// Reading along: while the audiobook linked to this ebook plays, the sentence
// being narrated is highlighted and the pages turn with it. Turning a page by
// hand lets you look around; the book catches up again after a moment.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { chapterLength, usePlayer } from "../audio/player";
import type { Draw } from "../vendor/foliate-js/overlayer.js";
import type { TocItem, View } from "../vendor/foliate-js/view.js";
import { chaptersUsable, matchChapters, sentenceAt, type TocEntry } from "./readAlong";
import { onPreparing, STEP_MS } from "../readAlong/prepare";
import { placeOf, readTiming, wordAt, wordsIn, type Timing } from "../readAlong/timing";

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
  /** Word timing worked out for this pair: all of it, some of it, or none yet. */
  timed: "all" | "some" | null;
  /** A document: the audiobook plays, but the pages are turned by hand. */
  manual: boolean;
  /** The linked audiobook is playing. */
  playing: boolean;
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
  let starts: number[] | null = null;
  return {
    length,
    /** Where the section's `n`th word starts, counted as read-along timing counts them. */
    wordStart(n: number): number | null {
      starts ??= wordsIn(nodes.map((x) => x.node.data).join("")).map((w) => w.at);
      return starts[Math.min(n, starts.length - 1)] ?? null;
    },
    /** The sentence `fraction` of the way through the section. */
    sentence(fraction: number): Range | null {
      return this.sentenceAt(Math.floor(fraction * length));
    },
    /** The sentence holding the character `at` of the section's text. */
    sentenceAt(at: number): Range | null {
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
  manual = false,
  onStart,
}: {
  getView: () => View | null;
  ready: boolean;
  bookId: string;
  dark: boolean;
  /** A document: TBV can't follow it, so the audiobook only plays alongside. */
  manual?: boolean;
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

  // Word timing, once worked out; reloaded now and then while it's being worked out.
  const [timing, setTiming] = useState<Timing | null>(null);
  useEffect(() => {
    if (!audiobookId) return setTiming(null);
    let current = true;
    let loadedAt = 0;
    const load = () => {
      loadedAt = Date.now();
      api.readAlongTiming(bookId, audiobookId).then(
        (json) => current && setTiming(readTiming(json)),
        () => undefined,
      );
    };
    load();
    const stop = onPreparing((p) => {
      if (p?.ebookId !== bookId || p.audiobookId !== audiobookId) return;
      if (p.stage !== "listening" || Date.now() - loadedAt > 30_000) load();
    });
    return () => {
      current = false;
      stop();
    };
  }, [bookId, audiobookId]);

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
    if (playingOurs && player.playing && ready && !manual) setFollowing(true);
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
      for (const c of getView()?.renderer.getContents() ?? []) c.overlayer?.remove(MARK_KEY);
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
    // Where the narrator is: a section and how far through it, or which word of it.
    let index: number | undefined;
    let fraction = 0;
    let word: number | null = null;
    const ci = player.chapterIndex;
    const section = chapters?.[ci];
    const said = timing ? wordAt(timing, position, STEP_MS * 2) : null;
    const place = timing && said !== null ? placeOf(timing, said) : null;
    if (timing && place) {
      index = place.section;
      word = place.word;
      fraction = timing.sections[index] ? place.word / timing.sections[index] : 0;
    } else if (chapters && section !== null && section !== undefined) {
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
      // In scroll mode several chapters can be laid out at once.
      const contents = view.renderer.getContents().find((c) => c.index === index);
      if (!contents) {
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
      const start = word === null ? null : s.text.t.wordStart(word);
      const range = start === null ? s.text.t.sentence(fraction) : s.text.t.sentenceAt(start);
      if (!range) return;
      if (s.shown?.node === range.startContainer && s.shown.start === range.startOffset) return;
      s.shown = { index: index!, node: range.startContainer, start: range.startOffset };
      if (!s.draw) s.draw = (await import("../vendor/foliate-js/overlayer.js")).Overlayer.highlight;
      try {
        for (const c of view.renderer.getContents()) c.overlayer?.remove(MARK_KEY);
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
  }, [following, view, book, audiobookId, position, chapters, player.chapterIndex, dark, s, timing]);

  useEffect(() => {
    if (!following) clear();
  }, [following, clear]);

  const toggle = useCallback(() => {
    if (!audiobookId) return;
    if (manual) {
      if (player.book?.book.id === audiobookId && player.playing) player.toggle();
      else {
        onStart();
        void player.load(audiobookId, true);
      }
      return;
    }
    if (following) {
      setFollowing(false);
      if (player.playing) player.toggle();
      return;
    }
    onStart();
    s.heldUntil = 0;
    setFollowing(true);
    void player.load(audiobookId, true);
  }, [audiobookId, following, player, onStart, s, manual]);

  return {
    audiobookId,
    following,
    toggle,
    timed: timing?.anchors.length ? (timing.done ? "all" : "some") : null,
    manual,
    playing: playingOurs && player.playing,
  };
}
