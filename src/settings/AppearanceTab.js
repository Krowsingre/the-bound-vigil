import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { HIGHLIGHT_COLORS, parseSettings, SETTINGS_KEY } from "../reader/settings";
import { customColors, isDark, PRIVACY_SHORTCUT, useAppSettings, useSystemDark, SCALES, } from "./appSettings";
import { Columns, Row, Section, Segmented, Toggle } from "./controls";
import { CustomThemeSection, themeFromWindow } from "./CustomThemeSection";
import { ProfileSection } from "./ProfileSection";
import { api } from "../api";
import { useToast } from "../components/Toast";
/** The reader's own settings, shared with the Aa panel in the reader. */
export function useReaderSettings() {
    const [settings, setSettings] = useState(null);
    useEffect(() => {
        api.getSetting(SETTINGS_KEY).then((json) => setSettings(parseSettings(json)), () => setSettings(parseSettings(null)));
    }, []);
    const change = (c) => setSettings((s) => {
        if (!s)
            return s;
        const next = { ...s, ...c };
        void api.setSetting(SETTINGS_KEY, JSON.stringify(next)).catch(() => undefined);
        return next;
    });
    return [settings, change];
}
/** The theme cards. Adaptive is one card; its light or dark is chosen under it. */
const THEMES = [
    { value: "light", label: "Light", icon: "sun" },
    { value: "dark", label: "Dark", icon: "moon" },
    { value: "system", label: "System", icon: "computer" },
    { value: "adaptive", label: "Adaptive", icon: "adaptive" },
    { value: "custom", label: "Custom", icon: "palette" },
];
const DENSITIES = [
    { value: "compact", label: "Compact" },
    { value: "default", label: "Default" },
    { value: "spacious", label: "Spacious" },
];
const SCALE_STEPS = ["small", "medium", "large"];
/** A slider with a few set stops, named under it. */
function Stops({ label, value, stops, names, onChange, }) {
    const at = Math.max(0, stops.indexOf(value));
    return (_jsxs("div", { className: "stops", children: [_jsx("input", { type: "range", min: 0, max: stops.length - 1, step: 1, value: at, "aria-label": label, "aria-valuetext": names[1], onChange: (e) => onChange(stops[Number(e.target.value)]) }), _jsxs("div", { className: "stops-names settings-row-hint", children: [_jsx("span", { children: names[0] }), _jsx("strong", { children: names[1] }), _jsx("span", { children: names[2] })] })] }));
}
export function AppearanceTab({ sidebarShown, onSidebarShown, }) {
    const { settings, change, adaptive, adaptiveBook, refreshAdaptive, togglePrivacy } = useAppSettings();
    const adaptiveOn = settings.theme === "adaptive";
    const systemDark = useSystemDark();
    const card = settings.theme;
    const toast = useToast();
    const [naming, setNaming] = useState(null);
    /** Keeps the Adaptive colours showing now as a custom theme of their own. */
    const keepAdaptive = async (name) => {
        try {
            const made = await api.saveCustomTheme(themeFromWindow(name, adaptive?.highlight));
            change({ theme: "custom", customTheme: made });
            setNaming(null);
            toast(`${made.name} saved as a custom theme.`);
        }
        catch (e) {
            toast(e instanceof Error ? e.message : String(e));
        }
    };
    const custom = settings.customTheme;
    const preview = (_jsx(Section, { id: "preview", title: "Theme preview", lede: "How the interface's colours look together.", children: _jsxs("div", { className: "theme-preview", children: [_jsx("div", { className: "theme-preview-art", children: adaptiveOn && adaptiveBook ? (_jsx(BookCover, { book: adaptiveBook })) : (_jsxs("div", { className: "theme-preview-sample", "aria-hidden": true, children: [_jsx("span", { className: "tp-sidebar" }), _jsxs("span", { className: "tp-main", children: [_jsx("span", { className: "tp-title" }), _jsx("span", { className: "tp-line" }), _jsx("span", { className: "tp-line short" }), _jsx("span", { className: "tp-button" })] })] })) }), _jsxs("ul", { className: "swatches", children: [_jsxs("li", { children: [_jsx("span", { className: "swatch-chip", style: { background: "var(--bg)" } }), "Page"] }), _jsxs("li", { children: [_jsx("span", { className: "swatch-chip", style: { background: "var(--surface)" } }), "Surface"] }), _jsxs("li", { children: [_jsx("span", { className: "swatch-chip", style: { background: "var(--accent)" } }), "Accent"] }), _jsxs("li", { children: [_jsx("span", { className: "swatch-chip", style: { background: (card === "custom" ? custom?.highlight : adaptive?.highlight) ?? HIGHLIGHT_COLORS[3].hex } }), "Highlight"] })] })] }) }));
    const side = (_jsxs(_Fragment, { children: [preview, _jsx(Section, { id: "density", title: "Interface density", lede: "More room between things, or less, everywhere in TBV.", children: _jsx(Stops, { label: "Interface density", value: settings.density, stops: DENSITIES.map((d) => d.value), names: ["Compact", DENSITIES.find((d) => d.value === settings.density)?.label ?? "Default", "Spacious"], onChange: (density) => change({ density }) }) }), _jsxs(Section, { id: "text", title: "Interface text", lede: "The font of menus, buttons and labels, and how big everything is. The reading font is under Reading.", children: [_jsx(Row, { label: "Font", stack: true, children: _jsx(Segmented, { label: "Interface font", value: settings.interfaceFont, options: [
                                { value: "system", label: "Segoe UI" },
                                { value: "serif", label: "Georgia" },
                                { value: "echolume", label: "Echolume" },
                            ], onChange: (interfaceFont) => change({ interfaceFont }) }) }), _jsx(Row, { label: "Font scaling", hint: "Makes all text and controls smaller or larger.", stack: true, children: _jsx(Stops, { label: "Font scaling", value: settings.scale, stops: SCALE_STEPS, names: ["Smaller", `${Math.round(SCALES[settings.scale] * 100)}%`, "Larger"], onChange: (scale) => change({ scale }) }) })] }), _jsxs(Section, { id: "touches", title: "Finishing touches", lede: "The texture behind pages and cards, and progress on covers.", children: [_jsx(Row, { label: "Surface style", stack: true, children: _jsx(Segmented, { label: "Surface style", value: settings.surface, options: [
                                { value: "clean", label: "Clean" },
                                { value: "matte", label: "Matte" },
                                { value: "paper", label: "Paper" },
                                { value: "linen", label: "Linen" },
                                { value: "vellum", label: "Vellum" },
                            ], onChange: (surface) => change({ surface }) }) }), _jsx("div", { className: "toggle-list", children: _jsx(Toggle, { label: "Show progress bars on books", hint: "In the Archive and Compendium. Sanctum always shows what you're reading.", checked: settings.showProgress, onChange: (showProgress) => change({ showProgress }) }) })] })] }));
    return (_jsxs(Columns, { side: side, children: [_jsx(Section, { id: "theme", title: "Application theme", lede: "Choose the base theme for the interface.", children: _jsx("div", { className: "theme-cards", role: "radiogroup", "aria-label": "Theme", children: THEMES.map((t) => (_jsxs("label", { className: `theme-card${card === t.value ? " is-active" : ""}`, children: [_jsxs("span", { className: `theme-tile theme-swatch-${t.value === "adaptive" ? (isDark({ theme: "adaptive", adaptiveBase: settings.adaptiveBase }, systemDark) ? "adaptive-dark" : "adaptive-light") : t.value}`, style: t.value === "custom" && custom
                                    ? {
                                        background: `linear-gradient(180deg, ${custom.surface} 0 76%, ${custom.accent} 76% 88%, ${custom.highlight} 88%)`,
                                        color: customColors(custom)["--text"],
                                        textShadow: "none",
                                    }
                                    : undefined, "aria-hidden": true, children: [_jsx(Icon, { name: t.icon, size: 30 }), _jsx("span", { className: "theme-tile-name", children: t.label })] }), _jsx("input", { type: "radio", name: "tbv-theme", "aria-label": t.label, checked: card === t.value, onChange: () => change({ theme: t.value }) })] }, t.value))) }) }), adaptiveOn && (_jsxs(Section, { id: "adaptive", title: "Adaptive theme", lede: "The interface's colours come from the cover of the book you're reading, on a light or dark base.", children: [_jsxs("p", { className: "settings-row-hint", children: [adaptiveBook ? (_jsxs(_Fragment, { children: ["Now from ", _jsx("em", { children: adaptiveBook.title }), "."] })) : ("No book has been opened yet."), !adaptive && adaptiveBook && " That book has no cover with a colour to use, so the usual accent stays."] }), _jsx(Row, { label: "Light or dark", hint: "Auto follows your device's light or dark mode.", children: _jsx(Segmented, { label: "Adaptive light or dark", value: settings.adaptiveBase, options: [
                                { value: "light", label: "Light" },
                                { value: "system", label: "Auto" },
                                { value: "dark", label: "Dark" },
                            ], onChange: (adaptiveBase) => change({ adaptiveBase }) }) }), _jsx(Row, { label: "Accent strength", hint: "How strongly the cover's colours are used.", children: _jsxs("div", { className: "range-row", children: [_jsx("span", { className: "settings-row-hint", children: "Subtle" }), _jsx("input", { type: "range", min: 0, max: 1, step: 0.05, value: settings.adaptiveStrength, "aria-label": "Accent strength", onChange: (e) => change({ adaptiveStrength: Number(e.target.value) }) }), _jsx("span", { className: "settings-row-hint", children: "Strong" })] }) }), _jsx("div", { className: "toggle-list", children: _jsx(Toggle, { label: "Auto-apply", hint: "Takes the colours again each time you open a different book. Off, they stay on this book until you reset them.", checked: settings.adaptiveAuto, onChange: (adaptiveAuto) => change({ adaptiveAuto, adaptivePinned: adaptiveAuto ? null : (adaptiveBook?.id ?? null) }) }) }), _jsxs("div", { className: "settings-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: refreshAdaptive, children: [_jsx(Icon, { name: "sync", size: 16 }), " Reset current adaptive theme"] }), _jsx("span", { className: "settings-row-hint", children: "Takes the colours again from the book you read most recently." })] }), naming === null ? (_jsxs("div", { className: "settings-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", disabled: !adaptive, onClick: () => setNaming(adaptiveBook ? `${adaptiveBook.title}`.slice(0, 40) : "My theme"), children: [_jsx(Icon, { name: "palette", size: 16 }), " Save as custom theme"] }), _jsx("span", { className: "settings-row-hint", children: "Keeps these colours as a theme of your own, to name and edit." })] })) : (_jsxs("form", { className: "settings-actions", onSubmit: (e) => {
                            e.preventDefault();
                            void keepAdaptive(naming);
                        }, children: [_jsx("input", { "aria-label": "Theme name", value: naming, maxLength: 40, autoFocus: true, onChange: (e) => setNaming(e.target.value) }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: !naming.trim(), children: "Save" }), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setNaming(null), children: "Cancel" })] }))] })), card === "custom" && _jsx(CustomThemeSection, {}), _jsx(ProfileSection, {}), _jsxs(Section, { id: "privacy", title: "Privacy mode", lede: `Hides every book cover at once, and brings them back just as fast. Press ${PRIVACY_SHORTCUT} anywhere, or use the menu under your sync circle.`, children: [_jsx("div", { className: "toggle-list", children: _jsx(Toggle, { label: "Hide covers now", hint: "Stays on until you turn it off, even if you close TBV.", checked: settings.privacy.on, onChange: () => togglePrivacy() }) }), _jsx(Row, { label: "Hidden covers show", hint: "What appears in place of each cover.", children: _jsx(Segmented, { label: "Hidden covers show", value: settings.privacy.style, options: [
                                { value: "titles", label: "The title" },
                                { value: "blank", label: "Nothing" },
                            ], onChange: (style) => change({ privacy: { ...settings.privacy, style } }) }) }), _jsx("div", { className: "toggle-list", children: _jsx(Toggle, { label: "Hide my profile picture too", hint: "Collection pictures made from covers or your own images are always hidden. TBV's gallery paintings stay.", checked: settings.privacy.avatar, onChange: (avatar) => change({ privacy: { ...settings.privacy, avatar } }) }) })] }), _jsx(Section, { id: "sanctum", title: "Sanctum", lede: "Your home page. Suggested reading always includes books you own and haven't started.", children: _jsx("div", { className: "toggle-list", children: _jsx(Toggle, { label: "Suggest books from online", hint: "Adds free and new books from Krowsingre Publishing, and other books by authors you read, found on Open Library. Only author names are sent.", checked: settings.suggestOnline, onChange: (suggestOnline) => change({ suggestOnline }) }) }) }), _jsx(Section, { id: "sidebar", title: "Sidebar", lede: "The menu of pages down the left. Clicking the emblem or the title at its top folds it too.", children: _jsxs("div", { className: "toggle-list", children: [_jsx(Toggle, { label: "Show the full sidebar", checked: sidebarShown, onChange: onSidebarShown }), _jsx(Toggle, { label: "Full-screen menu on a phone", hint: "When the phone is upright, the menu of pages fills the screen.", checked: settings.fullMenu, onChange: (fullMenu) => change({ fullMenu }) })] }) })] }));
}
