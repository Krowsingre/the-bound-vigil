// Settings › E-readers: the readers plugged in now, and Kindle by email.

import { useCallback, useEffect, useState } from "react";
import { api, isApp, openExternal } from "../api";
import type { Ereader, KindleEmailInput, KindleEmailView } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { DESKTOP_ONLY, EMAIL_SERVICES, missingField, serviceOf, usualPort } from "../ereaders/ereaders";
import { Section, Segmented, Select } from "./controls";

export function EreadersTab() {
  return (
    <>
      <ConnectedSection />
      <KindleEmailSection />
    </>
  );
}

function ConnectedSection() {
  const [readers, setReaders] = useState<Ereader[] | null>(null);
  const look = useCallback(() => {
    setReaders(null);
    api.listEreaders().then(setReaders, () => setReaders([]));
  }, []);
  useEffect(look, [look]);

  return (
    <Section
      id="connected"
      title="Connected e-readers"
      lede="Plug in your Kindle, Kobo or other e-reader with its cable, and send books to it from any book's menu."
    >
      {!isApp && <p className="settings-row-hint">{DESKTOP_ONLY}</p>}
      {readers === null ? (
        <p className="settings-row-hint">Looking…</p>
      ) : readers.length === 0 ? (
        <p className="settings-row-hint">
          No e-readers are plugged in right now. If yours asks, choose to connect it to the computer.
        </p>
      ) : (
        <ul className="ereader-list">
          {readers.map((r) => (
            <li key={r.root} className="ereader-item">
              <Icon name={r.kind === "other" ? "folder" : "ereader"} size={20} />
              <span>
                <span className="settings-row-label">
                  {r.kind === "other" ? `${r.name} (a drive with a books folder)` : r.name}
                </span>
                <span className="settings-row-hint">
                  Books go to {r.booksFolder}
                  {r.formats.length > 0 && `. Opens ${r.formats.map((f) => f.toUpperCase()).join(", ")}`}
                  {r.kind === "kindle" && ". EPUB books go to Kindles by email instead"}.
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="connection-actions">
        <button type="button" className="btn btn-quiet" disabled={readers === null} onClick={look}>
          <Icon name="sync" size={16} /> Look again
        </button>
      </div>
    </Section>
  );
}

const EMPTY: KindleEmailInput = {
  server: "smtp.gmail.com",
  port: 587,
  security: "starttls",
  username: "",
  password: null,
  from: "",
  kindle: "",
};

function KindleEmailSection() {
  const toast = useToast();
  const [saved, setSaved] = useState<KindleEmailView | null | undefined>(undefined);
  const [draft, setDraft] = useState<KindleEmailInput>(EMPTY);
  const [service, setService] = useState("gmail");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.kindleEmailSettings().then(
      (s) => {
        setSaved(s);
        if (s) {
          setDraft({ ...s, password: null });
          setService(serviceOf(s.server));
        }
      },
      () => setSaved(null),
    );
  }, []);

  const change = (patch: Partial<KindleEmailInput>) => {
    setError(null);
    setDraft((d) => {
      const next = { ...d, ...patch };
      // The username is usually the address itself.
      if (patch.from !== undefined && (!d.username || d.username === d.from)) next.username = patch.from;
      return next;
    });
  };
  const pickService = (id: string) => {
    setService(id);
    const s = EMAIL_SERVICES.find((x) => x.id === id);
    if (s) change({ server: s.server, port: s.port, security: s.security });
  };

  const missing = missingField(draft, Boolean(saved?.hasPassword));
  const save = async (): Promise<boolean> => {
    if (missing) {
      setError(missing);
      return false;
    }
    setBusy("save");
    try {
      const next = await api.saveKindleEmail({ ...draft, password: draft.password || null });
      setSaved(next);
      setDraft({ ...next, password: null });
      return true;
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    if (!(await save())) return;
    setBusy("test");
    try {
      await api.sendKindleTest();
      toast("Test sent. It should show up on your Kindle in a few minutes, once it's on Wi-Fi.");
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };
  const forget = async () => {
    await api.forgetKindleEmail();
    setSaved(null);
    setDraft(EMPTY);
    setService("gmail");
    toast("Forgot the Kindle email settings on this device.");
  };
  const note = EMAIL_SERVICES.find((s) => s.id === service)?.note;

  return (
    <Section
      id="kindle"
      title="Kindle by email"
      lede="Amazon's Send to Kindle takes EPUB, PDF, Word and text books by email, and turns them into Kindle books. TBV sends them from your own email account."
    >
      {saved === undefined ? null : (
        <form
          className="kindle-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save().then((ok) => ok && toast("Saved. Books can now go to your Kindle by email."));
          }}
        >
          <label className="field">
            <span>Your Kindle's email address</span>
            <input
              value={draft.kindle}
              onChange={(e) => change({ kindle: e.target.value })}
              placeholder="yourname@kindle.com"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <p className="settings-row-hint">
            Find it on Amazon under Manage Your Content and Devices › Preferences › Personal Document Settings.
          </p>
          <label className="field">
            <span>Your email address</span>
            <input
              value={draft.from}
              onChange={(e) => change({ from: e.target.value })}
              placeholder="you@example.com"
              spellCheck={false}
              autoComplete="email"
            />
          </label>
          <p className="kindle-approve">
            Add {draft.from.trim() || "this address"} to Amazon's Approved Personal Document E-mail List (amazon.com › Manage Your
            Content and Devices › Preferences › Personal Document Settings), or Amazon won't accept the books.{" "}
            <button type="button" className="link-button" onClick={() => void openExternal("https://www.amazon.com/mycd")}>
              Open Amazon
            </button>
          </p>
          <label className="field">
            <span>Your email service</span>
            <Select
              label="Your email service"
              value={service}
              options={[
                ...EMAIL_SERVICES.map((s) => ({ value: s.id, label: s.label })),
                { value: "other", label: "Another service" },
              ]}
              onChange={pickService}
            />
          </label>
          {service === "other" && (
            <>
              <div className="kindle-form-pair">
                <label className="field">
                  <span>Outgoing (SMTP) server</span>
                  <input
                    value={draft.server}
                    onChange={(e) => change({ server: e.target.value })}
                    placeholder="smtp.example.com"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>Port</span>
                  <input
                    inputMode="numeric"
                    value={draft.port || ""}
                    onChange={(e) => change({ port: Number(e.target.value.replace(/\D/g, "").slice(0, 5)) })}
                  />
                </label>
              </div>
              <div className="field">
                <span>Security</span>
                <Segmented
                  label="Security"
                  value={draft.security}
                  options={[
                    { value: "starttls", label: "STARTTLS" },
                    { value: "ssl", label: "SSL" },
                  ]}
                  onChange={(security) =>
                    change({ security, port: draft.port === usualPort(draft.security) ? usualPort(security) : draft.port })
                  }
                />
              </div>
            </>
          )}
          <label className="field">
            <span>Username</span>
            <input
              value={draft.username}
              onChange={(e) => change({ username: e.target.value })}
              spellCheck={false}
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={draft.password ?? ""}
              onChange={(e) => change({ password: e.target.value })}
              placeholder={saved?.hasPassword ? "Saved (type a new one to change it)" : "An app password"}
              autoComplete="current-password"
            />
          </label>
          <p className="settings-row-hint">
            {note ?? "Many email services need an app password for this, made in your account's security settings."} It stays on
            this device and is never synced or put in backups.
          </p>
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-actions">
            {saved && (
              <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => void forget()}>
                Forget
              </button>
            )}
            <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void test()}>
              <Icon name="email" size={16} /> {busy === "test" ? "Sending a test…" : "Send a test"}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
