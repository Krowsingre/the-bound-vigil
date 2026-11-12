// Reading along: while the audiobook linked to this ebook plays, the sentence
// being narrated is highlighted and the pages turn with it. Turning a page by
// hand lets you look around; the book catches up again after a moment.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { chapterLength, usePlayer } from "../audio/player";
import { chaptersUsable, matchChapters, sentenceAt } from "./readAlong";
import { linesUp, loadLineUp, onLinedUp, onLiningUp } from "../readAlong/lineUp";
import { placeOf, wordAt, wordsIn } from "../readAlong/timing";
const MARK_KEY = "tbv-read-along";
const MARK_LIGHT = "#5f84ad";
const MARK_DARK = "#8fa3b5";
/** After a page is turned by hand, how long before the book follows the narrator again. */
const LOOK_AROUND_MS = 8000;
function flatten(items, view, out = []) {
    for (const item of items ?? []) {
        const index = item.href ? view.book.resolveHref(item.href)?.index : undefined;
        if (typeof index === "number")
            out.push({ label: item.label, index });
        flatten(item.subitems ?? undefined, view, out);
    }
    return out;
}
/** The text of a section, and a way back from a place in it to a range. */
function textOf(doc) {
    const nodes = [];
    let length = 0;
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n;
        if (!text.data.trim())
            continue;
        nodes.push({ node: text, start: length });
        length += text.data.length;
    }
    let starts = null;
    return {
        length,
        /** Where the section's `n`th word starts, counted as read-along timing counts them. */
        wordStart(n) {
            starts ??= wordsIn(nodes.map((x) => x.node.data).join("")).map((w) => w.at);
            return starts[Math.min(n, starts.length - 1)] ?? null;
        },
        /** The sentence `fraction` of the way through the section. */
        sentence(fraction) {
            return this.sentenceAt(Math.floor(fraction * length));
        },
        /** The sentence holding the character `at` of the section's text. */
        sentenceAt(at) {
            let hit = nodes[0];
            for (const x of nodes)
                if (x.start <= at)
                    hit = x;
            if (!hit)
                return null;
            const [start, end] = sentenceAt(hit.node.data, at - hit.start);
            const range = doc.createRange();
            range.setStart(hit.node, start);
            range.setEnd(hit.node, Math.max(start, end));
            return range;
        },
    };
}
function wholeOnScreen(range, visible) {
    if (!visible)
        return true;
    try {
        return (range.compareBoundaryPoints(Range.START_TO_START, visible) >= 0 &&
            range.compareBoundaryPoints(Range.END_TO_END, visible) <= 0);
    }
    catch {
        return false;
    }
}
export function useReadAlong({ getView, ready, bookId, dark, manual = false, format = "", onStart, }) {
    const player = usePlayer();
    const [audiobookId, setAudiobookId] = useState(null);
    const [following, setFollowing] = useState(false);
    const s = useRef({
        draw: null,
        moving: 0,
        heldUntil: 0,
        shown: null,
        text: null,
    }).current;
    // How far lining up has got, and the timing once it's done. Looked at
    // again as this device lines it up, and now and then for another device's work.
    const [timing, setTiming] = useState(null);
    const [lineUp, setLineUp] = useState(null);
    useEffect(() => {
        if (!audiobookId) {
            setTiming(null);
            setLineUp(null);
            return;
        }
        let current = true;
        const load = () => loadLineUp(bookId, audiobookId).then((l) => {
            if (!current)
                return;
            setLineUp(l.state);
            setTiming(l.timing);
        }, () => undefined);
        void load();
        const ours = (e, a) => e === bookId && a === audiobookId;
        const stopHere = onLiningUp((l) => {
            if (l && ours(l.ebookId, l.audiobookId) && l.stage === "listening")
                setLineUp((was) => ({ done: false, failed: null, ...was, fraction: Math.min(0.99, l.fraction) }));
        });
        const stopDone = onLinedUp((e, a) => ours(e, a) && void load());
        const every = setInterval(() => void load(), 60_000);
        return () => {
            current = false;
            stopHere();
            stopDone();
            clearInterval(every);
        };
    }, [bookId, audiobookId]);
    useEffect(() => {
        let current = true;
        api.audiobookForEbook(bookId).then((id) => current && setAudiobookId(id), () => undefined);
        return () => {
            current = false;
        };
    }, [bookId]);
    const playingOurs = !!audiobookId && player.book?.book.id === audiobookId;
    // Opened from the audiobook while it plays: follow straight away.
    useEffect(() => {
        if (playingOurs && player.playing && ready && !manual)
            setFollowing(true);
        // Only as the book opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, audiobookId]);
    const view = ready ? getView() : null;
    const chapters = useMemo(() => {
        if (!view || !playingOurs || !player.book)
            return null;
        const matched = matchChapters(player.book.chapters.map((c) => c.title), flatten(view.book.toc, view));
        return chaptersUsable(matched) ? matched : null;
    }, [view, playingOurs, player.book]);
    const clear = useCallback(() => {
        try {
            for (const c of getView()?.renderer.getContents() ?? [])
                c.overlayer?.remove(MARK_KEY);
        }
        catch {
            /* the book has closed */
        }
        s.shown = null;
    }, [getView, s]);
    // Turning a page by hand: look around for a while.
    useEffect(() => {
        if (!view)
            return;
        const onRelocate = () => {
            if (s.moving === 0)
                s.heldUntil = Date.now() + LOOK_AROUND_MS;
        };
        view.addEventListener("relocate", onRelocate);
        return () => view.removeEventListener("relocate", onRelocate);
    }, [view, s]);
    // Follow the narrator.
    const book = player.book;
    const position = player.positionMs;
    useEffect(() => {
        if (!following || !view || !book || book.book.id !== audiobookId || Date.now() < s.heldUntil)
            return;
        // Where the narrator is: a section and how far through it, or which word of it.
        let index;
        let fraction = 0;
        let word = null;
        const ci = player.chapterIndex;
        const section = chapters?.[ci];
        const said = timing ? wordAt(timing, position, 10_000) : null;
        const place = timing && said !== null ? placeOf(timing, said) : null;
        if (timing && place) {
            index = place.section;
            word = place.word;
            fraction = timing.sections[index] ? place.word / timing.sections[index] : 0;
        }
        else if (chapters && section !== null && section !== undefined) {
            index = section;
            const length = chapterLength(book, ci);
            fraction = length ? (position - book.chapters[ci].startMs) / length : 0;
        }
        else {
            const resolved = view.resolveNavigation({ fraction: position / Math.max(1, book.durationMs) });
            index = resolved?.index;
            fraction = typeof resolved?.anchor === "number" ? resolved.anchor : 0;
        }
        if (index === undefined)
            return;
        fraction = Math.min(1, Math.max(0, fraction));
        const run = async () => {
            // In scroll mode several chapters can be laid out at once.
            const contents = view.renderer.getContents().find((c) => c.index === index);
            if (!contents) {
                s.moving++;
                try {
                    await view.renderer.goTo({ index: index, anchor: fraction });
                }
                finally {
                    // The relocate event comes just after the move.
                    setTimeout(() => s.moving--, 300);
                }
                return;
            }
            if (view.isFixedLayout)
                return;
            if (s.text?.doc !== contents.doc)
                s.text = { index: index, doc: contents.doc, t: textOf(contents.doc) };
            const start = word === null ? null : s.text.t.wordStart(word);
            const range = start === null ? s.text.t.sentence(fraction) : s.text.t.sentenceAt(start);
            if (!range)
                return;
            if (s.shown?.node === range.startContainer && s.shown.start === range.startOffset)
                return;
            s.shown = { index: index, node: range.startContainer, start: range.startOffset };
            if (!s.draw)
                s.draw = (await import("../vendor/foliate-js/overlayer.js")).Overlayer.highlight;
            try {
                for (const c of view.renderer.getContents())
                    c.overlayer?.remove(MARK_KEY);
                contents.overlayer?.add(MARK_KEY, range, s.draw, { color: dark ? MARK_DARK : MARK_LIGHT });
            }
            catch {
                /* drawn with the next sentence */
            }
            if (!wholeOnScreen(range, view.lastLocation?.range)) {
                s.moving++;
                try {
                    await view.renderer.scrollToAnchor?.(range);
                }
                finally {
                    setTimeout(() => s.moving--, 300);
                }
            }
        };
        void run();
    }, [following, view, book, audiobookId, position, chapters, player.chapterIndex, dark, s, timing]);
    useEffect(() => {
        if (!following)
            clear();
    }, [following, clear]);
    const toggle = useCallback(() => {
        if (!audiobookId)
            return;
        if (manual) {
            if (player.book?.book.id === audiobookId && player.playing)
                player.toggle();
            else {
                onStart();
                void player.load(audiobookId, true);
            }
            return;
        }
        if (following) {
            setFollowing(false);
            if (player.playing)
                player.toggle();
            return;
        }
        // Not lined up yet: the narrator can't be followed.
        if (linesUp(format) && !lineUp?.done && !lineUp?.failed)
            return;
        onStart();
        s.heldUntil = 0;
        setFollowing(true);
        void player.load(audiobookId, true);
    }, [audiobookId, following, player, onStart, s, manual, format, lineUp]);
    return {
        audiobookId,
        following,
        toggle,
        lineUp,
        linesUp: linesUp(format),
        manual,
        playing: playingOurs && player.playing,
    };
}
