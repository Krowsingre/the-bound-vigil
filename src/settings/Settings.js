import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { AppearanceTab } from "./AppearanceTab";
import { BrowserTab } from "./BrowserTab";
import { AboutTab, AccessibilityTab, PlanTab, AdvancedTab, CollectionsTab, FilesTab, LibraryTab, NotesTab, ReadingTab, ShortcutsTab } from "./OtherTabs";
import { searchSettings, SETTINGS_TABS } from "./settingsIndex";
import { SyncTab } from "./SyncTab";
import { EreadersTab } from "./EreadersTab";
import { ServersTab } from "./ServersTab";
import { isHome, isWeb } from "../api";
import { WebSyncTab } from "../web/WebConnect";
import { unfoldSection } from "./controls";
import { ActivityTab } from "./ActivityTab";
import { useNarrow } from "../lib/useNarrow";
/** The pages the web version has: the rest are about files and features on a computer. */
const WEB_TABS = new Set(["appearance", "reading", "collections", "sync", "activity", "accessibility", "about"]);
// On the phone at home, the computer keeps the settings; these change only how this phone shows things.
const HOME_TABS = new Set(["appearance", "reading", "accessibility", "about"]);
const TABS = isWeb ? SETTINGS_TABS.filter((t) => WEB_TABS.has(t.tab)) : isHome ? SETTINGS_TABS.filter((t) => HOME_TABS.has(t.tab)) : SETTINGS_TABS;
/** The computer's list of pages, in groups split by a thin line. */
const GROUPS = [
    // About is its own page, straight under Your plan (embre, 31 October).
    ["plan", "about"],
    ["appearance", "reading", "library", "collections", "notes", "browser", "files", "ereaders"],
    ["sync", "activity", "servers"],
    ["accessibility", "shortcuts", "advanced"],
];
const GROUPED = GROUPS.map((group) => group.flatMap((tab) => TABS.filter((t) => t.tab === tab))).filter((g) => g.length > 0);
/** Settings: its own menu of pages on the left, the chosen page on the right.
 * A phone opens on a landing page of cards instead; a computer opens on Appearance. */
