import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › Activity: what TBV is doing in the background, one switch
// apart: books being imported, what sync is sending and fetching, and pairs
// of books and audiobooks being lined up for read-along.
import { useEffect, useState } from "react";
import { api, isApp, isIOS } from "../api";
import { moved, useReorder } from "../collections/useReorder";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { showBookDetails } from "../details/openDetails";
import { PageSwitch } from "../library/Library";
import { PauseLiningUpButton, pausedUntilText } from "../readAlong/PauseLiningUp";
import { liningUp, liningUpPaused, liningUpPausedUntil, linesUp, onLinedUp, onLiningUp, onPauseChange, pauseAfterThis, pausingAfterThis, readLineUp, } from "../readAlong/lineUp";
export function ActivityTab({ side, onSide, imports, sync, }) {
    return (_jsxs("div", { className: "activity-tab", children: [_jsx(PageSwitch, { label: "Which activity", value: side, options: [
                    { value: "imports", label: "Imports" },
                    ...(api.kind === "web" ? [] : [{ value: "sync", label: "Sync" }]),
                    ...(isApp || api.kind === "preview" ? [{ value: "lining", label: "Confluence" }] : []),
                ], onChange: onSide }), side === "imports" ? imports : side === "sync" ? sync : _jsx(LiningUpPane, {})] }));
}
/** Every pair, and how far each is lined up. */
function LiningUpPane() {
    const [rows, setRows] = useState(null);
    const [now, setNow] = useState(liningUp());
    const [paused, setPaused] = useState(liningUpPaused());
    const [after, setAfter] = useState(pausingAfterThis());
    useEffect(() => onPauseChange(() => {
        setPaused(liningUpPaused());
        setAfter(pausingAfterThis());
    }), []);
    const [reload, setReload] = useState(0);
    const [view, setView] = useState("queued");
    // A pair no device has both halves of can't converge anywhere, so it waits outside the queue, saying why.
    const queued = (rows ?? []).filter((r) => r.pair.queued && r.pair.somewhere && stillToDo(r.pair));
    const out = (rows ?? []).filter((r) => (!r.pair.queued || !r.pair.somewhere) && stillToDo(r.pair));
    const finished = (rows ?? []).filter((r) => !stillToDo(r.pair));
    const order = queued.map((r) => keyOf(r.pair));
    // Shown at once; the next look at the list confirms it.
    const move = (key, to) => {
        const next = moved(order, key, to);
        const byKey = new Map((rows ?? []).map((r) => [keyOf(r.pair), r]));
        const placed = next.map((k) => byKey.get(k));
        setRows([...placed, ...(rows ?? []).filter((r) => !next.includes(keyOf(r.pair)))]);
        void api.orderReadAlongQueue(placed.map((r) => [r.pair.ebookId, r.pair.audiobookId])).finally(() => setReload((n) => n + 1));
    };
    const reorder = useReorder(order, true, move);
    const setQueued = (row, on) => {
        setRows((rows ?? []).map((r) => (r === row ? { ...r, pair: { ...r.pair, queued: on } } : r)));
        void api.setReadAlongQueued(row.pair.ebookId, row.pair.audiobookId, on).finally(() => setReload((n) => n + 1));
    };
    useEffect(() => onLiningUp(setNow), []);
    useEffect(() => onLinedUp(() => setReload((n) => n + 1)), []);
    // Another device's pieces arrive with sync, so the list looks again now and then.
    useEffect(() => {
        const t = setInterval(() => setReload((n) => n + 1), 30_000);
        return () => clearInterval(t);
    }, []);
    useEffect(() => {
        let current = true;
        const title = (id) => api.bookDetails(id).then((d) => d.book.title, () => "");
        void api.readAlongPairs().then(async (pairs) => {
            const found = await Promise.all(pairs.map(async (pair) => ({
                pair,
                ebook: await title(pair.ebookId),
                audiobook: await title(pair.audiobookId),
            })));
            if (current)
                setRows(found);
        }, () => current && setRows([]));
        return () => {
            current = false;
        };
    }, [reload]);
    return (_jsxs("div", { className: "activity-pane", children: [_jsxs("header", { className: "activity-head", children: [_jsx("div", { children: _jsxs("p", { className: "settings-row-hint", children: ["In Confluence, each book paired with its audiobook converges with it word by word, one pair at a time, on every device that has both downloaded. A computer works from the start and a phone from the end, so together they meet in the middle.", isIOS && " On this phone it's off until you turn it on in Preferences › Reading › Read-along."] }) }), _jsxs("div", { className: "imports-actions", children: [now && !paused && (_jsxs("button", { type: "button", className: `btn btn-quiet${after ? " is-active" : ""}`, "aria-pressed": after, title: after ? "Carry on with the next pair after all" : "Finish this pair, then pause", onClick: () => pauseAfterThis(!after), children: [_jsx(Icon, { name: "pause", size: 16 }), " ", after ? "Pausing after this" : "Pause after this"] })), _jsx(PauseLiningUpButton, { pauseLabel: "Pause now" })] })] }), paused && _jsxs("p", { className: "settings-row-hint activity-paused", children: ["Paused on this device ", pausedUntilText(liningUpPausedUntil()), "."] }), now && (_jsxs("section", { className: "imports-summary", "aria-live": "polite", children: [_jsxs("div", { className: "imports-summary-text", children: [_jsxs("h2", { children: [now.title || "A book", " is converging"] }), _jsx("p", { className: "settings-row-hint", children: now.stage === "cooling"
                                    ? `Paused while the phone cools down, ${Math.floor(now.fraction * 100)}% done`
                                    : now.stage === "model"
                                        ? now.modelTotal
                                            ? `Getting the speech model: ${mb(now.modelLoaded)} of ${mb(now.modelTotal)}`
                                            : "Getting the speech model ready…"
                                        : `${Math.floor(now.fraction * 100)}% done` })] }), _jsx(ProgressBar, { value: now.stage === "model" && now.modelTotal ? now.modelLoaded / now.modelTotal : now.fraction, label: `${Math.floor(now.fraction * 100)}% converged` })] })), rows === null ? null : rows.length === 0 ? (_jsxs("div", { className: "imports-empty", children: [_jsx(Icon, { name: "confluence", size: 28 }), _jsx("p", { children: "No books are paired with audiobooks yet. Pair one from a book's details, and it converges here." })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "lining-switch", children: _jsx(PageSwitch, { label: "Which pairs", value: view, options: [
                                { value: "queued", label: `Queued · ${queued.length}` },
                                { value: "out", label: `Not queued · ${out.length}` },
                            ], onChange: setView }) }), view === "queued" ? (_jsx("section", { className: "imports-group", children: queued.length === 0 ? (_jsx("p", { className: "settings-row-hint", children: "Nothing is queued. Add pairs from Not queued, and they converge in the order you choose." })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "settings-row-hint", children: "The first pair converges next. Drag to change the order, or use the arrows." }), _jsx("ul", { className: "imports-list", children: queued.map((r, index) => {
                                        const k = keyOf(r.pair);
                                        return (_jsxs(PairRow, { row: r, now: now, paused: paused, place: index + 1, reorder: reorder(k), children: [_jsx("button", { type: "button", className: "icon-btn", title: "Move to the top", "aria-label": "Move to the top", disabled: index === 0, onClick: () => move(k, 0), children: _jsx(Icon, { name: "arrowUp", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", title: "Move up", "aria-label": "Move up", disabled: index === 0, onClick: () => move(k, index - 1), children: _jsx(Icon, { name: "chevronUp", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", title: "Move down", "aria-label": "Move down", disabled: index === queued.length - 1, onClick: () => move(k, index + 1), children: _jsx(Icon, { name: "chevronDown", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", title: "Take out of the queue", "aria-label": "Take out of the queue", onClick: () => setQueued(r, false), children: _jsx(Icon, { name: "minus", size: 16 }) })] }, k));
                                    }) })] })) })) : (_jsx("section", { className: "imports-group", children: out.length === 0 ? (_jsx("p", { className: "settings-row-hint", children: "Every pair still to converge is in the queue." })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "settings-row-hint", children: "These pairs don't converge until you add them to the queue. A pair needs the book and its audiobook both downloaded on at least one device, and joins the queue by itself once they are." }), _jsx("ul", { className: "imports-list", children: out.map((r) => (_jsx(PairRow, { row: r, now: now, paused: paused, children: r.pair.somewhere && !r.pair.queued && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => setQueued(r, true), children: [_jsx(Icon, { name: "plus", size: 16 }), " Add to queue"] })) }, keyOf(r.pair)))) })] })) })), finished.length > 0 && (_jsxs("section", { className: "imports-group", children: [_jsxs("h3", { className: "section-label", children: ["Finished \u00B7 ", finished.length] }), _jsx("ul", { className: "imports-list", children: finished.map((r) => (_jsx(PairRow, { row: r, now: now, paused: paused }, keyOf(r.pair)))) })] }))] }))] }));
}
const keyOf = (p) => `${p.ebookId}|${p.audiobookId}`;
/** Still to be lined up (not done, not given up on, and a book with words to follow). */
const stillToDo = (p) => {
    if (!linesUp(p.ebookFormat))
        return false;
    const l = readLineUp(p.timing);
    return !l?.done && !l?.failed;
};
function PairRow({ row, now, paused, place, reorder, children, }) {
    const live = now && now.ebookId === row.pair.ebookId && now.audiobookId === row.pair.audiobookId ? now : null;
    const { text, tone } = state(row.pair, live, paused);
    return (_jsxs("li", { ...reorder, tabIndex: reorder?.draggable ? 0 : undefined, className: `import-row${tone === "bad" ? " is-bad" : ""}${live ? " is-current" : ""}`, children: [place ? _jsx("span", { className: "lining-place", children: place }) : _jsx(Icon, { name: tone === "ok" ? "checkCircle" : tone === "bad" ? "warning" : "confluence", size: 18 }), _jsxs("button", { type: "button", className: "import-text link-like", onClick: () => showBookDetails(row.pair.ebookId), children: [_jsx("span", { className: "import-name", children: row.ebook || "A book" }), _jsxs("span", { className: "import-detail", children: [row.audiobook ? `With ${row.audiobook} · ` : "", text] })] }), children && _jsx("span", { className: "lining-actions", children: children })] }));
}
const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
function state(pair, live, paused) {
    if (!linesUp(pair.ebookFormat))
        return {
            text: "A document or comic: the pages are turned by hand",
            tone: "same",
        };
    const l = readLineUp(pair.timing);
    if (l?.done)
        return { text: "Converged word by word", tone: "ok" };
    if (l?.failed)
        return {
            text: `Couldn't converge: ${l.failed} It follows by chapter.`,
            tone: "bad",
        };
    const sofar = l ? Math.floor(Math.min(0.99, pair.pieces / l.pieces) * 100) : 0;
    if (live)
        return {
            text: `Converging now: ${Math.floor(live.fraction * 100)}%`,
            tone: "same",
        };
    if (!pair.somewhere)
        return {
            text: `${sofar ? `${sofar}% so far. ` : ""}Not queued: no device has both the book and the audiobook downloaded`,
            tone: "same",
        };
    if (!pair.queued)
        return { text: sofar ? `${sofar}% so far. Left out of the queue` : "Left out of the queue", tone: "same" };
    if (!pair.here)
        return {
            text: `${sofar}% so far. Converges on another device that has both downloaded`,
            tone: "same",
        };
    if (paused)
        return { text: `${sofar}% so far. Paused on this device`, tone: "same" };
    return {
        text: sofar ? `${sofar}% so far, waiting its turn` : "Waiting its turn",
        tone: "same",
    };
}
