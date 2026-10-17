// Reading along: while the audiobook linked to this ebook plays, the sentence
// being narrated is highlighted and the pages turn with it. Turning a page by
// hand lets you look around; the book catches up again after a moment.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { chapterLength, usePlayer } from "../audio/player";
import type { Draw } from "../vendor/foliate-js/overlayer.js";
import type { TocItem, View } from "../vendor/foliate-js/view.js";
import { chaptersUsable, matchChapters, sentenceAt, type TocEntry } from "./readAlong";

const MARK_KEY = "tbv-read-along";
const MARK_LIGHT = "#5f84ad";
const MARK_DARK = "#8fa3b5";
/** After a page is turned by hand, how long before the book follows the narrator again. */
const LOOK_AROUND_MS = 8000;

export interface ReadAlong {
  /** The linked audiobook, or null when there isn't one. */
  audiobookId: string | null;
  following: boolean;
  /** Starts the audiobook and follows it, or stops following (and pauses it). */
  toggle: () => void;
}

function flatten(items: TocItem[] | undefined, view: View, out: TocEntry[] = []): TocEntry[] {
  for (const item of items ?? []) {
    const index = item.href ? view.book.resolveHref(item.href)?.index : undefined;
    if (typeof index === "number") out.push({ label: item.label, index });
    flatten(item.subitems ?? undefined, view, out);
  }
  return out;
}

/** The text of a section, and a way back from a place in it to a range. */
function textOf(doc: Document) {
  const nodes: { node: Text; start: number }[] = [];
  let length = 0;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (!text.data.trim()) continue;
    nodes.push({ node: text, start: length });
    length += text.data.length;
  }
  return {
    length,
    /** The sentence `fraction` of the way through the section. */
    sentence(fraction: number): Range | null {
      const at = Math.floor(fraction * length);
      let hit = nodes[0];
      for (const x of nodes) if (x.start <= at) hit = x;
      if (!hit) return null;
      const [start, end] = sentenceAt(hit.node.data, at - hit.start);
      const range = doc.createRange();
      range.setStart(hit.node, start);
      range.setEnd(hit.node, Math.max(start, end));
      return range;
    },
  };
}

function wholeOnScreen(range: Range, visible: Range | null | undefined): boolean {
  if (!visible) return true;
  try {
    return (
      range.compareBoundaryPoints(Range.START_TO_START, visible) >= 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, visible) <= 0
    );
  } catch {
    return false;
  }
}

export function useReadAlong({
  getView,
  ready,
  bookId,
  dark,
  onStart,
}: {
  getView: () => View | null;
  ready: boolean;
  bookId: string;
  dark: boolean;
  /** Called as following starts, to stop reading aloud. */
  onStart: () => void;
}): ReadAlong {
  const player = usePlayer();
  const [audiobookId, setAudiobookId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const s = useRef({
    draw: null as Draw | null,
    moving: 0,
    heldUntil: 0,
    shown: null as { index: number; start: number; node: Node } | null,
    text: null as { index: number; doc: Document; t: ReturnType<typeof textOf> } | null,
  }).current;

  useEffect(() => {
    let current = true;
    api.audiobookForEbook(bookId).then(
      (id) => current && setAudiobookId(id),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [bookId]);

  const playingOurs = !!audiobookId && player.book?.book.id === audiobookId;
  // Opened from the audiobook while it plays: follow straight away.
  useEffect(() => {
    if (playingOurs && player.playing && ready) setFollowing(true);
    // Only as the book opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, audiobookId]);

  const view = ready ? getView() : null;
  const chapters = useMemo(() => {
    if (!view || !playingOurs || !player.book) return null;
    const matched = matchChapters(
      player.book.chapters.map((c) => c.title),
      flatten(view.book.toc, view),
    );
    return chaptersUsable(matched) ? matched : null;
  }, [view, playingOurs, player.book]);

  const clear = useCallback(() => {
    try {
      getView()?.renderer.getContents()[0]?.overlayer?.remove(MARK_KEY);
    } catch {
      /* the book has closed */
    }
    s.shown = null;
  }, [getView, s]);

  // Turning a page by hand: look around for a while.
  useEffect(() => {
    if (!view) return;
    const onRelocate = () => {
      if (s.moving === 0) s.heldUntil = Date.now() + LOOK_AROUND_MS;
    };
    view.addEventListener("relocate", onRelocate);
    return () => view.removeEventListener("relocate", onRelocate);
  }, [view, s]);

  // Follow the narrator.
  const book = player.book;
  const position = player.positionMs;
  useEffect(() => {
    if (!following || !view || !book || book.book.id !== audiobookId || Date.now() < s.heldUntil) return;
    // Where the narrator is: a section and how far through it.
    let index: number | undefined;
    let fraction = 0;
    const ci = player.chapterIndex;
    const section = chapters?.[ci];
    if (chapters && section !== null && section !== undefined) {
      index = section;
      const length = chapterLength(book, ci);
      fraction = length ? (position - book.chapters[ci].startMs) / length : 0;
    } else {
      const resolved = view.resolveNavigation({ fraction: position / Math.max(1, book.durationMs) });
      index = resolved?.index;
      fraction = typeof resolved?.anchor === "number" ? resolved.anchor : 0;
    }
    if (index === undefined) return;
    fraction = Math.min(1, Math.max(0, fraction));

    const run = async () => {
      const contents = view.renderer.getContents()[0];
      if (!contents || contents.index !== index) {
        s.moving++;
        try {
          await view.renderer.goTo({ index: index!, anchor: fraction });
        } finally {
          // The relocate event comes just after the move.
          setTimeout(() => s.moving--, 300);
        }
        return;
      }
      if (view.isFixedLayout) return;
      if (s.text?.doc !== contents.doc) s.text = { index: index!, doc: contents.doc, t: textOf(contents.doc) };
      const range = s.text.t.sentence(fraction);
      if (!range) return;
      if (s.shown?.node === range.startContainer && s.shown.start === range.startOffset) return;
      s.shown = { index: index!, node: range.startContainer, start: range.startOffset };
      if (!s.draw) s.draw = (await import("../vendor/foliate-js/overlayer.js")).Overlayer.highlight;
      try {
        contents.overlayer?.remove(MARK_KEY);
        contents.overlayer?.add(MARK_KEY, range, s.draw, { color: dark ? MARK_DARK : MARK_LIGHT });
      } catch {
        /* drawn with the next sentence */
      }
      if (!wholeOnScreen(range, view.lastLocation?.range)) {
        s.moving++;
        try {
          await view.renderer.scrollToAnchor?.(range);
        } finally {
          setTimeout(() => s.moving--, 300);
        }
      }
    };
    void run();
  }, [following, view, book, audiobookId, position, chapters, player.chapterIndex, dark, s]);

  useEffect(() => {
    if (!following) clear();
  }, [following, clear]);

  const toggle = useCallback(() => {
    if (!audiobookId) return;
    if (following) {
      setFollowing(false);
      if (player.playing) player.toggle();
      return;
    }
    onStart();
    s.heldUntil = 0;
    setFollowing(true);
    void player.load(audiobookId, true);
  }, [audiobookId, following, player, onStart, s]);

  return { audiobookId, following, toggle };
}
