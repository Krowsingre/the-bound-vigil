import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { ServerRows } from "./ServerRows";
import { LocalSendRows } from "./LocalSendRows";
export function importCounts(view) {
    return { done: view.done, total: view.total, running: view.done < view.total };
}
function size(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function outcome(result) {
    switch (result?.outcome) {
        case "imported":
            return result.returned ? { text: "Deleted before, added to Previously deleted", tone: "same" } : { text: "Added", tone: "ok" };
        case "skippedDeleted":
            return { text: "Deleted before, skipped", tone: "same" };
        case "alreadyInLibrary":
            return { text: "Already in your library", tone: "same" };
        case "unsupported":
            return { text: "Not a book format TBV reads", tone: "bad" };
        case "failed":
            return { text: `Couldn't be added: ${result.reason}`, tone: "bad" };
        default:
            return { text: "Done", tone: "ok" };
    }
}
export function Imports({ view, onCancel, onClear, onImportBooks, onImportFolder, onOpenBook, servers, sent = [], embedded = false, }) {
    const { done, total, running } = importCounts(view);
    const { current, waiting, finished } = view;
    // Whole-import progress counts the books under way by how much of them is read.
    const partly = view.currentBytes ? (view.currentRead / view.currentBytes) * current.length : 0;
    const overall = total ? (done + partly * 0.9) / total : 0;
    const added = view.added;
    const problems = view.failed + view.unsupported;
    return (_jsxs("div", { className: `imports-page${embedded ? " activity-pane" : " library"}`, children: [_jsxs("header", { className: embedded ? "activity-head" : "library-head", children: [_jsxs("div", { children: [!embedded && _jsx("h1", { className: "library-title", children: "Imports" }), _jsx("p", { className: embedded ? "settings-row-hint" : "eyebrow", children: "Books being added to your library" })] }), _jsxs("div", { className: "imports-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: onImportFolder, children: [_jsx(Icon, { name: "folder", size: 16 }), " Import folder"] }), _jsxs("button", { type: "button", className: "btn btn-primary", onClick: onImportBooks, children: [_jsx("span", { "aria-hidden": true, children: "+" }), " Import books"] })] })] }), _jsx(LocalSendRows, { rows: sent }), servers && _jsx(ServerRows, { queue: servers }), total === 0 ? (sent.length > 0 || (servers && (servers.view.counts.total > 0 || servers.view.looking.length > 0)) ? null : (_jsxs("div", { className: "imports-empty", children: [_jsx(Icon, { name: "download", size: 28 }), _jsx("p", { children: "Nothing is being imported. Books you import, or drop on the window, show up here while they're added." })] }))) : (_jsxs(_Fragment, { children: [_jsxs("section", { className: "imports-summary", "aria-live": "polite", children: [_jsxs("div", { className: "imports-summary-text", children: [_jsx("h2", { children: running ? `Adding ${Math.min(done + 1, total)} of ${total} ${total === 1 ? "book" : "books"}` : `Finished: ${total} ${total === 1 ? "book" : "books"}` }), _jsxs("p", { className: "settings-row-hint", children: [added, " added", view.returned > 0 && ` (${view.returned} previously deleted, in the Previously deleted collection)`, view.already > 0 && `, ${view.already} already in your library`, view.skippedDeleted > 0 && `, ${view.skippedDeleted} previously deleted and skipped`, problems > 0 && `, ${problems} couldn't be added`, running && ". You can keep using TBV meanwhile."] })] }), _jsx(ProgressBar, { value: running ? overall : 1, label: `${Math.round((running ? overall : 1) * 100)}% imported` }), _jsxs("div", { className: "imports-summary-actions", children: [(view.waitingCount > 0 || view.current.length > 0) && (_jsx("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: onCancel, children: "Stop importing" })), done > 0 && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClear, children: "Clear finished" }))] })] }), current.length > 0 && (_jsxs("section", { className: "imports-group", children: [_jsx("h3", { className: "section-label", children: "Now" }), _jsx("ul", { className: "imports-list", children: current.map((i) => (_jsxs("li", { className: "import-row is-current", children: [_jsx(Icon, { name: "download", size: 18 }), _jsxs("div", { className: "import-text", children: [_jsx("span", { className: "import-name", children: i.name }), _jsx("span", { className: "import-detail", children: i.stage === "adding"
                                                        ? "Copying into your library…"
                                                        : `Reading ${size(i.bytesRead)} of ${size(i.bytes)}${i.bytes > 5 * 1024 * 1024 ? " (files in a cloud folder may download first)" : ""}` }), _jsx(ProgressBar, { value: i.bytes ? i.bytesRead / i.bytes : 0, label: `${i.name} progress` })] })] }, i.id))) })] })), waiting.length > 0 && (_jsxs("section", { className: "imports-group", children: [_jsxs("h3", { className: "section-label", children: ["Up next \u00B7 ", view.waitingCount] }), _jsx("ul", { className: "imports-list", children: waiting.map((i) => (_jsxs("li", { className: "import-row", children: [_jsx(Icon, { name: "clock", size: 18 }), _jsxs("div", { className: "import-text", children: [_jsx("span", { className: "import-name", children: i.name }), _jsx("span", { className: "import-detail", children: size(i.bytes) })] })] }, i.id))) }), view.waitingCount > waiting.length && _jsxs("p", { className: "settings-row-hint", children: ["And ", view.waitingCount - waiting.length, " more."] })] })), finished.length > 0 && (_jsxs("section", { className: "imports-group", children: [_jsxs("h3", { className: "section-label", children: ["Finished \u00B7 ", done, done > finished.length && ` · latest ${finished.length} shown`] }), _jsx("ul", { className: "imports-list", children: finished.map((i) => {
                                    const o = outcome(i.result);
                                    const bookId = i.result && "bookId" in i.result ? i.result.bookId : null;
                                    return (_jsxs("li", { className: `import-row is-${o.tone}`, children: [_jsx(Icon, { name: o.tone === "bad" ? "warning" : "check", size: 18 }), _jsxs("div", { className: "import-text", children: [_jsx("span", { className: "import-name", children: i.result && "title" in i.result ? i.result.title : i.name }), _jsx("span", { className: "import-detail", children: o.text })] }), bookId && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => onOpenBook(bookId), children: "Read" }))] }, i.id));
                                }) })] }))] }))] }));
}
