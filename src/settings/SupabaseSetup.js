import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Setting up a Supabase project and signing in to it: used to sync through
// Supabase, and to move a library there.
import { useState } from "react";
import SETUP_SQL from "../../supabase/setup.sql?raw";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
const URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i;
/** The project's address and publishable key, with the steps to find them. */
export function SupabaseProjectForm({ initial, onSave, onForget, onCancel, saveLabel = "Save", }) {
    const toast = useToast();
    const [draft, setDraft] = useState(initial ?? { url: "", anonKey: "" });
    const urlOk = URL_PATTERN.test(draft.url.trim());
    return (_jsxs("form", { className: "settings-subpanel supabase-form", onSubmit: (e) => {
            e.preventDefault();
            if (urlOk && draft.anonKey.trim())
                onSave({ url: draft.url.trim().replace(/\/$/, ""), anonKey: draft.anonKey.trim() });
        }, children: [_jsx("h3", { children: "Your Supabase project" }), _jsxs("ol", { className: "setup-steps", children: [_jsx("li", { children: "Use a Supabase project made for TBV, not one another app uses." }), _jsxs("li", { children: ["Open its ", _jsx("strong", { children: "SQL Editor" }), ", paste TBV's setup script, and press ", _jsx("strong", { children: "Run" }), ". It only needs doing once.", _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => navigator.clipboard.writeText(SETUP_SQL).then(() => toast("Setup script copied. Paste it into Supabase's SQL Editor."), () => toast("Couldn't copy. The script is supabase/setup.sql in TBV's code.")), children: [_jsx(Icon, { name: "copy", size: 14 }), " Copy setup script"] })] }), _jsxs("li", { children: ["From ", _jsx("strong", { children: "Project Settings" }), ", copy the project URL and the publishable key into the boxes below."] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Project URL" }), _jsx("input", { value: draft.url, onChange: (e) => setDraft({ ...draft, url: e.target.value }), placeholder: "https://yourproject.supabase.co", spellCheck: false })] }), draft.url.trim() && !urlOk && _jsx("p", { className: "form-error", children: "That doesn't look like a Supabase project address." }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Publishable key" }), _jsx("input", { value: draft.anonKey, onChange: (e) => setDraft({ ...draft, anonKey: e.target.value }), placeholder: "sb_publishable_\u2026 (or the older anon key, eyJ\u2026)", spellCheck: false })] }), _jsx("p", { className: "settings-row-hint", children: "This key is safe to keep in an app: it can't see anything until you sign in. Never paste the secret (service role) key here." }), _jsxs("div", { className: "dialog-actions", children: [onForget && (_jsx("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: onForget, children: "Forget this project" })), onCancel && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, children: "Cancel" })), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: !urlOk || !draft.anonKey.trim(), children: saveLabel })] })] }));
}
/** Email and password, to sign in or make an account. */
export function SignInForm({ title = "Sign in to sync", onSignIn, onDone, }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const go = async (create) => {
        if (!email.trim() || !password)
            return setError("Enter your email and a password.");
        if (create && password.length < 8)
            return setError("Use a password of at least 8 characters.");
        setBusy(true);
        setError(null);
        try {
            const done = await onSignIn(email, password, create);
            setPassword("");
            if (done)
                onDone(create);
            else
                setConfirming(true);
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("form", { className: "settings-subpanel account-panel", onSubmit: (e) => {
            e.preventDefault();
            void go(false);
        }, children: [_jsx("h3", { children: title }), _jsx("p", { className: "settings-row-hint", children: "Your first time? Choose an email and password and press Create account. On your other devices, sign in with the same ones." }), confirming && (_jsxs("p", { className: "settings-notice", role: "status", children: [_jsx(Icon, { name: "info", size: 18 }), _jsxs("span", { children: ["Supabase sent a link to ", email, ". Open it to confirm the address, then sign in here. If the page it opens doesn't load, that's fine: the address is confirmed anyway."] })] })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Email" }), _jsx("input", { type: "email", autoComplete: "username", value: email, onChange: (e) => setEmail(e.target.value), disabled: busy })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Password" }), _jsx("input", { type: "password", autoComplete: confirming ? "current-password" : "new-password", value: password, onChange: (e) => setPassword(e.target.value), disabled: busy })] }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => void go(true), children: "Create account" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: busy ? "Working…" : "Sign in" })] })] }));
}
