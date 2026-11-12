import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Looking over duplicate books: filters by format, the sharpest cover for
// every copy, deleting every copy of one format, and cleaning up by rule.
import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { copiesOfFormat, DEFAULT_FORMAT_ORDER, formatOrder, hasYourReading, keeperAfter, matchesFilter, planCleanup, setFormats, } from "../library/duplicatePlan";
import { authorLine } from "../lib/format";
import { readLocal, writeLocal } from "./appSettings";
import { formatBytes, Segmented } from "./controls";
const SAVED = "tbv.duplicates";
const PAGE = 100;
const copies = (n) => `${n.toLocaleString()} ${n === 1 ? "copy" : "copies"}`;
const sets = (n) => `${n.toLocaleString()} ${n === 1 ? "set" : "sets"}`;
const size = (books) => formatBytes(books.reduce((sum, b) => sum + b.fileSize, 0));
function facts(b) {
    return [
        b.format.toUpperCase(),
        b.fileSize ? formatBytes(b.fileSize) : null,
        b.coverSize ? `cover ${b.coverSize[0]}×${b.coverSize[1]}` : "no cover",
        `added ${new Date(b.addedAt).toLocaleDateString()}`,
        b.status === "in_progress" ? `${Math.round((b.totalProgression ?? 0) * 100)}% read` : b.status === "read" ? "read" : null,
        b.notes ? `${b.notes} ${b.notes === 1 ? "note" : "notes"}` : null,
        b.availability === "cloud" ? "in the cloud" : null,
    ]
        .filter(Boolean)
        .join(" · ");
}
/** A set can be helped when its covers differ in size, or some copies have none. */
/** Copies in different formats can be one book with several files. */
const canKeepTogether = (g) => setFormats(g).length > 1;
function canShareCover(g) {
    const areas = g.books.map((b) => (b.coverSize ? b.coverSize[0] * b.coverSize[1] : 0));
    return Math.max(...areas) > 0 && areas.some((a) => a < Math.max(...areas));
}
export function DuplicatesDialog({ groups: start, onClose }) {
    const toast = useToast();
    const [groups, setGroups] = useState(start);
    const [filter, setFilter] = useState({ kind: "all" });
    const [limit, setLimit] = useState(PAGE);
    const [view, setView] = useState("list");
    const [deleting, setDeleting] = useState(null);
    const [bulkFormat, setBulkFormat] = useState(null);
    const [work, setWork] = useState(null);
    const stop = useRef(false);
    const allFormats = useMemo(() => [...new Set(groups.flatMap(setFormats))].sort(), [groups]);
    const shown = useMemo(() => groups.filter((g) => matchesFilter(g, filter)), [groups, filter]);
    const shownFormats = useMemo(() => [...new Set(shown.flatMap(setFormats))].sort(), [shown]);
    const [savedOrder, setSavedOrder] = useState(() => {
        const saved = readLocal(SAVED).order;
        return Array.isArray(saved) ? saved.map(String) : DEFAULT_FORMAT_ORDER;
    });
    const order = useMemo(() => formatOrder(savedOrder, groups), [savedOrder, groups]);
    const busy = work !== null;
    const refresh = async () => {
        const fresh = await api.findDuplicates();
        setGroups(fresh);
    };
    /** Runs `steps` one at a time with progress; a library stays usable meanwhile. */
    const run = async (label, steps) => {
        stop.current = false;
        setWork({ label, done: 0, total: steps.length });
        let done = 0;
        let failed = 0;
        for (const step of steps) {
            if (stop.current)
                break;
            try {
                await step();
            }
            catch {
                failed++;
            }
            done++;
            if (done % 5 === 0 || done === steps.length)
                setWork({ label, done, total: steps.length });
        }
        try {
            await refresh();
        }
        catch {
            /* the list just stays as it was */
        }
        setWork(null);
        return { done, failed };
    };
    const shareCovers = async (list) => {
        const { failed } = await run("Giving every copy the sharpest cover", list.map((g) => () => api.shareBestCover(g.books.map((b) => b.id))));
        toast(failed ? `Done, but ${sets(failed)} couldn't be changed.` : `Every copy in ${sets(list.length)} now has the sharpest cover.`);
    };
    const removeOne = async (book) => {
        setDeleting(null);
        try {
            const set = groups.find((g) => g.books.some((b) => b.id === book.id));
            const keeper = set && keeperAfter(set, [book], order);
            if (keeper)
                await api.mergeReading(keeper.id, book.id);
            await api.deleteBook(book.id);
            toast(`Deleted “${book.title}” (${book.format.toUpperCase()}).`);
            setGroups((list) => list.map((g) => ({ ...g, books: g.books.filter((b) => b.id !== book.id) })).filter((g) => g.books.length > 1));
        }
        catch (e) {
            toast(`Couldn't delete it: ${String(e)}`);
        }
    };
    const bulk = bulkFormat ? copiesOfFormat(shown, bulkFormat, order) : null;
    const deleteFormat = async () => {
        if (!bulk || !bulkFormat)
            return;
        const format = bulkFormat.toUpperCase();
        setBulkFormat(null);
        const { done, failed } = await run(`Deleting every ${format} copy`, bulk.remove.map((b) => async () => {
            const keeper = bulk.into.get(b.id);
            if (keeper)
                await api.mergeReading(keeper.id, b.id);
            await api.deleteBook(b.id);
        }));
        toast(failed ? `Deleted ${copies(done - failed)}; ${copies(failed)} couldn't be deleted.` : `Deleted ${copies(done)}.`);
    };
    const keepTogether = async (list) => {
        const { done, failed } = await run("Keeping each set together as one book", list.map((g) => async () => {
            const main = keeperAfter(g, [], order);
            if (main)
                await api.keepTogether(main.id, g.books.filter((b) => b.id !== main.id).map((b) => b.id));
        }));
        toast(failed
            ? `Kept ${sets(done - failed)} together; ${sets(failed)} couldn't be.`
            : list.length === 1
                ? "Kept together as one book. Its formats are listed in its details."
                : `Kept ${sets(done)} together, each as one book.`);
    };
    const dismiss = (g) => void api.dismissDuplicates(g.key).then(() => setGroups((list) => list.filter((x) => x.key !== g.key)), (e) => toast(String(e)));
    const saveOrder = (next) => {
        setSavedOrder(next);
        writeLocal(SAVED, { order: next });
    };
    const filterKind = filter.kind;
    const exactly = filter.kind === "exactly" ? filter.formats : [];
    return (_jsxs("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onClose(), children: [_jsxs("div", { className: "dialog duplicates-dialog", role: "dialog", "aria-label": "Duplicate books", onKeyDown: (e) => !deleting && !bulkFormat && !busy && e.key === "Escape" && onClose(), children: [_jsx("h2", { children: "Duplicate books" }), work ? (_jsx(WorkProgress, { work: work, onStop: () => (stop.current = true) })) : view === "cleanup" ? (_jsx(CleanupView, { groups: shown, order: order, onOrder: saveOrder, onBack: () => setView("list"), onRun: async (steps, withCover) => {
                            // One set at a time: its cover first, and its copies go only once that worked.
                            const list = steps.map((s) => async () => {
                                if (withCover)
                                    await api.shareBestCover([s.keep.id, ...s.remove.map((b) => b.id)]);
                                // Your notes and place move first, so nothing of yours goes with a copy.
                                for (const b of s.remove) {
                                    await api.mergeReading(s.keep.id, b.id);
                                    await api.deleteBook(b.id);
                                }
                            });
                            const removed = steps.reduce((n, s) => n + s.remove.length, 0);
                            const { done, failed } = await run(`Cleaning up ${sets(steps.length)}`, list);
                            setView("list");
                            toast(done < list.length
                                ? "Stopped. What was done stays done."
                                : failed
                                    ? `Cleaned up, but ${sets(failed)} didn't work. Those are still listed.`
                                    : `Cleaned up ${sets(steps.length)} and deleted ${copies(removed)}.`);
                        } })) : (_jsxs(_Fragment, { children: [groups.length === 0 ? (_jsx("p", { className: "muted", children: "All sorted. No more duplicates to look at." })) : (_jsxs("p", { className: "muted", children: [sets(groups.length), " of books look alike. Clean them up by rule, or delete copies one by one. The sharpest cover can go on every copy first, and it stays after the others are deleted."] })), groups.length > 0 && (_jsxs("div", { className: "duplicate-tools", children: [_jsx(Segmented, { label: "Which sets to show", value: filterKind, options: [
                                            { value: "all", label: "All sets" },
                                            { value: "same", label: "One format" },
                                            { value: "exactly", label: "These formats" },
                                        ], onChange: (kind) => {
                                            setLimit(PAGE);
                                            setFilter(kind === "exactly" ? { kind, formats: exactly } : { kind });
                                        } }), filter.kind === "exactly" && (_jsx("div", { className: "duplicate-formats", role: "group", "aria-label": "Formats in a set", children: allFormats.map((f) => {
                                            const on = exactly.includes(f);
                                            return (_jsx("button", { type: "button", className: `duplicate-format${on ? " is-on" : ""}`, "aria-pressed": on, onClick: () => {
                                                    setLimit(PAGE);
                                                    setFilter({ kind: "exactly", formats: on ? exactly.filter((x) => x !== f) : [...exactly, f] });
                                                }, children: f.toUpperCase() }, f));
                                        }) })), _jsx("p", { className: "muted duplicate-count", children: filter.kind === "exactly" && exactly.length === 0
                                            ? "Pick the formats a set should be made of."
                                            : `Showing ${sets(shown.length)}${shown.length === groups.length ? "" : ` of ${groups.length.toLocaleString()}`}.` }), shown.length > 0 && (_jsxs("div", { className: "duplicate-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => setView("cleanup"), children: [_jsx(Icon, { name: "check", size: 14 }), " Clean up by rule\u2026"] }), shown.some(canKeepTogether) && (_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", title: "Each set becomes one book with a file per format, sharing its notes, highlights and place", onClick: () => void keepTogether(shown.filter(canKeepTogether)), children: [_jsx(Icon, { name: "link", size: 14 }), " Keep every set together"] })), shown.some(canShareCover) && (_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void shareCovers(shown.filter(canShareCover)), children: [_jsx(Icon, { name: "image", size: 14 }), " Sharpest cover for every set"] })), _jsxs("label", { className: "duplicate-bulk", children: [_jsx("span", { className: "visually-hidden", children: "Delete every copy of a format" }), _jsxs("select", { className: "settings-select", value: "", onChange: (e) => e.target.value && setBulkFormat(e.target.value), "aria-label": "Delete every copy of a format in the sets shown", children: [_jsx("option", { value: "", children: "Delete every\u2026" }), shownFormats.map((f) => (_jsxs("option", { value: f, children: [f.toUpperCase(), " in the sets shown"] }, f)))] })] })] }))] })), _jsxs("div", { className: "duplicate-groups", children: [shown.slice(0, limit).map((g) => (_jsxs("section", { className: "duplicate-group", children: [_jsxs("header", { children: [_jsx("span", { className: "muted", children: g.reason }), canShareCover(g) && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", title: "Every copy gets the largest cover between them", onClick: () => void shareCovers([g]), children: "Use the sharpest cover" })), canKeepTogether(g) && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", title: "One book with a file per format, sharing its notes, highlights and place", onClick: () => void keepTogether([g]), children: "Keep together" })), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => dismiss(g), children: "Not duplicates" })] }), _jsx("ul", { children: g.books.map((b) => (_jsxs("li", { className: "duplicate-book", children: [_jsx(BookCover, { book: b, size: "s" }), _jsxs("span", { className: "duplicate-text", children: [_jsx("strong", { children: b.title }), _jsx("span", { className: "muted", children: authorLine(b.authors) }), _jsx("span", { className: "muted duplicate-facts", children: facts(b) })] }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setDeleting(b), children: [_jsx(Icon, { name: "trash", size: 14 }), " Delete"] })] }, b.id))) })] }, g.key))), shown.length > limit && (_jsxs("button", { type: "button", className: "btn btn-quiet duplicate-more", onClick: () => setLimit((l) => l + PAGE), children: ["Show ", Math.min(PAGE, shown.length - limit), " more"] }))] }), _jsx("div", { className: "dialog-actions", children: _jsx("button", { type: "button", className: "btn btn-primary", onClick: onClose, children: "Done" }) })] }))] }), deleting && (_jsx(ConfirmDialog, { title: `Delete this copy of “${deleting.title}”?`, body: `The ${deleting.format.toUpperCase()} copy leaves your library on every device${deleting.notes ? `, with its ${deleting.notes} ${deleting.notes === 1 ? "note" : "notes"}` : ""}. The other copies stay.`, confirm: "Delete copy", danger: true, onCancel: () => setDeleting(null), onConfirm: () => void removeOne(deleting) })), bulkFormat && bulk && (_jsx(ConfirmDialog, { title: bulk.remove.length ? `Delete ${copies(bulk.remove.length)} in ${bulkFormat.toUpperCase()}?` : `No ${bulkFormat.toUpperCase()} copies can go`, body: [
                    bulk.remove.length
                        ? `They leave your library on every device (${size(bulk.remove)}). Every set keeps at least one copy: where a set is all ${bulkFormat.toUpperCase()}, its best copy stays.`
                        : `Each of these is the last copy of its set.`,
                    bulk.remove.some(hasYourReading) ? "Your notes, highlights and place on them move to the copy each set keeps." : "",
                ]
                    .filter(Boolean)
                    .join(" "), confirm: bulk.remove.length ? "Delete them" : "OK", danger: bulk.remove.length > 0, onCancel: () => setBulkFormat(null), onConfirm: () => (bulk.remove.length ? void deleteFormat() : setBulkFormat(null)) }))] }));
}
function WorkProgress({ work, onStop }) {
    return (_jsxs("div", { className: "duplicate-work", "aria-live": "polite", children: [_jsxs("p", { children: [work.label, "\u2026 ", work.done.toLocaleString(), " of ", work.total.toLocaleString()] }), _jsx("progress", { max: work.total, value: work.done }), _jsx("p", { className: "muted", children: "You can keep using TBV. Stopping keeps what's already done." }), _jsx("div", { className: "dialog-actions", children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: onStop, children: "Stop" }) })] }));
}
function CleanupView({ groups, order, onOrder, onBack, onRun, }) {
    const plan = useMemo(() => planCleanup(groups, order), [groups, order]);
    const [skipped, setSkipped] = useState(new Set());
    const [withCover, setWithCover] = useState(true);
    const [limit, setLimit] = useState(PAGE);
    const [confirming, setConfirming] = useState(false);
    const [dragging, setDragging] = useState(null);
    const seen = new Set(groups.flatMap(setFormats));
    const chosen = plan.steps.filter((s) => !skipped.has(s.key));
    const removing = chosen.flatMap((s) => s.remove);
    const move = (format, to) => {
        const next = order.filter((f) => f !== format);
        next.splice(Math.max(0, Math.min(to, next.length)), 0, format);
        onOrder(next);
    };
    const visibleOrder = order.filter((f) => seen.has(f));
    return (_jsxs("div", { className: "duplicate-cleanup", children: [_jsxs("section", { className: "duplicate-rules", children: [_jsx("h3", { children: "Which copy stays" }), _jsx("ol", { className: "duplicate-order", "aria-label": "Formats, best first", children: visibleOrder.map((f, i) => (_jsxs("li", { draggable: true, className: dragging === f ? "is-dragging" : undefined, onDragStart: (e) => {
                                setDragging(f);
                                e.dataTransfer.effectAllowed = "move";
                            }, onDragEnd: () => setDragging(null), onDragOver: (e) => e.preventDefault(), onDrop: (e) => {
                                e.preventDefault();
                                if (dragging && dragging !== f)
                                    move(dragging, order.indexOf(f));
                                setDragging(null);
                            }, children: [_jsx("span", { className: "num", children: i + 1 }), _jsx("strong", { children: f.toUpperCase() }), _jsx("button", { type: "button", className: "btn btn-quiet btn-icon btn-small", "aria-label": `Move ${f.toUpperCase()} up`, disabled: i === 0, onClick: () => move(f, order.indexOf(visibleOrder[i - 1])), children: _jsx(Icon, { name: "chevronUp", size: 14 }) }), _jsx("button", { type: "button", className: "btn btn-quiet btn-icon btn-small", "aria-label": `Move ${f.toUpperCase()} down`, disabled: i === visibleOrder.length - 1, onClick: () => move(f, order.indexOf(visibleOrder[i + 1])), children: _jsx(Icon, { name: "chevronDown", size: 14 }) })] }, f))) }), _jsxs("ul", { className: "muted duplicate-rule-notes", children: [_jsx("li", { children: "The copy in the format highest on this list stays. Drag to change the order." }), _jsx("li", { children: "When copies share that format, the largest file stays." }), _jsx("li", { children: "A copy with your notes, progress, rating, favourite, tags or collections always stays." })] }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: withCover, onChange: (e) => setWithCover(e.target.checked) }), _jsx("span", { children: "Give the copy that stays the sharpest cover first" })] })] }), _jsx("p", { className: "duplicate-summary", children: plan.steps.length
                    ? `${sets(chosen.length)}: ${copies(removing.length)} to delete (${size(removing)}).`
                    : "Nothing to clean up in the sets shown." }), _jsxs("ul", { className: "duplicate-plan", children: [plan.steps.slice(0, limit).map((s) => {
                        const on = !skipped.has(s.key);
                        return (_jsx("li", { className: on ? undefined : "is-off", children: _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: on, onChange: () => setSkipped((all) => {
                                            const next = new Set(all);
                                            if (on)
                                                next.add(s.key);
                                            else
                                                next.delete(s.key);
                                            return next;
                                        }) }), _jsxs("span", { className: "duplicate-plan-text", children: [_jsx("strong", { children: s.keep.title }), _jsxs("span", { children: ["Keep ", _jsx("b", { children: s.keep.format.toUpperCase() }), s.keep.fileSize ? ` ${formatBytes(s.keep.fileSize)}` : "", " ", _jsxs("span", { className: "muted", children: ["(", s.why.replace(/\.$/, "").toLowerCase(), ")"] })] }), _jsxs("span", { className: "muted", children: ["Delete ", s.remove.map((b) => `${b.format.toUpperCase()}${b.fileSize ? ` ${formatBytes(b.fileSize)}` : ""}`).join(", ")] })] })] }) }, s.key));
                    }), plan.steps.length > limit && (_jsx("li", { children: _jsxs("button", { type: "button", className: "btn btn-quiet duplicate-more", onClick: () => setLimit((l) => l + PAGE), children: ["Show ", Math.min(PAGE, plan.steps.length - limit), " more"] }) }))] }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onBack, children: "Back" }), _jsxs("button", { type: "button", className: "btn btn-danger", disabled: !removing.length, onClick: () => setConfirming(true), children: ["Delete ", copies(removing.length)] })] }), confirming && (_jsx(ConfirmDialog, { title: `Delete ${copies(removing.length)}?`, body: `They leave your library on every device (${size(removing)}). ${sets(chosen.length)} each keep one copy${withCover ? ", with the sharpest cover" : ""}.`, confirm: "Delete them", danger: true, onCancel: () => setConfirming(false), onConfirm: () => {
                    setConfirming(false);
                    void onRun(chosen, withCover);
                } }))] }));
}
