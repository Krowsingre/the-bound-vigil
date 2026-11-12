import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Discover's catalogues: the Bible picker, then the OPDS bookshelves you've
// added (your own Calibre library, Project Gutenberg…). None comes built in;
// free ones are suggested when adding. Browse their shelves, search, and
// bring a book in; it joins the import queue like any other.
import { useCallback, useEffect, useState } from "react";
import { api, isApp, serverBookId } from "../api";
import { playAudiobook } from "../audio/player";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { formatLabel } from "../lib/queryBooks";
import { Bible } from "../browse/Bible";
import { sameAddress, SUGGESTED_GROUPS } from "./suggested";
/** The Bibles' place in the list, ahead of the catalogues. */
const BIBLES = "bibles";
const NEEDS_LOGIN = "needs-login";
function fileLabel(file) {
    const format = file.format ? formatLabel(file.format) : file.mime;
    return file.label && file.label.toLowerCase() !== format.toLowerCase() ? `${format}: ${file.label}` : format;
}
function CatalogDialog({ catalog, existing, onSaved, onCancel, onOpenSite, }) {
    const [form, setForm] = useState({
        id: catalog?.id ?? null,
        name: catalog?.name ?? "",
        url: catalog?.url ?? "",
        username: catalog?.username ?? "",
        password: null,
    });
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const abs = catalog?.kind === "audiobookshelf";
    const toast = useToast();
    const save = async () => {
        setBusy(true);
        try {
            if (abs) {
                onSaved(await api.saveAbsServer({ id: form.id, name: form.name, url: form.url, username: form.username?.trim() ?? "", password: form.password || null }));
                return;
            }
            onSaved(await api.saveCatalog({ ...form, username: form.username?.trim() || null, password: form.password || null }));
        }
        catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };
    const bookmark = async (name, url) => {
        try {
            await api.addBookmark(name, url);
            toast(`${name} is in your Discover bookmarks.`);
        }
        catch (e) {
            setError(String(e));
        }
    };
    const addSuggested = async (name, url) => {
        setBusy(true);
        try {
            onSaved(await api.saveCatalog({ id: null, name, url, username: null, password: null }));
        }
        catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onCancel(), children: _jsxs("form", { className: "dialog writing-dialog catalog-dialog", role: "dialog", "aria-label": catalog ? "Edit catalogue" : "Add a catalogue", onSubmit: (e) => {
                e.preventDefault();
                void save();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onCancel(), children: [_jsx("h2", { children: catalog ? "Edit catalogue" : "Add a catalogue" }), !catalog && _jsx("p", { className: "muted dialog-lede", children: "An Audiobookshelf server is signed in to in Preferences \u203A Servers, and then shows here." }), abs ? (_jsx("p", { className: "muted dialog-lede", children: "Sign in with the username and password you use for Audiobookshelf. You can look through its libraries here and bring audiobooks and ebooks into TBV, and where you are in an audiobook stays the same in both." })) : (_jsx("p", { className: "muted dialog-lede", children: "Any OPDS catalogue works. For your own Calibre library, start Calibre's content server (Connect/share \u203A Start Content server) and enter its address with /opds at the end, like http://192.168.1.20:8080/opds." })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Address" }), _jsx("input", { value: form.url, onChange: (e) => setForm({ ...form, url: e.target.value }), placeholder: abs ? "http://192.168.1.20:13378" : "https://…", autoFocus: !!catalog, inputMode: "url" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Name" }), _jsx("input", { value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }), placeholder: "Optional" })] }), _jsxs("div", { className: "writing-details-row", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "User name" }), _jsx("input", { value: form.username ?? "", onChange: (e) => setForm({ ...form, username: e.target.value }), placeholder: abs ? "" : "Only if it asks", autoComplete: "off" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Password" }), _jsx("input", { type: "password", value: form.password ?? "", onChange: (e) => setForm({ ...form, password: e.target.value }), placeholder: catalog?.hasPassword ? (abs ? "Signed in" : "Saved") : "", autoComplete: "new-password" })] })] }), _jsx("p", { className: "muted writing-hint", children: abs
                        ? "TBV keeps only the server's sign-in, never the password, on this device."
                        : "The password stays on this computer and is never put in a backup." }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || !form.url.trim() || (abs && (!form.username?.trim() || (!catalog?.hasPassword && !form.password))), children: busy && abs ? "Signing in…" : abs && form.password ? "Sign in" : "Save" })] }), !catalog && (_jsxs(_Fragment, { children: [_jsx("strong", { className: "catalog-own", children: "Or start with a free source" }), _jsx("p", { className: "muted dialog-lede", children: "Suggestions only: all free and legal, and nothing is added until you choose it." }), SUGGESTED_GROUPS.map((group) => {
                            const items = group.items.filter((s) => s.kind === "site" || !existing.some((u) => sameAddress(u, s.url)));
                            if (!items.length)
                                return null;
                            return (_jsxs("section", { className: "catalog-suggested", "aria-label": group.title, children: [_jsx("strong", { children: group.title }), _jsx("span", { className: "muted", children: group.about }), _jsx("ul", { children: items.map((s) => (_jsxs("li", { children: [_jsxs("span", { children: [_jsx("b", { children: s.name }), _jsx("span", { className: "muted", children: s.about })] }), s.kind === "opds" ? (_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => void addSuggested(s.name, s.url), children: [_jsx(Icon, { name: "plus", size: 14 }), " Add"] })) : (_jsxs("span", { className: "catalog-site-actions", children: [_jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": `Bookmark ${s.name}`, title: "Save to your Discover bookmarks", disabled: busy, onClick: () => void bookmark(s.name, s.url), children: _jsx(Icon, { name: "bookmark", size: 15 }) }), onOpenSite && (_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => onOpenSite(s.url), children: [_jsx(Icon, { name: "globe", size: 14 }), " Open"] }))] }))] }, s.url))) })] }, group.title));
                        })] }))] }) }));
}
function EntryCard({ entry, state, onOpen, onDownload, onListen, }) {
    const [best, ...others] = entry.files.filter((f) => f.format);
    const [imageFailed, setImageFailed] = useState(false);
    const more = others.map((f) => ({ label: fileLabel(f), icon: "download", onSelect: () => onDownload(f) }));
    return (_jsxs("li", { className: "catalog-book", children: [_jsx("div", { className: "catalog-cover", children: entry.cover && !imageFailed ? (_jsx("img", { src: entry.cover, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onError: () => setImageFailed(true) })) : (_jsx("span", { className: "catalog-cover-blank", children: entry.title })) }), _jsxs("div", { className: "catalog-book-text", children: [_jsx("strong", { className: "catalog-book-title", children: entry.title }), entry.authors.length > 0 && _jsx("span", { className: "muted", children: entry.authors.join(", ") }), entry.summary && _jsx("p", { className: "catalog-summary muted", children: entry.summary }), _jsxs("div", { className: "catalog-actions", children: [onListen && (_jsxs("button", { type: "button", className: "btn btn-primary btn-small", onClick: onListen, title: "Play it from the server, without downloading it", children: [_jsx(Icon, { name: "play", size: 14 }), " Listen"] })), best ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: `btn ${onListen ? "btn-quiet" : "btn-primary"} btn-small`, disabled: state !== "idle", onClick: () => onDownload(best), children: state === "busy" ? "Bringing it in…" : state === "done" ? (_jsxs(_Fragment, { children: [_jsx(Icon, { name: "check", size: 14 }), " Added"] })) : (_jsxs(_Fragment, { children: [_jsx(Icon, { name: "download", size: 14 }), " ", formatLabel(best.format)] })) }), more.length > 0 && state === "idle" && (_jsx(Menu, { label: "Other formats", className: "btn btn-quiet btn-small", trigger: _jsxs(_Fragment, { children: ["Other formats ", _jsx(Icon, { name: "chevronDown", size: 13 })] }), items: more }))] })) : entry.navigation ? (_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: onOpen, children: ["See the book ", _jsx(Icon, { name: "chevronRight", size: 14 })] })) : (_jsx("span", { className: "muted", children: entry.notFree ? "This one has to be bought or borrowed on the catalog's own site." : "No file TBV can open." }))] })] })] }));
}
export function Catalogs({ refreshKey = 0, onOpenBook, onOpenSite, }) {
    const [catalogs, setCatalogs] = useState(null);
    const [current, setCurrent] = useState(null);
    const [trail, setTrail] = useState([]);
    const [feed, setFeed] = useState(null);
    const [loading, setLoading] = useState(false);
    const [problem, setProblem] = useState(null);
    const [words, setWords] = useState("");
    const [editing, setEditing] = useState(null);
    const [removing, setRemoving] = useState(null);
    const [downloads, setDownloads] = useState({});
    const toast = useToast();
    const bibles = !!onOpenBook;
    const reloadCatalogs = useCallback(async () => {
        const list = await api.catalogs();
        setCatalogs(list);
        setCurrent((c) => (c && (c === BIBLES || list.some((x) => x.id === c)) ? c : bibles ? BIBLES : (list[0]?.id ?? null)));
    }, [bibles]);
    useEffect(() => {
        void reloadCatalogs().catch((e) => setProblem(String(e)));
    }, [reloadCatalogs]);
    const step = trail[trail.length - 1] ?? null;
    useEffect(() => {
        if (!current || current === BIBLES || !step)
            return;
        let live = true;
        setLoading(true);
        setProblem(null);
        const loading = step.search !== undefined && feed?.search ? api.catalogSearch(current, feed.search, step.search) : api.catalogFeed(current, step.url);
        loading.then((f) => live && (setFeed(f), setLoading(false)), (e) => live && (setProblem(String(e)), setLoading(false)));
        return () => {
            live = false;
        };
        // The search address comes from the page before; it doesn't start a load by itself.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current, step]);
    // A new catalog starts at its first page.
    useEffect(() => {
        if (current)
            setTrail([{ title: catalogs?.find((c) => c.id === current)?.name ?? "Catalogue", url: null }]);
        setFeed(null);
        setWords("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current]);
    const go = (title, url) => setTrail((t) => [...t, { title, url }]);
    const back = (i) => setTrail((t) => t.slice(0, i + 1));
    const search = () => {
        if (!words.trim() || !feed?.search)
            return;
        setTrail((t) => [...t.slice(0, 1), { title: `“${words.trim()}”`, url: null, search: words.trim() }]);
    };
    const download = async (entry, file) => {
        if (!current)
            return;
        setDownloads((d) => ({ ...d, [entry.id]: "busy" }));
        try {
            await api.downloadFromCatalog(current, file, entry.title);
            setDownloads((d) => ({ ...d, [entry.id]: "done" }));
            toast(`${entry.title} is being added to your library.`);
        }
        catch (e) {
            setDownloads((d) => {
                const { [entry.id]: _, ...rest } = d;
                return rest;
            });
            toast(String(e) === NEEDS_LOGIN ? "The catalog wants you to sign in. Add your details with Edit." : String(e));
        }
    };
    const catalog = catalogs?.find((c) => c.id === current) ?? null;
    const shelves = feed?.entries.filter((e) => !e.files.length && e.navigation && !e.authors.length && !e.summary) ?? [];
    const books = feed?.entries.filter((e) => !shelves.includes(e)) ?? [];
    return (_jsxs("div", { className: "catalogs-page", children: [_jsxs("div", { className: "catalogs-layout", children: [_jsxs("nav", { className: "catalogs-list", "aria-label": "Your catalogues", children: [_jsxs("button", { type: "button", className: "btn btn-primary btn-small catalogs-add", onClick: () => setEditing("new"), children: [_jsx("span", { "aria-hidden": true, children: "+" }), " Add a catalogue"] }), bibles && (_jsx("div", { className: `catalogs-item${current === BIBLES ? " is-current" : ""}`, children: _jsxs("button", { type: "button", onClick: () => setCurrent(BIBLES), "aria-current": current === BIBLES ? "true" : undefined, children: [_jsx(Icon, { name: "bookOpen", size: 16 }), _jsx("span", { children: "Bibles" })] }) })), (catalogs ?? []).map((c) => (_jsxs("div", { "data-item-menu": true, className: `catalogs-item${c.id === current ? " is-current" : ""}`, children: [_jsxs("button", { type: "button", onClick: () => setCurrent(c.id), "aria-current": c.id === current ? "true" : undefined, children: [_jsx(Icon, { name: c.kind === "audiobookshelf" ? "headphones" : "globe", size: 16 }), _jsx("span", { children: c.name })] }), _jsx(Menu, { label: `More for ${c.name}`, className: "writing-chapter-more", trigger: _jsx(Icon, { name: "more", size: 16 }), items: [
                                            { label: "Edit…", icon: "edit", onSelect: () => setEditing(c) },
                                            { label: "Remove…", icon: "trash", danger: true, onSelect: () => setRemoving(c) },
                                        ] })] }, c.id))), catalogs?.length === 0 && _jsx("p", { className: "muted writing-hint", children: "No catalogues yet. Add one to start." })] }), _jsxs("section", { className: "catalogs-main", "aria-busy": loading, children: [current === BIBLES && onOpenBook && _jsx(Bible, { refreshKey: refreshKey, onOpenBook: onOpenBook, onOpenSite: onOpenSite }), catalog && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "catalogs-bar", children: [_jsx("ol", { className: "catalogs-trail", "aria-label": "Where you are", children: trail.map((s, i) => (_jsx("li", { children: i < trail.length - 1 ? (_jsx("button", { type: "button", className: "link-btn", onClick: () => back(i), children: i === 0 ? catalog.name : s.title })) : (_jsx("strong", { children: i === 0 ? catalog.name : feed?.title && !s.search ? feed.title : s.title })) }, i))) }), feed?.search && (_jsxs("form", { className: "catalogs-search", role: "search", onSubmit: (e) => {
                                                    e.preventDefault();
                                                    search();
                                                }, children: [_jsx(Icon, { name: "search", size: 16 }), _jsx("input", { value: words, onChange: (e) => setWords(e.target.value), placeholder: `Search ${catalog.name}`, "aria-label": `Search ${catalog.name}` })] }))] }), problem ? (_jsx("div", { className: "library-empty", role: "alert", children: problem === NEEDS_LOGIN ? (_jsxs(_Fragment, { children: [_jsxs("h2", { children: [catalog.name, " wants you to sign in"] }), _jsx("p", { className: "muted", children: "Add the user name and password you use for it. They stay on this computer." }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => setEditing(catalog), children: "Sign in" })] })) : (_jsxs(_Fragment, { children: [_jsx("h2", { children: "This page couldn't be opened" }), _jsx("p", { className: "muted", children: problem }), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setTrail((t) => [...t]), children: "Try again" })] })) })) : loading && !feed ? (_jsx("div", { className: "library-loading", "aria-label": "Loading the catalogue" })) : feed ? (_jsxs("div", { className: loading ? "is-loading" : undefined, children: [shelves.length > 0 && (_jsx("ul", { className: "catalog-shelves", children: shelves.map((s) => (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => go(s.title, s.navigation), children: [_jsx("span", { children: s.title }), _jsx(Icon, { name: "chevronRight", size: 16 })] }) }, s.id))) })), books.length > 0 && (_jsx("ul", { className: "catalog-books", children: books.map((b) => (_jsx(EntryCard, { entry: b, state: downloads[b.id] ?? "idle", onOpen: () => b.navigation && go(b.title, b.navigation), onDownload: (f) => void download(b, f), onListen: isApp && catalog?.kind === "audiobookshelf" && b.files.some((f) => f.url.endsWith("/audio"))
                                                        ? () => playAudiobook(serverBookId(catalog.id, b.id))
                                                        : undefined }, b.id))) })), !shelves.length && !books.length && _jsx("p", { className: "muted catalogs-nothing", children: "Nothing here." }), (feed.previous || feed.next) && (_jsxs("div", { className: "catalogs-pages", children: [feed.previous && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => go(feed.title, feed.previous), children: [_jsx(Icon, { name: "chevronLeft", size: 15 }), " Previous"] })), feed.next && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => go(feed.title, feed.next), children: ["More ", _jsx(Icon, { name: "chevronRight", size: 15 })] }))] }))] })) : null] }))] })] }), editing && (_jsx(CatalogDialog, { catalog: editing === "new" ? null : editing, existing: catalogs?.map((c) => c.url) ?? [], onOpenSite: onOpenSite, onCancel: () => setEditing(null), onSaved: (c) => {
                    setEditing(null);
                    void reloadCatalogs().then(() => {
                        setCurrent(c.id);
                        setTrail([{ title: c.name, url: null }]);
                    });
                } })), removing && (_jsx(ConfirmDialog, { title: `Remove ${removing.name}?`, body: "Books you've already brought in stay in your library.", confirm: "Remove", danger: true, onCancel: () => setRemoving(null), onConfirm: () => {
                    const gone = removing;
                    setRemoving(null);
                    void api.removeCatalog(gone.id).then(reloadCatalogs, (e) => toast(String(e)));
                } }))] }));
}
