import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRememberedDisclosure } from "../components/RememberedDetails";
// Discover's start page, drawn by TBV (so it opens at once, and offline):
// a search box that hands over to the address box, tiles for Bookmarks,
// History, Downloads and the Reading List, Quick Links on gallery paintings,
// and the sites visited lately.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { galleryUrl } from "../collections/gallery";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { clearClosedTabs } from "./browserTabs";
import { ClosedList } from "./ClosedList";
import { clearHistory, onHistory, readHistory, removeFromHistory } from "./browserHistory";
import { onBrowserPrefs, readBrowserPrefs, siteOf } from "./browserPrefs";
import { backgroundUrl, DiscoverBackgroundPicker } from "./DiscoverBackground";
import { QuickLinksEditor, freePainting } from "./QuickLinksEditor";
import { SiteBadge } from "./SiteBadge";
/** Paintings light enough on their left side (where the name sits) for dark text. */
const LIGHT_PAINTINGS = new Set([
    "aurelian-castle",
    "blush-botanical",
    "coastal-ruins",
    "vintage-herbarium",
    "snowbound-peaks",
    "winter-valley",
    "classical-coastal-ruins",
    "waterfall-citadel",
    "quiet-blossoms",
]);
export const isLightPainting = (name) => LIGHT_PAINTINGS.has(name);
/** How many sites Recent Sites shows. */
const RECENT = 5;
/** A site's front door, for Recent Sites and Quick Links: its address without the page. */
const originOf = (url) => {
    try {
        return new URL(url).origin;
    }
    catch {
        return url;
    }
};
function recentSites() {
    const seen = new Set();
    const sites = [];
    for (const e of readHistory()) {
        if (e.kind !== "page")
            continue;
        const site = siteOf(e.url);
        if (!site || seen.has(site))
            continue;
        seen.add(site);
        sites.push({ url: e.url, title: e.title?.trim() || site, site });
        if (sites.length === RECENT)
            break;
    }
    return sites;
}
const TILES = [
    { panel: "bookmarks", label: "Bookmarks", icon: "compass" },
    { panel: "history", label: "History", icon: "clock" },
    { panel: "downloads", label: "Downloads", icon: "download" },
    { panel: "reading", label: "Reading List", icon: "notes" },
];
export function StartPage({ onGo, onNewTab, onPanel, search, onSearchChange, onSearch, closed, onReopen, privately = false, }) {
    const toast = useToast();
    const [links, setLinks] = useState([]);
    const [editing, setEditing] = useState(false);
    const [recent, setRecent] = useState(recentSites);
    const [clearing, setClearing] = useState(false);
    const [clearingClosed, setClearingClosed] = useState(false);
    const [showClosed, setShowClosed] = useRememberedDisclosure("discover.closedTabs");
    const [showRecentList, setShowRecentList] = useRememberedDisclosure("discover.recentSites", true);
    const [prefs, setPrefs] = useState(readBrowserPrefs);
    useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
    const showRecent = prefs.showRecent && prefs.historyOn;
    const backdrop = backgroundUrl(prefs.background);
    const [choosing, setChoosing] = useState(false);
    // The picture stops at the scroll bar, so it never runs under it.
    const scroller = useRef(null);
    const [bar, setBar] = useState(0);
    useEffect(() => {
        const el = scroller.current;
        if (!el)
            return;
        const measure = () => setBar(el.offsetWidth - el.clientWidth);
        measure();
        const watch = new ResizeObserver(measure);
        watch.observe(el);
        if (el.firstElementChild)
            watch.observe(el.firstElementChild);
        return () => watch.disconnect();
    }, []);
    const reload = useCallback(() => api.quickLinks().then(setLinks, () => undefined), []);
    useEffect(() => void reload(), [reload]);
    useEffect(() => onHistory(() => setRecent(recentSites())), []);
    const used = useMemo(() => links.map((l) => l.picture), [links]);
    const addQuick = async (title, url) => {
        try {
            await api.addQuickLink(title, originOf(url) + "/", freePainting(used));
            await reload();
            toast(`${title} is in your Quick Links.`);
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
    };
    return (_jsxs(_Fragment, { children: [backdrop && _jsx("div", { className: "start-backdrop", style: { backgroundImage: `url(${backdrop})`, right: bar }, "aria-hidden": true }), _jsxs("div", { ref: scroller, className: `start-page${backdrop ? " has-backdrop" : ""}`, children: [_jsx("button", { type: "button", className: "start-background-button", title: "Change the background", "aria-label": "Change the background", onClick: () => setChoosing(true), children: _jsx(Icon, { name: "image", size: 17 }) }), _jsxs("div", { className: "start-inner", children: [_jsx("h1", { className: "start-title", children: "Discover" }), _jsx("p", { className: "start-lede", children: "Explore the web, find new stories, and keep what matters to you." }), _jsx("span", { className: "start-rule", "aria-hidden": true }), privately && (_jsxs("p", { className: "start-private", children: [_jsx(Icon, { name: "eyeOff", size: 18 }), _jsxs("span", { children: [_jsx("b", { children: "Private tab." }), " Pages you visit here aren't kept in History, and the sites' cookies and sign-ins go when you close it. Downloads and bookmarks you make are kept."] })] })), _jsxs("form", { className: "start-search", role: "search", onSubmit: (e) => {
                                    e.preventDefault();
                                    if (search.trim())
                                        onSearch(search);
                                }, children: [_jsx(Icon, { name: "search", size: 20 }), _jsx("input", { type: "text", value: search, onChange: (e) => onSearchChange(e.target.value), placeholder: "Search the web or enter a website\u2026", "aria-label": "Search the web or enter a website", spellCheck: false, autoCapitalize: "off", enterKeyHint: "go" }), _jsx("button", { type: "submit", className: "start-search-go", "aria-label": "Go", disabled: !search.trim(), children: _jsx(Icon, { name: "chevronRight", size: 18 }) })] }), _jsx("div", { className: "start-tiles", children: TILES.map((t) => (_jsxs("button", { type: "button", className: `start-tile start-tile-${t.panel}`, onClick: () => onPanel(t.panel), children: [_jsx(Icon, { name: t.icon, size: 28 }), _jsx("span", { children: t.label })] }, t.panel))) }), _jsx("span", { className: "start-rule start-rule-wide", "aria-hidden": true }), _jsxs("section", { className: "start-section", "aria-labelledby": "start-quick", children: [_jsxs("header", { children: [_jsx("h2", { id: "start-quick", children: "Quick Links" }), _jsxs("button", { type: "button", className: "start-more", onClick: () => setEditing(true), children: ["Edit ", _jsx(Icon, { name: "chevronRight", size: 16 })] })] }), links.length === 0 ? (_jsx("p", { className: "muted", children: "Sites you add with Edit show here, each on a painting of its own." })) : (_jsx("div", { className: "quick-links", children: links.map((l) => {
                                            const picture = galleryUrl(l.picture, "wide");
                                            return (_jsxs("button", { type: "button", className: `quick-link${isLightPainting(l.picture) ? " is-light" : ""}`, style: picture ? { backgroundImage: `url(${picture})` } : undefined, onClick: () => onGo(l.url), title: l.url, children: [_jsx(SiteBadge, { url: l.url, title: l.title }), _jsx("span", { className: "quick-link-name", children: l.title }), _jsx("span", { className: "quick-link-open", "aria-hidden": true, children: _jsx(Icon, { name: "external", size: 16 }) })] }, l.id));
                                        }) }))] }), showRecent && recent.length > 0 && (_jsxs(_Fragment, { children: [_jsx("span", { className: "start-rule start-rule-wide", "aria-hidden": true }), _jsxs("section", { className: "start-section", "aria-labelledby": "start-recent", children: [_jsxs("header", { children: [_jsx("h2", { id: "start-recent", children: "Recent Sites" }), _jsxs("span", { className: "start-more-row", children: [_jsxs("button", { type: "button", className: "start-more", "aria-expanded": showRecentList, onClick: () => setShowRecentList(!showRecentList), children: [showRecentList ? "Hide" : `Show ${recent.length}`, " ", _jsx(Icon, { name: showRecentList ? "chevronUp" : "chevronDown", size: 16 })] }), _jsxs("button", { type: "button", className: "start-more", onClick: () => setClearing(true), children: ["Clear ", _jsx(Icon, { name: "chevronRight", size: 16 })] })] })] }), showRecentList && _jsx("ul", { className: "recent-sites", children: recent.map((r) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "recent-site", onClick: () => onGo(r.url), title: r.url, children: [_jsx("span", { className: "recent-site-icon", children: _jsx(SiteBadge, { url: r.url, title: r.title, size: 30 }) }), _jsxs("span", { className: "recent-site-text", children: [_jsx("b", { children: r.title }), _jsx("span", { className: "muted", children: originOf(r.url) })] })] }), _jsx(Menu, { label: `More for ${r.title}`, className: "icon-btn", trigger: _jsx(Icon, { name: "moreVertical", size: 18 }), items: [
                                                                { label: "Open in new tab", icon: "plus", onSelect: () => onNewTab(r.url) },
                                                                { label: "Copy link", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(r.url).then(() => toast("Link copied.")) },
                                                                { label: "Add to Quick Links", icon: "link", onSelect: () => void addQuick(r.title, r.url) },
                                                                {
                                                                    label: "Remove from history",
                                                                    icon: "trash",
                                                                    onSelect: () => removeFromHistory(readHistory().filter((e) => siteOf(e.url) === r.site).map((e) => e.id)),
                                                                },
                                                            ] })] }, r.site))) })] })] })), closed.length > 0 && (_jsxs(_Fragment, { children: [_jsx("span", { className: "start-rule start-rule-wide", "aria-hidden": true }), _jsxs("section", { className: "start-section", "aria-labelledby": "start-closed", children: [_jsxs("header", { children: [_jsx("h2", { id: "start-closed", children: "Recently closed tabs" }), _jsxs("span", { className: "start-more-row", children: [_jsxs("button", { type: "button", className: "start-more", "aria-expanded": showClosed, onClick: () => setShowClosed(!showClosed), children: [showClosed ? "Hide" : `Show ${closed.length}`, " ", _jsx(Icon, { name: showClosed ? "chevronUp" : "chevronDown", size: 16 })] }), _jsxs("button", { type: "button", className: "start-more", onClick: () => setClearingClosed(true), children: ["Clear ", _jsx(Icon, { name: "chevronRight", size: 16 })] })] })] }), showClosed && _jsx(ClosedList, { closed: closed, onReopen: onReopen })] })] }))] }), choosing && (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && setChoosing(false), children: _jsxs("div", { className: "dialog start-background-dialog", role: "dialog", "aria-label": "Start page background", onKeyDown: (e) => e.key === "Escape" && setChoosing(false), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx("h2", { children: "Background" }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: () => setChoosing(false), children: _jsx(Icon, { name: "close", size: 18 }) })] }), _jsx("p", { className: "muted", children: "A picture behind the start page, on this device. It's also in Preferences \u203A Discover." }), _jsx(DiscoverBackgroundPicker, { value: prefs.background, onError: toast })] }) })), editing && _jsx(QuickLinksEditor, { links: links, onChanged: reload, onClose: () => setEditing(false) }), clearingClosed && (_jsx(ConfirmDialog, { title: "Clear Recently closed tabs?", body: "The list of tabs you closed is emptied. Open tabs, History and Bookmarks stay.", confirm: "Clear", danger: true, onCancel: () => setClearingClosed(false), onConfirm: () => {
                            clearClosedTabs(null);
                            setClearingClosed(false);
                        } })), clearing && (_jsx(ConfirmDialog, { title: "Clear Recent Sites?", body: "This clears Discover's history, so these sites go from History too. Bookmarks, Quick Links, tabs and site sign-ins stay.", confirm: "Clear", danger: true, onCancel: () => setClearing(false), onConfirm: () => {
                            clearHistory(null);
                            setClearing(false);
                        } }))] })] }));
}
