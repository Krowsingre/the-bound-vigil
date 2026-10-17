// Setting up a Supabase project and signing in to it: used to sync through
// Supabase, and to move a library there.

import { useState } from "react";
import type { SupabaseProject } from "../api/types";
import SETUP_SQL from "../../supabase/setup.sql?raw";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";

const URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i;

/** The project's address and publishable key, with the steps to find them. */
export function SupabaseProjectForm({
  initial,
  onSave,
  onForget,
  onCancel,
  saveLabel = "Save",
}: {
  initial: SupabaseProject | null;
  onSave: (project: SupabaseProject) => void;
  onForget?: () => void;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<SupabaseProject>(initial ?? { url: "", anonKey: "" });
  const urlOk = URL_PATTERN.test(draft.url.trim());
  return (
    <form
      className="settings-subpanel supabase-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (urlOk && draft.anonKey.trim()) onSave({ url: draft.url.trim().replace(/\/$/, ""), anonKey: draft.anonKey.trim() });
      }}
    >
      <h3>Your Supabase project</h3>
      <ol className="setup-steps">
        <li>Use a Supabase project made for TBV, not one another app uses.</li>
        <li>
          Open its <strong>SQL Editor</strong>, paste TBV's setup script, and press <strong>Run</strong>. It only needs doing
          once.
          <button
            type="button"
            className="btn btn-quiet btn-small"
            onClick={() =>
              navigator.clipboard.writeText(SETUP_SQL).then(
                () => toast("Setup script copied. Paste it into Supabase's SQL Editor."),
                () => toast("Couldn't copy. The script is supabase/setup.sql in TBV's code."),
              )
            }
          >
            <Icon name="copy" size={14} /> Copy setup script
          </button>
        </li>
        <li>
          From <strong>Project Settings</strong>, copy the project URL and the publishable key into the boxes below.
        </li>
      </ol>
      <label className="field">
        <span>Project URL</span>
        <input
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          placeholder="https://yourproject.supabase.co"
          spellCheck={false}
        />
      </label>
      {draft.url.trim() && !urlOk && <p className="form-error">That doesn't look like a Supabase project address.</p>}
      <label className="field">
        <span>Publishable key</span>
        <input
          value={draft.anonKey}
          onChange={(e) => setDraft({ ...draft, anonKey: e.target.value })}
          placeholder="sb_publishable_… (or the older anon key, eyJ…)"
          spellCheck={false}
        />
      </label>
      <p className="settings-row-hint">
        This key is safe to keep in an app: it can't see anything until you sign in. Never paste the secret (service role) key
        here.
      </p>
      <div className="dialog-actions">
        {onForget && (
          <button type="button" className="btn btn-quiet btn-danger-text" onClick={onForget}>
            Forget this project
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!urlOk || !draft.anonKey.trim()}>
          {saveLabel}
        </button>
      </div>
    </form>
  );
}

/** Email and password, to sign in or make an account. */
export function SignInForm({
  title = "Sign in to sync",
  onSignIn,
  onDone,
}: {
  title?: string;
  /** False means Supabase emailed a link to confirm the address first. */
  onSignIn: (email: string, password: string, create: boolean) => Promise<boolean>;
  onDone: (created: boolean) => void;
}) {
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
      const done = await onSignIn(email, password, create);
      setPassword("");
      if (done) onDone(create);
      else setConfirming(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="settings-subpanel account-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void go(false);
      }}
    >
      <h3>{title}</h3>
      <p className="settings-row-hint">
        Your first time? Choose an email and password and press Create account. On your other devices, sign in with the same ones.
      </p>
      {confirming && (
        <p className="settings-notice" role="status">
          <Icon name="info" size={18} />
          <span>
            Supabase sent a link to {email}. Open it to confirm the address, then sign in here. If the page it opens doesn't load,
            that's fine: the address is confirmed anyway.
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
