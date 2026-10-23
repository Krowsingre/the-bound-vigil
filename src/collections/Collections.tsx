import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  CollectionDetail,
  CollectionRef,
  CollectionSummary,
  CollectionsOverview,
  CoverRef,
  SmartSummary,
} from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { CollectionCard, PinnedCard, SeriesCard, SmartCard } from "./CollectionCards";
import { CollectionEditor } from "./CollectionEditor";
import { sameRef, SMART_INFO } from "./collectionInfo";
import { CollectionPanel } from "./CollectionPanel";
import { CollectionView } from "./CollectionView";
import { moved, useReorder } from "./useReorder";
import { useAppSettings } from "../settings/appSettings";
import { Stat } from "../home/ReadingActivity";

type Tab = "all" | "collections" | "reading_lists" | "series";
type Sort = "custom" | "name" | "size" | "rating" | "created" | "changed";
type SmartSort = "custom" | "name" | "size" | "rating";

const SORTS: { sort: Sort; label: string }[] = [
  { sort: "custom", label: "Your order" },
  { sort: "name", label: "Name, A to Z" },
  { sort: "size", label: "Most books" },
  { sort: "rating", label: "Highest rated" },
  { sort: "created", label: "Recently created" },
  { sort: "changed", label: "Recently changed" },
];

const SMART_SORTS: { sort: SmartSort; label: string }[] = [
  { sort: "custom", label: "Your order" },
  { sort: "name", label: "Name, A to Z" },
  { sort: "size", label: "Most books" },
  { sort: "rating", label: "Highest rated" },
];

/** Highest average rating first; collections with no rated books last. */
const byRating = (a: { rating: number | null }, b: { rating: number | null }) =>
  (b.rating ?? -1) - (a.rating ?? -1);

const PREFS_KEY = "tbv.collections.view";
/** Your order for the smart collections, kept with this device's settings. */
const SMART_ORDER_KEY = "collections.smartOrder";

interface Prefs {
  sort: Sort;
  smartSort: SmartSort;
  layout: "grid" | "list";
}

function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      sort: SORTS.some((s) => s.sort === p.sort) ? p.sort : "custom",
      smartSort: SMART_SORTS.some((s) => s.sort === p.smartSort) ? p.smartSort : "custom",
      layout: p.layout === "list" ? "list" : "grid",
    };
  } catch {
    return { sort: "custom", smartSort: "custom", layout: "grid" };
  }
}

/** Your order for the smart collections, with any new kinds at the end. */
function orderSmart(list: SmartSummary[], saved: string[]): SmartSummary[] {
  const rank = (k: string) => {
    const i = saved.indexOf(k);
    return i < 0 ? saved.length + list.findIndex((s) => s.kind === k) : i;
  };
  return [...list].sort((a, b) => rank(a.kind) - rank(b.kind));
}

type Editing = { collection?: CollectionSummary; books: CoverRef[] } | null;

