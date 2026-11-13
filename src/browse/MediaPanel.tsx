// Discover › Media servers: films, shows and music from a Plex, Jellyfin or
// Emby server, or a folder shared over WebDAV, played in TBV's own player.
// Sign-ins stay on this device.
import { useEffect, useRef, useState } from "react";
import { api, openExternal } from "../api";
import type { MediaItem, MediaKind, MediaServerView, PageVideo } from "../api/types";
import { Icon } from "../components/Icon";

const KINDS: { kind: MediaKind; label: string }[] = [
  { kind: "plex", label: "Plex" },
  { kind: "jellyfin", label: "Jellyfin" },
  { kind: "emby", label: "Emby" },
  { kind: "webdav", label: "Other" },
];

const kindLabel = (kind: MediaKind) => (kind === "webdav" ? "Shared folder" : KINDS.find((k) => k.kind === kind)!.label);
const clean = (e: unknown) => String(e).replace(/^Error: /, "");

type Step = { id: string; title: string };

export function MediaPanel({ title = "Media servers", onClose, onPlay }: {
  title?: string;
  /** Over the browser: back to the page. As its own page (Scry): none. */
  onClose?: () => void;
  onPlay: (video: PageVideo, from?: { server: MediaServerView; item: MediaItem }) => void;
}) {
  const [servers, setServers] = useState<MediaServerView[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [trail, setTrail] = useState<Step[]>([]);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    void api.mediaServers().then((all) => {
      setServers(all);
      setCurrent(all[0]?.id ?? null);
      setAdding(!all.length);
    }, (e: unknown) => setTrouble(clean(e)));
  }, []);

  const server = servers?.find((s) => s.id === current) ?? null;
  const folder = trail.length ? trail[trail.length - 1].id : undefined;

  useEffect(() => {
    if (!current || adding) return;
    let gone = false;
    setItems(null);
    setTrouble(null);
    api.mediaList(current, folder).then((found) => !gone && setItems(found), (e: unknown) => !gone && (setItems([]), setTrouble(clean(e))));
    return () => {
      gone = true;
    };
  }, [current, folder, adding]);

  const added = (fresh: MediaServerView[]) => {
    setServers((all) => [...(all ?? []).filter((s) => !fresh.some((f) => f.id === s.id)), ...fresh]);
    setCurrent(fresh[0].id);
    setTrail([]);
    setAdding(false);
  };

  const open = async (item: MediaItem) => {
    if (!current) return;
    if (item.kind === "folder") return setTrail((t) => [...t, { id: item.id, title: item.title }]);
    try {
      const playing = await api.mediaPlay(current, item.id, item.title, item.kind === "audio");
      onPlay(playing, server ? { server, item } : undefined);
    } catch (e) {
      setTrouble(clean(e));
    }
  };

  const remove = async () => {
    if (!server) return;
    await api.mediaRemove(server.id);
    const left = (servers ?? []).filter((s) => s.id !== server.id);
    setServers(left);
    setCurrent(left[0]?.id ?? null);
    setTrail([]);
    setRemoving(false);
    setAdding(!left.length);
  };

  return (
    <section className="browser-media" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose?.()}>
      <div className="browser-reader-bar">
        {onClose ? (
          <button type="button" className="btn btn-quiet btn-small" onClick={onClose}>
            <Icon name="arrowLeft" size={14} /> Back to the page
          </button>
        ) : <span />}
        {!!servers?.length && !adding && (
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Add a server
          </button>
        )}
      </div>
      <div className="browser-media-body">
        <h1>{title}</h1>
        {!!servers?.length && !adding && (
          <div className="browser-media-servers" role="tablist" aria-label="Your servers">
            {servers.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={s.id === current} className={`chip${s.id === current ? " is-active" : ""}`} onClick={() => (setCurrent(s.id), setTrail([]), setRemoving(false))}>
                {s.name} <span className="browser-media-kind">· {kindLabel(s.kind)}</span>
              </button>
            ))}
          </div>
        )}
        {adding ? (
          <AddServer onAdded={added} onCancel={servers?.length ? () => setAdding(false) : undefined} />
        ) : server ? (
          <>
            <nav className="browser-media-trail" aria-label="Where you are">
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setTrail([])}>{server.name}</button>
              {trail.map((step, i) => (
                <span key={step.id}>
                  <Icon name="chevronRight" size={13} />
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => setTrail((t) => t.slice(0, i + 1))}>{step.title}</button>
                </span>
              ))}
              <span className="browser-media-spacer" />
              {removing ? (
                <span className="browser-media-remove">
                  Remove {server.name} from TBV?
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => setRemoving(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-small" onClick={() => void remove()}>Remove</button>
                </span>
              ) : (
                <button type="button" className="btn btn-quiet btn-small" title={`Remove ${server.name} from TBV`} onClick={() => setRemoving(true)}>
                  <Icon name="trash" size={14} /> Remove
                </button>
              )}
            </nav>
            {trouble && <p className="browser-media-trouble" role="alert">{trouble}</p>}
            {items === null ? (
              <p className="muted">Loading…</p>
            ) : !items.length && !trouble ? (
              <p className="muted">Nothing here that TBV can play.</p>
            ) : (
              <ul className="browser-media-grid">
                {items.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => void open(item)} title={item.kind === "folder" ? `Open ${item.title}` : `Play ${item.title}`}>
                      <span className={`browser-media-picture is-${item.kind}`}>
                        {item.image ? <img src={item.image} alt="" loading="lazy" draggable={false} /> : <Icon name={item.kind === "folder" ? "folder" : item.kind === "audio" ? "headphones" : "videoReader"} size={30} />}
                      </span>
                      <span className="browser-media-title">{item.title}</span>
                      {item.detail && <span className="muted browser-media-detail">{item.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : servers === null ? (
          trouble ? <p className="browser-media-trouble" role="alert">{trouble}</p> : <p className="muted">Loading…</p>
        ) : null}
      </div>
    </section>
  );
}

function AddServer({ onAdded, onCancel }: { onAdded: (servers: MediaServerView[]) => void; onCancel?: () => void }) {
  const [kind, setKind] = useState<MediaKind>("plex");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const waiting = useRef(0);

  useEffect(() => () => window.clearTimeout(waiting.current), []);

  const plex = async () => {
    setBusy(true);
    setNote(null);
    try {
      const pin = await api.mediaPlexStart();
      void openExternal(pin.url);
      setNote("Approve The Bound Vigil on the Plex page that opened, then come back here.");
      const until = Date.now() + 5 * 60_000;
      const check = async () => {
        try {
          const found = await api.mediaPlexFinish(pin.id, remember);
          if (found) return onAdded(found);
          if (Date.now() > until) {
            setBusy(false);
            return setNote("The Plex sign-in wasn't approved in time. Try again.");
          }
          waiting.current = window.setTimeout(() => void check(), 2000);
        } catch (e) {
          setBusy(false);
          setNote(clean(e));
        }
      };
      waiting.current = window.setTimeout(() => void check(), 2000);
    } catch (e) {
      setBusy(false);
      setNote(clean(e));
    }
  };

  const signIn = async () => {
    setBusy(true);
    setNote(null);
    try {
      onAdded(await api.mediaSignIn(kind, url, username, password, name || undefined, remember));
    } catch (e) {
      setNote(clean(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="browser-media-add"
      onSubmit={(e) => {
        e.preventDefault();
        void (kind === "plex" ? plex() : signIn());
      }}
    >
      <h2>Add a server</h2>
      <div className="browser-media-kinds" role="radiogroup" aria-label="Kind of server">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} className={`chip${kind === k.kind ? " is-active" : ""}`} disabled={busy} onClick={() => (setKind(k.kind), setNote(null))}>
            {k.label}
          </button>
        ))}
      </div>
      {kind === "plex" ? (
        <p className="muted">Sign in with your Plex account on plex.tv. TBV never sees your Plex password.</p>
      ) : (
        <>
          {kind === "webdav" && <p className="muted">Any server that shares a folder over WebDAV, such as a NAS or Nextcloud.</p>}
          <label className="field">
            <span>Address</span>
            <input value={url} inputMode="url" autoCapitalize="off" spellCheck={false} required onChange={(e) => setUrl(e.target.value)} placeholder={kind === "webdav" ? "https://nas.local/media" : "http://192.168.1.20:8096"} />
          </label>
          {kind === "webdav" && (
            <label className="field">
              <span>Name (optional)</span>
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Home files" />
            </label>
          )}
          <label className="field">
            <span>{kind === "webdav" ? "Username (if it asks for one)" : "Username"}</span>
            <input value={username} autoCapitalize="off" autoComplete="username" spellCheck={false} required={kind !== "webdav"} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
          </label>
        </>
      )}
      <label className="browser-media-remember">
        <input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} />
        <span>Remember my sign-in on this device</span>
      </label>
      {note && <p className="browser-media-trouble" role="status">{note}</p>}
      <div className="dialog-actions">
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || (kind !== "plex" && !url.trim())}>
          {kind === "plex" ? (busy ? "Waiting for Plex…" : "Sign in with Plex") : busy ? "Signing in…" : kind === "webdav" ? "Connect" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
