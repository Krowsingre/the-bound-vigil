import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  CollectionDetail,
  CollectionRef,
  CollectionSummary,
  CollectionsOverview,
  CoverRef,
} from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { CollectionCard, PinnedCard, SeriesCard, SmartCard } from "./CollectionCards";
import { CollectionEditor } from "./CollectionEditor";
import { sameRef } from "./collectionInfo";
import { CollectionPanel } from "./CollectionPanel";
import { CollectionView } from "./CollectionView";

type Tab = "all" | "collections" | "reading_lists" | "series";
type Sort = "name" | "created" | "changed" | "size" | "custom";

const SORTS: { sort: Sort; label: string }[] = [
  { sort: "custom", label: "Your order" },
  { sort: "name", label: "Name" },
  { sort: "created", label: "Recently created" },
  { sort: "changed", label: "Recently changed" },
  { sort: "size", label: "Most books" },
];

const PREFS_KEY = "tbv.collections.view";

function readPrefs(): { sort: Sort; layout: "grid" | "list" } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      sort: SORTS.some((s) => s.sort === p.sort) ? p.sort : "custom",
      layout: p.layout === "list" ? "list" : "grid",
    };
  } catch {
    return { sort: "custom", layout: "grid" };
  }
}

type Editing = { collection?: CollectionSummary; books: CoverRef[] } | null;

