import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { authorLine, percent } from "../lib/format";
import { WindowControls } from "../shell/WindowControls";
import { formatNumber, formatPage, pageAtFraction } from "./pages";
/** The reader's own title bar, in place of the app header. */
export function ReaderTopBar({ title, authors, focus, onHome, search, textSettings, readAloud, bookmarked, onToggleBookmark, notesOpen, noteCount, onToggleNotes, menu, avatar, fullscreen, onToggleFullscreen, onExitFocus, }) {
    return (_jsxs("header", { className: `reader-top${focus ? " reader-top-focus" : ""}`, "data-tauri-drag-region": true, children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Back to Sanctum", title: "Back to Sanctum", onClick: onHome, children: _jsx(Icon, { name: "home", size: 20 }) }), !focus && (_jsxs(_Fragment, { children: [_jsx("span", { className: "reader-top-rule", "aria-hidden": true }), _jsx("span", { className: "reader-top-app", children: "The Bound Vigil" })] })), _jsx("span", { className: "reader-top-rule", "aria-hidden": true }), _jsxs("span", { className: "reader-top-title", "data-tauri-drag-region": true, children: [_jsx("strong", { children: title }), _jsx("span", { className: "reader-top-rule", "aria-hidden": true }), _jsx("span", { className: "reader-top-author", children: authorLine(authors) })] }), _jsx("span", { className: "reader-top-spacer", "data-tauri-drag-region": true }), focus ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Leave focus mode (Esc)", title: "Leave focus mode (Esc)", onClick: onExitFocus, children: _jsx(Icon, { name: "focus", size: 20 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": fullscreen ? "Leave full screen (F11)" : "Full screen (F11)", title: fullscreen ? "Leave full screen (F11)" : "Full screen (F11)", onClick: onToggleFullscreen, children: _jsx(Icon, { name: fullscreen ? "exitFullscreen" : "fullscreen", size: 20 }) })] })) : (_jsxs(_Fragment, { children: [search, _jsx("span", { className: "reader-top-rule", "aria-hidden": true }), textSettings, readAloud, _jsx("button", { type: "button", className: `icon-btn${bookmarked ? " is-on" : ""}`, "aria-label": bookmarked ? "Remove bookmark (Ctrl+B)" : "Bookmark this page (Ctrl+B)", title: bookmarked ? "Remove bookmark (Ctrl+B)" : "Bookmark this page (Ctrl+B)", "aria-pressed": bookmarked, onClick: onToggleBookmark, children: _jsx(Icon, { name: "bookmark", size: 20, filled: bookmarked }) }), _jsxs("button", { type: "button", className: `icon-btn reader-notes-btn${notesOpen ? " is-on" : ""}`, "aria-label": "Highlights and notes", title: "Highlights and notes", "aria-pressed": notesOpen, onClick: onToggleNotes, children: [_jsx(Icon, { name: "notes", size: 20 }), noteCount > 0 && _jsx("span", { className: "dot", "aria-hidden": true })] }), _jsx(Menu, { label: "More", trigger: _jsx(Icon, { name: "more", size: 20 }), items: menu, menuClassName: "menu-narrow" }), avatar, _jsx(WindowControls, {})] })), focus && _jsx(WindowControls, {})] }));
}
/** Page, a slider to go anywhere, percent read, chapter, and page turns. */
export function ReaderBottomBar({ position, fraction, chapter, onContents, onSeek, onPrev, onNext, focus, zoom, }) {
    // While dragging, the label shows where you'd land; the book moves on release.
    const [dragging, setDragging] = useState(null);
    const shown = dragging ?? fraction;
    const total = position?.total ?? 0;
    const shownPage = dragging !== null && total ? { page: pageAtFraction(dragging, total), total } : position;
    const commit = () => {
        if (dragging !== null)
            onSeek(dragging);
        setDragging(null);
    };
    return (_jsxs("footer", { className: `reader-bottom${focus ? " reader-bottom-focus" : ""}${zoom && !focus ? " has-zoom" : ""}`, children: [_jsx("span", { className: "reader-bottom-page", children: shownPage ? formatPage(shownPage) : " " }), _jsx("input", { type: "range", className: "reader-slider", min: 0, max: 1, step: 0.0005, value: shown, style: { ["--fill"]: `${shown * 100}%` }, "aria-label": "Position in book", "aria-valuetext": shownPage ? formatPage(shownPage) : percent(shown), onChange: (e) => setDragging(Number(e.target.value)), onPointerUp: commit, onKeyUp: commit, onBlur: () => setDragging(null) }), _jsx("span", { className: "reader-bottom-percent", children: percent(shown) }), _jsx("button", { type: "button", className: "reader-bottom-chapter", title: "Show contents", "aria-label": chapter ? `Show contents: ${chapter}` : "Show contents", onClick: onContents, children: chapter || "Contents" }), !focus && zoom, !focus && (_jsxs("span", { className: "reader-bottom-turns", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Previous page", title: "Previous page (\u2190)", onClick: onPrev, children: _jsx(Icon, { name: "chevronLeft", size: 20 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Next page", title: "Next page (\u2192)", onClick: onNext, children: _jsx(Icon, { name: "chevronRight", size: 20 }) })] }))] }));
}
/** "Return to previous location", shown after jumping somewhere. */
export function ReturnPill({ jump, onReturn, onDismiss }) {
    return (_jsxs("div", { className: "return-pill", role: "status", children: [_jsxs("button", { type: "button", className: "return-pill-go", onClick: onReturn, children: [_jsx(Icon, { name: "arrowLeft", size: 16 }), "Return to previous location", jump.page !== null && _jsxs("span", { className: "return-pill-from", children: ["From page ", formatNumber(jump.page)] })] }), _jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": "Dismiss", title: "Dismiss", onClick: onDismiss, children: _jsx(Icon, { name: "close", size: 14 }) })] }));
}
/** A small panel anchored to a button, closed by clicking elsewhere or Escape. */
export function Popover({ label, trigger, children, className = "", title = label, on = false, muted = false, }) {
    const [open, setOpen] = useState(false);
    const root = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const close = (e) => {
            if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target))
                setOpen(false);
        };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", close);
        };
    }, [open]);
    return (_jsxs("div", { className: "menu-root", ref: root, children: [_jsx("button", { type: "button", className: `icon-btn${open || on ? " is-on" : ""}${muted ? " is-muted" : ""}`, "aria-label": label, "aria-description": title !== label ? title : undefined, title: title, "aria-expanded": open, "aria-haspopup": "dialog", onClick: () => setOpen((o) => !o), children: trigger }), open && (_jsx("div", { className: `menu menu-end popover ${className}`, role: "dialog", "aria-label": label, children: children }))] }));
}