export function Collections({
  open,
  refreshKey,
  onOpen,
  onOpenBook,
  onChanged,
  search,
}: {
  /** What's typed in the top bar's search box: the collections are filtered by it. */
  search: string;
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
  const [smartOrder, setSmartOrder] = useState<string[]>([]);
  const filter = search;
  const wide = useWide();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<CollectionSummary | null>(null);
  const toast = useToast();
  const { settings } = useAppSettings();

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

  useEffect(() => {
    api.getSetting(SMART_ORDER_KEY).then(
      (json) => {
        try {
          const saved: unknown = JSON.parse(json ?? "[]");
          if (Array.isArray(saved)) setSmartOrder(saved.filter((k): k is string => typeof k === "string"));
        } catch {
          /* start from the usual order */
        }
      },
      () => undefined,
    );
  }, []);

  // Something is always selected for the side panel: the first pinned one to start.
  const firstPinned = overview?.pinned[0]?.id;
  useEffect(() => {
    if (!selected && firstPinned) setSelected({ kind: "collection", id: firstPinned });
  }, [selected, firstPinned]);

  const changePrefs = (change: Partial<Prefs>) =>
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
        .updateCollection(c.id, { name: c.name, description: c.description, kind: c.kind, badge: c.badge, pinned: !c.pinned, rules: c.rules })
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
              toast(
                saved.rules
                  ? `Made ${saved.name}. It holds ${saved.count} ${saved.count === 1 ? "book" : "books"} now and keeps up by itself.`
                  : `Made ${saved.name}. Add books from any book's … menu, or from the collection.`,
              );
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
      size: (a, b) => b.count - a.count || a.name.localeCompare(b.name),
      rating: (a, b) => byRating(a, b) || a.name.localeCompare(b.name),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      changed: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    };
    return [...list].sort(sorters[prefs.sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, tab, q, prefs.sort]);
  const smart = useMemo(() => {
    const list = overview?.smart ?? [];
    if (prefs.smartSort === "name") return [...list].sort((a, b) => SMART_INFO[a.kind].name.localeCompare(SMART_INFO[b.kind].name));
    if (prefs.smartSort === "size") return [...list].sort((a, b) => b.count - a.count);
    if (prefs.smartSort === "rating") return [...list].sort(byRating);
    return orderSmart(list, smartOrder);
  }, [overview, prefs.smartSort, smartOrder]);

  const reorderSmart = useReorder(
    smart.map((s) => s.kind),
    prefs.smartSort === "custom",
    (kind, to) => {
      const next = moved(
        smart.map((s) => s.kind as string),
        kind,
        to,
      );
      setSmartOrder(next);
      api.setSetting(SMART_ORDER_KEY, JSON.stringify(next)).catch((e: unknown) => toast(String(e)));
    },
  );

  // Your order covers every collection, so a move within a filtered view
  // lands next to the card it was dropped on.
  const reorderOwn = useReorder(
    own.map((c) => c.id),
    prefs.sort === "custom" && !q,
    (id, to) => {
      if (!overview) return;
      const target = own[to]?.id;
      const full = overview.collections.map((c) => c.id);
      const index = target ? full.indexOf(target) : full.length - 1;
      const order = moved(full, id, index);
      setOverview({ ...overview, collections: order.map((cid) => overview.collections.find((c) => c.id === cid)!) });
      api.moveCollection(id, index).then(changed, (e: unknown) => {
        toast(String(e));
        changed();
      });
    },
  );

  const series = (settings.showSeries ? (overview?.series ?? []) : []).filter(
    (s) => (tab === "all" || tab === "series") && matches(s.name, ...s.authors),
  );

  const { shown: seriesShown, more } = useShownBit(series.length, `${tab}/${q}`);

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
  // One click opens a collection; the side panel then shows it on the way back.
  const pick = (ref: CollectionRef) => {
    setSelected(ref);
    onOpen(ref);
  };
  const isSel = (ref: CollectionRef) => sameRef(selected, ref);

  return (
    <div className="collections-page compendium">
      <header className="library-head is-stacked compendium-head">
        <div className="library-title-row">
          <h1 className="library-title">Compendium</h1>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ books: [] })}>
            <Icon name="plus" size={15} /> New
          </button>
        </div>
        <div className="stats stats-5 library-stats">
          <Stat icon="squares" value={counts.collections} label="Collections" />
          <Stat icon="listNumber" value={counts.reading_lists} label="Reading lists" />
          {settings.showSeries && <Stat icon="layers" value={counts.series} label="Series" />}
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

          {!q && settings.showSmartCollections && (
            <section className="collections-section">
              <div className="section-head section-head-tools">
                <h2>Smart collections</h2>
                <Menu
                  label="Sort smart collections"
                  className="toolbar-button"
                  trigger={
                    <>
                      Sort: {SMART_SORTS.find((s) => s.sort === prefs.smartSort)?.label} <Icon name="chevronDown" size={14} />
                    </>
                  }
                  items={SMART_SORTS.map((s) => ({
                    label: s.label,
                    checked: prefs.smartSort === s.sort,
                    onSelect: () => changePrefs({ smartSort: s.sort }),
                  }))}
                />
              </div>
              <ul className="smart-row">
                {smart.map((s) => {
                  const ref: CollectionRef = { kind: "smart", smart: s.kind };
                  return (
                    <SmartCard
                      key={s.kind}
                      smart={s}
                      selected={isSel(ref)}
                      reorder={reorderSmart(s.kind)}
                      onSelect={() => pick(ref)}
                      onOpen={() => onOpen(ref)}
                    />
                  );
                })}
              </ul>
            </section>
          )}

          <section className="collections-section">
            <div className="section-head">
              <h2>Your collections</h2>
            </div>
            <div className="library-toolbar is-compact">
              <div className="scribe-chips" role="tablist" aria-label="Kinds of collection">
                {(
                  [
                    ["all", "All"],
                    ["collections", "Collections"],
                    ["reading_lists", "Reading lists"],
                    ["series", "Series"],
                  ] as const
                )
                  .filter(([value]) => value !== "series" || settings.showSeries)
                  .map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    className={`chip${tab === value ? " is-active" : ""}`}
                    onClick={() => setTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="toolbar-controls">
                <Menu
                  label="Sort collections"
                  className="toolbar-button"
                  trigger={
                    <>
                      <Icon name="sort" size={16} /> <Icon name="chevronDown" size={12} />
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
                      reorder={reorderOwn(c.id)}
                      onSelect={() => pick(ref)}
                      onOpen={() => onOpen(ref)}
                    />
                  );
                })}
                {series.slice(0, seriesShown).map((s) => {
                  const ref: CollectionRef = { kind: "series", name: s.name };
                  return (
                    <SeriesCard key={s.name} series={s} layout={prefs.layout} selected={isSel(ref)} onSelect={() => pick(ref)} onOpen={() => onOpen(ref)} />
                  );
                })}
                {series.length > seriesShown && <li ref={more} className="collection-more" aria-hidden />}
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

        {selected && wide && (
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


/** Wide enough for the side panel beside the collections (see collections.css). */
function useWide(): boolean {
  const query = "(min-width: 1201px)";
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const change = () => setWide(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return wide;
}

const SERIES_AT_ONCE = 60;

/**
 * How many series cards to draw: a first lot, then more as the end comes
 * into view, so thousands of series (and their covers) don't all load at once.
 */
function useShownBit(total: number, resetKey: string) {
  const [shown, setShown] = useState(SERIES_AT_ONCE);
  // A callback ref, so a fresh end marker (back from a collection) is watched too.
  const [end, more] = useState<HTMLLIElement | null>(null);
  useEffect(() => setShown(SERIES_AT_ONCE), [resetKey]);
  useEffect(() => {
    if (!end || shown >= total || typeof IntersectionObserver !== "function") return;
    const watching = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && setShown((n) => n + SERIES_AT_ONCE), { rootMargin: "600px" });
    watching.observe(end);
    return () => watching.disconnect();
  }, [end, shown, total]);
  return { shown, more };
}
