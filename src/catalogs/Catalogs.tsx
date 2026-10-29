// Discover's catalogues: the Bible in three translations, then OPDS
// bookshelves online (Project Gutenberg, Standard Ebooks, your own Calibre
// library…). Browse their shelves, search, and bring a book in; it joins the
// import queue like any other.

import { useCallback, useEffect, useState } from "react";
import { api, isApp, serverBookId } from "../api";
import { playAudiobook } from "../audio/player";
import type { CatalogInput, CatalogView, OpdsEntry, OpdsFeed, OpdsFile } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { formatLabel } from "../lib/queryBooks";
import { Bible } from "../browse/Bible";
import { TRANSLATIONS } from "../browse/bibleBooks";
import { sameAddress, SUGGESTED_CATALOGS } from "./suggested";

/** The Bibles' place in the list, ahead of the catalogues. */
const BIBLES = "bibles";

const NEEDS_LOGIN = "needs-login";

type Step = { title: string; url: string | null; search?: string };

function fileLabel(file: OpdsFile): string {
  const format = file.format ? formatLabel(file.format) : file.mime;
  return file.label && file.label.toLowerCase() !== format.toLowerCase() ? `${format}: ${file.label}` : format;
}

function CatalogDialog({
  catalog,
  existing,
  bibles,
  onSaved,
  onCancel,
}: {
  catalog: CatalogView | null;
  /** The Bibles are offered first, where they can be opened afterwards. */
  bibles: boolean;
  /** Addresses already added, so suggestions leave them out. */
  existing: string[];
  onSaved: (c: CatalogView) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CatalogInput>({
    id: catalog?.id ?? null,
    name: catalog?.name ?? "",
    url: catalog?.url ?? "",
    username: catalog?.username ?? "",
    password: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [abs, setAbs] = useState(catalog?.kind === "audiobookshelf");
  const toast = useToast();
  const save = async () => {
    setBusy(true);
    try {
      if (abs) {
        onSaved(
          await api.saveAbsServer({ id: form.id, name: form.name, url: form.url, username: form.username?.trim() ?? "", password: form.password || null }),
        );
        return;
      }
      onSaved(await api.saveCatalog({ ...form, username: form.username?.trim() || null, password: form.password || null }));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const suggestions = catalog ? [] : SUGGESTED_CATALOGS.filter((s) => !existing.some((u) => sameAddress(u, s.url)));
  const addBible = async (t: (typeof TRANSLATIONS)[number]) => {
    setBusy(true);
    try {
      await api.downloadWebBook(t.url, t.name);
      toast(`The ${t.name} is being added to your library.`);
      onCancel();
    } catch (e) {
      setError(`The ${t.name} couldn't be brought in: ${String(e)}`);
      setBusy(false);
    }
  };
  const addSuggested = async (name: string, url: string) => {
    setBusy(true);
    try {
      onSaved(await api.saveCatalog({ id: null, name, url, username: null, password: null }));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog writing-dialog"
        role="dialog"
        aria-label={catalog ? "Edit catalogue" : "Add a catalogue"}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2>{catalog ? "Edit catalogue" : "Add a catalogue"}</h2>
        {!catalog && bibles && (
          <section className="catalog-suggested" aria-label="Bibles">
            <strong>Bibles</strong>
            <ul>
              {TRANSLATIONS.map((t) => (
                <li key={t.id}>
                  <span>
                    <b>
                      {t.name} ({t.short})
                    </b>
                    <span className="muted">{t.about}</span>
                  </span>
                  <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => void addBible(t)}>
                    <Icon name="plus" size={14} /> Add
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {suggestions.length > 0 && (
          <section className="catalog-suggested" aria-label="Free catalogues">
            <strong>Free catalogues</strong>
            <ul>
              {suggestions.map((s) => (
                <li key={s.url}>
                  <span>
                    <b>{s.name}</b>
                    <span className="muted">{s.about}</span>
                  </span>
                  <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => void addSuggested(s.name, s.url)}>
                    <Icon name="plus" size={14} /> Add
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!catalog && <strong className="catalog-own">Or your own address</strong>}
        {!catalog && (
          <div className="scribe-chips catalog-kinds" role="radiogroup" aria-label="What it is">
            {(
              [
                [false, "OPDS catalogue"],
                [true, "Audiobookshelf"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={abs === value}
                className={`chip${abs === value ? " is-active" : ""}`}
                onClick={() => (setAbs(value), setError(null))}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {abs ? (
          <p className="muted dialog-lede">
            Sign in with the username and password you use for Audiobookshelf. You can look through its libraries here and bring audiobooks and ebooks
            into TBV, and where you are in an audiobook stays the same in both.
          </p>
        ) : (
          <p className="muted dialog-lede">
            Any OPDS catalogue works. For your own Calibre library, start Calibre's content server (Connect/share › Start Content server) and enter its
            address with /opds at the end, like http://192.168.1.20:8080/opds.
          </p>
        )}
        <label className="field">
          <span>Address</span>
          <input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder={abs ? "http://192.168.1.20:13378" : "https://…"}
            autoFocus={!!catalog}
            inputMode="url"
          />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Optional" />
        </label>
        <div className="writing-details-row">
          <label className="field">
            <span>User name</span>
            <input
              value={form.username ?? ""}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={abs ? "" : "Only if it asks"}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={form.password ?? ""}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={catalog?.hasPassword ? (abs ? "Signed in" : "Saved") : ""}
              autoComplete="new-password"
            />
          </label>
        </div>
        <p className="muted writing-hint">
          {abs
            ? "TBV keeps only the server's sign-in, never the password, on this device."
            : "The password stays on this computer and is never put in a backup."}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !form.url.trim() || (abs && (!form.username?.trim() || (!catalog?.hasPassword && !form.password)))}
          >
            {busy && abs ? "Signing in…" : abs && form.password ? "Sign in" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function EntryCard({
  entry,
  state,
  onOpen,
  onDownload,
  onListen,
}: {
  entry: OpdsEntry;
  state: "idle" | "busy" | "done";
  onOpen: () => void;
  onDownload: (file: OpdsFile) => void;
  /** Plays it straight from the server (an Audiobookshelf audiobook). */
  onListen?: () => void;
}) {
  const [best, ...others] = entry.files.filter((f) => f.format);
  const [imageFailed, setImageFailed] = useState(false);
  const more: MenuEntry[] = others.map((f) => ({ label: fileLabel(f), icon: "download", onSelect: () => onDownload(f) }));
  return (
    <li className="catalog-book">
      <div className="catalog-cover">
        {entry.cover && !imageFailed ? (
          <img src={entry.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        ) : (
          <span className="catalog-cover-blank">{entry.title}</span>
        )}
      </div>
      <div className="catalog-book-text">
        <strong className="catalog-book-title">{entry.title}</strong>
        {entry.authors.length > 0 && <span className="muted">{entry.authors.join(", ")}</span>}
        {entry.summary && <p className="catalog-summary muted">{entry.summary}</p>}
        <div className="catalog-actions">
          {onListen && (
            <button type="button" className="btn btn-primary btn-small" onClick={onListen} title="Play it from the server, without downloading it">
              <Icon name="play" size={14} /> Listen
            </button>
          )}
          {best ? (
            <>
              <button type="button" className={`btn ${onListen ? "btn-quiet" : "btn-primary"} btn-small`} disabled={state !== "idle"} onClick={() => onDownload(best)}>
                {state === "busy" ? "Bringing it in…" : state === "done" ? (
                  <>
                    <Icon name="check" size={14} /> Added
                  </>
                ) : (
                  <>
                    <Icon name="download" size={14} /> {formatLabel(best.format!)}
                  </>
                )}
              </button>
              {more.length > 0 && state === "idle" && (
                <Menu label="Other formats" className="btn btn-quiet btn-small" trigger={<>Other formats <Icon name="chevronDown" size={13} /></>} items={more} />
              )}
            </>
          ) : entry.navigation ? (
            <button type="button" className="btn btn-quiet btn-small" onClick={onOpen}>
              See the book <Icon name="chevronRight" size={14} />
            </button>
          ) : (
            <span className="muted">{entry.notFree ? "This one has to be bought or borrowed on the catalog's own site." : "No file TBV can open."}</span>
          )}
        </div>
      </div>
    </li>
  );
}

export function Catalogs({ refreshKey = 0, onOpenBook }: { refreshKey?: number; onOpenBook?: (bookId: string, at?: string) => void }) {
  const [catalogs, setCatalogs] = useState<CatalogView[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [trail, setTrail] = useState<Step[]>([]);
  const [feed, setFeed] = useState<OpdsFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [editing, setEditing] = useState<CatalogView | "new" | null>(null);
  const [removing, setRemoving] = useState<CatalogView | null>(null);
  const [downloads, setDownloads] = useState<Record<string, "busy" | "done">>({});
  const toast = useToast();
  const bibles = !!onOpenBook;

  const reloadCatalogs = useCallback(async () => {
    const list = await api.catalogs();
    setCatalogs(list);
    setCurrent((c) => (c && (c === BIBLES || list.some((x) => x.id === c)) ? c : bibles ? BIBLES : (list[0]?.id ?? null)));
  }, [bibles]);
  useEffect(() => {
    void reloadCatalogs().catch((e) => setProblem(String(e)));
  }, [reloadCatalogs]);

  const step = trail[trail.length - 1] ?? null;
  useEffect(() => {
    if (!current || current === BIBLES || !step) return;
    let live = true;
    setLoading(true);
    setProblem(null);
    const loading = step.search !== undefined && feed?.search ? api.catalogSearch(current, feed.search, step.search) : api.catalogFeed(current, step.url);
    loading.then(
      (f) => live && (setFeed(f), setLoading(false)),
      (e: unknown) => live && (setProblem(String(e)), setLoading(false)),
    );
    return () => {
      live = false;
    };
    // The search address comes from the page before; it doesn't start a load by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, step]);

  // A new catalog starts at its first page.
  useEffect(() => {
    if (current) setTrail([{ title: catalogs?.find((c) => c.id === current)?.name ?? "Catalogue", url: null }]);
    setFeed(null);
    setWords("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const go = (title: string, url: string) => setTrail((t) => [...t, { title, url }]);
  const back = (i: number) => setTrail((t) => t.slice(0, i + 1));
  const search = () => {
    if (!words.trim() || !feed?.search) return;
    setTrail((t) => [...t.slice(0, 1), { title: `“${words.trim()}”`, url: null, search: words.trim() }]);
  };

  const download = async (entry: OpdsEntry, file: OpdsFile) => {
    if (!current) return;
    setDownloads((d) => ({ ...d, [entry.id]: "busy" }));
    try {
      await api.downloadFromCatalog(current, file, entry.title);
      setDownloads((d) => ({ ...d, [entry.id]: "done" }));
      toast(`${entry.title} is being added to your library.`);
    } catch (e) {
      setDownloads((d) => {
        const { [entry.id]: _, ...rest } = d;
        return rest;
      });
      toast(String(e) === NEEDS_LOGIN ? "The catalog wants you to sign in. Add your details with Edit." : String(e));
    }
  };

  const catalog = catalogs?.find((c) => c.id === current) ?? null;
  const shelves = feed?.entries.filter((e) => !e.files.length && e.navigation && !e.authors.length && !e.summary) ?? [];
  const books = feed?.entries.filter((e) => !shelves.includes(e)) ?? [];

  return (
    <div className="catalogs-page">
      <div className="catalogs-layout">
        <nav className="catalogs-list" aria-label="Your catalogues">
          <button type="button" className="btn btn-primary btn-small catalogs-add" onClick={() => setEditing("new")}>
            <span aria-hidden>+</span> Add a catalogue
          </button>
          {bibles && (
            <div className={`catalogs-item${current === BIBLES ? " is-current" : ""}`}>
              <button type="button" onClick={() => setCurrent(BIBLES)} aria-current={current === BIBLES ? "true" : undefined}>
                <Icon name="bookOpen" size={16} />
                <span>Bibles</span>
              </button>
            </div>
          )}
          {(catalogs ?? []).map((c) => (
            <div key={c.id} className={`catalogs-item${c.id === current ? " is-current" : ""}`}>
              <button type="button" onClick={() => setCurrent(c.id)} aria-current={c.id === current ? "true" : undefined}>
                <Icon name={c.kind === "audiobookshelf" ? "headphones" : "globe"} size={16} />
                <span>{c.name}</span>
              </button>
              <Menu
                label={`More for ${c.name}`}
                className="writing-chapter-more"
                trigger={<Icon name="more" size={16} />}
                items={[
                  { label: "Edit…", icon: "edit", onSelect: () => setEditing(c) },
                  { label: "Remove…", icon: "trash", danger: true, onSelect: () => setRemoving(c) },
                ]}
              />
            </div>
          ))}
          {catalogs?.length === 0 && <p className="muted writing-hint">No catalogues yet. Add one to start.</p>}
        </nav>
        <section className="catalogs-main" aria-busy={loading}>
          {current === BIBLES && onOpenBook && <Bible refreshKey={refreshKey} onOpenBook={onOpenBook} />}
          {catalog && (
            <>
              <div className="catalogs-bar">
                <ol className="catalogs-trail" aria-label="Where you are">
                  {trail.map((s, i) => (
                    <li key={i}>
                      {i < trail.length - 1 ? (
                        <button type="button" className="link-btn" onClick={() => back(i)}>
                          {i === 0 ? catalog.name : s.title}
                        </button>
                      ) : (
                        <strong>{i === 0 ? catalog.name : feed?.title && !s.search ? feed.title : s.title}</strong>
                      )}
                    </li>
                  ))}
                </ol>
                {feed?.search && (
                  <form
                    className="catalogs-search"
                    role="search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      search();
                    }}
                  >
                    <Icon name="search" size={16} />
                    <input value={words} onChange={(e) => setWords(e.target.value)} placeholder={`Search ${catalog.name}`} aria-label={`Search ${catalog.name}`} />
                  </form>
                )}
              </div>
              {problem ? (
                <div className="library-empty" role="alert">
                  {problem === NEEDS_LOGIN ? (
                    <>
                      <h2>{catalog.name} wants you to sign in</h2>
                      <p className="muted">Add the user name and password you use for it. They stay on this computer.</p>
                      <button type="button" className="btn btn-primary" onClick={() => setEditing(catalog)}>
                        Sign in
                      </button>
                    </>
                  ) : (
                    <>
                      <h2>This page couldn't be opened</h2>
                      <p className="muted">{problem}</p>
                      <button type="button" className="btn btn-quiet" onClick={() => setTrail((t) => [...t])}>
                        Try again
                      </button>
                    </>
                  )}
                </div>
              ) : loading && !feed ? (
                <div className="library-loading" aria-label="Loading the catalogue" />
              ) : feed ? (
                <div className={loading ? "is-loading" : undefined}>
                  {shelves.length > 0 && (
                    <ul className="catalog-shelves">
                      {shelves.map((s) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => go(s.title, s.navigation!)}>
                            <span>{s.title}</span>
                            <Icon name="chevronRight" size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {books.length > 0 && (
                    <ul className="catalog-books">
                      {books.map((b) => (
                        <EntryCard
                          key={b.id}
                          entry={b}
                          state={downloads[b.id] ?? "idle"}
                          onOpen={() => b.navigation && go(b.title, b.navigation)}
                          onDownload={(f) => void download(b, f)}
                          onListen={
                            isApp && catalog?.kind === "audiobookshelf" && b.files.some((f) => f.url.endsWith("/audio"))
                              ? () => playAudiobook(serverBookId(catalog.id, b.id))
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  )}
                  {!shelves.length && !books.length && <p className="muted catalogs-nothing">Nothing here.</p>}
                  {(feed.previous || feed.next) && (
                    <div className="catalogs-pages">
                      {feed.previous && (
                        <button type="button" className="btn btn-quiet" onClick={() => go(feed.title, feed.previous!)}>
                          <Icon name="chevronLeft" size={15} /> Previous
                        </button>
                      )}
                      {feed.next && (
                        <button type="button" className="btn btn-quiet" onClick={() => go(feed.title, feed.next!)}>
                          More <Icon name="chevronRight" size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
      {editing && (
        <CatalogDialog
          catalog={editing === "new" ? null : editing}
          existing={catalogs?.map((c) => c.url) ?? []}
          bibles={bibles}
          onCancel={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null);
            void reloadCatalogs().then(() => {
              setCurrent(c.id);
              setTrail([{ title: c.name, url: null }]);
            });
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          body="Books you've already brought in stay in your library."
          confirm="Remove"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const gone = removing;
            setRemoving(null);
            void api.removeCatalog(gone.id).then(reloadCatalogs, (e) => toast(String(e)));
          }}
        />
      )}
    </div>
  );
}