export function Collections({
  open,
  refreshKey,
  onOpen,
  onOpenBook,
  onChanged,
}: {
  /** The collection shown full page, or null for the overview. */
  open: CollectionRef | null;
  refreshKey: number;
  onOpen: (collection: CollectionRef | null) => void;
  onOpenBook: (bookId: string) => void;
  /** Something changed that other pages show (counts, Home's collections). */
  onChanged: () => void;
}) {
  const [overview, setOverview] = useState<CollectionsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<CollectionRef | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [prefs, setPrefs] = useState(readPrefs);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<CollectionSummary | null>(null);
  const toast = useToast();
  const narrow = useNarrow();

  useEffect(() => {
    let current = true;
    api.getCollectionsOverview().then(
      (o) => {
        if (!current) return;
        setOverview(o);
        setError(null);
      },
      (e: unknown) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
  }, [refreshKey, reload]);

  // Something is always selected for the side panel: the first pinned one to start.
  const firstPinned = overview?.pinned[0]?.id;
  useEffect(() => {
    if (!selected && firstPinned) setSelected({ kind: "collection", id: firstPinned });
  }, [selected, firstPinned]);

  const changePrefs = (change: Partial<typeof prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...change };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* just not remembered */
      }
      return next;
    });

  const changed = useCallback(() => {
    setReload((n) => n + 1);
    onChanged();
  }, [onChanged]);

  const edit = useCallback(async (collection: CollectionSummary) => {
    const detail = await api.getCollection({ kind: "collection", id: collection.id }).catch(() => null);
    setEditing({
      collection,
      books: (detail?.books ?? []).map(({ id, title, authors, coverPath }) => ({ id, title, authors, coverPath })),
    });
  }, []);

  const togglePin = useCallback(
    (c: CollectionSummary) =>
      api
        .updateCollection(c.id, { name: c.name, description: c.description, kind: c.kind, badge: c.badge, pinned: !c.pinned })
        .then(changed, (e: unknown) => toast(String(e))),
    [changed, toast],
  );

  const menuFor = useCallback(
    (c: CollectionSummary): MenuEntry[] => [
      { label: "Open", onSelect: () => onOpen({ kind: "collection", id: c.id }) },
      { label: c.kind === "shelf" ? "Change picture or badge…" : "Edit…", icon: "edit", onSelect: () => void edit(c) },
      c.pinned
        ? { label: "Unpin from the top", onSelect: () => void togglePin(c) }
        : { label: "Pin to the top", onSelect: () => void togglePin(c) },
      ...(c.kind === "shelf"
        ? []
        : (["divider", { label: "Delete…", icon: "trash", danger: true, onSelect: () => setDeleting(c) }] as MenuEntry[])),
    ],
    [edit, togglePin, onOpen],
  );
  const detailMenu = useCallback(
    (detail: CollectionDetail) => (detail.collection ? menuFor(detail.collection).slice(1) : []),
    [menuFor],
  );

  const confirmDelete = (c: CollectionSummary) =>
    api.deleteCollection(c.id).then(
      () => {
        setDeleting(null);
        toast(`Deleted ${c.name}. Its books are still in your library.`);
        if (selected?.kind === "collection" && selected.id === c.id) setSelected(null);
        if (open?.kind === "collection" && open.id === c.id) onOpen(null);
        changed();
      },
      (e: unknown) => toast(String(e)),
    );

  const dialogs = (
    <>
      {editing && (
        <CollectionEditor
          collection={editing.collection}
          books={editing.books}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            if (!editing.collection) {
              toast(`Made ${saved.name}. Add books from any book's … menu, or from the collection.`);
              setSelected({ kind: "collection", id: saved.id });
            }
            changed();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="The collection goes on every device. The books in it stay in your library."
          confirm="Delete collection"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete(deleting)}
        />
      )}
    </>
  );

  const q = filter.trim().toLocaleLowerCase();
  const matches = (...texts: (string | null | undefined)[]) => !q || texts.some((t) => t?.toLocaleLowerCase().includes(q));

  const own = useMemo(() => {
    const list = (overview?.collections ?? []).filter(
      (c) =>
        (tab === "all" || (tab === "collections" && c.kind === "collection") || (tab === "reading_lists" && c.kind === "reading_list")) &&
        matches(c.name, c.description),
    );
    const sorters: Record<Sort, (a: CollectionSummary, b: CollectionSummary) => number> = {
      custom: () => 0,
      name: (a, b) => a.name.localeCompare(b.name),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      changed: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      size: (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    };
    return [...list].sort(sorters[prefs.sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, tab, q, prefs.sort]);
  const series = (overview?.series ?? []).filter((s) => (tab === "all" || tab === "series") && matches(s.name, ...s.authors));

  if (open)
    return (
      <>
        <CollectionView
          collection={open}
          series={overview?.series ?? []}
          refreshKey={refreshKey + reload}
          menuFor={detailMenu}
          onBack={() => onOpen(null)}
          onOpenBook={onOpenBook}
          onChanged={changed}
        />
        {dialogs}
      </>
    );

  if (error)
    return (
      <div className="collections-page">
        <div className="library-empty" role="alert">
          <h2>Your collections couldn't be loaded</h2>
          <p className="muted">{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => setReload((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!overview) return <div className="collections-page library-loading" aria-busy="true" aria-label="Loading your collections" />;

  const counts: Record<Tab, number> = {
    all: overview.collections.length + overview.series.length,
    collections: overview.collections.filter((c) => c.kind === "collection").length,
    reading_lists: overview.collections.filter((c) => c.kind === "reading_list").length,
    series: overview.series.length,
  };
  // Without room for the side panel, a click opens the collection straight away.
  const pick = (ref: CollectionRef) => (narrow ? onOpen(ref) : setSelected(ref));
  const isSel = (ref: CollectionRef) => sameRef(selected, ref);

  return (
    <div className="collections-page">
      <header className="collections-head">
        <div className="collections-heading">
          <h1 className="library-title">Collections</h1>
          <p className="collections-lede">Organize your library. Shape your reading journey.</p>
        </div>
        <div className="collections-actions">
          <label className="search collections-search">
            <Icon name="search" size={16} />
            <input type="search" placeholder="Search collections…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search collections" />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ books: [] })}>
            <span aria-hidden>+</span> New collection
          </button>
        </div>
      </header>

      <div className="collections-layout">
        <div className="collections-main">
          {overview.pinned.length > 0 && !q && (
            <section aria-label="Pinned">
              <ul className="pinned-row">
                {overview.pinned.map((c) => {
                  const ref: CollectionRef = { kind: "collection", id: c.id };
                  return (
                    <PinnedCard
                      key={c.id}
                      collection={c}
                      selected={isSel(ref)}
                      menu={menuFor(c)}
                      onSelect={() => pick(ref)}
                      onOpen={() => onOpen(ref)}
                    />
                  );
                })}
              </ul>
            </section>
          )}

          {!q && (
            <section className="collections-section">
              <div className="section-head">
                <h2>Smart collections</h2>
                <p className="muted">These fill themselves as you read.</p>
              </div>
              <ul className="smart-row">
                {overview.smart.map((s) => {
                  const ref: CollectionRef = { kind: "smart", smart: s.kind };
                  return <SmartCard key={s.kind} smart={s} selected={isSel(ref)} onSelect={() => pick(ref)} onOpen={() => onOpen(ref)} />;
                })}
              </ul>
            </section>
          )}

          <section className="collections-section">
            <div className="section-head">
              <h2>Your collections</h2>
              <p className="muted">Your own groupings, plus series found in your books.</p>
            </div>
            <div className="library-toolbar">
              <div className="tabs" role="tablist" aria-label="Kinds of collection">
                {(
                  [
                    ["all", "All"],
                    ["collections", "Collections"],
                    ["reading_lists", "Reading lists"],
                    ["series", "Series"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    className={`tab${tab === value ? " is-active" : ""}`}
                    onClick={() => setTab(value)}
                  >
                    {label} <span className="tab-count">{counts[value]}</span>
                  </button>
                ))}
              </div>
              <div className="toolbar-controls">
                <Menu
                  label="Sort collections"
                  className="toolbar-button"
                  trigger={
                    <>
                      Sort: {SORTS.find((s) => s.sort === prefs.sort)?.label} <Icon name="chevronDown" size={14} />
                    </>
                  }
                  items={SORTS.map((s) => ({ label: s.label, checked: prefs.sort === s.sort, onSelect: () => changePrefs({ sort: s.sort }) }))}
                />
                <div className="layout-switch" role="radiogroup" aria-label="Layout">
                  {(
                    [
                      ["grid", "Cards", "grid"],
                      ["list", "List", "list"],
                    ] as const
                  ).map(([value, label, icon]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={prefs.layout === value}
                      aria-label={label}
                      title={label}
                      className={prefs.layout === value ? "is-active" : undefined}
                      onClick={() => changePrefs({ layout: value })}
                    >
                      <Icon name={icon} size={16} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {own.length + series.length === 0 ? (
              <div className="library-empty collections-empty">
                {q ? (
                  <>
                    <h2>Nothing matches</h2>
                    <p className="muted">No collections match “{filter.trim()}”.</p>
                  </>
                ) : tab === "series" ? (
                  <>
                    <h2>No series yet</h2>
                    <p className="muted">Series appear here when your books say which series they belong to.</p>
                  </>
                ) : (
                  <>
                    <h2>No collections yet</h2>
                    <p className="muted">Group books your way: a reading list for winter, a shelf of comfort reads, a book club.</p>
                    <button type="button" className="btn btn-primary" onClick={() => setEditing({ books: [] })}>
                      Make your first collection
                    </button>
                  </>
                )}
              </div>
            ) : (
              <ul className={`collection-cards collection-cards-${prefs.layout}`}>
                {own.map((c) => {
                  const ref: CollectionRef = { kind: "collection", id: c.id };
                  return (
                    <CollectionCard
                      key={c.id}
                      collection={c}
                      layout={prefs.layout}
                      selected={isSel(ref)}
                      menu={menuFor(c)}
                      onSelect={() => pick(ref)}
                      onOpen={() => onOpen(ref)}
                    />
                  );
                })}
                {series.map((s) => {
                  const ref: CollectionRef = { kind: "series", name: s.name };
                  return (
                    <SeriesCard key={s.name} series={s} layout={prefs.layout} selected={isSel(ref)} onSelect={() => pick(ref)} onOpen={() => onOpen(ref)} />
                  );
                })}
                {tab !== "series" && !q && (
                  <li className="collection-card collection-card-new">
                    <button type="button" className="collection-card-open" onClick={() => setEditing({ books: [] })}>
                      <span className="new-plus" aria-hidden>
                        +
                      </span>
                      <span>
                        <span className="collection-card-name">Create a new collection</span>
                        <span className="collection-card-meta">Organize your library your way.</span>
                      </span>
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>
        </div>

        {selected && (
          <CollectionPanel
            selected={selected}
            series={overview.series}
            refreshKey={refreshKey + reload}
            menuFor={detailMenu}
            onOpen={() => onOpen(selected)}
            onOpenBook={onOpenBook}
          />
        )}
      </div>
      {dialogs}
    </div>
  );
}


function useNarrow() {
  const query = "(max-width: 1200px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const change = () => setNarrow(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return narrow;
}
