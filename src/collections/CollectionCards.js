import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { Stars } from "../components/StarRating";
import { hashOf } from "../lib/format";
import { Badge } from "./badges";
import { bookCount, KIND_LABEL, pictureUrl, SMART_INFO } from "./collectionInfo";
/** A collection's picture, or a quiet tone when it has none. */
export function CollectionPicture({ collection, className = "", shape = "wide", }) {
    const src = pictureUrl(collection, shape);
    return (_jsx("span", { className: `collection-picture ${className}`, "data-tone": hashOf(collection.id) % 4, children: src ? (_jsx("img", { className: collection.picture?.startsWith("gallery:") ? undefined : "private-picture", src: src, alt: "", draggable: false })) : (_jsx("span", { className: "collection-picture-covers", children: collection.covers.slice(0, 3).map((c) => (_jsx(BookCover, { book: c, size: "m" }, c.id))) })) }));
}
export function CoverStrip({ covers, count, missing = [] }) {
    const lacking = missing.slice(0, Math.max(0, 3 - covers.length));
    return (_jsxs("span", { className: "cover-strip", children: [covers.map((c) => (_jsx(BookCover, { book: c, size: "m" }, c.id))), lacking.map((m, i) => (_jsx(MissingStripCover, { book: m }, `missing-${i}`))), Array.from({ length: Math.max(0, 3 - covers.length - lacking.length) }, (_, i) => (_jsx("span", { className: "cover-strip-empty", "aria-hidden": true, children: i === 0 && count === 0 ? "Empty" : "" }, i)))] }));
}
/** A book of the series the library lacks, greyed out as on the series' own page. */
function MissingStripCover({ book }) {
    const [failed, setFailed] = useState(false);
    return (_jsx("span", { className: "cover cover-m missing-cover", title: `${book.title} (missing)`, children: book.coverUrl && !failed ? (_jsx("img", { className: "private-picture", src: book.coverUrl, alt: "", draggable: false, onError: () => setFailed(true) })) : (_jsx("span", { className: "cover-generated missing-blank", children: _jsx("span", { className: "cover-title", children: book.title }) })) }));
}
/** The large picture cards in the pinned row. */
export function PinnedCard({ collection, selected, menu, onSelect, onOpen, }) {
    return (_jsxs("li", { className: `pinned-card${selected ? " is-selected" : ""}`, children: [_jsxs("button", { type: "button", className: "pinned-open", onClick: onSelect, onDoubleClick: onOpen, "aria-pressed": selected, children: [_jsx(CollectionPicture, { collection: collection, shape: "square" }), _jsxs("span", { className: "pinned-text", children: [_jsxs("span", { className: "pinned-name", children: [_jsx(Badge, { name: collection.badge, size: 16 }), collection.name] }), _jsx("span", { className: "pinned-count", children: bookCount(collection.count) })] })] }), _jsx(Menu, { label: `More for ${collection.name}`, trigger: _jsx(Icon, { name: "more" }), items: menu })] }));
}
export function SmartCard({ smart, selected, reorder, onSelect, onOpen, }) {
    const info = SMART_INFO[smart.kind];
    return (_jsx("li", { ...reorder, children: _jsxs("button", { type: "button", className: `smart-card${selected ? " is-selected" : ""}`, onClick: onSelect, onDoubleClick: onOpen, "aria-pressed": selected, title: info.description, children: [_jsx(Badge, { name: info.badge, size: 20 }), _jsxs("span", { className: "smart-text", children: [_jsx("span", { className: "smart-name", children: info.name }), _jsx("span", { className: "smart-count", children: bookCount(smart.count) })] })] }) }));
}
export function CollectionCard({ collection, layout, selected, menu, reorder, onSelect, onOpen, }) {
    return (_jsxs("li", { ...reorder, className: `collection-card collection-card-${layout}${selected ? " is-selected" : ""}`, "data-tone": hashOf(collection.id) % 4, children: [_jsxs("button", { type: "button", className: "collection-card-open", onClick: onSelect, onDoubleClick: onOpen, "aria-pressed": selected, children: [_jsxs("span", { className: "collection-card-head", children: [_jsxs("span", { className: "collection-card-name", children: [_jsx(Badge, { name: collection.badge, size: 16 }), collection.name] }), _jsxs("span", { className: "collection-card-meta", children: [bookCount(collection.count), collection.kind === "reading_list" && _jsxs(_Fragment, { children: [" \u00B7 ", KIND_LABEL.reading_list] }), collection.rating !== null && _jsx(Stars, { value: collection.rating, size: 11, label: `Average rating ${collection.rating.toFixed(1)} of 5` })] })] }), layout === "grid" ? (pictureUrl(collection) ? (_jsx(CollectionPicture, { collection: collection, className: "collection-card-picture" })) : (_jsx(CoverStrip, { covers: collection.covers, count: collection.count }))) : (_jsx("span", { className: "collection-card-desc", children: collection.description }))] }), _jsx(Menu, { label: `More for ${collection.name}`, trigger: _jsx(Icon, { name: "more" }), items: menu })] }));
}
export function SeriesCard({ series, layout, selected, onSelect, onOpen, }) {
    return (_jsx("li", { className: `collection-card collection-card-${layout}${selected ? " is-selected" : ""}`, "data-tone": hashOf(series.name) % 4, children: _jsxs("button", { type: "button", className: "collection-card-open", onClick: onSelect, onDoubleClick: onOpen, "aria-pressed": selected, children: [_jsxs("span", { className: "collection-card-head", children: [_jsxs("span", { className: "collection-card-name", children: [_jsx(Badge, { name: "scroll", size: 16 }), series.name] }), _jsxs("span", { className: "collection-card-meta", children: [bookCount(series.count), " \u00B7 Series"] })] }), layout === "grid" ? (_jsx(CoverStrip, { covers: series.covers, count: series.count, missing: series.missing })) : (_jsx("span", { className: "collection-card-desc", children: series.authors.join(", ") }))] }) }));
}
