import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api, isIOS } from "../api";
import { useToast } from "../components/Toast";
import { COME_BACK, LINKS_OPEN, DEFAULT_HOME, lowerFor, onBrowserPrefs, PROTECTION_LEVELS, REDIRECT_MODES, redirectHost, protectionOf, readBrowserPrefs, resetSite, SEARCH_ENGINES, sitesWithSettings, zoomLabel, writeBrowserPrefs, } from "../browse/browserPrefs";
import { Columns, Row, Section, SectionGroup, Select, Toggle } from "./controls";
import { temporaryDownloads } from "../browse/browserDownloads";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DiscoverBackgroundPicker } from "../browse/DiscoverBackground";
import { clearHistory, HISTORY_KEEPS, trimHistory } from "../browse/browserHistory";
/** Tells an open browser about a change to protection; it's read afresh when the browser next opens anyway. */
const protect = (prefs) => void api.browserProtect(protectionOf(prefs)).catch(() => undefined);
/** Discover's browser: what it searches with, where it starts, what it blocks, and what happens to downloads. */
export function BrowserTab() {
    const toast = useToast();
    const [prefs, setPrefs] = useState(readBrowserPrefs);
    const [home, setHome] = useState(prefs.home);
    const [redirectSite, setRedirectSite] = useState("");
    const [clearing, setClearing] = useState(false);
    const [cleanup, setCleanup] = useState(null);
    const [working, setWorking] = useState(false);
    const manageTemporary = async (remove) => {
        setWorking(true);
        try {
            const result = await temporaryDownloads(remove);
            if (remove) {
                setCleanup(null);
                toast(result.failed ? `Couldn't remove ${result.failed} temporary entries.` : "Temporary files removed.");
            }
            else if (result.files || result.failed)
                setCleanup(result);
            else
                toast("There are no temporary files to remove.");
        }
        catch (error) {
            toast(String(error));
        }
        finally {
            setWorking(false);
        }
    };
    const chooseDownloadFolder = async () => {
        try {
            const downloadFolder = await api.chooseFolder("Choose where to save Discover downloads", prefs.downloadFolder);
            if (downloadFolder)
                writeBrowserPrefs({ downloadFolder, askDownloadFolder: false });
        }
        catch (error) {
            toast(String(error));
        }
    };
    useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
    useEffect(() => setHome(prefs.home), [prefs.home]);
    const saveHome = () => {
        const text = home.trim();
        if (!text)
            return setHome(prefs.home);
        const address = /^https?:\/\//i.test(text) ? text : `https://${text}`;
        try {
            new URL(address);
        }
        catch {
            toast("That isn't a web address.");
            return setHome(prefs.home);
        }
        if (address !== prefs.home) {
            writeBrowserPrefs({ home: address });
            toast("Your home page is saved.");
        }
    };
    const side = (_jsxs(_Fragment, { children: [_jsxs(SectionGroup, { id: "media", title: "Downloads and media", lede: "Ebooks you download, and sound that keeps playing.", holds: ["downloads", "playing"], children: [_jsxs(Section, { id: "downloads", title: "Downloads", lede: "Ebooks you download in Discover.", children: [_jsx(Toggle, { label: "Add ebooks to the library without asking", hint: "Off: TBV asks whether to add each ebook or keep it in Downloads.", checked: prefs.addWithoutAsking, onChange: (addWithoutAsking) => writeBrowserPrefs({ addWithoutAsking }) }), _jsxs(Row, { label: "Download to", hint: prefs.askDownloadFolder ? "Ask every time" : prefs.downloadFolder ?? "Downloads (TBV default)", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void chooseDownloadFolder(), children: "Choose folder" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => writeBrowserPrefs({ downloadFolder: null, askDownloadFolder: false }), children: "Reset to TBV default" })] }), _jsx(Toggle, { label: "Ask where to save each download", checked: prefs.askDownloadFolder, onChange: (askDownloadFolder) => writeBrowserPrefs({ askDownloadFolder }) }), _jsx(Toggle, { label: "Delete temporary files when removing downloads from history", hint: "Files saved to your download folder and books in your library stay where they are.", checked: prefs.deleteTemporaryWithHistory, onChange: (deleteTemporaryWithHistory) => writeBrowserPrefs({ deleteTemporaryWithHistory }) }), _jsx(Row, { label: "Temporary files", children: _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: working, onClick: () => void manageTemporary(false), children: "Remove all temporary files" }) }), cleanup && _jsx(ConfirmDialog, { title: "Remove temporary files?", body: `${cleanup.files} files (${(cleanup.bytes / 1024 / 1024).toFixed(1)} MB). Active transfers and imports are skipped.`, confirm: "Remove", onCancel: () => setCleanup(null), onConfirm: () => { if (!working)
                                    void manageTemporary(true); } })] }), _jsx(Section, { id: "playing", title: "Videos and sound", lede: "What happens to a video or music playing in Discover when you go to another page.", children: _jsx(Toggle, { label: "Keep playing after leaving Discover", hint: "Off: videos and sound pause when you leave Discover.", checked: prefs.keepPlaying, onChange: (keepPlaying) => writeBrowserPrefs({ keepPlaying }) }) })] }), _jsx(Section, { id: "apps", title: "Links for other apps", lede: "Links that open another app, such as an email address or a phone number.", children: _jsx(Toggle, { label: "Ask before opening other apps", hint: "Off: they open straight away.", checked: prefs.askApps, onChange: (askApps) => writeBrowserPrefs({ askApps }) }) })] }));
    return (_jsxs(Columns, { side: side, children: [_jsxs(Section, { id: "redirects", title: "Website redirects", lede: "Choose what Discover does when a site automatically sends you to another page. Trusted sites can redirect under any mode.", children: [_jsx(Row, { label: "Automatic redirects", children: _jsx(Select, { label: "Automatic redirects", value: prefs.redirects, options: REDIRECT_MODES, onChange: (redirects) => protect(writeBrowserPrefs({ redirects })) }) }), _jsxs("form", { onSubmit: (event) => {
                            event.preventDefault();
                            const host = redirectHost(redirectSite);
                            if (!host)
                                return toast("Enter a website host.");
                            protect(writeBrowserPrefs({ redirectAllowlist: [...new Set([...prefs.redirectAllowlist, host])] }));
                            setRedirectSite("");
                        }, children: [_jsxs("label", { children: ["Allow redirects from ", _jsx("input", { value: redirectSite, placeholder: "example.com", onChange: (event) => setRedirectSite(event.target.value) })] }), _jsx("button", { type: "submit", className: "btn btn-quiet btn-small", children: "Add site" })] }), prefs.redirectAllowlist.map((host) => (_jsx(Row, { label: host, children: _jsx("button", { type: "button", className: "btn btn-quiet btn-small", "aria-label": "Remove " + host, onClick: () => protect(writeBrowserPrefs({ redirectAllowlist: prefs.redirectAllowlist.filter((site) => site !== host) })), children: "Remove" }) }, host)))] }), _jsxs(SectionGroup, { id: "start", title: "Start and search", lede: "What Discover opens to and how it searches.", holds: ["search", "home"], children: [_jsxs(Section, { id: "search", title: "Searching", lede: "Words typed into Discover's address box that aren't a web address are searched for.", children: [_jsx(Toggle, { label: "Suggest from history and bookmarks while typing", hint: "Also your Quick Links and open tabs. Everything comes from this device, so nothing you type is sent anywhere.", checked: prefs.suggest, onChange: (suggest) => writeBrowserPrefs({ suggest }) }), _jsx(Row, { label: "Search engine", children: _jsx(Select, { label: "Search engine", value: prefs.search, options: SEARCH_ENGINES.map((e) => ({
                                        value: e.value,
                                        label: e.label,
                                    })), onChange: (search) => writeBrowserPrefs({ search }) }) })] }), _jsxs(Section, { id: "home", title: "Home page", lede: "Where new tabs start, and where Discover's home button goes.", children: [_jsx(Row, { label: "Start with", children: _jsx(Select, { label: "Start with", value: prefs.startPage ? "start" : "site", options: [
                                        { value: "start", label: "Discover start page" },
                                        { value: "site", label: "A website" },
                                    ], onChange: (v) => writeBrowserPrefs({ startPage: v === "start" }) }) }), _jsx(Toggle, { label: "Show Recent Sites on the start page", hint: prefs.historyOn ? "The sites you visited last, from History." : "History is off, so there are none to show.", checked: prefs.showRecent, disabled: !prefs.startPage, onChange: (showRecent) => writeBrowserPrefs({ showRecent }) }), _jsx(Row, { label: "Start page background", hint: "A picture behind the start page, on this device. It stops at the scroll bar.", stack: true, children: _jsx(DiscoverBackgroundPicker, { value: prefs.background, onError: toast }) }), !prefs.startPage && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Home page" }), _jsx("input", { type: "url", spellCheck: false, value: home, "aria-label": "Home page", onChange: (e) => setHome(e.target.value), onBlur: saveHome, onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur() })] })), !prefs.startPage && (_jsx("div", { className: "connection-actions", children: _jsx("button", { type: "button", className: "btn btn-quiet", disabled: prefs.home === DEFAULT_HOME, onClick: () => (writeBrowserPrefs({ home: DEFAULT_HOME }), toast("Your home page is Project Gutenberg again.")), children: "Use Project Gutenberg" }) })), _jsx(Row, { label: "Coming back to Discover", hint: "Starting at the home page closes your other tabs.", children: _jsx(Select, { label: "Coming back to Discover", value: prefs.comeBack, options: COME_BACK, onChange: (comeBack) => writeBrowserPrefs({ comeBack }) }) }), _jsx(Row, { label: "Websites from Sanctum's Quick links", hint: "Opened in Discover.", children: _jsx(Select, { label: "Websites from Sanctum's Quick links", value: prefs.linksOpen, options: LINKS_OPEN, onChange: (linksOpen) => writeBrowserPrefs({ linksOpen }) }) })] })] }), _jsxs(Section, { id: "history", title: "History", lede: "Pages visited and words searched for in Discover. Open it from Discover's \u2022\u2022\u2022 menu. To have the same history on every device, turn on Sync Discover history in Preferences \u203A Sync & Backup.", children: [_jsx(Toggle, { label: "Keep a history of pages visited", checked: prefs.historyOn, onChange: (historyOn) => writeBrowserPrefs({ historyOn }) }), _jsx(Toggle, { label: "Keep searches too", hint: "Words typed into the address box that aren't a web address.", checked: prefs.historySearches, disabled: !prefs.historyOn, onChange: (historySearches) => writeBrowserPrefs({ historySearches }) }), _jsx(Row, { label: "Keep history for", children: _jsx(Select, { label: "Keep history for", value: prefs.historyKeep, options: HISTORY_KEEPS.map((k) => ({ value: k.value, label: k.label })), onChange: (historyKeep) => {
                                writeBrowserPrefs({ historyKeep });
                                trimHistory(historyKeep);
                            } }) }), _jsx(Row, { label: "Clear history", hint: "Bookmarks, tabs and site sign-ins stay.", children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setClearing(true), children: "Clear history" }) }), clearing && (_jsx(ConfirmDialog, { title: "Clear all history?", body: "Every page and search goes from Discover's history.", confirm: "Clear", danger: true, onCancel: () => setClearing(false), onConfirm: () => {
                            clearHistory();
                            setClearing(false);
                            toast("Discover's history is cleared.");
                        } }))] }), _jsxs(SectionGroup, { id: "privacy", title: "Privacy and sites", lede: "What Discover blocks, choices made for single sites, and what sites keep.", holds: ["protection", "sites", "sitedata"], children: [_jsxs(Section, { id: "protection", title: "Protection", lede: "What Discover blocks on the websites you visit. A site that won't work properly can have its protection lowered from its Site information sheet (the lock in the address box).", children: [_jsx(Row, { label: "Protection", hint: PROTECTION_LEVELS.find((p) => p.value === prefs.protection)?.hint, children: _jsx(Select, { label: "Protection", value: prefs.protection, options: PROTECTION_LEVELS.map((p) => ({ value: p.value, label: p.value === "strict" ? `${p.label} (recommended)` : p.label })), onChange: (protection) => protect(writeBrowserPrefs({ protection })) }) }), prefs.lowered.length > 0 && (_jsxs(_Fragment, { children: [_jsx("p", { className: "muted", children: "Sites with protection lowered:" }), prefs.lowered.map((site) => (_jsx(Row, { label: site, children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => protect(lowerFor(site, false)), children: "Restore protection" }) }, site)))] }))] }), _jsx(Section, { id: "sites", title: "Sites with their own settings", lede: "Choices made for one site from its Site information sheet (the lock in the address box).", children: sitesWithSettings(prefs).length === 0 ? (_jsx("p", { className: "muted", children: "None yet. Every site uses the choices above." })) : (sitesWithSettings(prefs).map((site) => {
                            const own = prefs.sites[site] ?? {};
                            const what = [
                                prefs.lowered.includes(site) && "Protection lowered",
                                own.zoom && `Zoom ${zoomLabel(own.zoom)}`,
                                own.desktop && isIOS && "Desktop version",
                            ].filter(Boolean);
                            return (_jsx(Row, { label: site, hint: what.join(" · ") || undefined, children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => {
                                        protect(resetSite(site));
                                        toast(`${site} is back to the usual settings.`);
                                    }, children: "Reset" }) }, site));
                        })) }), _jsxs(Section, { id: "sitedata", title: "Site data", lede: "Cookies and saved logins from websites you've visited in Discover. TBV's own data isn't touched.", children: [_jsx(Toggle, { label: "Clear cookies and site data each time TBV starts", hint: "You'll be signed out of every website each time. Bookmarks, History and tabs stay.", checked: prefs.clearOnStart, onChange: (clearOnStart) => writeBrowserPrefs({ clearOnStart }) }), _jsx(Row, { label: "Clear cookies and site data", hint: "You'll be signed out of every website in Discover.", children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api
                                        .browserClear()
                                        .then(() => toast("Every site's cookies and data are cleared."))
                                        .catch((e) => toast(String(e))), children: "Clear" }) })] })] })] }));
}
