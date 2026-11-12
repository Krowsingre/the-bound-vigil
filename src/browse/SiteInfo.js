import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The Site information sheet, from the lock in the address box: whether the
// connection is secure, and this site's own choices (protection, zoom, the
// desktop version on iPhone and iPad), clearing its data, and sharing it.
import { useEffect, useState } from "react";
import { isIOS } from "../api";
import { Icon } from "../components/Icon";
import { Toggle } from "../settings/controls";
import { onBrowserPrefs, readBrowserPrefs, siteOf, siteSettings, ZOOMS, zoomLabel } from "./browserPrefs";
import { SiteBadge } from "./SiteBadge";
export function SiteInfo({ url, actions }) {
    const [prefs, setPrefs] = useState(readBrowserPrefs);
    const [clearing, setClearing] = useState(false);
    useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
    const site = siteOf(url) ?? url;
    const secure = /^https:/i.test(url);
    const own = siteSettings(site, prefs);
    const zoom = own.zoom ?? 1;
    const at = ZOOMS.indexOf(zoom);
    const step = (by) => {
        // A size between the steps (none today) goes to the nearest one.
        const from = at >= 0 ? at : ZOOMS.findIndex((z) => z > zoom) - (by > 0 ? 1 : 0);
        const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, from + by))];
        if (next !== zoom)
            actions.onZoom(next);
    };
    const lowered = prefs.lowered.includes(site);
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && actions.onClose(), children: _jsxs("div", { className: "dialog site-info", role: "dialog", "aria-label": `About ${site}`, onKeyDown: (e) => e.key === "Escape" && actions.onClose(), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx(SiteBadge, { url: url, title: site, size: 28 }), _jsx("h2", { children: site }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: actions.onClose, children: _jsx(Icon, { name: "close", size: 18 }) })] }), _jsxs("p", { className: `site-info-secure${secure ? "" : " is-unsafe"}`, children: [_jsx(Icon, { name: secure ? "lock" : "warning", size: 18 }), _jsxs("span", { children: [_jsx("b", { children: secure ? "Connection is secure" : "Not secure" }), _jsx("span", { className: "muted", children: secure ? "What you send and see here is private between you and the site." : "Don't type passwords or card numbers on this page." })] })] }), _jsxs("div", { className: "site-info-rows", children: [_jsx(Toggle, { label: "Protection", hint: prefs.protection === "off" ? "Protection is off for every site in Preferences › Discover." : lowered ? "Lowered for this site, so it can work properly." : "Trackers and the like are blocked here.", checked: prefs.protection !== "off" && !lowered, disabled: prefs.protection === "off", onChange: (on) => actions.onProtection(!on) }), _jsxs("div", { className: "site-info-row", children: [_jsxs("span", { children: [_jsx("b", { children: "Zoom" }), _jsx("span", { className: "muted", children: "How large its pages are." })] }), _jsxs("span", { className: "site-info-zoom", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Smaller", disabled: zoom <= ZOOMS[0], onClick: () => step(-1), children: _jsx(Icon, { name: "minus", size: 16 }) }), _jsx("output", { "aria-live": "polite", children: zoomLabel(zoom) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Larger", disabled: zoom >= ZOOMS[ZOOMS.length - 1], onClick: () => step(1), children: _jsx(Icon, { name: "plus", size: 16 }) }), zoom !== 1 && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => actions.onZoom(1), children: "Reset" }))] })] }), isIOS && _jsx(Toggle, { label: "Desktop version", hint: "Show this site as it looks on a computer.", checked: !!own.desktop, onChange: actions.onDesktop }), _jsxs("div", { className: "site-info-row", children: [_jsxs("span", { children: [_jsx("b", { children: "This site's data" }), _jsxs("span", { className: "muted", children: ["Its cookies and stored data. Clearing them signs you out of ", site, "."] })] }), clearing ? (_jsxs("span", { className: "site-info-confirm", children: [_jsx("button", { type: "button", className: "btn btn-danger btn-small", onClick: () => (setClearing(false), actions.onClearData()), children: "Clear" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setClearing(false), children: "Cancel" })] })) : (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setClearing(true), children: "Clear\u2026" }))] })] }), _jsxs("div", { className: "site-info-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: actions.onCopy, children: [_jsx(Icon, { name: "copy", size: 15 }), " Copy link"] }), _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: actions.onShare, children: [_jsx(Icon, { name: "share", size: 15 }), " Share\u2026"] })] })] }) }));
}
