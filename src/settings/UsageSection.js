import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › Sync › Supabase space: how much of the free plan's room TBV is
// using, so a big library doesn't fill it without warning.
import { useEffect, useState } from "react";
import { api } from "../api";
import SETUP_SQL from "../../supabase/setup.sql?raw";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { Section } from "./controls";
/** The free plan's room: 1 GB of files and a 500 MB database. */
export const FREE_FILES = 1024 ** 3;
export const FREE_DATABASE = 500 * 1024 ** 2;
export function size(bytes) {
    if (bytes >= 1024 ** 3)
        return `${(bytes / 1024 ** 3).toFixed(2).replace(/\.?0+$/, "")} GB`;
    if (bytes >= 1024 ** 2)
        return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB`;
}
/** The line under each bar. */
export function usageLine(used, room) {
    const share = Math.round((used / room) * 100);
    const over = used > room ? " That's over the free plan's room." : share >= 80 ? " That's nearly full." : "";
    return `${size(used)} of ${size(room)} (${share}%).${over}`;
}
/** What the files are, in words. */
export function filesBreakdown(usage) {
    const parts = [`books ${size(usage.bookBytes)}`];
    if (usage.audioBytes)
        parts.push(`audiobooks ${size(usage.audioBytes)}`);
    parts.push(`covers and pictures ${size(usage.pictureBytes)}`);
    return `${usage.files.toLocaleString()} files: ${parts.join(", ")}.`;
}
export function UsageSection({ overview }) {
    const toast = useToast();
    const [usage, setUsage] = useState(null);
    const [problem, setProblem] = useState(null);
    const [checking, setChecking] = useState(false);
    const signedIn = overview.provider.kind === "supabase" ? !!overview.signedInAs : overview.also?.provider.kind === "supabase";
    const check = async () => {
        setChecking(true);
        setProblem(null);
        try {
            setUsage(await api.supabaseUsage());
        }
        catch (e) {
            setProblem(String(e));
        }
        finally {
            setChecking(false);
        }
    };
    useEffect(() => {
        if (signedIn)
            void check();
    }, [signedIn]);
    if (!signedIn)
        return null;
    return (_jsxs(Section, { id: "usage", title: "Supabase space", lede: "How much room TBV is using in your Supabase project, measured against the free plan.", children: [usage && (_jsxs("div", { className: "settings-subpanel move-panel usage-panel", children: [_jsx("p", { children: "Files" }), _jsx(ProgressBar, { value: usage.fileBytes / FREE_FILES, label: `Files: ${usageLine(usage.fileBytes, FREE_FILES)}` }), _jsxs("p", { className: "settings-row-hint", children: [usageLine(usage.fileBytes, FREE_FILES), " ", filesBreakdown(usage)] }), _jsx("p", { children: "Database" }), usage.databaseBytes === null ? (_jsxs("p", { className: "settings-row-hint", children: ["To see this, run TBV's setup script once more in Supabase's SQL Editor. It's safe to run again and changes nothing you've synced.", " ", _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => navigator.clipboard.writeText(SETUP_SQL).then(() => toast("Setup script copied. Paste it into Supabase's SQL Editor and press Run."), () => toast("Couldn't copy. The script is supabase/setup.sql in TBV's code.")), children: "Copy setup script" })] })) : (_jsxs(_Fragment, { children: [_jsx(ProgressBar, { value: usage.databaseBytes / FREE_DATABASE, label: `Database: ${usageLine(usage.databaseBytes, FREE_DATABASE)}` }), _jsxs("p", { className: "settings-row-hint", children: [usageLine(usage.databaseBytes, FREE_DATABASE), " This holds your library's details, progress and notes."] })] })), _jsx("p", { className: "settings-row-hint", children: "On Supabase's paid plan the room is much larger (100 GB of files), so these bars only matter on the free plan." })] })), problem && _jsxs("p", { className: "settings-row-hint", children: ["Couldn't check: ", problem] }), _jsx("div", { className: "dialog-actions move-start", children: _jsx("button", { type: "button", className: "btn btn-quiet", disabled: checking, onClick: () => void check(), children: checking ? "Checking Supabase…" : "Check again" }) })] }));
}
