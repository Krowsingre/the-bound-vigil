// Preferences › Servers › Audiobookshelf: signing in to and out of your
// Audiobookshelf servers (embre, 29 October). Browsing and listening stay in
// Discover's catalogues, where each signed-in server shows.

import { useCallback, useEffect, useState } from "react";
import { api, isApp } from "../api";
import type { CatalogView } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { Section } from "./controls";

interface Form {
  id: string | null;
  name: string;
  url: string;
  username: string;
  password: string;
}

const plain = (e: unknown) => String(e).replace(/^Error: /, "");

export function AudiobookshelfSection() {
  const toast = useToast();
  const [servers, setServers] = useState<CatalogView[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isApp) return setServers([]);
    api.catalogs().then(
      (all) => setServers(all.filter((c) => c.kind === "audiobookshelf")),
      () => setServers([]),
    );
  }, []);
  useEffect(load, [load]);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) toast(done);
      load();
      return true;
    } catch (e) {
      setError(plain(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    if (!form) return;
    setError(null);
    const ok = await run(() => api.saveAbsServer({ id: form.id, name: form.name, url: form.url, username: form.username.trim(), password: form.password || null }), "Signed in to Audiobookshelf.");
    if (ok) setForm(null);
  };

  return (
    <Section
      id="audiobookshelf"
      title="Audiobookshelf"
      lede="Sign in to your Audiobookshelf server here. Its libraries then show in Discover's catalogues, where you can listen straight from the server or bring books into TBV."
    >
      {!isApp && <p className="settings-row-hint">Audiobookshelf works in the TBV app.</p>}
      {servers && servers.length > 0 && (
        <ul className="ereader-list server-list">
          {servers.map((s) => (
            <li key={s.id} className="ereader-item server-item">
              <Icon name="headphones" size={20} />
              <span>
                <span className="settings-row-label">{s.name}</span>
                <span className="settings-row-hint">
                  {s.hasPassword ? `Signed in as ${s.username ?? "you"}` : "Signed out"} · {s.url}
                </span>
              </span>
              <span className="server-actions">
                {s.hasPassword ? (
                  <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void run(() => api.signOutAbsServer(s.id), `Signed out of ${s.name}.`)}>
                    Sign out
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => (setError(null), setForm({ id: s.id, name: s.name, url: s.url, username: s.username ?? "", password: "" }))}>
                    Sign in
                  </button>
                )}
                <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} title="Remove" disabled={busy} onClick={() => void run(() => api.removeCatalog(s.id), `${s.name} was removed.`)}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {form ? (
        <form
          className="kindle-form server-form"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <label className="field">
            <span>Address</span>
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://192.168.1.20:13378" inputMode="url" autoFocus={!form.id} />
          </label>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Optional" />
          </label>
          <label className="field">
            <span>User name</span>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" autoFocus={!!form.id} />
          </label>
          <p className="settings-row-hint">TBV keeps only the server's sign-in, never the password, on this device.</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="connection-actions">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setForm(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !form.url.trim() || !form.username.trim() || !form.password}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      ) : (
        <div className="connection-actions">
          <button type="button" className="btn btn-quiet" disabled={!isApp} onClick={() => (setError(null), setForm({ id: null, name: "", url: "", username: "", password: "" }))}>
            <Icon name="plus" size={16} /> Add an Audiobookshelf server
          </button>
        </div>
      )}
      {error && !form && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}
