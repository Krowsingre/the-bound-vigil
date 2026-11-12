import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// "Kindle, not in library" (embre, 5 November 2026): the books bought on
// Kindle that aren't in the library yet. A book leaves the list by itself
// once it's added to the library, or by hand, which is remembered.
import { useEffect, useMemo, useState } from "react";
import { Menu } from "../components/Menu";
import { askBrowser } from "../browse/browserAsk";
import { addressFor, readBrowserPrefs } from "../browse/browserPrefs";
import { KindleArchivePicker } from "./KindleArchivePicker";
import { api, openExternal } from "../api";
import { KindleReviewDialog } from "../imports/KindleReview";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { hashOf } from "../lib/format";
import { CoverStrip } from "./CollectionCards";
import { bookCount } from "./collectionInfo";
export const KINDLE_NAME = "Kindle, not in library";
const AT_ONCE = 120;
export function KindleCard({ summary, layout, onOpen }) {
    return (_jsx("li", { className: `collection-card collection-card-${layout} kindle-card`, "data-tone": hashOf(KINDLE_NAME) % 4, children: _jsxs("button", { type: "button", className: "collection-card-open", onClick: onOpen, children: [_jsxs("span", { className: "collection-card-head", children: [_jsxs("span", { className: "collection-card-name", children: [_jsx(Icon, { name: "tag", size: 16 }), KINDLE_NAME] }), _jsxs("span", { className: "collection-card-meta", children: [bookCount(summary.missing), " \u00B7 From Kindle"] })] }), layout === "grid" ? (_jsx(CoverStrip, { covers: [], count: summary.missing, missing: summary.covers })) : (_jsx("span", { className: "collection-card-desc", children: "Bought on Kindle, not yet in your library." }))] }) }));
}
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);
export function KindleView({ onBack, onChanged, onDiscover, filter }) {
    const toast = useToast();
    const [removed, setRemoved] = useState(false);
    const [list, setList] = useState(null);
    const [shown, setShown] = useState(AT_ONCE);
    const [reload, setReload] = useState(0);
    const [waiting, setWaiting] = useState(0);
    const [picking, setPicking] = useState(null);
    const [review, setReview] = useState(null);
    useEffect(() => {
        let live = true;
        setList(null);
        api.kindleMissing(removed).then((l) => {
            if (!live)
                return;
            setList(l);
            void api.kindleSummary().then((k) => live && setWaiting(k.waiting), () => undefined);
        }, (e) => live && (toast(`The Kindle list couldn't be loaded: ${String(e)}`), setList([])));
        return () => void (live = false);
    }, [removed, reload, toast]);
    useEffect(() => setShown(AT_ONCE), [removed, filter]);
    const q = filter.trim().toLowerCase();
    const matching = useMemo(() => (list ?? []).filter((p) => !q || p.title.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)), [list, q]);
    const change = (p) => api.setKindleRemoved([p.asin], !removed).then(() => {
        setList((l) => l?.filter((x) => x.asin !== p.asin) ?? l);
        toast(removed ? `${p.title} is back on the list.` : `${p.title} is off the list. Show removed books to bring it back.`);
        onChanged();
    }, (e) => toast(`That didn't work: ${String(e)}`));
    return (_jsxs("div", { className: "collection-view kindle-view", children: [_jsx("header", { className: "collection-hero kindle-hero", children: _jsxs("div", { className: "collection-hero-text", children: [_jsxs("button", { type: "button", className: "back-link", onClick: onBack, children: [_jsx(Icon, { name: "chevronLeft", size: 14 }), " Collections"] }), _jsxs("h1", { children: [_jsx(Icon, { name: "tag", size: 26 }), KINDLE_NAME] }), _jsx("p", { className: "collection-hero-meta", children: list ? `${bookCount(list.length)}${removed ? " taken off the list" : " · From Kindle"}` : "Looking…" }), _jsx("p", { className: "collection-hero-description", children: "Books you've bought on Kindle that aren't in your library yet. Each one leaves the list by itself once you add it. TBV can't download Kindle books, so this is a list of what's still to bring over." })] }) }), _jsxs("div", { className: "collection-view-tools kindle-tools", children: [_jsxs("label", { className: "kindle-show-removed", children: [_jsx("input", { type: "checkbox", checked: removed, onChange: (e) => setRemoved(e.target.checked) }), " Show removed books"] }), waiting > 0 && (_jsxs("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => void api.kindleReview().then(setReview, (e) => toast(`That didn't work: ${String(e)}`)), children: ["Review ", waiting.toLocaleString(), " ", waiting === 1 ? "match" : "matches"] })), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setReload((n) => n + 1), children: [_jsx(Icon, { name: "sync", size: 14 }), " Check the library again"] })] }), list === null ? (_jsx("div", { className: "library-loading", "aria-busy": "true" })) : matching.length === 0 ? (_jsxs("div", { className: "library-empty collections-empty", children: [_jsx("h2", { children: q ? "Nothing matches" : removed ? "Nothing taken off the list" : "Every Kindle book is in your library" }), _jsx("p", { className: "muted", children: q ? `No Kindle books match “${filter.trim()}”.` : removed ? "Books you take off the list wait here." : "When you have a newer list, choose it in Import books." })] })) : (_jsxs(_Fragment, { children: [_jsx("ul", { className: "missing-row kindle-row", children: matching.slice(0, shown).map((p) => (_jsx(KindleBook, { book: p, removed: removed, onMatch: () => setPicking(p), onDiscover: onDiscover, onChange: () => void change(p) }, p.asin))) }), matching.length > shown && (_jsxs("button", { type: "button", className: "btn btn-quiet kindle-more", onClick: () => setShown((n) => n + AT_ONCE), children: ["Show more (", (matching.length - shown).toLocaleString(), " left)"] }))] })), picking && (_jsx(KindleArchivePicker, { purchase: picking, onClose: (matched) => {
                    setPicking(null);
                    if (matched) {
                        setList((previous) => previous?.filter((book) => book.asin !== picking.asin) ?? previous);
                        onChanged();
                    }
                } })), review && (_jsx(KindleReviewDialog, { review: review, imported: null, onClose: (applied) => {
                    setReview(null);
                    if (applied) {
                        setReload((n) => n + 1);
                        onChanged();
                    }
                } }))] }));
}
function KindleBook({ book, removed, onChange, onMatch, onDiscover }) {
    const toast = useToast();
    const query = [book.title, book.author].filter(Boolean).join(" ");
    const [failed, setFailed] = useState(false);
    const day = dayOf(book.acquiredAt);
    return (_jsxs("li", { className: `missing-card${book.read ? " is-read" : ""}${removed ? " is-hidden" : ""}`, children: [_jsxs("div", { className: "cover cover-m missing-cover kindle-cover", children: [_jsx("div", { className: "cover-private", "aria-hidden": true, children: _jsx("span", { className: "cover-title", children: book.title }) }), book.coverUrl && !failed ? (_jsx("img", { className: "private-picture", src: book.coverUrl, alt: "", draggable: false, onError: () => setFailed(true) })) : (_jsx("div", { className: "cover-generated missing-blank", children: _jsx("span", { className: "cover-title", children: book.title }) })), book.read && _jsx("span", { className: "missing-badge", children: "Read" })] }), _jsx("span", { className: "missing-title", title: book.title, children: book.title }), _jsx("span", { className: "kindle-author muted", title: book.author, children: book.author || "Unknown author" }), _jsxs("span", { className: "missing-meta", children: [_jsx("span", { className: "muted", children: day ?? "" }), _jsx(Menu, { label: "More for " + book.title, trigger: _jsx(Icon, { name: "more", size: 16 }), items: [
                            { label: "Copy title and author", icon: "copy", onSelect: () => void navigator.clipboard.writeText(query).then(() => toast("Copied title and author."), () => toast("Couldn't copy the title and author.")) },
                            { label: "Search in Discover", icon: "search", disabled: !onDiscover, onSelect: () => {
                                    const url = addressFor(query, readBrowserPrefs().search);
                                    if (url && onDiscover) {
                                        askBrowser({ url });
                                        onDiscover();
                                    }
                                } },
                            { label: "Open on Amazon", icon: "link", onSelect: () => void openExternal(book.link) },
                            { label: "It's in my Archive", icon: "library", onSelect: onMatch },
                            { label: removed ? "Put it back on the list" : "Take it off the list", icon: removed ? "undo" : "close", onSelect: onChange },
                        ] })] })] }));
}
