import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The building blocks of every Settings page: sections, labelled rows,
// switches and choices. On a computer the sections are cards, always open,
// in two columns (see Columns); on a phone they fold, one under another.
import { createContext, useContext, useEffect, useId, useState } from "react";
import { Icon } from "../components/Icon";
import { useNarrow } from "../lib/useNarrow";
const OPENED_KEY = "tbv.settings.opened";
/** Sections opened, remembered on this device. The rest start folded. */
function readOpened() {
    try {
        return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]"));
    }
    catch {
        return new Set();
    }
}
function saveOpened(id, opened) {
    const all = readOpened();
    if (opened)
        all.add(id);
    else
        all.delete(id);
    try {
        localStorage.setItem(OPENED_KEY, JSON.stringify([...all]));
    }
    catch {
        // Not remembered; it still opens.
    }
}
/** Which group holds each section that's part of one. */
const GROUP_OF = new Map();
/** Opens a folded section, e.g. one found by searching settings, and the group holding it. */
export function unfoldSection(id) {
    const group = GROUP_OF.get(id);
    if (group)
        unfoldSection(group);
    saveOpened(id, true);
    window.dispatchEvent(new CustomEvent("tbv:unfold-section", { detail: id }));
}
/** Set inside a group: its sections are parts of one card, not cards. */
const InGroup = createContext(false);
/**
 * A page's cards in two columns on a computer: the main one, wider, for the
 * bigger settings, and `side` for small cards (previews, single switches).
 * On a phone, or a narrow window, the side cards follow the main ones.
 */
export function Columns({ side, children }) {
    return (_jsxs("div", { className: `prefs-columns${side ? "" : " is-single"}`, children: [_jsx("div", { className: "prefs-col prefs-col-main", children: children }), side && _jsx("div", { className: "prefs-col prefs-col-side", children: side })] }));
}
/**
 * Several sections as one: a single card that folds, with each section
 * inside it as a part under its own small heading. `holds` names them, so
 * searching for one of them opens the card.
 */
