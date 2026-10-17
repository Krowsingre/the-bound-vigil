import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { BookPreview, CollectionPreview, ItemKind, LibraryPage } from "../api/types";
import { askEditDetails } from "../details/openDetails";
import { askSendToEreader } from "../ereaders/SendToEreader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { makeBookActions } from "../home/bookActions";
import { Stat } from "../home/ReadingActivity";
import { AddTagToMany } from "./BookDialogs";
import { BookGrid, BookList, BookTable, type Selection } from "./BookViews";
import { CollectionsTab } from "./CollectionsTab";
import { LibraryToolbar } from "./LibraryToolbar";
import { PAGE_SIZE, type LibraryView } from "./libraryView";
import { Pagination } from "./Pagination";

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

const WORDS = {
  books: { title: "Library", eyebrow: "Your personal archive", one: "book", many: "books", total: "Total books" },
  documents: { title: "Documents", eyebrow: "PDF, Word and text files", one: "document", many: "documents", total: "Total documents" },
  audiobooks: { title: "Audiobooks", eyebrow: "Your listening shelf", one: "audiobook", many: "audiobooks", total: "Total audiobooks" },
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
  const [collections, setCollections] = useState<CollectionPreview[] | null>(null);
  const [reload, setReload] = useState(0);
  // Choosing books to change many at once.
  const [selected, setSelected] = useState<Map<string, BookPreview> | null>(null);
  const [tagging, setTagging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const words = WORDS[kind];
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
    authors: view.authors,
    narrators: view.narrators,
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
        authors: view.authors,
        narrators: view.narrators,
        kind,
        page: view.page,
        pageSize: PAGE_SIZE,
      })
      .then(
        (data) => current && setLoad({ state: "ready", data }),
        (e: unknown) => current && setLoad({ state: "error", message: String(e) }),
      );
    return () => {
      current = false;
    };
  }, [kind, shelf, view.sort, view.formats, view.location, view.tags, view.genres, view.authors, view.narrators, view.page, search, refreshKey, reload]);

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

  // A new page starts at the top, like turning a page.
  useEffect(() => {
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }, [view.page]);

  const page = load.state === "ready" ? load.data : null;
  const counts = page?.counts ?? null;
  const filtered =
    view.formats.length > 0 || view.location !== null || view.tags.length > 0 || view.genres.length > 0 || view.authors.length > 0 || view.narrators.length > 0;
  const selection: Selection | null = selected && {
    has: (id) => selected.has(id),
    toggle: (book) =>
      setSelected((s) => {
        const next = new Map(s);
        if (next.has(book.id)) next.delete(book.id);
        else next.set(book.id, book);
        return next;
      }),
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

  const removeChosen = async () => {
    setRemoving(false);
    const list = chosen;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      setBusy(`Removing ${i + 1} of ${list.length}…`);
      try {
        await api.deleteBook(list[i].id);
      } catch {
        failed++;
      }
    }
    setBusy(null);
    setSelected(new Map());
    setReload((n) => n + 1);
    const done = list.length - failed;
    toast(
      failed
        ? `Removed ${done} of ${list.length} ${words.many}. ${failed} couldn't be removed.`
        : `Removed ${done === 1 ? `1 ${words.one}` : `${done} ${words.many}`} from your library.`,
    );
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
            <button type="button" className="btn btn-quiet" onClick={() => onChange({ formats: [], location: null, tags: [], genres: [], authors: [], narrators: [] })}>
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
    const Layout = { grid: BookGrid, list: BookList, compact: BookTable }[view.layout];
    body = (
      <>
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
            <Stat value={counts.collections} label="Collections" />
          </div>
        )}
      </header>

      <LibraryToolbar
        view={view}
        counts={counts}
        formats={page?.formats ?? []}
        tags={page?.tags ?? []}
        genres={page?.genres ?? []}
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
          {page && page.books.some((b) => !selected.has(b.id)) && (
            <button type="button" className="view-all" onClick={() => setSelected(new Map([...selected, ...page.books.map((b) => [b.id, b] as const)]))}>
              Choose all on this page
            </button>
          )}
          {page && page.total > page.books.length && selected.size < page.total && (
            <button type="button" className="view-all" disabled={busy !== null} onClick={() => void chooseAll()}>
              Choose all {page.total}
            </button>
          )}
          {selected.size > 0 && (
            <button type="button" className="view-all" disabled={busy !== null} onClick={() => setSelected(new Map())}>
              Clear
            </button>
          )}
          {busy && <span className="select-count">{busy}</span>}
          <span className="select-actions">
            <button type="button" className="btn btn-quiet" disabled={!selected.size} onClick={() => askEditDetails(chosen)}>
              <Icon name="edit" size={16} /> Edit details
            </button>
            <button type="button" className="btn btn-quiet" disabled={!selected.size} onClick={() => setTagging(true)}>
              <Icon name="tag" size={16} /> Add a tag
            </button>
            {kind !== "audiobooks" && (
              <button type="button" className="btn btn-quiet" disabled={!selected.size} onClick={() => askSendToEreader(chosen)}>
                <Icon name="ereader" size={16} /> Send to e-reader
              </button>
            )}
            <button
              type="button"
              className="btn btn-quiet btn-danger-text"
              disabled={!selected.size || busy !== null}
              onClick={() => setRemoving(true)}
            >
              <Icon name="trash" size={16} /> Remove from library
            </button>
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => setSelected(null)}>
              Done
            </button>
          </span>
        </div>
      )}
      {removing && (
        <ConfirmDialog
          title={chosen.length === 1 ? `Remove “${chosen[0].title}”?` : `Remove ${chosen.length} ${words.many}?`}
          body={
            `This takes ${chosen.length === 1 ? "it" : "them"} out of your library on every device, with highlights and notes. ` +
            "Book files you imported from a folder of your own stay where they are."
          }
          confirm={chosen.length === 1 ? `Remove ${words.one}` : `Remove ${chosen.length} ${words.many}`}
          danger
          onCancel={() => setRemoving(false)}
          onConfirm={() => void removeChosen()}
        />
      )}
      {tagging && (
        <AddTagToMany
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

      <div className="library-body">{body}</div>
    </div>
  );
}
