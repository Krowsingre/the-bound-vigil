import { useEffect, useMemo, useRef, useState } from "react";
import { api, isHome, isWeb } from "../api";
import type { BookPreview, CollectionPreview, ItemKind, LibraryPage } from "../api/types";
import { askEditDetails } from "../details/openDetails";
import { askSendToEreader } from "../ereaders/SendToEreader";
import { askSendWithLocalSend, canSendWithLocalSend } from "../localsend/SendWithLocalSend";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry, type MenuItem } from "../components/Menu";
import { SeriesPanel } from "./SeriesPanel";
import { useToast } from "../components/Toast";
import { makeBookActions, phoneChoiceShown } from "../home/bookActions";
import { Spent, Stat } from "../home/ReadingActivity";
import { useTimeSpent } from "../home/useTimeSpent";
import { TagsDialog, deleteWarning, removeWarning } from "./BookDialogs";
import { BookGrid, BookList, BookTable, type Selection } from "./BookViews";
import { CollectionsTab } from "./CollectionsTab";
import { LibraryToolbar } from "./LibraryToolbar";
import { excludeCount, NO_FILTERS, PAGE_SIZE, type LibraryView } from "./libraryView";
import { Pagination } from "./Pagination";
import { useNarrow } from "../lib/useNarrow";

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

const WORDS = {
  books: { title: "Library", eyebrow: "Your personal archive", one: "book", many: "books", total: "Books" },
  documents: { title: "Documents", eyebrow: "PDF, Word and text files", one: "document", many: "documents", total: "Documents" },
  audiobooks: { title: "Audiobooks", eyebrow: "Your listening shelf", one: "audiobook", many: "audiobooks", total: "Audiobooks" },
} as const;

