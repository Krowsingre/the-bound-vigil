import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Custom themes: four colours of your own (page, surface, accent and
// highlight), named, edited later, and synced to your other devices. TBV
// works out the text and borders so words always read.
import { useEffect, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { contrast, customColors, useAppSettings } from "./appSettings";
import { Section } from "./controls";
const COLOURS = [
    { key: "page", label: "Page" },
    { key: "surface", label: "Surface" },
    { key: "accent", label: "Accent" },
    { key: "highlight", label: "Highlight" },
];
/** A colour the window shows now, as #rrggbb (whatever form the style sheet gave it). */
export function shownColour(variable, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx || !value)
        return fallback;
    ctx.fillStyle = fallback;
    ctx.fillStyle = value;
    const out = String(ctx.fillStyle);
    if (/^#[0-9a-f]{6}$/i.test(out))
        return out.toLowerCase();
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(out);
    return rgb ? `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : fallback;
}
/** The colours showing now, as a theme to start from. */
export function themeFromWindow(name, highlight) {
    return {
        id: "",
        name,
        page: shownColour("--bg", "#f1efeb"),
        surface: shownColour("--surface", "#faf9f6"),
        accent: shownColour("--accent", "#2f3a44"),
        highlight: highlight ?? shownColour("--highlight", "#c9d6e3"),
    };
}
export function useCustomThemes() {
    const [themes, setThemes] = useState([]);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let current = true;
        api.customThemes().then((list) => current && setThemes(list), () => current && setThemes([]));
        return () => {
            current = false;
        };
    }, [tick]);
    return [themes, () => setTick((n) => n + 1)];
}
const same = (a, b) => a.name === b.name && COLOURS.every(({ key }) => a[key].toLowerCase() === b[key].toLowerCase());
export function CustomThemeSection() {
    const { settings, change } = useAppSettings();
    const [themes, reload] = useCustomThemes();
    const [deleting, setDeleting] = useState(null);
    const toast = useToast();
    const theme = settings.customTheme;
    // Picking Custom with nothing made yet starts from the colours showing now.
    useEffect(() => {
        if (!theme)
            change({ customTheme: themeFromWindow("My theme") });
    }, [theme, change]);
    if (!theme)
        return null;
    const saved = themes.find((t) => t.id === theme.id);
    const edit = (c) => change({ customTheme: { ...theme, ...c } });
    const store = async (asNew) => {
        try {
            const made = await api.saveCustomTheme(asNew ? { ...theme, id: "", name: saved && theme.name === saved.name ? `${theme.name} (copy)` : theme.name } : theme);
            change({ customTheme: made });
            reload();
            toast(asNew || !saved ? `${made.name} saved. It's on your other devices too.` : `${made.name} updated.`);
        }
        catch (e) {
            toast(e instanceof Error ? e.message : String(e));
        }
    };
    const colours = customColors(theme);
    const problems = [
        contrast(theme.accent, theme.page) < 3 && "The accent is hard to see on the page colour.",
        contrast(theme.accent, theme.surface) < 3 && "The accent is hard to see on the surface colour.",
        contrast(colours["--text"], theme.highlight) < 4.5 && "Words are hard to read on the highlight colour.",
        contrast(colours["--text"], theme.surface) < 4.5 && "Text is hard to read on the surface colour. Try a lighter or darker surface.",
    ].filter(Boolean);
    return (_jsxs(Section, { id: "custom-theme", title: "Custom theme", lede: "Choose four colours. TBV picks the text and border colours so words stay easy to read.", children: [themes.length > 0 && (_jsx("ul", { className: "custom-themes", "aria-label": "Your themes", children: themes.map((t) => (_jsx("li", { children: _jsxs("button", { type: "button", className: `custom-theme-chip${t.id === theme.id ? " is-active" : ""}`, onClick: () => change({ customTheme: t }), children: [_jsx("span", { className: "custom-theme-dots", "aria-hidden": true, children: COLOURS.map(({ key }) => (_jsx("span", { style: { background: t[key] } }, key))) }), t.name] }) }, t.id))) })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Name" }), _jsx("input", { value: theme.name, maxLength: 40, onChange: (e) => edit({ name: e.target.value }) })] }), _jsx("div", { className: "custom-theme-colours", children: COLOURS.map(({ key, label }) => (_jsxs("label", { children: [_jsx("input", { type: "color", value: theme[key], onChange: (e) => edit({ [key]: e.target.value }) }), _jsx("span", { children: label }), _jsx("code", { children: theme[key] })] }, key))) }), problems.map((p) => (_jsxs("p", { className: "settings-row-hint is-warning", role: "status", children: [_jsx(Icon, { name: "warning", size: 14 }), " ", p] }, p))), _jsxs("div", { className: "settings-actions", children: [_jsx("button", { type: "button", className: "btn btn-primary", disabled: !theme.name.trim() || (!!saved && same(saved, theme)), onClick: () => void store(false), children: saved ? "Save changes" : "Save theme" }), saved && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void store(true), children: "Save as a new theme" })), saved && !same(saved, theme) && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => change({ customTheme: saved }), children: "Undo changes" })), saved && (_jsxs("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: () => setDeleting(saved), children: [_jsx(Icon, { name: "trash", size: 15 }), " Delete"] }))] }), deleting && (_jsx(ConfirmDialog, { title: `Delete ${deleting.name}?`, body: "It goes from all your devices. Any device showing it keeps its colours until you choose another theme.", confirm: "Delete theme", danger: true, onCancel: () => setDeleting(null), onConfirm: () => {
                    const gone = deleting;
                    setDeleting(null);
                    void api.removeCustomTheme(gone.id).then(() => {
                        const next = themes.find((t) => t.id !== gone.id);
                        change({ customTheme: next ?? { ...gone, id: "" } });
                        reload();
                    }, (e) => toast(String(e)));
                } }))] }));
}
