import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { CollectionPreview, LibraryPage } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { makeBookActions } from "../home/bookActions";
import { Stat } from "../home/ReadingActivity";
import { BookGrid, BookList, BookTable } from "./BookViews";
import { CollectionsTab } from "./CollectionsTab";
import { LibraryToolbar } from "./LibraryToolbar";
import { PAGE_SIZE, type LibraryView } from "./libraryView";
import { Pagination } from "./Pagination";

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

export function Library({
  view,
  search,
  refreshKey,
  onChange,
  onClearSearch,
  onImportBooks,
  onImportFolder,
  onOpenBook,
}: {
  view: LibraryView;
  search: string;
  refreshKey: number;
  onChange: (change: Partial<LibraryView>) => void;
  onClearSearch: () => void;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const [load, setLoad] = useState<Load<LibraryPage>>({ state: "loading" });
  const [collections, setCollections] = useState<CollectionPreview[] | null>(null);
  const [reload, setReload] = useState(0);
  const toast = useToast();
  const actions = useMemo(
    () => makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook),
    [toast, onOpenBook],
  );

  const shelf = view.tab === "collections" ? "all" : view.tab;
  useEffect(() => {
    let current = true;
    api
      .getLibrary({
        shelf,
        sort: view.sort,
        search: search.trim() || null,
        formats: view.formats,
        location: view.location,
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
  }, [shelf, view.sort, view.formats, view.location, view.page, search, refreshKey, reload]);

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

  // A new page starts at the top, like turning a page.
  useEffect(() => {
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }, [view.page]);

  const page = load.state === "ready" ? load.data : null;
  const counts = page?.counts ?? null;
  const filtered = view.formats.length > 0 || view.location !== null;

  let body: React.ReactNode;
  if (load.state === "error") {
    body = (
      <div className="library-empty" role="alert">
        <h2>Your library couldn't be loaded</h2>
        <p className="muted">{load.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => setReload((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  } else if (view.tab === "collections") {
    body = <CollectionsTab collections={collections} />;
  } else if (!page) {
    body = <div className="library-loading" aria-busy="true" aria-label="Loading your library" />;
  } else if (page.counts.all === 0) {
    body = (
      <div className="library-empty">
        <h2>No books yet</h2>
        <p className="muted">Import the books you already have. TBV keeps its own copy and never changes your files.</p>
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={onImportBooks}>
            <Icon name="importFile" size={16} /> Import books
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
          {search.trim() ? `No books on this shelf match “${search.trim()}”.` : "No books on this shelf yet."}
          {filtered && " Filters are also narrowing the list."}
        </p>
        <div className="hero-actions">
          {search.trim() && (
            <button type="button" className="btn btn-quiet" onClick={onClearSearch}>
              Clear search
            </button>
          )}
          {filtered && (
            <button type="button" className="btn btn-quiet" onClick={() => onChange({ formats: [], location: null })}>
              Clear filters
            </button>
          )}
          {view.tab !== "all" && (
            <button type="button" className="btn btn-quiet" onClick={() => onChange({ tab: "all" })}>
              Show all books
            </button>
          )}
        </div>
      </div>
    );
  } else {
    const Layout = { grid: BookGrid, list: BookList, compact: BookTable }[view.layout];
    body = (
      <>
        <Layout books={page.books} actions={actions} />
        <Pagination page={page.page} pageSize={page.pageSize} total={page.total} onPage={(p) => onChange({ page: p })} />
      </>
    );
  }

  return (
    <div className="library">
      <header className="library-head">
        <div>
          <h1 className="library-title">Library</h1>
          <p className="eyebrow">Your personal archive</p>
        </div>
        {counts && (
          <div className="stats stats-5 library-stats">
            <Stat value={counts.all} label="Total books" />
            <Stat value={counts.read} label="Read" />
            <Stat value={counts.inProgress} label="In progress" />
            <Stat value={counts.unread} label="Unread" />
            <Stat value={counts.collections} label="Collections" />
          </div>
        )}
      </header>

      <LibraryToolbar view={view} counts={counts} formats={page?.formats ?? []} onChange={onChange} />

      {search.trim() && view.tab !== "collections" && (
        <p className="search-note">
          Showing results for “{search.trim()}”
          <button type="button" className="view-all" onClick={onClearSearch}>
            Clear
          </button>
        </p>
      )}

      <div className="library-body">{body}</div>
    </div>
  );
}
