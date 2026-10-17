import { useState } from "react";
import { api, isWeb } from "../api";
import type { SupabaseProject } from "../api/types";
import { phoneLink } from "../web/link";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const go = async (create: boolean) => {
    if (!email.trim() || !password) return setError("Enter your email and a password.");
    if (create && password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      const done = await api.syncSignIn(email, password, create);
      setPassword("");
      if (done) {
        toast(create ? "Account made. Your library is syncing." : "Signed in. Your library is syncing.");
        onChanged();
      } else {
        setConfirming(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

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
    <form
      className="settings-subpanel account-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void go(false);
      }}
    >
      <h3>Sign in to sync</h3>
      <p className="settings-row-hint">
        Your first time? Choose an email and password and press Create account. On your other devices, sign in with the same ones.
      </p>
      {confirming && (
        <p className="settings-notice" role="status">
          <Icon name="info" size={18} />
          <span>
            Supabase sent a link to {email}. Open it to confirm the address, then sign in here. If the page it opens doesn't load, that's fine: the
            address is confirmed anyway.
          </span>
        </p>
      )}
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete={confirming ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void go(true)}>
          Create account
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Working…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
