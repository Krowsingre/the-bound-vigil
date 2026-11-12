/** Each page's name, and the few words under it in the sidebar. */
export const PAGE = {
    home: { label: "Sanctum", caption: "Your home" },
    library: { label: "Archive", caption: "Books & documents" },
    audiobooks: { label: "Resonance", caption: "Audiobooks" },
    collections: { label: "Compendium", caption: "Your collections" },
    writing: { label: "Scribe", caption: "Notes & manuscripts" },
    catalogs: { label: "Discover", caption: "Find new books" },
    settings: { label: "Preferences", caption: "Settings & sync" },
};
export const NAV = [
    { route: "home", ...PAGE.home, icon: "home" },
    { route: "library", ...PAGE.library, icon: "library" },
    { route: "audiobooks", ...PAGE.audiobooks, icon: "headphones" },
    { route: "collections", ...PAGE.collections, icon: "layers" },
    { route: "writing", ...PAGE.writing, icon: "pen" },
    { route: "catalogs", ...PAGE.catalogs, icon: "compass" },
    { route: "settings", ...PAGE.settings, icon: "settings" },
];
/** The pages this copy of TBV shows. Discover needs the app (a web page can't
 * reach most catalogs or hold a browser). Scribe holds notes too; the books you
 * write need synced records, which the phone at home doesn't keep, so there
 * it's only notes. */
export function navFor({ web, home, android = false }) {
    // Android's test version has no browser yet.
    return NAV.filter((n) => !(n.route === "catalogs" && (web || home || android))).map((n) => n.route === "writing" && home ? { ...n, caption: "Your notes" } : n);
}
/** Sync & Accounts lives inside Preferences, so Preferences stays highlighted;
 * notes are part of Scribe, and documents of the Archive. */
export function navRouteOf(route) {
    return route === "sync" ? "settings" : route === "notes" ? "writing" : route === "documents" ? "library" : route;
}
