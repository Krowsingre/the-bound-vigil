import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › Sync: moving the library to another cloud service, or keeping
// a copy there. A short wizard (what to do, where, set it up, which books),
// then progress, then the check that nothing was missed. The copying runs in
// the background in the desktop app, so TBV can be used meanwhile.
import { useEffect, useState } from "react";
import { api, isApp } from "../api";
import { MOVE_DESKTOP_ONLY } from "../api/moveStub";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { useAppSettings } from "./appSettings";
import { RadioList, Section } from "./controls";
import { PROVIDERS } from "./providers";
import { SignInForm, SupabaseProjectForm } from "./SupabaseSetup";
import { serviceName, SyncFolderPanel, viewOfChoice } from "./SyncFolderPanel";
const STEPS = ["mode", "where", "setup", "scope"];
const NOWHERE = { kind: "off", service: null, location: null, username: null };
/** A service in words, as it fits in a sentence: "Dropbox", "your WebDAV server". */
export function placeName(view) {
    if (!view || view.kind === "off")
        return "nowhere yet";
    if (view.kind === "supabase")
        return "Supabase";
    if (view.kind === "webdav")
        return "your WebDAV server";
    if (view.kind === "cloud")
        return serviceName(view.service);
    return view.service && view.service !== "custom" ? serviceName(view.service) : "that folder";
}
const STAGE_TEXT = {
    looking: "Looking at what to copy…",
    records: "Copying your progress, notes and collections…",
    files: "Copying books and covers…",
    checking: "Checking nothing was missed…",
};
const SCOPE_TEXT = { all: "everything", text: "your books and documents", audio: "your audiobooks" };
export function MoveSection({ overview, inUse, onChanged, }) {
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [step, setStep] = useState(null);
    const [mode, setMode] = useState("migrate");
    const [where, setWhere] = useState(null);
    const [target, setTarget] = useState(null);
    const [scope, setScope] = useState("all");
    const [project, setProject] = useState(null);
    const [anotherProject, setAnotherProject] = useState(false);
    const { changeSync } = useAppSettings();
    useEffect(() => {
        void api.moveStatus().then(setStatus, () => undefined);
        return api.onMove((s) => {
            setStatus(s);
            if (!s.switched)
                return;
            // The app turned off sending the files of books left behind; keep that here too.
            if (s.scope === "text")
                changeSync({ audioFiles: false });
            if (s.scope === "audio")
                changeSync({ bookFiles: false });
            onChanged();
        });
    }, [onChanged, changeSync]);
    const current = overview?.provider ?? NOWHERE;
    const from = placeName(inUse ? current : null);
    const reset = () => {
        setStep(null);
        setWhere(null);
        setTarget(null);
        setProject(null);
        setAnotherProject(false);
        setScope("all");
    };
    const act = (work) => void work.catch((e) => toast(e instanceof Error ? e.message : String(e)));
    // Signed in to Supabase already, but syncing elsewhere: that sign-in can be the destination.
    const savedSupabase = !anotherProject && current.kind !== "supabase" && overview?.signedInAs && overview.project ? overview.signedInAs : null;
    const body = (() => {
        if (!status)
            return null;
        if (status.running) {
            const { stage, done, total } = status.progress;
            return (_jsxs("div", { className: "settings-subpanel move-panel", "aria-live": "polite", children: [_jsxs("h3", { children: [status.mode === "migrate" ? "Moving" : "Copying", " ", SCOPE_TEXT[status.scope], " to ", placeName(status.to)] }), _jsx("p", { children: STAGE_TEXT[stage] }), _jsx(ProgressBar, { value: total ? done / total : stage === "checking" ? 1 : 0, label: `${total ? Math.round((done / total) * 100) : 0}% copied` }), _jsxs("p", { className: "settings-row-hint", children: [total > 0 && stage !== "looking" ? `${done} of ${total} copied. ` : "", "You can keep reading while this runs. It carries on from where it got to if you stop it and start again."] }), _jsx("div", { className: "dialog-actions", children: _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => act(api.cancelMove()), children: [_jsx(Icon, { name: "stop", size: 16 }), " Stop"] }) })] }));
        }
        if (status.report || status.error)
            return _jsx(MoveResult, { status: status, onDone: () => (reset(), act(api.clearMove())), onAgain: () => act(api.retryMove()) });
        if (!step) {
            return (_jsx("div", { className: "dialog-actions move-start", children: _jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => setStep("mode"), children: [_jsx(Icon, { name: "upload", size: 16 }), " Move or back up\u2026"] }) }));
        }
        const n = STEPS.indexOf(step) + 1;
        const back = () => setStep(STEPS[n - 2] ?? null);
        return (_jsxs("div", { className: "settings-subpanel move-panel", children: [_jsxs("p", { className: "move-step", children: ["Step ", n, " of 4"] }), step === "mode" && (_jsxs(_Fragment, { children: [_jsx("h3", { children: "What would you like to do?" }), _jsx(RadioList, { label: "Move or back up", value: mode, options: [
                                {
                                    value: "migrate",
                                    label: "Move my library",
                                    hint: "Copy everything to a new service, check it all arrived, then sync there instead.",
                                },
                                {
                                    value: "backup",
                                    label: "Keep a copy there",
                                    hint: `Copy everything to another service as a backup, and keep syncing through ${from === "nowhere yet" ? "this computer" : from}.`,
                                },
                            ], onChange: setMode })] })), step === "where" && (_jsxs(_Fragment, { children: [_jsx("h3", { children: mode === "migrate" ? "Where should your library go?" : "Where should the copy go?" }), _jsx("div", { className: "provider-cards", role: "radiogroup", "aria-label": "Where to", children: PROVIDERS.map((p) => {
                                const here = p.id === inUse && p.id !== "custom" && p.id !== "supabase";
                                return (_jsxs("button", { type: "button", role: "radio", "aria-checked": where === p.id, disabled: here, className: `provider-card${where === p.id ? " is-active" : ""}`, onClick: () => setWhere(p.id), children: [_jsx("span", { className: "provider-art", children: p.art }), _jsxs("span", { className: "provider-text", children: [_jsx("span", { className: "settings-row-label", children: p.name }), _jsx("span", { className: "settings-row-hint", children: here
                                                        ? "Your library is here now"
                                                        : p.id === "supabase"
                                                            ? "Your own Supabase project"
                                                            : p.id === "custom"
                                                                ? "A folder or WebDAV"
                                                                : "Uses its app's folder" })] })] }, p.id));
                            }) })] })), step === "setup" && where === "supabase" && (_jsx(_Fragment, { children: status.supabaseAccount || savedSupabase ? (_jsxs("div", { className: "account-panel", children: [_jsx("h3", { children: "Supabase is ready" }), _jsxs("p", { className: "account-line", children: [_jsx(Icon, { name: "check", size: 16 }), " Signed in as ", _jsx("strong", { children: status.supabaseAccount ?? savedSupabase })] }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => (setAnotherProject(true), setProject(null), act(api.moveSignOut())), children: "Use another project" }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => (setTarget({ kind: "supabase" }), setStep("scope")), children: "Next" })] })] })) : !project ? (_jsx(SupabaseProjectForm, { initial: current.kind === "supabase" ? null : (overview?.project ?? null), saveLabel: "Next", onSave: setProject })) : (_jsx(SignInForm, { title: "Sign in to your new project", onSignIn: (email, password, create) => api.moveSignIn(project, email, password, create), onDone: () => (setTarget({ kind: "supabase" }), setStep("scope")) })) })), step === "setup" && where && where !== "supabase" && (_jsx(SyncFolderPanel, { service: where, current: NOWHERE, onChanged: () => undefined, useLabel: "Next", onUse: (choice) => (setTarget(choice), setStep("scope")) }, where)), step === "scope" && (_jsxs(_Fragment, { children: [_jsx("h3", { children: "Which books?" }), _jsx(RadioList, { label: "Which books", value: scope, options: [
                                {
                                    value: "all",
                                    label: "All",
                                    hint: "Every book, document and audiobook, with your progress, notes and collections.",
                                },
                                { value: "text", label: "Text only", hint: "Books and documents." },
                                {
                                    value: "audio",
                                    label: "Audio only",
                                    hint: status.audioReady ? "Audiobooks." : "Arrives with audiobooks.",
                                    disabled: !status.audioReady,
                                },
                            ], onChange: setScope }), _jsxs("p", { className: "settings-row-hint", children: [mode === "migrate"
                                    ? `TBV copies ${SCOPE_TEXT[scope]} to ${placeName(target && viewOf(target))}, checks it all arrived, and only then syncs there. Until then, nothing changes.`
                                    : `TBV copies ${SCOPE_TEXT[scope]} to ${placeName(target && viewOf(target))}. Sync carries on as it is.`, " ", "Books only in the cloud are copied too, without being kept on this computer."] })] })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => (n === 1 ? reset() : back()), children: n === 1 ? "Cancel" : "Back" }), (step === "mode" || step === "where") && (_jsx("button", { type: "button", className: "btn btn-primary", disabled: step === "where" && !where, onClick: () => setStep(STEPS[n]), children: "Next" })), step === "scope" && target && (_jsx("button", { type: "button", className: "btn btn-primary", onClick: () => act(api.startMove(mode, scope, target).then(() => setStep(null))), children: mode === "migrate" ? "Start moving" : "Start copying" }))] })] }));
    })();
    return (_jsxs(Section, { id: "move", title: "Move or back up your library", lede: "Copy your whole library to another cloud service, to move there or to keep a spare copy.", children: [!isApp && _jsx("p", { className: "settings-row-hint", children: MOVE_DESKTOP_ONLY }), body] }));
}
const viewOf = viewOfChoice;
function MoveResult({ status, onDone, onAgain }) {
    const to = placeName(status.to);
    const from = placeName(status.from);
    const report = status.report;
    const check = report?.check ?? null;
    const migrate = status.mode === "migrate";
    const passed = !!check && check.missing.length === 0 && check.moreMissing === 0;
    let title;
    let words;
    let again = null;
    if (status.error || !report) {
        title = "That didn't finish";
        words = `${status.error ?? "Something went wrong."} ${migrate ? `Your library still syncs through ${from}.` : ""}`;
        again = "Try again";
    }
    else if (report.cancelled) {
        title = "Stopped";
        words = `What was copied stays in ${to}. Start again to carry on from where it got to.${migrate ? ` Your library still syncs through ${from}.` : ""}`;
        again = "Carry on";
    }
    else if (passed) {
        title = migrate ? "Your library has moved" : "Your copy is complete";
        words = migrate
            ? status.switched
                ? `Everything arrived in ${to}, and your library syncs there from now on. Nothing was deleted from ${from}.`
                : `Everything arrived in ${to}.`
            : `Everything arrived in ${to}. Your library still syncs through ${from}.`;
    }
    else {
        title = `Some things didn't make it to ${to}`;
        words = migrate ? `So TBV hasn't switched over: your library still syncs through ${from}.` : "The rest of the copy is there.";
        again = "Try the missing ones again";
    }
    return (_jsxs("div", { className: "settings-subpanel move-panel", role: "status", children: [_jsxs("h3", { children: [_jsx(Icon, { name: passed ? "check" : "warning", size: 18 }), " ", title] }), _jsx("p", { children: words }), report && !report.cancelled && (_jsxs("dl", { className: "move-numbers", children: [_jsx("dt", { children: "Copied" }), _jsxs("dd", { children: [report.recordsCopied, " ", report.recordsCopied === 1 ? "item" : "items", " and ", report.filesCopied, " ", report.filesCopied === 1 ? "file" : "files"] }), _jsx("dt", { children: "Already there" }), _jsx("dd", { children: report.alreadyThere }), check && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Checked" }), _jsxs("dd", { children: [check.recordsFound, " of ", check.records, " items and ", check.filesFound, " of ", check.files, " files are there"] })] }))] })), check && check.missing.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h4", { children: "Not there yet" }), _jsxs("ul", { className: "move-missing", children: [check.missing.map((m) => (_jsx("li", { children: m }, m))), check.moreMissing > 0 && _jsxs("li", { children: ["\u2026and ", check.moreMissing, " more"] })] })] })), check && check.notes.length > 0 && (_jsx("ul", { className: "move-notes settings-row-hint", children: check.notes.map((m) => (_jsx("li", { children: m }, m))) })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: again ? "btn btn-quiet" : "btn btn-primary", onClick: onDone, children: "Done" }), again && (_jsx("button", { type: "button", className: "btn btn-primary", onClick: onAgain, children: again }))] })] }));
}
