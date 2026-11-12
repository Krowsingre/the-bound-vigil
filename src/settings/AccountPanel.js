import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { api, isWeb } from "../api";
import { phoneLink } from "../web/link";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { SignInForm } from "./SupabaseSetup";
/**
 * Signing in to the Supabase project. One account holds one library: use
 * the same email on every device. TBV keeps the sign-in on this device only.
 */
export function AccountPanel({ signedIn, project, onChanged, }) {
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    if (signedIn) {
        return (_jsxs("div", { className: "settings-subpanel account-panel", children: [_jsx("h3", { children: "Account" }), _jsxs("p", { className: "account-line", children: [_jsx(Icon, { name: "check", size: 16 }), " Signed in as ", _jsx("strong", { children: signedIn })] }), _jsx("p", { className: "settings-row-hint", children: isWeb
                        ? "This is the account your desktop app signs in with. Signing out clears this browser's copy of your library."
                        : "To add another device, install TBV there, set up this same project, and sign in with this account." }), project && !isWeb && (_jsx("p", { className: "settings-row-hint", children: "On your phone, open TBV's web version from a link that already knows this project: copy it, send it to yourself, and open it there." })), _jsxs("div", { className: "dialog-actions", children: [project && !isWeb && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => navigator.clipboard.writeText(phoneLink(project)).then(() => toast("Phone link copied. Open it on your phone and sign in with this account."), () => toast("Couldn't copy the link.")), children: [_jsx(Icon, { name: "copy", size: 16 }), " Copy phone link"] })), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => {
                                setBusy(true);
                                api.syncSignOut().then(() => {
                                    setBusy(false);
                                    toast(isWeb ? "Signed out. Your library is still in the cloud." : "Signed out. Your library stays on this device.");
                                    onChanged();
                                }, (e) => {
                                    setBusy(false);
                                    toast(String(e));
                                });
                            }, children: "Sign out" })] })] }));
    }
    return (_jsx(SignInForm, { onSignIn: (email, password, create) => api.syncSignIn(email, password, create), onDone: (create) => {
            toast(create ? "Account made. Your library is syncing." : "Signed in. Your library is syncing.");
            onChanged();
        } }));
}
