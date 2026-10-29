// Preferences › Servers: seedboxes, NAS drives and other computers to bring
// books and audiobooks in from, over FTP, FTPS or SFTP.

import { useCallback, useEffect, useState } from "react";
import { api, isApp } from "../api";
import { NO_SERVER_QUEUE, SERVERS_DESKTOP_ONLY } from "../api/serverStub";
import type { RemoteEntry, ServerInput, ServerQueueView, ServerListing, ServerProtocol, ServerView } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { Columns, formatBytes, Section, Segmented } from "./controls";
import { LocalSendSection } from "./LocalSendSection";

const PROTOCOLS: { value: ServerProtocol; label: string }[] = [
  { value: "sftp", label: "SFTP (SSH)" },
  { value: "ftps", label: "FTPS" },
  { value: "ftp", label: "FTP" },
];

const usualPort = (p: ServerProtocol) => (p === "sftp" ? 22 : 21);

const EMPTY: ServerInput = {
  id: null,
  name: "",
  protocol: "sftp",
  host: "",
  port: 22,
  username: "",
  password: null,
  login: "password",
  keyFile: null,
  folder: "",
};

const plain = (e: unknown) => String(e).replace(/^Error: /, "");
const NEW_KEY = "new-host-key:";

/** What to ask before a server's key is trusted. */
interface KeyQuestion {
  server: ServerView;
  fingerprint: string;
  /** Tried again once the key is trusted. */
  then: (server: ServerView) => void;
  cancel: () => void;
}

