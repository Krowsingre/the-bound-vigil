import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { api } from "../api";
import { useCoverOnView } from "../lib/coverOnView";
import { authorLine, hashOf } from "../lib/format";
import { isAudio, isDocument } from "../lib/queryBooks";
import { Icon } from "./Icon";
// Muted cloth tones for books that ship without cover art.
const CLOTH = ["#2f3a44", "#3d3a33", "#33403a", "#41323a", "#2e3540", "#463c2e"];
export function BookCover({ book, size = "m", onExpand, seriesCount, seriesPublished }) {
    const [failed, setFailed] = useState(false);
    const [element, setElement] = useState(null);
    // On iPhone a cover comes down from the cloud when it's shown.
    const fetched = useCoverOnView(book.id, !!book.coverPath, element);
    const cover = book.coverPath ?? fetched;
    const morePublished = seriesCount !== undefined && seriesPublished !== undefined && seriesPublished > seriesCount;
    const seriesLabel = morePublished ? `${seriesCount} in your library · at least ${seriesPublished} published` : `${seriesCount} books in your library`;
    const src = cover && !failed ? api.coverUrl(cover) : "";
    return (_jsxs("div", { ref: setElement, className: `cover cover-${size}${book.format && isAudio(book.format) ? " cover-audio" : ""}`, children: [_jsxs("div", { className: "cover-private", "aria-hidden": true, children: [_jsx("span", { className: "cover-title", children: book.title }), _jsx("span", { className: "cover-author", children: authorLine(book.authors) })] }), src ? (_jsx("img", { src: src, alt: "", draggable: false, onError: () => setFailed(true) })) : (_jsxs("div", { className: "cover-generated", style: { background: CLOTH[hashOf(book.id) % CLOTH.length] }, children: [_jsx("span", { className: "cover-title", children: book.title }), _jsx("span", { className: "cover-author", children: authorLine(book.authors) })] })), src && onExpand && _jsx("button", { type: "button", className: "cover-expand", "aria-label": "Expand cover for " + book.title, onClick: () => onExpand(src) }), book.paired && book.format && (_jsx("span", { className: "cover-pair", title: isAudio(book.format) ? "Its ebook is in your library" : "Its audiobook is in your library", children: _jsx(Icon, { name: isAudio(book.format) ? "library" : "headphones", size: 12, label: isAudio(book.format) ? "Has its ebook" : "Has its audiobook" }) })), book.format && isDocument(book.format) && (_jsxs("span", { className: "cover-doc", title: `A document (${book.format.toUpperCase()})`, children: [_jsx(Icon, { name: "file", size: 12 }), " ", book.format.toUpperCase()] })), book.availability === "cloud" && (_jsx("span", { className: "cover-badge", title: "In your library, not downloaded to this device", children: _jsx(Icon, { name: "cloud", size: 14, label: "In the cloud" }) })), seriesCount !== undefined && _jsx("span", { className: `cover-series-count${morePublished ? " has-more" : ""}`, title: seriesLabel, "aria-label": seriesLabel, children: seriesCount }), book.availability === "missing" && (_jsx("span", { className: "cover-badge cover-badge-warn", title: "The file is missing from this device", children: _jsx(Icon, { name: "warning", size: 14, label: "File missing" }) }))] }));
}
