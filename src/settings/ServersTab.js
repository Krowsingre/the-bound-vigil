import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Preferences › Servers: seedboxes, NAS drives and other computers to bring
// books and audiobooks in from, over FTP, FTPS or SFTP.
import { useCallback, useEffect, useState } from "react";
import { api, isApp } from "../api";
import { NO_SERVER_QUEUE, SERVERS_DESKTOP_ONLY } from "../api/serverStub";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { Columns, formatBytes, Section, Segmented } from "./controls";
import { AudiobookshelfSection } from "./AudiobookshelfSection";
import { LocalSendSection } from "./LocalSendSection";
const PROTOCOLS = [
    { value: "sftp", label: "SFTP (SSH)" },
    { value: "ftps", label: "FTPS" },
    { value: "ftp", label: "FTP" },
];
const usualPort = (p) => (p === "sftp" ? 22 : 21);
const EMPTY = {
    id: null,
    name: "",
    protocol: "sftp",
    host: "",
    port: 22,
    username: "",
    password: null,
    login: "password",
    keyFile: null,
    folder: "",
};
const plain = (e) => String(e).replace(/^Error: /, "");
const NEW_KEY = "new-host-key:";
export function ServersTab() {
    const toast = useToast();
    const [servers, setServers] = useState(null);
    const [editing, setEditing] = useState(null);
    const [browsing, setBrowsing] = useState(null);
    const [question, setQuestion] = useState(null);
    const [removing, setRemoving] = useState(null);
    const load = useCallback(() => {
        api.listServers().then(setServers, () => setServers([]));
    }, []);
    useEffect(load, [load]);
    /** Runs `work`, asking about the server's key first if it's new to TBV. */
    const withKey = useCallback(async (server, work, onError) => {
        try {
            await work(server);
        }
        catch (e) {
            const message = plain(e);
            if (message.startsWith(NEW_KEY)) {
                setQuestion({
                    server,
                    fingerprint: message.slice(NEW_KEY.length),
                    then: (trusted) => void work(trusted).catch((e2) => onError(plain(e2))),
                    cancel: () => onError("TBV didn't connect, because the server's key wasn't trusted."),
                });
            }
            else {
                onError(message);
            }
        }
    }, []);
    return (_jsxs(Columns, { side: _jsx(LocalSendSection, {}), children: [_jsxs(Section, { id: "servers", title: "Servers", lede: "Bring in books, documents and audiobooks from a seedbox, a NAS or another computer. Files are copied into TBV; nothing on the server is changed.", children: [!isApp && _jsx("p", { className: "settings-row-hint", children: SERVERS_DESKTOP_ONLY }), servers !== null && servers.length === 0 && !editing && (_jsx("p", { className: "settings-row-hint", children: "No servers yet. Add one with its address and your sign-in." })), servers && servers.length > 0 && (_jsx("ul", { className: "ereader-list server-list", children: servers.map((s) => (_jsxs("li", { className: "ereader-item server-item", children: [_jsx(Icon, { name: "database", size: 20 }), _jsxs("span", { children: [_jsx("span", { className: "settings-row-label", children: s.name }), _jsxs("span", { className: "settings-row-hint", children: [s.protocol.toUpperCase(), " \u00B7 ", s.username ? `${s.username}@` : "", s.host, s.port !== usualPort(s.protocol) ? `:${s.port}` : "", s.folder ? ` · starts in ${s.folder}` : ""] })] }), _jsxs("span", { className: "server-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => setBrowsing(s), children: [_jsx(Icon, { name: "download", size: 16 }), " Browse"] }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Change ${s.name}`, title: "Change", onClick: () => setEditing({ ...s, password: null }), children: _jsx(Icon, { name: "edit", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Remove ${s.name}`, title: "Remove", onClick: () => setRemoving(s), children: _jsx(Icon, { name: "trash", size: 16 }) })] })] }, s.id))) })), editing ? (_jsx(ServerForm, { initial: editing, saved: servers?.find((s) => s.id === editing.id) ?? null, withKey: withKey, onSaved: (s) => {
                            setServers((list) => (list?.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...(list ?? []), s]));
                            setEditing((e) => (e ? { ...e, id: s.id } : e));
                        }, onClose: () => setEditing(null) })) : (_jsx("div", { className: "connection-actions", children: _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: !isApp && servers === null, onClick: () => setEditing(EMPTY), children: [_jsx(Icon, { name: "plus", size: 16 }), " Add a server"] }) })), _jsx(DownloadStatus, {})] }), _jsx(AudiobookshelfSection, {}), browsing && (_jsx(BrowseDialog, { server: browsing, withKey: withKey, onClose: () => setBrowsing(null), onStarted: (count) => {
                    toast(`${count === 1 ? "It's" : "They're"} on the Imports page, and added to your library as ${count === 1 ? "it arrives" : "they arrive"}. You can keep choosing.`);
                } })), question && (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => {
                    if (e.target !== e.currentTarget)
                        return;
                    question.cancel();
                    setQuestion(null);
                }, children: _jsxs("div", { className: "dialog confirm-dialog", role: "alertdialog", "aria-label": "Is this your server?", children: [_jsx("h2", { children: "Is this your server?" }), _jsxs("p", { className: "muted", children: ["TBV hasn't connected to ", question.server.host, " before. It shows this fingerprint, which works like the server's ID card:"] }), _jsx("p", { className: "server-fingerprint", children: question.fingerprint }), _jsx("p", { className: "muted", children: "If your provider lists the same fingerprint, or you set this server up yourself, choose Trust. If TBV ever sees a different one for this server, it will stop and tell you." }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => {
                                        question.cancel();
                                        setQuestion(null);
                                    }, children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => {
                                        const q = question;
                                        setQuestion(null);
                                        api.trustServerKey(q.server.id, q.fingerprint).then((trusted) => {
                                            setServers((list) => list?.map((x) => (x.id === trusted.id ? trusted : x)) ?? list);
                                            q.then(trusted);
                                        }, (e) => toast(plain(e)));
                                    }, children: "Trust" })] })] }) })), removing && (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && setRemoving(null), children: _jsxs("div", { className: "dialog confirm-dialog", role: "alertdialog", "aria-label": `Remove ${removing.name}?`, children: [_jsxs("h2", { children: ["Remove ", removing.name, "?"] }), _jsx("p", { className: "muted", children: "TBV forgets this server and its password. Books already brought in stay in your library." }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setRemoving(null), children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn-danger", onClick: () => {
                                        const s = removing;
                                        setRemoving(null);
                                        void api.removeServer(s.id).then(load);
                                        if (editing?.id === s.id)
                                            setEditing(null);
                                    }, children: "Remove" })] })] }) }))] }));
}
function ServerForm({ initial, saved, withKey, onSaved, onClose, }) {
    const toast = useToast();
    const [draft, setDraft] = useState(initial);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [tested, setTested] = useState(null);
    const change = (patch) => {
        setError(null);
        setTested(null);
        setDraft((d) => ({ ...d, ...patch }));
    };
    const sftp = draft.protocol === "sftp";
    const save = async () => {
        setBusy("save");
        try {
            const next = await api.saveServer({ ...draft, password: draft.password || null });
            onSaved(next);
            setDraft((d) => ({ ...d, id: next.id, password: null }));
            return next;
        }
        catch (e) {
            setError(plain(e));
            return null;
        }
        finally {
            setBusy(null);
        }
    };
    const test = async () => {
        const server = await save();
        if (!server)
            return;
        setBusy("test");
        await withKey(server, async (s) => {
            setTested(await api.testServer(s.id));
        }, setError);
        setBusy(null);
    };
    return (_jsxs("form", { className: "kindle-form server-form", onSubmit: (e) => {
            e.preventDefault();
            void save().then((s) => {
                if (!s)
                    return;
                toast(`Saved ${s.name}. Choose Browse to bring books in from it.`);
                onClose();
            });
        }, children: [_jsx("h3", { className: "server-form-title", children: initial.id ? `Change ${saved?.name ?? "server"}` : "Add a server" }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Type" }), _jsx(Segmented, { label: "Type", value: draft.protocol, options: PROTOCOLS, onChange: (protocol) => change({ protocol, port: draft.port === usualPort(draft.protocol) || !draft.port ? usualPort(protocol) : draft.port }) })] }), _jsx("p", { className: "settings-row-hint", children: sftp
                    ? "SFTP works over SSH. Most seedboxes and NAS drives offer it, and it keeps your password and files private."
                    : draft.protocol === "ftps"
                        ? "FTP with encryption. Use it when your server offers FTPS (sometimes called FTP over TLS or FTPES)."
                        : "Plain FTP sends your password and files unencrypted. Use it only on your own network, or when nothing else is offered." }), _jsxs("div", { className: "kindle-form-pair", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Address" }), _jsx("input", { value: draft.host, onChange: (e) => change({ host: e.target.value }), placeholder: "seedbox.example.net or 192.168.1.20", spellCheck: false, autoComplete: "off" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Port" }), _jsx("input", { inputMode: "numeric", value: draft.port || "", onChange: (e) => change({ port: Number(e.target.value.replace(/\D/g, "").slice(0, 5)) }) })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Username" }), _jsx("input", { value: draft.username, onChange: (e) => change({ username: e.target.value }), spellCheck: false, autoComplete: "off" })] }), sftp && (_jsxs("div", { className: "field", children: [_jsx("span", { children: "Sign in with" }), _jsx(Segmented, { label: "Sign in with", value: draft.login, options: [
                            { value: "password", label: "Password" },
                            { value: "key", label: "Key file" },
                        ], onChange: (login) => change({ login }) })] })), sftp && draft.login === "key" && (_jsxs("div", { className: "field", children: [_jsx("span", { children: "Private key file" }), _jsxs("div", { className: "server-key-file", children: [_jsx("input", { value: draft.keyFile ?? "", readOnly: true, placeholder: "No file chosen", "aria-label": "Private key file" }), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.pickKeyFile().then((path) => path && change({ keyFile: path })), children: "Choose\u2026" })] })] })), _jsxs("label", { className: "field", children: [_jsx("span", { children: sftp && draft.login === "key" ? "Key passphrase (if it has one)" : "Password" }), _jsx("input", { type: "password", value: draft.password ?? "", onChange: (e) => change({ password: e.target.value }), placeholder: saved?.hasPassword ? "Saved (type a new one to change it)" : "", autoComplete: "off" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Start in this folder (optional)" }), _jsx("input", { value: draft.folder, onChange: (e) => change({ folder: e.target.value }), placeholder: "/downloads/books", spellCheck: false })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Name (optional)" }), _jsx("input", { value: draft.name, onChange: (e) => change({ name: e.target.value }), placeholder: draft.host || "My seedbox" })] }), _jsx("p", { className: "settings-row-hint", children: "Saved on this device only. The password is never synced or put in backups." }), error && _jsx("p", { className: "form-error", children: error }), tested && (_jsxs("p", { className: "server-tested", children: [_jsx(Icon, { name: "check", size: 16 }), " ", tested] })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, children: "Cancel" }), _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: busy !== null, onClick: () => void test(), children: [_jsx(Icon, { name: "sync", size: 16 }), " ", busy === "test" ? "Connecting…" : "Test connection"] }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy !== null, children: busy === "save" ? "Saving…" : "Save" })] })] }));
}
function parentOf(path) {
    if (path === "/" || !path)
        return null;
    const up = path.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
    return up || "/";
}
function BrowseDialog({ server, withKey, onClose, onStarted, }) {
    const [listing, setListing] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [chosen, setChosen] = useState(new Map());
    const [starting, setStarting] = useState(false);
    const open = useCallback((path) => {
        setLoading(true);
        setError(null);
        void withKey(server, async (s) => {
            setListing(await api.browseServer(s.id, path));
            setLoading(false);
        }, (message) => {
            setError(message);
            setLoading(false);
        });
    }, [server, withKey]);
    useEffect(() => open(null), [open]);
    const toggle = (entry) => setChosen((c) => {
        const next = new Map(c);
        if (next.has(entry.path))
            next.delete(entry.path);
        else
            next.set(entry.path, entry);
        return next;
    });
    const up = listing ? parentOf(listing.path) : null;
    const start = async () => {
        setStarting(true);
        try {
            await api.downloadFromServer(server.id, [...chosen.values()].map((e) => ({ path: e.path, isDir: e.isDir, size: e.size })));
            onStarted(chosen.size);
            setChosen(new Map());
        }
        catch (e) {
            setError(plain(e));
        }
        setStarting(false);
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog browse-dialog", role: "dialog", "aria-label": `Browse ${server.name}`, onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsx("h2", { children: server.name }), _jsxs("div", { className: "browse-path", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Up a folder", title: "Up a folder", disabled: !up || loading, onClick: () => up && open(up), children: _jsx(Icon, { name: "arrowLeft", size: 16 }) }), _jsx("span", { className: "browse-path-text", children: listing?.path ?? "Connecting…" })] }), _jsx("div", { className: "browse-list", "aria-busy": loading, children: loading ? (_jsx("p", { className: "settings-row-hint browse-note", children: listing ? "Opening…" : `Connecting to ${server.host}…` })) : error && !listing ? null : listing && listing.entries.length === 0 ? (_jsx("p", { className: "settings-row-hint browse-note", children: "Nothing here TBV can import." })) : (_jsx("ul", { children: listing?.entries.map((entry) => (_jsxs("li", { className: chosen.has(entry.path) ? "is-chosen" : undefined, children: [_jsx("label", { className: "browse-check", children: _jsx("input", { type: "checkbox", checked: chosen.has(entry.path), onChange: () => toggle(entry), "aria-label": `Choose ${entry.name}` }) }), entry.isDir ? (_jsxs("button", { type: "button", className: "browse-entry", onClick: () => open(entry.path), children: [_jsx(Icon, { name: "folder", size: 18 }), _jsx("span", { className: "browse-name", children: entry.name }), _jsx(Icon, { name: "chevronRight", size: 16 })] })) : (_jsxs("button", { type: "button", className: "browse-entry", onClick: () => toggle(entry), children: [_jsx(Icon, { name: /\.(mp3|m4a|m4b|aac|ogg|opus|flac|wav)$/i.test(entry.name) ? "headphones" : "file", size: 18 }), _jsx("span", { className: "browse-name", children: entry.name }), _jsx("span", { className: "browse-size", children: formatBytes(entry.size) })] }))] }, entry.path))) })) }), listing && listing.hidden > 0 && !loading && (_jsx("p", { className: "settings-row-hint", children: listing.hidden === 1 ? "1 file TBV can't import isn't shown." : `${listing.hidden} files TBV can't import aren't shown.` })), error && _jsx("p", { className: "form-error", children: error }), _jsx("p", { className: "settings-row-hint", children: "Tick books, audiobooks or whole folders. A folder of audio files becomes one audiobook, or several when their tags say they're different books. You can keep browsing while files come down." }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, children: "Close" }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: chosen.size === 0 || starting, onClick: () => void start(), children: starting ? "Starting…" : chosen.size === 0 ? "Bring in" : `Bring in ${chosen.size === 1 ? "1 item" : `${chosen.size} items`}` })] })] }) }));
}
/** How many files come down at once, and how the list stands; the files
 *  themselves are on the Imports page. */
function DownloadStatus() {
    const [view, setView] = useState(NO_SERVER_QUEUE);
    useEffect(() => {
        const load = () => void api.serverQueue().then(setView, () => undefined);
        load();
        return api.onServerQueue(load);
    }, []);
    const c = view.counts;
    const left = c.waiting + c.downloading + c.downloaded;
    return (_jsxs("div", { className: "server-download", children: [_jsxs("div", { className: "settings-row", children: [_jsxs("div", { className: "settings-row-text", children: [_jsx("p", { className: "settings-row-label", children: "Connections" }), _jsx("p", { className: "settings-row-hint", children: "How many files come down at once. Each uses its own connection; some servers allow only a few." })] }), _jsx(Segmented, { label: "Connections", value: String(view.connections), options: ["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n })), onChange: (n) => void api.setServerConnections(Number(n)).then(() => api.serverQueue().then(setView)) })] }), (left > 0 || view.looking.length > 0) && (_jsxs("p", { className: "settings-row-hint", role: "status", children: [view.looking.length > 0 && `Looking through ${view.looking[0]}… `, left > 0 && `${left} ${left === 1 ? "file" : "files"} on the way from servers. Every file is listed on the Imports page.`] }))] }));
}
