// Sanctum's Quick Links: tiles that go to almost anything in TBV (a page,
// one of Discover's panels, a book, a collection) or to a website, kept
// apart from Discover's own links and synced. See crates/tbv-core/src/sanctum_links.rs.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview, CollectionSummary, SanctumLink } from "../api/types";
import { askBrowser } from "../browse/browserAsk";
import { addressFor, isAddress, readableAddress } from "../browse/browserPrefs";
import type { StartPanel } from "../browse/StartPage";
import { Icon, type IconName } from "../components/Icon";
import { useToast } from "../components/Toast";
import { hashOf } from "../lib/format";
import { NAV, type Route } from "../shell/routes";
import { Section } from "./Section";

const PANELS: { target: string; panel: StartPanel | null; label: string; icon: IconName }[] = [
  { target: "tbv:discover", panel: null, label: "Discover", icon: "compass" },
  { target: "tbv:bookmarks", panel: "bookmarks", label: "Bookmarks", icon: "bookOpen" },
  { target: "tbv:downloads", panel: "downloads", label: "Downloads", icon: "download" },
  { target: "tbv:reading", panel: "reading", label: "Reading List", icon: "file" },
  { target: "tbv:history", panel: "history", label: "History", icon: "clock" },
];

/** The pages a link can open, besides Discover's panels. */
const PAGES = NAV.filter((n) => n.route !== "home" && n.route !== "catalogs");

type Kind = "page" | "book" | "collection" | "site";

function kindOf(target: string): Kind {
  if (target.startsWith("tbv:") || target.startsWith("page:")) return "page";
  if (target.startsWith("book:")) return "book";
  if (target.startsWith("collection:")) return "collection";
  return "site";
}

/** The icon a link shows: its own, else its kind's. */
function iconOf(link: SanctumLink): IconName {
  if (link.icon) return link.icon as IconName;
  const page = PANELS.find((p) => p.target === link.target);
  if (page) return page.icon;
  const nav = PAGES.find((p) => `page:${p.route}` === link.target);
  if (nav) return nav.icon;
  const kind = kindOf(link.target);
  return kind === "book" ? "bookOpen" : kind === "collection" ? "layers" : "globe";
}

export interface LinkGo {
  onNavigate: (route: Route) => void;
  onOpenBook: (bookId: string) => void;
  onOpenCollection: (id: string) => void;
}

/** Goes where a link points. */
export function followLink(target: string, go: LinkGo) {
  const panel = PANELS.find((p) => p.target === target);
  if (panel) {
    if (panel.panel) askBrowser({ panel: panel.panel });
    return go.onNavigate("catalogs");
  }
  if (target.startsWith("page:")) return go.onNavigate(target.slice(5) as Route);
  if (target.startsWith("book:")) return go.onOpenBook(target.slice(5));
  if (target.startsWith("collection:")) return go.onOpenCollection(target.slice(11));
  askBrowser({ url: target });
  go.onNavigate("catalogs");
}