export function Library({
  kind = "books",
  view,
  search,
  refreshKey,
  onChange,
  onClearSearch,
  onImportBooks,
  onImportFolder,
  onOpenBook,
  onOpenCollection,
  intro,
}: {
  /** Books (the Library), documents (PDF, Word and text files) or audiobooks. */
  kind?: ItemKind;
  view: LibraryView;
  search: string;
  refreshKey: number;
  onChange: (change: Partial<LibraryView>) => void;
  onClearSearch: () => void;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenBook: (bookId: string) => void;
  onOpenCollection: (id: string) => void;
  /** Shown above the books, like Continue listening. */
  intro?: React.ReactNode;
}) {
  const [load, setLoad] = useState<Load<LibraryPage>>({ state: "loading" });
  const spent = useTimeSpent(refreshKey);
  const [collections, setCollections] = useState<CollectionPreview[] | null>(null);
  const [reload, setReload] = useState(0);
  // Choosing books to change many at once.
  const [selected, setSelected] = useState<Map<string, BookPreview> | null>(null);
  /** The book picked last, where a Shift-click range starts. */
  const lastPicked = useRef<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [asking, setAsking] = useState<"remove" | "delete" | "download" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The search and filters everything was last chosen for. */
  const toast = useToast();
  const words = WORDS[kind];
  // On a phone there are no pages: more books load as the list nears its end.
  const endless = useNarrow();
  /** Phone: how many pages are shown, and the books of every page after the first. */
  const [pages, setPages] = useState(1);
  const [later, setLater] = useState<BookPreview[][]>([]);
  const loadingMore = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const actions = useMemo(
    () => makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook),
    [toast, onOpenBook],
  );

  const shelf = view.tab === "collections" ? "all" : view.tab;
  const query = {
    shelf,
    sort: view.sort,
    search: search.trim() || null,
    formats: view.formats,
    location: view.location,
    tags: view.tags,
    genres: view.genres,
    languages: view.languages,
    downloadable: view.downloadable,
    authors: view.authors,
    series: view.series,
    narrators: view.narrators,
    hideRead: view.hideRead,
    exclude: view.exclude,
    kind,
  };
  useEffect(() => {
    let current = true;
    api
      .getLibrary({
        shelf,
        sort: view.sort,
        search: search.trim() || null,
        formats: view.formats,
        location: view.location,
        tags: view.tags,
        genres: view.genres,
        languages: view.languages,
        downloadable: view.downloadable,
        authors: view.authors,
        series: view.series,
        narrators: view.narrators,
        hideRead: view.hideRead,
        exclude: view.exclude,
        kind,
        page: endless ? 0 : view.page,
        pageSize: PAGE_SIZE,
      })
      .then(
        (data) => current && setLoad({ state: "ready", data }),
        (e: unknown) => current && setLoad({ state: "error", message: String(e) }),
      );
    return () => {
      current = false;
    };
  }, [kind, shelf, view.sort, view.formats, view.location, view.tags, view.genres, view.languages, view.downloadable, view.authors, view.series, view.narrators, view.hideRead, view.exclude, view.page, search, refreshKey, reload, endless]);

  // A new search, filter, shelf or sort starts the phone's list from the top.
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    setPages(1);
    setLater([]);
  }, [queryKey, endless]);

  // The later pages come again after a change (a book moved shelf, say), so the list keeps its place.
  useEffect(() => {
    if (!endless || pages < 2) return;
    let current = true;
    loadingMore.current = true;
    Promise.all(Array.from({ length: pages - 1 }, (_, i) => api.getLibrary({ ...query, page: i + 1, pageSize: PAGE_SIZE })))
      .then(
        (got) => current && setLater(got.map((p, i) => (p.page === i + 1 ? p.books : []))),
        () => {},
      )
      .finally(() => {
        if (current) loadingMore.current = false;
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endless, refreshKey, reload]);

  // The next page, once more of it is wanted.
  useEffect(() => {
    if (!endless || pages < 2 || later.length >= pages - 1) return;
    let current = true;
    loadingMore.current = true;
    const want = pages - 1;
    api
      .getLibrary({ ...query, page: want, pageSize: PAGE_SIZE })
      .then(
        (p) => current && setLater((l) => (l.length === want - 1 && p.page === want ? [...l, p.books] : l)),
        () => {},
      )
      .finally(() => {
        loadingMore.current = false;
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endless, pages, later.length]);
  useEffect(() => {
    if (view.tab !== "collections") return;
    let current = true;
    api.getCollections().then(
      (c) => current && setCollections(c),
      () => current && setCollections([]),
    );
    return () => {
      current = false;
    };
  }, [view.tab, refreshKey]);

  // Chosen books keep up with changes made to them, like a tag just added.
  useEffect(() => {
    if (load.state !== "ready") return;
    setSelected((s) => {
      if (!s || !load.data.books.some((b) => s.has(b.id))) return s;
      const next = new Map(s);
      load.data.books.forEach((b) => next.has(b.id) && next.set(b.id, b));
      return next;
    });
  }, [load]);

  // Only books the search and filters show stay chosen: when they change,
  // chosen books they now leave out are let go, so changing many never
  // reaches a book you can't see.
  const chosenIds = useRef<string[]>([]);
  chosenIds.current = selected ? [...selected.keys()] : [];
  useEffect(() => {
    const ids = chosenIds.current;
    if (!ids.length) return;
    let current = true;
    const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
    Promise.all(chunks.map((chunk) => api.getLibrary({ ...query, ids: chunk, page: 0, pageSize: 200 }))).then(
      (pages) => {
        if (!current) return;
        const shown = new Set<string>(pages.flatMap((p) => p.books.map((b) => b.id)));
        setSelected((s) => {
          if (!s || [...s.keys()].every((id) => shown.has(id))) return s;
          return new Map([...s].filter(([id]) => shown.has(id)));
        });
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [queryKey, refreshKey, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new page starts at the top, like turning a page.
  useEffect(() => {
    if (!endless) document.querySelector(".content")?.scrollTo({ top: 0 });
  }, [view.page, endless]);

  const first = load.state === "ready" ? load.data : null;
  // On a phone, the first page with every later one loaded so far.
  const page = useMemo(
    () => (first && endless && later.length ? { ...first, books: [...first.books, ...later.flat()] } : first),
    [first, endless, later],
  );
  const hasMore = endless && page !== null && (later.length + 1) * PAGE_SIZE < page.total;

  // Genres, tags, formats and languages come from the books themselves: a
  // filter on one that no book has any more (its last book changed or went)
  // is dropped, so the lists never hold names the library doesn't.
  useEffect(() => {
    if (!first) return;
    const change = gone(view, first);
    if (change) onChange(change);
  }, [first]); // eslint-disable-line react-hooks/exhaustive-deps

  // Near the end of the list, the next page loads.
  useEffect(() => {
    const target = end.current;
    if (!hasMore || !target || typeof IntersectionObserver !== "function") return;
    const watch = new IntersectionObserver(
      (seen) => {
        if (seen.some((s) => s.isIntersecting) && !loadingMore.current) setPages((n) => Math.max(n, later.length + 2));
      },
      { root: document.querySelector(".content"), rootMargin: "800px 0px" },
    );
    watch.observe(target);
    return () => watch.disconnect();
  }, [hasMore, later.length]);
  const counts = page?.counts ?? null;
  const filtered =
    view.formats.length > 0 || view.location !== null || view.tags.length > 0 || view.genres.length > 0 || view.languages.length > 0 || view.downloadable || view.authors.length > 0 || view.series.length > 0 || view.narrators.length > 0 || view.hideRead || excludeCount(view.exclude) > 0;
  const selection: Selection | null = selected && {
    has: (id) => selected.has(id),
    toggle: (book, range) => {
      const from = range?.findIndex((b) => b.id === lastPicked.current) ?? -1;
      const to = range?.findIndex((b) => b.id === book.id) ?? -1;
      lastPicked.current = book.id;
      setSelected((s) => {
        const next = new Map(s);
        if (range && from >= 0 && to >= 0) {
          // Shift: everything between the last book picked and this one.
          for (const b of range.slice(Math.min(from, to), Math.max(from, to) + 1)) next.set(b.id, b);
        } else if (next.has(book.id)) next.delete(book.id);
        else next.set(book.id, book);
        return next;
      });
    },
  };
  const chosen = selected ? [...selected.values()] : [];

  /** Chooses every book the current filters and search show, on every page. */
  const chooseAll = async () => {
    setBusy("Choosing…");
    try {
      const all = new Map(selected ?? []);
      for (let p = 0; ; p++) {
        const got = await api.getLibrary({ ...query, page: p, pageSize: 200 });
        got.books.forEach((b) => all.set(b.id, b));
        if (got.page < p || (got.page + 1) * got.pageSize >= got.total) break;
      }
      setSelected(all);
    } catch (e) {
      toast(`Couldn't choose them all: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const none = !selected?.size;
  const pageAllChosen = !!page?.books.length && page.books.every((b) => selected?.has(b.id));
  // Books a search or filter hides are let go from the choice, so this many means all of them.
  const libraryAllChosen = !!page?.total && (selected?.size ?? 0) >= page.total;
  const chosenActions: MenuEntry[] = [
    { label: "Edit details", icon: "edit", disabled: none, onSelect: () => askEditDetails(chosen) },
    { label: "Tags", icon: "tag", disabled: none, onSelect: () => setTagging(true) },
    ...(kind !== "audiobooks" ? [{ label: "Send to e-reader", icon: "ereader", disabled: none, onSelect: () => askSendToEreader(chosen) } as MenuItem] : []),
    ...(canSendWithLocalSend ? [{ label: "Send with LocalSend", icon: "upload", disabled: none, onSelect: () => askSendWithLocalSend(chosen) } as MenuItem] : []),
    ...(!isWeb && phoneChoiceShown()
      ? [
          { label: "Send to device", icon: "upload", disabled: none, onSelect: () => actions.setPhoneWanted?.(chosen, true) } as MenuItem,
          ...(chosen.some((b) => b.phoneWanted)
            ? [{ label: "Stop sending to device", icon: "cloudOff", onSelect: () => actions.setPhoneWanted?.(chosen.filter((b) => b.phoneWanted), false) } as MenuItem]
            : []),
        ]
      : []),
    { label: "Save copies", icon: "copy", disabled: none || busy !== null, onSelect: () => void saveChosen() },
    {
      label: "Remove download",
      icon: "cloudOff",
      hint: "Keeps the cloud copy",
      disabled: !chosen.some((b) => b.availability === "local" && b.inCloud) || busy !== null,
      onSelect: () => setAsking("download"),
    },
    "divider",
    { label: "Clear choice", icon: "close", disabled: none || busy !== null, onSelect: () => setSelected(new Map()) },
    { label: "Remove from library", icon: "close", disabled: none || busy !== null, onSelect: () => setAsking("remove") },
    { label: "Delete", icon: "trash", danger: true, disabled: none || busy !== null, onSelect: () => setAsking("delete") },
  ];

  /** Removes downloads, removes from the library, or deletes, one book at a time. */
  const changeChosen = async (what: "remove" | "delete" | "download") => {
    setAsking(null);
    const list = what === "download" ? chosen.filter((b) => b.availability === "local" && b.inCloud) : chosen;
    const verb = { remove: "Removing", delete: "Deleting", download: "Removing downloads" }[what];
    const work = { remove: api.removeFromLibrary, delete: api.deleteBook, download: api.removeDownload }[what];
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      setBusy(`${verb}: ${i + 1} of ${list.length}…`);
      try {
        await work(list[i].id);
      } catch {
        failed++;
      }
    }
    setBusy(null);
    if (what !== "download") setSelected(new Map());
    setReload((n) => n + 1);
    const done = list.length - failed;
    const count = (n: number) => (n === 1 ? `1 ${words.one}` : `${n} ${words.many}`);
    const skipped = chosen.length - list.length;
    toast(
      what === "download"
        ? `Removed the downloads of ${count(done)}. They're still in the cloud.` +
            (skipped ? ` ${count(skipped)} ${skipped === 1 ? "isn't" : "aren't"} in the cloud yet, so ${skipped === 1 ? "it was" : "they were"} kept here.` : "")
        : failed
          ? `${what === "remove" ? "Removed" : "Deleted"} ${done} of ${list.length}. ${failed} couldn't be changed.`
          : `${what === "remove" ? "Removed" : "Deleted"} ${count(done)}.`,
    );
  };

  const saveChosen = async () => {
    try {
      setBusy("Saving copies…");
      const done = await api.saveCopies(chosen.map((b) => b.id));
      if (done) toast(`Saved ${done.saved === 1 ? "a copy" : `${done.saved} copies`} to ${done.folder}.`);
    } catch (e) {
      toast(`Couldn't save the copies: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  let body: React.ReactNode;
  if (load.state === "error") {
    body = (
      <div className="library-empty" role="alert">
        <h2>Your {kind === "documents" ? "documents" : "library"} couldn't be loaded</h2>
        <p className="muted">{load.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => setReload((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  } else if (view.tab === "collections") {
    body = <CollectionsTab collections={collections} onOpenCollection={onOpenCollection} />;
  } else if (!page) {
    body = <div className="library-loading" aria-busy="true" aria-label="Loading your library" />;
  } else if (page.counts.all === 0) {
    body = (
      <div className="library-empty">
        <h2>No {words.many} yet</h2>
        <p className="muted">
          {kind === "documents"
            ? "PDF, Word and text files you import show up here, apart from your books. TBV keeps its own copy and never changes your files."
            : "Import the books you already have. TBV keeps its own copy and never changes your files."}
        </p>
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={onImportBooks}>
            <Icon name="importFile" size={16} /> Import {words.many}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onImportFolder}>
            <Icon name="folder" size={16} /> Import a folder
          </button>
        </div>
      </div>
    );
  } else if (page.total === 0) {
    body = (
      <div className="library-empty">
        <h2>Nothing matches</h2>
        <p className="muted">
          {search.trim() ? `No ${words.many} on this shelf match “${search.trim()}”.` : `No ${words.many} on this shelf yet.`}
          {filtered && " Filters are also narrowing the list."}
        </p>
        <div className="hero-actions">
          {search.trim() && (
            <button type="button" className="btn btn-quiet" onClick={onClearSearch}>
              Clear search
            </button>
          )}
          {filtered && (
            <button type="button" className="btn btn-quiet" onClick={() => onChange(NO_FILTERS)}>
              Clear filters
            </button>
          )}
          {view.tab !== "all" && (
            <button type="button" className="btn btn-quiet" onClick={() => onChange({ tab: "all" })}>
              Show all {words.many}
            </button>
          )}
        </div>
      </div>
    );
  } else {
    // The phone has no list view, for now.
    const Layout = { grid: BookGrid, list: endless ? BookGrid : BookList, compact: BookTable }[view.layout];
    body = endless ? (
      <>
        <Layout books={page.books} actions={actions} selection={selection} />
        <div ref={end} className="library-end muted num">
          {hasMore ? <span className="library-more" aria-busy="true" aria-label={`Loading more ${words.many}`} /> : `${page.total.toLocaleString()} ${page.total === 1 ? words.one : words.many}`}
        </div>
      </>
    ) : (
      <>
        <Pagination top page={page.page} pageSize={page.pageSize} total={page.total} onPage={(p) => onChange({ page: p })} />
        <Layout books={page.books} actions={actions} selection={selection} />
        <Pagination noun={[words.one, words.many]} page={page.page} pageSize={page.pageSize} total={page.total} onPage={(p) => onChange({ page: p })} />
      </>
    );
  }

  return (
    <div className="library">
      <header className="library-head">
        <div>
          <h1 className="library-title">{words.title}</h1>
          <p className="eyebrow">{words.eyebrow}</p>
        </div>
        {counts && (
          <div className="stats stats-5 library-stats">
            <Stat value={counts.all} label={words.total} />
            <Stat value={counts.read} label="Read" />
            <Stat value={counts.inProgress} label="In progress" />
            <Stat value={counts.unread} label="Unread" />
            {/* The Audiobooks page has its panel beside it, so listening time takes the collections' place. */}
            {kind !== "audiobooks" && <Stat value={counts.collections} label="Collections" />}
            {spent && (kind === "audiobooks" ? <Stat value={<Spent seconds={spent.listen} />} label="Listened" /> : <Stat value={<Spent seconds={spent.read} />} label="Time read" />)}
          </div>
        )}
      </header>

      {isWeb && (
        <div className="segmented library-reach" role="radiogroup" aria-label="Which books to show">
          {[
            { on: false, label: "Full library" },
            { on: true, label: "Available to download" },
          ].map(({ on, label }) => (
            <button key={label} type="button" role="radio" aria-checked={view.downloadable === on} onClick={() => onChange({ downloadable: on, page: 0 })}>
              {label}
            </button>
          ))}
        </div>
      )}

      <LibraryToolbar
        view={view}
        counts={counts}
        formats={page?.formats ?? []}
        tags={page?.tags ?? []}
        genres={page?.genres ?? []}
        languages={page?.languages ?? []}
        authors={page?.authors ?? undefined}
        narrators={page?.narrators ?? undefined}
        allLabel={kind === "books" ? undefined : `All ${words.many}`}
        selecting={selected !== null}
        onSelecting={(on) => setSelected(on ? new Map() : null)}
        onChange={onChange}
      />

      {selected && view.tab !== "collections" && (
        <div className="select-bar" role="toolbar" aria-label={`Change many ${words.many}`}>
          <span className="select-count">
            {selected.size ? `${selected.size} chosen` : `Click ${words.many} to choose them`}
          </span>
          {busy && <span className="select-count">{busy}</span>}
          <span className="select-actions">
            <Menu
              label={`Do something with the chosen ${words.many}`}
              className="btn btn-quiet"
              align="start"
              trigger={
                <>
                  Actions <Icon name="chevronDown" size={13} />
                </>
              }
              items={chosenActions}
            />
            {/* The phone has no pages, so only "All in library" there. */}
            {!endless && (
              <label className="select-all">
                <input
                  type="checkbox"
                  checked={pageAllChosen}
                  disabled={!page?.books.length || busy !== null}
                  onChange={(e) => {
                    if (!page) return;
                    const next = new Map(selected);
                    page.books.forEach((b) => (e.target.checked ? next.set(b.id, b) : next.delete(b.id)));
                    setSelected(next);
                  }}
                />
                All on page
              </label>
            )}
            <label className="select-all">
              <input
                type="checkbox"
                checked={libraryAllChosen}
                disabled={!page?.total || busy !== null}
                onChange={(e) => (e.target.checked ? void chooseAll() : setSelected(new Map()))}
              />
              All in library
            </label>
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => setSelected(null)}>
              Done
            </button>
          </span>
        </div>
      )}
      {asking && (
        <ConfirmDialog
          title={
            {
              download: `Remove the downloads of ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`}?`,
              remove: `Remove ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`} from your library?`,
              delete: `Delete ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`} for good?`,
            }[asking]
          }
          body={
            asking === "download"
              ? "This frees up space on this device. The books stay in your library and in the cloud, and download again when you open them. Books that aren't in the cloud yet are kept here."
              : (asking === "remove" ? removeWarning : deleteWarning)(chosen.length > 1)
          }
          confirm={{ download: "Remove downloads", remove: "Remove from library", delete: "Delete for good" }[asking]}
          danger={asking !== "download"}
          onCancel={() => setAsking(null)}
          onConfirm={() => void changeChosen(asking)}
        />
      )}
      {tagging && (
        <TagsDialog
          books={chosen}
          onClose={(changed) => {
            setTagging(false);
            if (changed) setReload((n) => n + 1);
          }}
        />
      )}

      {search.trim() && view.tab !== "collections" && (
        <p className="search-note">
          Showing results for “{search.trim()}”
          <button type="button" className="view-all" onClick={onClearSearch}>
            Clear
          </button>
        </p>
      )}

      {view.tab !== "collections" && intro}

      {!isWeb && !isHome && view.tab !== "collections" && view.series.length === 1 && (
        <SeriesPanel
          name={view.series[0]}
          author={page?.books[0]?.authors[0] ?? ""}
          refreshKey={refreshKey + reload}
          onChanged={() => setReload((n) => n + 1)}
        />
      )}

      <div className="library-body">{body}</div>
    </div>
  );
}

const KNOWN_LISTS = ["formats", "tags", "genres", "languages"] as const;

/** The filters to keep when some of `view`'s names aren't in the library any more, or null when all are. */
export function gone(view: LibraryView, page: Pick<LibraryPage, (typeof KNOWN_LISTS)[number]>): Partial<LibraryView> | null {
  const change: Partial<LibraryView> = {};
  const exclude = { ...view.exclude };
  let changed = false;
  for (const list of KNOWN_LISTS) {
    const known = new Set(page[list].map((n) => n.toLowerCase()));
    const keep = (names: string[]) => names.filter((n) => known.has(n.toLowerCase()));
    const shown = keep(view[list]);
    const hidden = keep(view.exclude[list]);
    if (shown.length !== view[list].length) change[list] = shown;
    if (hidden.length !== view.exclude[list].length) exclude[list] = hidden;
    changed ||= shown.length !== view[list].length || hidden.length !== view.exclude[list].length;
  }
  if (!changed) return null;
  return { ...change, exclude, page: 0 };
}
