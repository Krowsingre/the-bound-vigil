import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { startupStep } from "../splash/startup";
import { useToast } from "../components/Toast";
import { Icon } from "../components/Icon";
import { greeting } from "../lib/format";
import { useNarrow } from "../lib/useNarrow";
import { makeBookActions } from "./bookActions";
import { CompendiumRow } from "./CompendiumRow";
import { InProgress } from "./InProgress";
import { ReadingActivity } from "./ReadingActivity";
import { RecentlyAdded } from "./RecentlyAdded";
import { QuickLinks } from "./QuickLinks";
import { ResumeHero } from "./ResumeHero";
import { SuggestedReading } from "./SuggestedReading";
export function Home({ refreshKey, onNavigate, onOpenLibrary, onOpenSeries, onImportBooks, onImportFolder, onLoaded, onOpenBook, onOpenCompendium, onOpenCollection, }) {
    const narrow = useNarrow();
    const [load, setLoad] = useState({ state: "loading" });
    const [reload, setReload] = useState(0);
    const toast = useToast();
    useEffect(() => {
        let current = true;
        api.getHome().then((home) => {
            if (!current)
                return;
            setLoad({ state: "ready", home });
            onLoaded?.(home);
        }, (e) => current && setLoad({ state: "error", message: String(e) }));
        return () => {
            current = false;
        };
    }, [refreshKey, reload, onLoaded]);
    // The first screen is drawn: the splash can go once covers and fonts are in.
    useEffect(() => {
        if (load.state === "loading")
            return;
        startupStep("library");
        startupStep("sanctum");
    }, [load.state]);
    const actions = makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook);
    const openLibrary = useCallback(() => onOpenLibrary({ tab: "all" }), [onOpenLibrary]);
    if (load.state === "loading")
        return _jsx("div", { className: "home home-loading", "aria-busy": "true", "aria-label": "Loading your library" });
    if (load.state === "error")
        return (_jsxs("div", { className: "home home-error", role: "alert", children: [_jsx("h1", { children: "Your library couldn't be loaded" }), _jsx("p", { className: "muted", children: load.message }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => setReload((n) => n + 1), children: "Try again" })] }));
    const { home } = load;
    if (home.libraryCounts.total === 0) {
        return (_jsx("div", { className: "home", children: _jsxs("section", { className: "welcome", "aria-labelledby": "welcome-title", children: [_jsx("p", { className: "eyebrow", children: greeting() }), _jsx("h1", { id: "welcome-title", className: "hero-title", children: "Your library is empty" }), _jsx("p", { className: "hero-synopsis", children: "Add books you already have. TBV keeps its own copy in its library folder and never changes your original files." }), _jsxs("div", { className: "hero-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary btn-large", onClick: onImportBooks, children: [_jsx(Icon, { name: "importFile", size: 16 }), " Import books"] }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-large", onClick: onImportFolder, children: [_jsx(Icon, { name: "folder", size: 16 }), " Import a folder"] }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-large", onClick: () => onNavigate("sync"), children: [_jsx(Icon, { name: "link", size: 16 }), " Join an existing library"] })] }), _jsx("p", { className: "muted welcome-hint", children: "You can also drag book files anywhere into this window. EPUB, PDF, Kindle (MOBI, AZW3), comics (CBZ), FB2, TXT and Word (DOCX, DOC) are accepted." })] }) }));
    }
    // On a computer: cards in three rows, as in embre's picture. A phone keeps its own layout.
    if (!narrow)
        return (_jsxs("div", { className: "home home-desk", children: [_jsx(ResumeHero, { book: home.resumeBook, actions: actions, onOpenLibrary: openLibrary }), _jsx(ReadingActivity, { finished: home.libraryCounts.read, finishedDates: home.finishedDates, refreshKey: refreshKey, wide: true }), _jsx(RecentlyAdded, { books: home.recentlyAdded, actions: actions, onOpenSeries: onOpenSeries ?? openLibrary, onViewAll: () => onOpenCompendium("recently_added"), menus: true }), _jsx(InProgress, { books: home.inProgress, actions: actions, onViewAll: () => onOpenCompendium("in_progress"), list: true }), _jsx(QuickLinks, { refreshKey: refreshKey, onNavigate: onNavigate, onOpenBook: onOpenBook, onOpenCollection: onOpenCollection }), _jsx(SuggestedReading, { shelves: home.suggested ?? [], readAuthors: home.readAuthors ?? [], actions: actions, onNavigate: onNavigate }), _jsx(CompendiumRow, { refreshKey: refreshKey, onOpenCollection: onOpenCollection, onOpenCompendium: onOpenCompendium, onViewAll: () => onNavigate("collections") })] }));
    return (_jsxs("div", { className: "home", children: [_jsxs("div", { className: "home-top", children: [_jsx(ResumeHero, { book: home.resumeBook, actions: actions, onOpenLibrary: openLibrary }), _jsx(ReadingActivity, { finished: home.libraryCounts.read, finishedDates: home.finishedDates, refreshKey: refreshKey })] }), _jsxs("div", { className: "home-middle", children: [_jsx(InProgress, { books: home.inProgress, actions: actions, onViewAll: () => onOpenCompendium("in_progress") }), _jsx(RecentlyAdded, { books: home.recentlyAdded, actions: actions, onOpenSeries: onOpenSeries ?? openLibrary, onViewAll: () => onOpenCompendium("recently_added") })] })] }));
}
