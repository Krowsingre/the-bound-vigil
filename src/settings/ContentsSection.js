import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RememberedDetails } from "../components/RememberedDetails";
// Preferences › Sync › What's in Supabase: every file TBV keeps there, by type,
// and removing any of them. Tidy up Supabase does the usual clear-out; this
// is for choosing exactly what goes.
import { useMemo, useState } from "react";
import { api, isApp } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { Section } from "./controls";
import { size } from "./UsageSection";
const KINDS = [
    { kind: "ebook", label: "Ebooks" },
    { kind: "document", label: "Documents" },
    { kind: "audiobook", label: "Audiobooks" },
    { kind: "cover", label: "Covers" },
    { kind: "picture", label: "Pictures" },
    { kind: "other", label: "Other files" },
];
/** Rows shown per type before "Show more". */
const PAGE = 200;
const fileCount = (n) => `${n.toLocaleString()} ${n === 1 ? "file" : "files"}`;
const total = (files) => files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
const nameOf = (f) => f.title ?? f.path.split("/").pop() ?? f.path;
/** What the confirmation says, in plain words. */
export function removeText(chosen) {
    const only = chosen.filter((f) => !f.elsewhere && f.kind !== "cover").length;
    const parts = [`${fileCount(chosen.length)} (${size(total(chosen))}) ${chosen.length === 1 ? "is" : "are"} removed from Supabase.`];
    const one = only === 1;
    if (only === chosen.length)
        parts.push(`${one ? "It isn't" : "None of them are"} on this computer or in your other sync place, so ${one ? "this is the only copy" : "these are the only copies"}. Once removed, ${one ? "it's" : "they're"} gone for good.`);
    else if (only)
        parts.push(`${only.toLocaleString()} of them ${one ? "isn't" : "aren't"} on this computer or in your other sync place, so that copy is the only one. Once removed, ${one ? "it's" : "they're"} gone for good.`);
    parts.push("Your phone can't download a removed book. Every book stays in your library, and sync won't send removed files back.");
    return parts.join(" ");
}
export function ContentsSection({ overview }) {
    const toast = useToast();
    const [files, setFiles] = useState(null);
    const [loading, setLoading] = useState(false);
    const [chosen, setChosen] = useState(new Set());
    const [search, setSearch] = useState("");
    const [shown, setShown] = useState({});
    const [confirming, setConfirming] = useState(false);
    const [progress, setProgress] = useState(null);
    const signedIn = overview.provider.kind === "supabase" ? !!overview.signedInAs : overview.also?.provider.kind === "supabase";
    const groups = useMemo(() => {
        const q = search.trim().toLowerCase();
        const matching = (files ?? []).filter((f) => !q || nameOf(f).toLowerCase().includes(q));
        return KINDS.map((k) => ({ ...k, files: matching.filter((f) => f.kind === k.kind) })).filter((g) => g.files.length);
    }, [files, search]);
    if (!signedIn)
        return null;
    const load = async () => {
        if (!isApp)
            toast("This is the browser preview: these files are made up.");
        setLoading(true);
        try {
            setFiles(await api.supabaseContents());
            setChosen(new Set());
        }
        catch (e) {
            toast(`Couldn't look in Supabase: ${String(e)}`);
        }
        finally {
            setLoading(false);
        }
    };
    const toggle = (paths, on) => setChosen((c) => {
        const next = new Set(c);
        for (const p of paths) {
            if (on)
                next.add(p);
            else
                next.delete(p);
        }
        return next;
    });
    const picked = (files ?? []).filter((f) => chosen.has(f.path));
    const remove = async () => {
        setConfirming(false);
        setProgress({ done: 0, total: picked.length });
        try {
            const report = await api.removeSupabaseFiles(picked.map((f) => f.path), setProgress);
            toast(`Removed ${fileCount(report.removed)} from Supabase.${report.failed ? ` ${fileCount(report.failed)} couldn't be removed; try again later.` : ""}`);
            await load();
        }
        catch (e) {
            toast(`That didn't finish: ${String(e)}`);
        }
        finally {
            setProgress(null);
        }
    };
    return (_jsxs(Section, { id: "contents", title: "What's in Supabase", lede: "Every file TBV keeps in Supabase, by type. Choose any of them to remove.", children: [progress ? (_jsxs("div", { className: "settings-subpanel move-panel", "aria-live": "polite", children: [_jsx("p", { children: "Removing from Supabase\u2026" }), _jsx(ProgressBar, { value: progress.total ? progress.done / progress.total : 0, label: `${progress.done} of ${progress.total} removed` })] })) : files ? (_jsxs("div", { className: "settings-subpanel contents-panel", children: [_jsx("input", { type: "search", className: "input contents-search", placeholder: "Find a book\u2026", "aria-label": "Find a book", value: search, onChange: (e) => setSearch(e.target.value) }), groups.length === 0 && _jsx("p", { className: "settings-row-hint", children: files.length ? "Nothing matches." : "Supabase holds no files from TBV." }), groups.map((g) => {
                        const all = g.files.every((f) => chosen.has(f.path));
                        const limit = shown[g.kind] ?? PAGE;
                        return (_jsxs(RememberedDetails, { disclosure: `preferences.contents.${g.kind}`, className: "contents-group", children: [_jsxs("summary", { children: [_jsx("input", { type: "checkbox", checked: all, "aria-label": `Choose all ${g.label.toLowerCase()}`, onClick: (e) => e.stopPropagation(), onChange: (e) => toggle(g.files.map((f) => f.path), e.target.checked) }), _jsx("strong", { children: g.label }), _jsxs("span", { className: "muted", children: [fileCount(g.files.length), " \u00B7 ", size(total(g.files))] })] }), _jsx("ul", { children: g.files.slice(0, limit).map((f) => (_jsx("li", { children: _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: chosen.has(f.path), onChange: (e) => toggle([f.path], e.target.checked) }), _jsx("span", { className: "contents-name", title: f.path, children: nameOf(f) }), !f.elsewhere && f.kind !== "cover" && _jsx("span", { className: "contents-only", children: "Only copy" }), _jsx("span", { className: "muted", children: f.bytes === null ? "" : size(f.bytes) })] }) }, f.path))) }), g.files.length > limit && (_jsxs("button", { type: "button", className: "view-all", onClick: () => setShown((s) => ({ ...s, [g.kind]: limit + PAGE })), children: ["Show more (", (g.files.length - limit).toLocaleString(), " left)"] }))] }, g.kind));
                    }), _jsxs("div", { className: "dialog-actions", children: [_jsx("span", { className: "muted", children: picked.length ? `${fileCount(picked.length)} chosen (${size(total(picked))})` : "Nothing chosen" }), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: loading, onClick: () => void load(), children: loading ? "Looking…" : "Look again" }), _jsx("button", { type: "button", className: "btn btn-danger", disabled: !picked.length, onClick: () => setConfirming(true), children: "Remove from Supabase\u2026" })] })] })) : (_jsx("div", { className: "dialog-actions move-start", children: _jsx("button", { type: "button", className: "btn btn-quiet", disabled: loading, onClick: () => void load(), children: loading ? "Looking in Supabase…" : "Show what's in Supabase" }) })), confirming && (_jsx(ConfirmDialog, { title: "Remove from Supabase?", body: removeText(picked), confirm: `Remove ${fileCount(picked.length)}`, danger: true, onCancel: () => setConfirming(false), onConfirm: () => void remove() }))] }));
}
