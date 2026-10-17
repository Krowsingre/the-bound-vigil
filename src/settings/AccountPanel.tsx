import { useState } from "react";
import { api, isWeb } from "../api";
import type { SupabaseProject } from "../api/types";
import { phoneLink } from "../web/link";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { SignInForm } from "./SupabaseSetup";

/**
 * Signing in to the Supabase project. One account holds one library: use
 * the same email on every device. TBV keeps the sign-in on this device only.
 */
export function AccountPanel({
  signedIn,
  project,
  onChanged,
}: {
  signedIn: string | null;
  /** Given on the desktop, to offer a link that opens this library on a phone. */
  project?: SupabaseProject | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (signedIn) {
    return (
      <div className="settings-subpanel account-panel">
        <h3>Account</h3>
        <p className="account-line">
          <Icon name="check" size={16} /> Signed in as <strong>{signedIn}</strong>
        </p>
        <p className="settings-row-hint">
          {isWeb
            ? "This is the account your desktop app signs in with. Signing out clears this browser's copy of your library."
            : "To add another device, install TBV there, set up this same project, and sign in with this account."}
        </p>
        {project && !isWeb && (
          <p className="settings-row-hint">
            On your phone, open TBV's web version from a link that already knows this project: copy it, send it to yourself, and open it there.
          </p>
        )}
        <div className="dialog-actions">
          {project && !isWeb && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() =>
                navigator.clipboard.writeText(phoneLink(project)).then(
                  () => toast("Phone link copied. Open it on your phone and sign in with this account."),
                  () => toast("Couldn't copy the link."),
                )
              }
            >
              <Icon name="copy" size={16} /> Copy phone link
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              api.syncSignOut().then(
                () => {
                  setBusy(false);
                  toast(isWeb ? "Signed out. Your library is still in the cloud." : "Signed out. Your library stays on this device.");
                  onChanged();
                },
                (e: unknown) => {
                  setBusy(false);
                  toast(String(e));
                },
              );
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <SignInForm
      onSignIn={(email, password, create) => api.syncSignIn(email, password, create)}
      onDone={(create) => {
        toast(create ? "Account made. Your library is syncing." : "Signed in. Your library is syncing.");
        onChanged();
      }}
    />
  );
}
