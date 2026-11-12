import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// The services a library can be kept in, as Preferences › Sync shows them.
import { isAndroid } from "../api";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
const ALL_PROVIDERS = [
    {
        id: "supabase",
        name: "Supabase",
        art: (_jsx("svg", { viewBox: "0 0 24 24", width: "26", height: "26", "aria-hidden": true, children: _jsx("path", { d: "M13 2 4 14h7l-1 8 9-12h-7z", fill: "currentColor" }) })),
    },
    {
        id: "dropbox",
        name: "Dropbox",
        art: (_jsx("svg", { viewBox: "0 0 24 24", width: "26", height: "26", "aria-hidden": true, children: _jsx("path", { d: "m7 3-5 3.2L7 9.4l5-3.2zm10 0-5 3.2 5 3.2 5-3.2zM2 12.6l5 3.2 5-3.2-5-3.2zm15-3.2-5 3.2 5 3.2 5-3.2zM7 17l5 3.2 5-3.2-5-3.2z", fill: "currentColor" }) })),
    },
    {
        id: "gdrive",
        name: "Google Drive",
        art: (_jsx("svg", { viewBox: "0 0 24 24", width: "26", height: "26", "aria-hidden": true, children: _jsx("path", { d: "M8.5 3h7l6.5 11.3h-7zM8.5 3 2 14.3l3.5 6 6.5-11.3zm-3 17.3h13l3.5-6H9z", fill: "currentColor" }) })),
    },
    {
        id: "onedrive",
        name: "OneDrive",
        art: (_jsx("svg", { viewBox: "0 0 24 24", width: "26", height: "26", "aria-hidden": true, children: _jsx("path", { d: "M7 18h11a4 4 0 0 0 .6-7.9A6 6 0 0 0 7.2 8.6 4.8 4.8 0 0 0 7 18z", fill: "currentColor" }) })),
    },
    {
        id: "icloud",
        name: "iCloud Drive",
        art: (_jsx("svg", { viewBox: "0 0 24 24", width: "26", height: "26", "aria-hidden": true, children: _jsx("path", { d: "M6.5 19h11a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6.6 9.2 5 5 0 0 0 6.5 19z", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinejoin: "round" }) })),
    },
    {
        id: "mega",
        name: "MEGA",
        art: (_jsxs("svg", { viewBox: "0 0 24 24", width: "26", height: "26", "aria-hidden": true, children: [_jsx("circle", { cx: "12", cy: "12", r: "10", fill: "currentColor" }), _jsx("path", { d: "M7.5 16V8.5l4.5 4.5 4.5-4.5V16", fill: "none", stroke: "var(--surface)", strokeWidth: "2", strokeLinejoin: "round" })] })),
    },
    {
        id: "custom",
        name: "Another service",
        art: (_jsxs("svg", { viewBox: "0 0 24 24", width: "26", height: "26", "aria-hidden": true, children: [_jsx("circle", { cx: "12", cy: "12", r: "9.5", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeDasharray: "3 2.6" }), _jsx("path", { d: "M12 8v8M8 12h8", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" })] })),
    },
];
/** The places to sync with here. Android's test version has no iCloud, and can't reach a folder a desktop app keeps in step (MEGA). */
export const PROVIDERS = isAndroid ? ALL_PROVIDERS.filter((p) => p.id !== "icloud" && p.id !== "mega") : ALL_PROVIDERS;
/**
 * The place chosen, as a card, and every other one in a dropdown. With
 * nothing chosen there is only the dropdown.
 */
export function ProviderPicker({ picked, onPick, label, status, inUse, }) {
    const card = PROVIDERS.find((p) => p.id === picked);
    const others = PROVIDERS.filter((p) => p.id !== picked);
    return (_jsxs("div", { className: "provider-picker", children: [card && (_jsxs("div", { className: "provider-card is-active", children: [_jsx("span", { className: "provider-art", children: card.art }), _jsxs("span", { className: "provider-text", children: [_jsx("span", { className: "settings-row-label", children: card.name }), status && (_jsxs("span", { className: "settings-row-hint", children: [_jsx("span", { className: `status-dot${card.id === inUse ? " is-ready" : ""}`, "aria-hidden": true }), status(card.id)] }))] })] })), _jsx(Menu, { label: label, className: "btn btn-quiet provider-more", trigger: _jsxs(_Fragment, { children: [card ? "Choose another place" : "Choose a place", " ", _jsx(Icon, { name: "chevronDown", size: 14 })] }), items: others.map((p) => ({ label: p.name, hint: status?.(p.id), onSelect: () => onPick(p.id) })) })] }));
}
