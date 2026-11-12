import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Discover: a web browser, with ebooks you download offered to your library.
// The row's globe-plus button opens the catalogues: the Bible picker and any
// you add (free ones are suggested, none built in).
// Whatever comes in joins the import queue like any other book.
import { Catalogs } from "../catalogs/Catalogs";
import { Icon } from "../components/Icon";
import { askBrowser } from "./browserAsk";
import { Browser } from "./Browser";
export function Browse({ refreshKey, onOpenBook, catalogues, onOpenCatalogues, onCloseCatalogues, search, onSearchChange, allowTabSplit, onSplitWith, }) {
    return (_jsxs("div", { className: "library browse-page browse-browser", children: [_jsx(Browser, { onOpenCatalogues: onOpenCatalogues, onOpenBook: onOpenBook, search: search, onSearchChange: onSearchChange, allowSplit: allowTabSplit, companion: false, onSplitWith: onSplitWith }), catalogues && (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onCloseCatalogues(), children: _jsxs("div", { className: "dialog catalogues-panel", role: "dialog", "aria-label": "Catalogues", onKeyDown: (e) => e.key === "Escape" && onCloseCatalogues(), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx("h2", { children: "Catalogues" }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onCloseCatalogues, children: _jsx(Icon, { name: "close", size: 18 }) })] }), _jsx(Catalogs, { refreshKey: refreshKey, onOpenBook: (id, at) => {
                                onCloseCatalogues();
                                onOpenBook(id, at);
                            }, onOpenSite: (url) => {
                                onCloseCatalogues();
                                askBrowser({ url });
                            } })] }) }))] }));
}
