import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview, HomeViewModel } from "../api/types";
import { useToast } from "../components/Toast";
import { Icon } from "../components/Icon";
import { greeting } from "../lib/format";
import type { Route } from "../shell/routes";
import { openMessage, type BookActions } from "./bookActions";
import { CollectionsPreview } from "./CollectionsPreview";
import { InProgress } from "./InProgress";
import { LibrarySnapshot } from "./LibrarySnapshot";
import { NotesPreview } from "./NotesPreview";
import { ReadingActivity } from "./ReadingActivity";
import { RecentlyAdded } from "./RecentlyAdded";
import { ResumeHero } from "./ResumeHero";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; home: HomeViewModel };

export function Home({
  refreshKey,
  onNavigate,
  onImportBooks,
  onImportFolder,
  onLoaded,
}: {
  refreshKey: number;
  onNavigate: (route: Route) => void;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onLoaded?: (home: HomeViewModel) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let current = true;
    api.getHome().then(
      (home) => {
        if (!current) return;
        setLoad({ state: "ready", home });
        onLoaded?.(home);
      },
      (e: unknown) => current && setLoad({ state: "error", message: String(e) }),
    );
    return () => {
      current = false;
    };
  }, [refreshKey, reload, onLoaded]);

  const actions: BookActions = {
    open: (book: BookPreview) => toast(openMessage(book)),
    setStatus: (book, status) =>
      api.setBookStatus(book.id, status).then(
        () => setReload((n) => n + 1),
        (e: unknown) => toast(`Couldn't update “${book.title}”: ${String(e)}`),
      ),
  };
  const openLibrary = useCallback(() => onNavigate("library"), [onNavigate]);

  if (load.state === "loading") return <div className="home home-loading" aria-busy="true" aria-label="Loading your library" />;
  if (load.state === "error")
    return (
      <div className="home home-error" role="alert">
        <h1>Your library couldn't be loaded</h1>
        <p className="muted">{load.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => setReload((n) => n + 1)}>
          Try again
        </button>
      </div>
    );

  const { home } = load;
  if (home.libraryCounts.total === 0) {
    return (
      <div className="home">
        <section className="welcome" aria-labelledby="welcome-title">
          <p className="eyebrow">{greeting()}</p>
          <h1 id="welcome-title" className="hero-title">
            Your library is empty
          </h1>
          <p className="hero-synopsis">
            Add books you already have. TBV keeps its own copy in its library folder and never changes your original files.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-large" onClick={onImportBooks}>
              <Icon name="importFile" size={16} /> Import books
            </button>
            <button type="button" className="btn btn-quiet btn-large" onClick={onImportFolder}>
              <Icon name="folder" size={16} /> Import a folder
            </button>
            <button type="button" className="btn btn-quiet btn-large" disabled title="Arrives with sync">
              <Icon name="link" size={16} /> Join an existing library
            </button>
          </div>
          <p className="muted welcome-hint">You can also drag book files anywhere into this window. EPUB, PDF, MOBI, AZW3, CBZ and FB2 are accepted.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="home">
      <div className="home-top">
        <ResumeHero book={home.resumeBook} actions={actions} onOpenLibrary={openLibrary} />
        <ReadingActivity activity={home.activity} />
      </div>
      <div className="home-middle">
        <RecentlyAdded books={home.recentlyAdded} actions={actions} onViewAll={openLibrary} />
        <InProgress books={home.inProgress} actions={actions} onViewAll={openLibrary} />
      </div>
      <div className="home-bottom">
        <CollectionsPreview collections={home.collections} onViewAll={() => onNavigate("collections")} />
        <NotesPreview notes={home.annotations} onViewAll={() => onNavigate("notes")} />
        <LibrarySnapshot counts={home.libraryCounts} onOpenLibrary={openLibrary} />
      </div>
    </div>
  );
}