export function ServersTab() {
  const toast = useToast();
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [editing, setEditing] = useState<ServerInput | null>(null);
  const [browsing, setBrowsing] = useState<ServerView | null>(null);
  const [question, setQuestion] = useState<KeyQuestion | null>(null);
  const [removing, setRemoving] = useState<ServerView | null>(null);

  const load = useCallback(() => {
    api.listServers().then(setServers, () => setServers([]));
  }, []);
  useEffect(load, [load]);

  /** Runs `work`, asking about the server's key first if it's new to TBV. */
  const withKey = useCallback(
    async (server: ServerView, work: (server: ServerView) => Promise<void>, onError: (message: string) => void) => {
      try {
        await work(server);
      } catch (e) {
        const message = plain(e);
        if (message.startsWith(NEW_KEY)) {
          setQuestion({
            server,
            fingerprint: message.slice(NEW_KEY.length),
            then: (trusted) => void work(trusted).catch((e2) => onError(plain(e2))),
            cancel: () => onError("TBV didn't connect, because the server's key wasn't trusted."),
          });
        } else {
          onError(message);
        }
      }
    },
    [],
  );

  return (
    <Columns side={<LocalSendSection />}>
      <Section
        id="servers"
        title="Servers"
        lede="Bring in books, documents and audiobooks from a seedbox, a NAS or another computer. Files are copied into TBV; nothing on the server is changed."
      >
        {!isApp && <p className="settings-row-hint">{SERVERS_DESKTOP_ONLY}</p>}
        {servers !== null && servers.length === 0 && !editing && (
          <p className="settings-row-hint">No servers yet. Add one with its address and your sign-in.</p>
        )}
        {servers && servers.length > 0 && (
          <ul className="ereader-list server-list">
            {servers.map((s) => (
              <li key={s.id} className="ereader-item server-item">
                <Icon name="database" size={20} />
                <span>
                  <span className="settings-row-label">{s.name}</span>
                  <span className="settings-row-hint">
                    {s.protocol.toUpperCase()} · {s.username ? `${s.username}@` : ""}
                    {s.host}
                    {s.port !== usualPort(s.protocol) ? `:${s.port}` : ""}
                    {s.folder ? ` · starts in ${s.folder}` : ""}
                  </span>
                </span>
                <span className="server-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setBrowsing(s)}>
                    <Icon name="download" size={16} /> Browse
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Change ${s.name}`}
                    title="Change"
                    onClick={() => setEditing({ ...s, password: null })}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} title="Remove" onClick={() => setRemoving(s)}>
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {editing ? (
          <ServerForm
            initial={editing}
            saved={servers?.find((s) => s.id === editing.id) ?? null}
            withKey={withKey}
            onSaved={(s) => {
              setServers((list) => (list?.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...(list ?? []), s]));
              setEditing((e) => (e ? { ...e, id: s.id } : e));
            }}
            onClose={() => setEditing(null)}
          />
        ) : (
          <div className="connection-actions">
            <button type="button" className="btn btn-quiet" disabled={!isApp && servers === null} onClick={() => setEditing(EMPTY)}>
              <Icon name="plus" size={16} /> Add a server
            </button>
          </div>
        )}
        <DownloadStatus />
      </Section>

      {browsing && (
        <BrowseDialog
          server={browsing}
          withKey={withKey}
          onClose={() => setBrowsing(null)}
          onStarted={(count) => {
            toast(
              `${count === 1 ? "It's" : "They're"} on the Imports page, and added to your library as ${count === 1 ? "it arrives" : "they arrive"}. You can keep choosing.`,
            );
          }}
        />
      )}

      {question && (
        <div
          className="dialog-backdrop"
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            question.cancel();
            setQuestion(null);
          }}
        >
          <div className="dialog confirm-dialog" role="alertdialog" aria-label="Is this your server?">
            <h2>Is this your server?</h2>
            <p className="muted">
              TBV hasn't connected to {question.server.host} before. It shows this fingerprint, which works like the server's ID card:
            </p>
            <p className="server-fingerprint">{question.fingerprint}</p>
            <p className="muted">
              If your provider lists the same fingerprint, or you set this server up yourself, choose Trust. If TBV ever sees a
              different one for this server, it will stop and tell you.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  question.cancel();
                  setQuestion(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const q = question;
                  setQuestion(null);
                  api.trustServerKey(q.server.id, q.fingerprint).then(
                    (trusted) => {
                      setServers((list) => list?.map((x) => (x.id === trusted.id ? trusted : x)) ?? list);
                      q.then(trusted);
                    },
                    (e) => toast(plain(e)),
                  );
                }}
              >
                Trust
              </button>
            </div>
          </div>
        </div>
      )}

      {removing && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setRemoving(null)}>
          <div className="dialog confirm-dialog" role="alertdialog" aria-label={`Remove ${removing.name}?`}>
            <h2>Remove {removing.name}?</h2>
            <p className="muted">TBV forgets this server and its password. Books already brought in stay in your library.</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const s = removing;
                  setRemoving(null);
                  void api.removeServer(s.id).then(load);
                  if (editing?.id === s.id) setEditing(null);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </Columns>
  );
}

type WithKey = (server: ServerView, work: (server: ServerView) => Promise<void>, onError: (message: string) => void) => Promise<void>;

function ServerForm({
  initial,
  saved,
  withKey,
  onSaved,
  onClose,
}: {
  initial: ServerInput;
  saved: ServerView | null;
  withKey: WithKey;
  onSaved: (server: ServerView) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<ServerInput>(initial);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const change = (patch: Partial<ServerInput>) => {
    setError(null);
    setTested(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const sftp = draft.protocol === "sftp";

  const save = async (): Promise<ServerView | null> => {
    setBusy("save");
    try {
      const next = await api.saveServer({ ...draft, password: draft.password || null });
      onSaved(next);
      setDraft((d) => ({ ...d, id: next.id, password: null }));
      return next;
    } catch (e) {
      setError(plain(e));
      return null;
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    const server = await save();
    if (!server) return;
    setBusy("test");
    await withKey(
      server,
      async (s) => {
        setTested(await api.testServer(s.id));
      },
      setError,
    );
    setBusy(null);
  };

  return (
    <form
      className="kindle-form server-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save().then((s) => {
          if (!s) return;
          toast(`Saved ${s.name}. Choose Browse to bring books in from it.`);
          onClose();
        });
      }}
    >
      <h3 className="server-form-title">{initial.id ? `Change ${saved?.name ?? "server"}` : "Add a server"}</h3>
      <div className="field">
        <span>Type</span>
        <Segmented
          label="Type"
          value={draft.protocol}
          options={PROTOCOLS}
          onChange={(protocol) =>
            change({ protocol, port: draft.port === usualPort(draft.protocol) || !draft.port ? usualPort(protocol) : draft.port })
          }
        />
      </div>
      <p className="settings-row-hint">
        {sftp
          ? "SFTP works over SSH. Most seedboxes and NAS drives offer it, and it keeps your password and files private."
          : draft.protocol === "ftps"
            ? "FTP with encryption. Use it when your server offers FTPS (sometimes called FTP over TLS or FTPES)."
            : "Plain FTP sends your password and files unencrypted. Use it only on your own network, or when nothing else is offered."}
      </p>
      <div className="kindle-form-pair">
        <label className="field">
          <span>Address</span>
          <input
            value={draft.host}
            onChange={(e) => change({ host: e.target.value })}
            placeholder="seedbox.example.net or 192.168.1.20"
            spellCheck={false}
            autoComplete="off"
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
      <label className="field">
        <span>Username</span>
        <input value={draft.username} onChange={(e) => change({ username: e.target.value })} spellCheck={false} autoComplete="off" />
      </label>
      {sftp && (
        <div className="field">
          <span>Sign in with</span>
          <Segmented
            label="Sign in with"
            value={draft.login}
            options={[
              { value: "password", label: "Password" },
              { value: "key", label: "Key file" },
            ]}
            onChange={(login) => change({ login })}
          />
        </div>
      )}
      {sftp && draft.login === "key" && (
        <div className="field">
          <span>Private key file</span>
          <div className="server-key-file">
            <input value={draft.keyFile ?? ""} readOnly placeholder="No file chosen" aria-label="Private key file" />
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => void api.pickKeyFile().then((path) => path && change({ keyFile: path }))}
            >
              Choose…
            </button>
          </div>
        </div>
      )}
      <label className="field">
        <span>{sftp && draft.login === "key" ? "Key passphrase (if it has one)" : "Password"}</span>
        <input
          type="password"
          value={draft.password ?? ""}
          onChange={(e) => change({ password: e.target.value })}
          placeholder={saved?.hasPassword ? "Saved (type a new one to change it)" : ""}
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>Start in this folder (optional)</span>
        <input
          value={draft.folder}
          onChange={(e) => change({ folder: e.target.value })}
          placeholder="/downloads/books"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Name (optional)</span>
        <input value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder={draft.host || "My seedbox"} />
      </label>
      <p className="settings-row-hint">Saved on this device only. The password is never synced or put in backups.</p>
      {error && <p className="form-error">{error}</p>}
      {tested && (
        <p className="server-tested">
          <Icon name="check" size={16} /> {tested}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void test()}>
          <Icon name="sync" size={16} /> {busy === "test" ? "Connecting…" : "Test connection"}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy !== null}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function parentOf(path: string): string | null {
  if (path === "/" || !path) return null;
  const up = path.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
  return up || "/";
}

function BrowseDialog({
  server,
  withKey,
  onClose,
  onStarted,
}: {
  server: ServerView;
  withKey: WithKey;
  onClose: () => void;
  /** Called with how many things were chosen; the dialog stays open for more. */
  onStarted: (count: number) => void;
}) {
  const [listing, setListing] = useState<ServerListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState<Map<string, RemoteEntry>>(new Map());
  const [starting, setStarting] = useState(false);

  const open = useCallback(
    (path: string | null) => {
      setLoading(true);
      setError(null);
      void withKey(
        server,
        async (s) => {
          setListing(await api.browseServer(s.id, path));
          setLoading(false);
        },
        (message) => {
          setError(message);
          setLoading(false);
        },
      );
    },
    [server, withKey],
  );
  useEffect(() => open(null), [open]);

  const toggle = (entry: RemoteEntry) =>
    setChosen((c) => {
      const next = new Map(c);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.set(entry.path, entry);
      return next;
    });
  const up = listing ? parentOf(listing.path) : null;
  const start = async () => {
    setStarting(true);
    try {
      await api.downloadFromServer(
        server.id,
        [...chosen.values()].map((e) => ({ path: e.path, isDir: e.isDir, size: e.size })),
      );
      onStarted(chosen.size);
      setChosen(new Map());
    } catch (e) {
      setError(plain(e));
    }
    setStarting(false);
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog browse-dialog" role="dialog" aria-label={`Browse ${server.name}`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>{server.name}</h2>
        <div className="browse-path">
          <button
            type="button"
            className="icon-btn"
            aria-label="Up a folder"
            title="Up a folder"
            disabled={!up || loading}
            onClick={() => up && open(up)}
          >
            <Icon name="arrowLeft" size={16} />
          </button>
          <span className="browse-path-text">{listing?.path ?? "Connecting…"}</span>
        </div>
        <div className="browse-list" aria-busy={loading}>
          {loading ? (
            <p className="settings-row-hint browse-note">{listing ? "Opening…" : `Connecting to ${server.host}…`}</p>
          ) : error && !listing ? null : listing && listing.entries.length === 0 ? (
            <p className="settings-row-hint browse-note">Nothing here TBV can import.</p>
          ) : (
            <ul>
              {listing?.entries.map((entry) => (
                <li key={entry.path} className={chosen.has(entry.path) ? "is-chosen" : undefined}>
                  <label className="browse-check">
                    <input type="checkbox" checked={chosen.has(entry.path)} onChange={() => toggle(entry)} aria-label={`Choose ${entry.name}`} />
                  </label>
                  {entry.isDir ? (
                    <button type="button" className="browse-entry" onClick={() => open(entry.path)}>
                      <Icon name="folder" size={18} />
                      <span className="browse-name">{entry.name}</span>
                      <Icon name="chevronRight" size={16} />
                    </button>
                  ) : (
                    <button type="button" className="browse-entry" onClick={() => toggle(entry)}>
                      <Icon name={/\.(mp3|m4a|m4b|aac|ogg|opus|flac|wav)$/i.test(entry.name) ? "headphones" : "file"} size={18} />
                      <span className="browse-name">{entry.name}</span>
                      <span className="browse-size">{formatBytes(entry.size)}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {listing && listing.hidden > 0 && !loading && (
          <p className="settings-row-hint">
            {listing.hidden === 1 ? "1 file TBV can't import isn't shown." : `${listing.hidden} files TBV can't import aren't shown.`}
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <p className="settings-row-hint">
          Tick books, audiobooks or whole folders. A folder of audio files becomes one audiobook, or several when their tags say
          they're different books. You can keep browsing while files come down.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled={chosen.size === 0 || starting} onClick={() => void start()}>
            {starting ? "Starting…" : chosen.size === 0 ? "Bring in" : `Bring in ${chosen.size === 1 ? "1 item" : `${chosen.size} items`}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** How many files come down at once, and how the list stands; the files
 *  themselves are on the Imports page. */
function DownloadStatus() {
  const [view, setView] = useState<ServerQueueView>(NO_SERVER_QUEUE);
  useEffect(() => {
    const load = () => void api.serverQueue().then(setView, () => undefined);
    load();
    return api.onServerQueue(load);
  }, []);
  const c = view.counts;
  const left = c.waiting + c.downloading + c.downloaded;
  return (
    <div className="server-download">
      <div className="settings-row">
        <div className="settings-row-text">
          <p className="settings-row-label">Connections</p>
          <p className="settings-row-hint">
            How many files come down at once. Each uses its own connection; some servers allow only a few.
          </p>
        </div>
        <Segmented
          label="Connections"
          value={String(view.connections)}
          options={["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n }))}
          onChange={(n) => void api.setServerConnections(Number(n)).then(() => api.serverQueue().then(setView))}
        />
      </div>
      {(left > 0 || view.looking.length > 0) && (
        <p className="settings-row-hint" role="status">
          {view.looking.length > 0 && `Looking through ${view.looking[0]}… `}
          {left > 0 && `${left} ${left === 1 ? "file" : "files"} on the way from servers. Every file is listed on the Imports page.`}
        </p>
      )}
    </div>
  );
}