export function QuickLinks({ refreshKey, ...go }: LinkGo & { refreshKey: number }) {
  const [links, setLinks] = useState<SanctumLink[] | null>(null);
  const [editing, setEditing] = useState<null | "list" | "add">(null);
  const reload = useCallback(() => api.sanctumLinks().then(setLinks, () => setLinks([])), []);
  useEffect(() => void reload(), [reload, refreshKey]);
  if (!links) return <Section title="Quick links" className="sanctum-links">{null}</Section>;
  return (
    <Section
      title="Quick links"
      className="sanctum-links"
      action={
        <button type="button" className="view-all" onClick={() => setEditing("list")}>
          Edit <span aria-hidden>→</span>
        </button>
      }
    >
      <ul className="link-tiles">
        {links.map((l) => (
          <li key={l.id}>
            <button type="button" className="link-tile" data-tone={hashOf(l.title) % 4} onClick={() => followLink(l.target, go)} title={l.title}>
              <Icon name={iconOf(l)} size={30} />
              <span>{l.title}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="link-tile link-tile-add" onClick={() => setEditing("add")}>
            <Icon name="plus" size={30} />
            <span>Add Link</span>
          </button>
        </li>
      </ul>
      {editing && <LinksEditor links={links} adding={editing === "add"} onChanged={reload} onClose={() => setEditing(null)} />}
    </Section>
  );
}

interface Draft {
  /** Null for a new one. */
  id: string | null;
  kind: Kind;
  title: string;
  target: string;
  icon: string;
}

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "page", label: "A page" },
  { kind: "book", label: "A book" },
  { kind: "collection", label: "A collection" },
  { kind: "site", label: "A website" },
];

const blank = (kind: Kind = "page"): Draft => ({ id: null, kind, title: "", target: "", icon: "" });

/** Edit ›: add, rename, move and take off links. Changes save as they're made, and sync. */
function LinksEditor({ links, adding, onChanged, onClose }: { links: SanctumLink[]; adding: boolean; onChanged: () => Promise<unknown>; onClose: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(adding ? blank() : null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      await onChanged();
      return true;
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    let target = draft.target;
    if (draft.kind === "site") {
      const url = isAddress(target) ? addressFor(target) : null;
      if (!url) return toast("Type the site's address, such as standardebooks.org.");
      target = url;
    }
    if (!target) return toast("Choose where the link goes.");
    const ok = await run(() => (draft.id ? api.updateSanctumLink(draft.id, draft.title, target, draft.icon) : api.addSanctumLink(draft.title, target, draft.icon)));
    if (ok) {
      if (adding && !draft.id) onClose();
      else setDraft(null);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog quick-links-editor" role="dialog" aria-label="Edit Quick links" onKeyDown={(e) => e.key === "Escape" && (draft && !adding ? setDraft(null) : onClose())}>
        <header className="catalogues-head">
          <h2>{draft ? (draft.id ? "Change link" : "Add a link") : "Quick links"}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        {draft ? (
          <form
            className="quick-link-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="segmented link-kinds" role="radiogroup" aria-label="Goes to">
              {KINDS.map((k) => (
                <button key={k.kind} type="button" role="radio" aria-checked={draft.kind === k.kind} onClick={() => setDraft({ ...draft, kind: k.kind, target: "" })}>
                  {k.label}
                </button>
              ))}
            </div>
            <TargetPicker draft={draft} onChange={setDraft} />
            <label className="field">
              <span>Name</span>
              <input value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="As it shows on the tile" />
            </label>
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => (adding ? onClose() : setDraft(null))}>
                {adding ? "Cancel" : "Back"}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.target.trim()}>
                {draft.id ? "Save" : "Add"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <ul className="browser-download-list quick-links-list">
              {links.map((l, i) => (
                <li key={l.id}>
                  <button type="button" className="browser-history-open" onClick={() => setDraft({ id: l.id, kind: kindOf(l.target), title: l.title, target: l.target, icon: l.icon })} title={`Change ${l.title}`}>
                    <Icon name={iconOf(l)} size={20} />
                    <span className="browser-download-name">
                      <b>{l.title}</b>
                      <span className="muted">{describe(l.target)}</span>
                    </span>
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move ${l.title} up`} disabled={busy || i === 0} onClick={() => void run(() => api.moveSanctumLink(l.id, i - 1))}>
                    <Icon name="chevronUp" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move ${l.title} down`} disabled={busy || i === links.length - 1} onClick={() => void run(() => api.moveSanctumLink(l.id, i + 1))}>
                    <Icon name="chevronDown" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Take ${l.title} off`} disabled={busy} onClick={() => void run(() => api.removeSanctumLink(l.id))}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {links.length === 0 && <p className="muted">No links yet.</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDraft(blank())}>
                <Icon name="plus" size={15} /> Add a link
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Where a link goes, in a few words, for the editor's list. */
function describe(target: string): string {
  const panel = PANELS.find((p) => p.target === target);
  if (panel) return panel.panel ? `Discover › ${panel.label}` : "Discover";
  const page = PAGES.find((p) => `page:${p.route}` === target);
  if (page) return page.label;
  if (target.startsWith("book:")) return "A book";
  if (target.startsWith("collection:")) return "A collection";
  return readableAddress(target);
}

/** The choice of where a link goes, for its kind. Picking one also names it, unless a name was typed. */
function TargetPicker({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const pick = (target: string, title: string, icon = "") => onChange({ ...draft, target, title: draft.title && draft.id ? draft.title : title, icon });
  if (draft.kind === "site")
    return (
      <label className="field">
        <span>Address</span>
        <input value={draft.target} inputMode="url" autoCapitalize="off" spellCheck={false} onChange={(e) => onChange({ ...draft, target: e.target.value })} placeholder="standardebooks.org" autoFocus />
      </label>
    );
  if (draft.kind === "page")
    return (
      <label className="field">
        <span>Page</span>
        <select
          value={draft.target}
          onChange={(e) => {
            const p = PANELS.find((x) => x.target === e.target.value);
            const n = PAGES.find((x) => `page:${x.route}` === e.target.value);
            pick(e.target.value, p?.label ?? n?.label ?? "");
          }}
        >
          <option value="">Choose a page…</option>
          <optgroup label="Discover">
            {PANELS.map((p) => (
              <option key={p.target} value={p.target}>
                {p.panel ? `Discover › ${p.label}` : p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Pages">
            {PAGES.map((p) => (
              <option key={p.route} value={`page:${p.route}`}>
                {p.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
    );
  if (draft.kind === "collection") return <CollectionPicker value={draft.target} onPick={(c) => pick(`collection:${c.id}`, c.name)} />;
  return <BookPicker value={draft.target} onPick={(b) => pick(`book:${b.id}`, b.title)} />;
}

function CollectionPicker({ value, onPick }: { value: string; onPick: (c: CollectionSummary) => void }) {
  const [list, setList] = useState<CollectionSummary[]>([]);
  useEffect(() => {
    api.getCollectionsOverview().then(
      (o) => setList(o.collections),
      () => undefined,
    );
  }, []);
  return (
    <label className="field">
      <span>Collection</span>
      <select
        value={value}
        onChange={(e) => {
          const c = list.find((x) => `collection:${x.id}` === e.target.value);
          if (c) onPick(c);
        }}
      >
        <option value="">{list.length ? "Choose a collection…" : "No collections yet"}</option>
        {list.map((c) => (
          <option key={c.id} value={`collection:${c.id}`}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function BookPicker({ value, onPick }: { value: string; onPick: (b: BookPreview) => void }) {
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<BookPreview[]>([]);
  useEffect(() => {
    const words = search.trim();
    if (!words) return setFound([]);
    let current = true;
    const timer = window.setTimeout(() => {
      api
        .getLibrary({ shelf: "all", sort: "title", search: words, formats: [], location: null, kind: null, page: 0, pageSize: 6 })
        .then((page) => current && setFound(page.books), () => undefined);
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [search]);
  return (
    <div className="field">
      <label>
        <span>Book</span>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title or author" autoFocus />
      </label>
      {found.length > 0 && (
        <ul className="link-book-results" role="listbox" aria-label="Books found">
          {found.map((b) => (
            <li key={b.id}>
              <button type="button" role="option" aria-selected={value === `book:${b.id}`} onClick={() => onPick(b)}>
                <b>{b.title}</b>
                <span className="muted">{b.authors.join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
