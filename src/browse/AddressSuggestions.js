import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// What drops down under Discover's address box while typing: Paste and go,
// then matches from History, bookmarks, Quick Links and the open tabs. All of
// it is already on this device, so nothing typed is sent anywhere.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { onHistory, readHistory, removeFromHistory } from "./browserHistory";
import { readableAddress, readBrowserPrefs, siteOf } from "./browserPrefs";
import { readTabs } from "./browserTabs";
import { SiteBadge } from "./SiteBadge";
const MOST = 6;
const ORDER = ["bookmark", "history", "tab", "quick", "search"];
/** Best first: the site starting with what's typed, then the title, then anywhere in the address. */
export function suggestionsFor(typed, from) {
    const q = typed.trim().toLocaleLowerCase();
    if (!q)
        return [];
    const bare = q.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const scored = [];
    for (const s of from) {
        const site = siteOf(s.url) ?? "";
        const address = s.url.toLocaleLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
        const title = s.title.toLocaleLowerCase();
        const score = address === bare || site === bare || title === q ? 4 : site.startsWith(bare) || address.startsWith(bare) ? 3 : title.split(/\s+/).some((w) => w.startsWith(q)) ? 2 : address.includes(bare) || title.includes(q) ? 1 : 0;
        if (score)
            scored.push({ s, score: (ORDER.length - ORDER.indexOf(s.kind)) * 10 + score });
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const out = [];
    for (const { s } of scored) {
        // Keep navigation and switching distinct, and prefer a bookmark for duplicate URLs.
        const key = `${s.kind === "tab" || s.kind === "search" ? s.kind : "open"}:${s.url}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(s);
        if (out.length === MOST)
            break;
    }
    if (out[0]?.kind === "tab") {
        const { tab: _tab, ...site } = out[0];
        out.unshift({ ...site, kind: "history" });
    }
    return out.slice(0, MOST);
}
const ICONS = { tab: "arrowRight", quick: "link", bookmark: "bookmark", history: "clock", search: "search" };
export function AddressSuggestions({ typed, current, onGo, onOpen, onTab, showPaste = true }) {
    const [marks, setMarks] = useState([]);
    const [links, setLinks] = useState([]);
    const [history, setHistory] = useState(readHistory);
    const [selected, setSelected] = useState(-1);
    useEffect(() => onHistory(() => setHistory(readHistory())), []);
    useEffect(() => setSelected(-1), [typed]);
    const suggest = readBrowserPrefs().suggest;
    useEffect(() => {
        if (!suggest)
            return;
        api.bookmarks().then(setMarks, () => undefined);
        api.quickLinks().then(setLinks, () => undefined);
    }, [suggest]);
    const list = useMemo(() => {
        // Only what's been typed; the address put up on tapping isn't a search.
        if (!suggest || !typed.trim() || typed === current)
            return [];
        const { tabs, active } = readTabs("");
        const rows = history.slice(0, 1000);
        const from = [
            ...tabs.filter((t) => t.id !== active && /^https?:/i.test(t.url)).map((t) => ({ kind: "tab", url: t.url, title: t.title ?? siteOf(t.url) ?? t.url, tab: t.id })),
            ...links.map((l) => ({ kind: "quick", url: l.url, title: l.title })),
            ...marks.map((m) => ({ kind: "bookmark", url: m.url, title: m.title })),
            ...rows.map((e) => ({ kind: e.kind === "search" ? "search" : "history", url: e.url, title: e.title?.trim() || siteOf(e.url) || e.url })),
        ];
        return suggestionsFor(typed, from).map((s) => ({
            ...s,
            historyIds: history.filter((entry) => entry.url === s.url && entry.kind === (s.kind === "search" ? "search" : "page")).map((entry) => entry.id),
        }));
    }, [suggest, typed, current, marks, links, history]);
    // Always in the tab typed in; a site open in another tab has its own Switch button.
    const choose = (s) => (s.kind === "search" ? onGo(s.url) : onOpen(s.url));
    useEffect(() => {
        const input = document.getElementById("global-search");
        const key = (event) => {
            if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || !list.length)
                return;
            const row = list[selected];
            if (!event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                setSelected(event.key === "ArrowDown" ? (selected + 1) % list.length : selected <= 0 ? list.length - 1 : selected - 1);
            }
            else if (!event.shiftKey && event.key === "Enter" && row) {
                event.preventDefault();
                choose(row);
            }
            else if (event.shiftKey && event.key === "Delete" && row?.historyIds?.length) {
                event.preventDefault();
                removeFromHistory(row.historyIds);
                setSelected(-1);
            }
        };
        input?.addEventListener("keydown", key);
        return () => input?.removeEventListener("keydown", key);
    }, [list, selected, onGo, onOpen, onTab]);
    const paste = async () => {
        try {
            const text = (await navigator.clipboard.readText()).trim();
            if (text)
                onGo(text);
        }
        catch {
            // Not allowed to read the clipboard: nothing happens.
        }
    };
    if (!showPaste && !list.length)
        return null;
    return (_jsxs("div", { className: "address-suggestions", role: "listbox", "aria-label": "Suggestions", onPointerDown: (e) => e.preventDefault(), children: [showPaste && _jsxs("button", { type: "button", role: "option", "aria-selected": false, className: "address-suggestion", onClick: () => void paste(), children: [_jsx("span", { className: "address-suggestion-icon", children: _jsx(Icon, { name: "paste", size: 18 }) }), _jsx("span", { className: "address-suggestion-text", children: _jsx("b", { children: "Paste and go" }) })] }), list.map((s, index) => (_jsxs("div", { className: "address-suggestion-row", children: [_jsxs("button", { type: "button", role: "option", "aria-selected": selected === index, className: "address-suggestion", onClick: () => choose(s), children: [_jsx("span", { className: "address-suggestion-icon", children: _jsx(SiteBadge, { url: s.url, title: s.title, size: 20 }) }), _jsxs("span", { className: "address-suggestion-text", children: [_jsx("b", { children: s.title }), _jsx("span", { className: "muted", children: s.kind === "tab" ? `Open in another tab · ${readableAddress(s.url)}` : s.kind === "search" ? "Previous search" : `${s.kind === "bookmark" ? "Bookmarked · " : ""}${readableAddress(s.url)}` })] }), _jsx(Icon, { name: ICONS[s.kind], size: 14, className: "address-suggestion-kind" })] }), s.tab && _jsx("button", { type: "button", className: "btn btn-quiet btn-small address-suggestion-switch", title: "Go to the tab it's open in", onClick: () => onTab(s.tab), children: "Switch to tab" }), !!s.historyIds?.length && _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Remove ${s.title} from history`, title: "Remove from history (Shift+Delete)", onClick: () => { removeFromHistory(s.historyIds ?? []); setSelected(-1); }, children: _jsx(Icon, { name: "close", size: 14 }) })] }, `${s.kind}:${s.url}`)))] }));
}