export function SectionGroup({ id, title, lede, holds, children }) {
    for (const part of holds)
        GROUP_OF.set(part, id);
    return (_jsx(Section, { id: id, title: title, lede: lede, children: _jsx(InGroup.Provider, { value: true, children: _jsx("div", { className: "settings-parts", children: children }) }) }));
}
/** A settings section: a card, folded on a phone until its heading is tapped. */
export function Section({ id, title, lede, aside, collapsible = false, children, }) {
    return useContext(InGroup) ? (_jsx(SectionPart, { id: id, title: title, lede: lede, aside: aside, children: children })) : (_jsx(FoldingSection, { id: id, title: title, lede: lede, aside: aside, collapsible: collapsible, children: children }));
}
/** A section inside a group: a heading and its settings, always open. */
function SectionPart({ id, title, lede, aside, children }) {
    return (_jsxs("section", { className: `settings-part${aside ? " has-aside" : ""}`, id: `settings-${id}`, "aria-labelledby": `settings-${id}-title`, children: [_jsxs("div", { className: "settings-part-main", children: [_jsx("h3", { id: `settings-${id}-title`, children: title }), lede && _jsx("p", { className: "muted", children: lede }), children] }), aside && _jsx("div", { className: "settings-section-aside", children: aside })] }));
}
function FoldingSection({ id, title, lede, aside, collapsible, children }) {
    const narrow = useNarrow();
    const [shut, setFolded] = useState(() => !readOpened().has(id));
    const canFold = narrow || collapsible;
    const folded = canFold && shut;
    useEffect(() => {
        const open = (e) => e.detail === id && setFolded(false);
        window.addEventListener("tbv:unfold-section", open);
        return () => window.removeEventListener("tbv:unfold-section", open);
    }, [id]);
    const toggle = () => {
        saveOpened(id, folded);
        setFolded(!folded);
    };
    const heading = canFold ? (_jsxs("button", { type: "button", className: "settings-section-toggle", "aria-expanded": !folded, onClick: toggle, children: [title, _jsx(Icon, { name: "chevronDown", size: 18 })] })) : (title);
    return (_jsxs("section", { className: `settings-section${aside && !folded ? " has-aside" : ""}${folded ? " is-folded" : ""}`, id: `settings-${id}`, "aria-labelledby": `settings-${id}-title`, children: [_jsxs("div", { className: "settings-section-main", children: [_jsxs("header", { className: "settings-section-head", children: [_jsx("h2", { id: `settings-${id}-title`, children: heading }), lede && _jsx("p", { className: "muted", children: lede })] }), !folded && children] }), aside && !folded && _jsx("div", { className: "settings-section-aside", children: aside })] }));
}
/** One setting: its name and a line of explanation on the left, the control on the right. */
export function Row({ label, hint, children, stack }) {
    return (_jsxs("div", { className: `settings-row${stack ? " is-stacked" : ""}`, children: [_jsxs("div", { className: "settings-row-text", children: [_jsx("span", { className: "settings-row-label", children: label }), hint && _jsx("span", { className: "settings-row-hint", children: hint })] }), _jsx("div", { className: "settings-row-control", children: children })] }));
}
export function Toggle({ label, hint, checked, disabled, onChange, }) {
    const id = useId();
    return (_jsxs("div", { className: `settings-toggle${disabled ? " is-disabled" : ""}`, children: [_jsx("button", { type: "button", role: "switch", id: id, className: "switch", "aria-checked": checked, disabled: disabled, onClick: () => onChange(!checked), children: _jsx("span", { className: "switch-knob", "aria-hidden": true }) }), _jsxs("label", { htmlFor: id, className: "settings-toggle-text", children: [_jsx("span", { className: "settings-row-label", children: label }), hint && _jsx("span", { className: "settings-row-hint", children: hint })] })] }));
}
/** A row of mutually exclusive choices. */
export function Segmented({ label, value, options, onChange, }) {
    return (_jsx("div", { className: "segmented settings-segmented", role: "radiogroup", "aria-label": label, children: options.map((o) => (_jsx("button", { type: "button", role: "radio", "aria-checked": value === o.value, onClick: () => onChange(o.value), children: o.label }, o.value))) }));
}
/** Choices with a line of explanation each, as radio buttons. */
export function RadioList({ label, value, options, onChange, }) {
    const name = useId();
    return (_jsx("div", { className: "radio-list", role: "radiogroup", "aria-label": label, children: options.map((o) => (_jsxs("label", { className: `radio-item${o.disabled ? " is-disabled" : ""}`, children: [_jsx("input", { type: "radio", name: name, checked: value === o.value, disabled: o.disabled, onChange: () => onChange(o.value) }), _jsxs("span", { children: [_jsx("span", { className: "settings-row-label", children: o.label }), o.hint && _jsx("span", { className: "settings-row-hint", children: o.hint })] })] }, o.value))) }));
}
export function Select({ label, value, options, onChange, }) {
    return (_jsx("select", { className: "settings-select", "aria-label": label, value: value, onChange: (e) => onChange(e.target.value), children: options.map((o) => (_jsx("option", { value: o.value, children: o.label }, o.value))) }));
}
/** A big button with an icon, a name and a line of explanation. */
export function ActionTile({ icon, title, hint, onClick, disabled, }) {
    return (_jsxs("button", { type: "button", className: "action-tile", onClick: onClick, disabled: disabled, children: [_jsx("span", { className: "action-tile-icon", children: icon }), _jsxs("span", { className: "action-tile-text", children: [_jsx("span", { className: "settings-row-label", children: title }), _jsx("span", { className: "settings-row-hint", children: hint })] })] }));
}
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} bytes`;
    const units = ["KB", "MB", "GB", "TB"];
    let n = bytes / 1024;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
        n /= 1024;
        unit++;
    }
    return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[unit]}`;
}
