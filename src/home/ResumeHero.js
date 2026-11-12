import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { authorLine, percent, relativeTime } from "../lib/format";
import { bookContextMenu, bookMenu } from "./bookActions";
/** The book to carry on with: its cover beside the title, how far along, and Continue reading. */
export function ResumeHero({ book, actions, onOpenLibrary, }) {
    if (!book) {
        return (_jsx("section", { className: "hero hero-empty", "aria-labelledby": "hero-title", children: _jsxs("div", { className: "hero-body", children: [_jsx("p", { className: "eyebrow", children: "Continue reading" }), _jsx("h1", { id: "hero-title", className: "hero-title", children: "Begin reading" }), _jsx("p", { className: "hero-synopsis", children: "Nothing is in progress yet. Choose a book from Recently added, or open your Archive to find one." }), _jsx("div", { className: "hero-actions", children: _jsxs("button", { type: "button", className: "btn btn-primary", onClick: onOpenLibrary, children: ["Open Archive ", _jsx("span", { "aria-hidden": true, children: "\u2192" })] }) })] }) }));
    }
    // Where the other devices are, for anyone who points at the progress bar.
    // The book's own cover, enlarged and softened, behind the card (embre's choice).
    const backdrop = book.coverPath ? api.coverUrl(book.coverPath) : "";
    const chapter = book.resumeLocator?.chapter?.trim();
    const elsewhere = book.remotePositions.map((r) => `On ${r.deviceName} you're at ${percent(r.totalProgression)} (${relativeTime(r.at)})`).join("\n");
    return (_jsxs("section", { className: `hero${backdrop ? " has-backdrop" : ""}`, "aria-labelledby": "hero-title", ...bookContextMenu(book, actions), children: [backdrop && (_jsx("div", { className: "hero-backdrop", "aria-hidden": true, children: _jsx("img", { className: "private-picture", src: backdrop, alt: "", draggable: false }) })), _jsxs("div", { className: "hero-inner", children: [_jsx("button", { type: "button", className: "hero-cover", onClick: () => actions.open(book), "aria-label": `Open ${book.title}`, children: _jsx(BookCover, { book: book, size: "l" }) }), _jsxs("div", { className: "hero-body", children: [_jsx("p", { className: "eyebrow", children: "Continue reading" }), _jsx("h1", { id: "hero-title", className: "hero-title", children: book.title }), _jsx("p", { className: "hero-author", children: authorLine(book.authors) }), _jsxs("p", { className: "hero-where", children: [_jsx("span", { className: "hero-percent", children: percent(book.totalProgression) }), chapter && (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": true, children: " \u00B7 " }), _jsx("span", { className: "hero-chapter", children: chapter })] }))] }), _jsxs("div", { className: "hero-progress", title: elsewhere || undefined, children: [_jsx(ProgressBar, { value: book.totalProgression }), _jsx("span", { className: "hero-percent", children: percent(book.totalProgression) })] }), elsewhere && _jsx("p", { className: "visually-hidden", children: elsewhere }), _jsxs("div", { className: "hero-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary btn-large", onClick: () => actions.open(book), children: [_jsx(Icon, { name: "play", size: 16 }), " Continue reading"] }), _jsx(Menu, { label: `More for ${book.title}`, className: "icon-btn icon-btn-round", trigger: _jsx(Icon, { name: "more" }), items: bookMenu(book, actions), align: "start" })] })] })] })] }));
}