export function Settings({ tab, onTab, jump, onJumped, libraryLayout, librarySort, onLibraryView, sidebarShown, onSidebarShown, onRestored, activity, query, onQuery, }) {
    const narrow = useNarrow();
    // A computer has no landing page.
    tab = tab ?? (narrow ? null : "appearance");
    const setQuery = onQuery;
    const [jumpTo, setJumpTo] = useState(null);
    useEffect(() => {
        if (!jump)
            return;
        setJumpTo(jump);
        onJumped?.();
    }, [jump, onJumped]);
    const body = useRef(null);
    const jumped = useRef(false);
    const results = searchSettings(query).filter((r) => TABS.some((t) => t.tab === r.tab));
    const page = SETTINGS_TABS.find((t) => t.tab === tab);
    // A new page starts at its top, or at the section picked from search
    // (opened first, and found once it's drawn: it may sit inside another).
    useEffect(() => {
        if (!jumpTo) {
            // Not when the jump just made has been cleared.
            if (jumped.current)
                jumped.current = false;
            else
                body.current?.closest(".content")?.scrollTo({ top: 0 });
            return;
        }
        unfoldSection(jumpTo);
        let fade;
        const frame = requestAnimationFrame(() => {
            const target = document.getElementById(`settings-${jumpTo}`);
            if (target) {
                target.scrollIntoView({ block: "start" });
                target.classList.add("is-found");
                fade = setTimeout(() => target.classList.remove("is-found"), 1600);
            }
            jumped.current = true;
            setJumpTo(null);
        });
        return () => {
            cancelAnimationFrame(frame);
            if (fade)
                clearTimeout(fade);
        };
    }, [tab, jumpTo]);
    const content = (() => {
        switch (tab) {
            case "plan":
                return _jsx(PlanTab, {});
            case "appearance":
                return (_jsx(AppearanceTab, { sidebarShown: sidebarShown, onSidebarShown: onSidebarShown }));
            case "reading":
                return _jsx(ReadingTab, {});
            case "library":
                return _jsx(LibraryTab, { layout: libraryLayout, sort: librarySort, onChange: onLibraryView });
            case "collections":
                return _jsx(CollectionsTab, {});
            case "notes":
                return _jsx(NotesTab, {});
            case "browser":
                return _jsx(BrowserTab, {});
            case "sync":
                return isWeb ? _jsx(WebSyncTab, {}) : _jsx(SyncTab, { onRestored: onRestored });
            case "activity":
                return _jsx(ActivityTab, { ...activity });
            case "files":
                return _jsx(FilesTab, {});
            case "ereaders":
                return _jsx(EreadersTab, {});
            case "servers":
                return _jsx(ServersTab, {});
            case "accessibility":
                return _jsx(AccessibilityTab, {});
            case "shortcuts":
                return _jsx(ShortcutsTab, {});
            case "advanced":
                return _jsx(AdvancedTab, {});
            case "about":
                return _jsx(AboutTab, {});
        }
    })();
    const found = (_jsx("ul", { className: "settings-menu settings-results", children: results.length === 0 ? (_jsxs("li", { className: "settings-row-hint settings-no-results", children: ["Nothing in Preferences matches \u201C", query.trim(), "\u201D."] })) : (results.map((r) => (_jsx("li", { children: _jsx("button", { type: "button", className: "settings-menu-item", onClick: () => {
                    setQuery("");
                    onTab(r.tab);
                    setJumpTo(r.section);
                }, children: _jsxs("span", { children: [r.label, _jsx("span", { className: "settings-result-page", children: SETTINGS_TABS.find((t) => t.tab === r.tab)?.label })] }) }) }, `${r.tab}-${r.section}`)))) }));
    // The landing page's cards are the menu, so the list of pages shows only inside one.
    if (!page) {
        return (_jsx("div", { className: "settings-page is-landing", children: _jsxs("div", { className: "settings-body", ref: body, children: [_jsx("header", { className: "settings-head settings-landing-head", children: _jsxs("div", { children: [_jsx("h1", { children: "Preferences" }), _jsx("p", { className: "muted", children: "Choose what to change." })] }) }), query.trim() ? (found) : (
                    // The same groups as the computer's list, split by a thin line.
                    GROUPED.map((group, i) => (_jsx("ul", { className: "settings-landing", children: group.map((t) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "settings-landing-card", onClick: () => onTab(t.tab), children: [_jsx(Icon, { name: t.icon, size: 22 }), _jsxs("span", { className: "settings-landing-text", children: [_jsx("span", { className: "settings-landing-name", children: t.label }), _jsx("span", { className: "settings-row-hint", children: t.lede })] })] }) }, t.tab))) }, i))))] }) }));
    }
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("nav", { className: "settings-nav", "aria-label": "Preferences", children: [_jsx("p", { className: "settings-eyebrow", children: "Preferences" }), query.trim() ? (found) : (GROUPED.map((group, i) => (_jsx("ul", { className: "settings-menu", children: group.map((t) => (_jsx("li", { children: _jsxs("button", { type: "button", className: `settings-menu-item${tab === t.tab ? " is-active" : ""}`, "aria-current": tab === t.tab ? "page" : undefined, onClick: () => onTab(t.tab), children: [_jsx(Icon, { name: t.icon, size: 20 }), t.label] }) }, t.tab))) }, i))))] }), _jsxs("div", { className: "settings-body", ref: body, children: [_jsxs("header", { className: "settings-head", children: [narrow && (_jsxs("button", { type: "button", className: "link-btn settings-back", onClick: () => onTab(null), children: [_jsx(Icon, { name: "chevronLeft", size: 16 }), " All preferences"] })), _jsx("h1", { children: page.label }), !narrow && _jsx("span", { className: "settings-ornament", "aria-hidden": true }), _jsx("p", { className: "muted", children: page.lede }), isHome && (_jsx("p", { className: "settings-row-hint", children: "You're using TBV from your computer. Changes here last until this page reloads; the rest of the settings are on the computer." }))] }), content] })] }));
}
