import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { HomeViewModel, SmartKind } from "../api/types";
import { startupStep } from "../splash/startup";
import { useToast } from "../components/Toast";
import { Icon } from "../components/Icon";
import { greeting } from "../lib/format";
import type { LibraryView } from "../library/libraryView";
import type { Route } from "../shell/routes";
import { useNarrow } from "../lib/useNarrow";
import { makeBookActions } from "./bookActions";
import { CompendiumRow } from "./CompendiumRow";
import { InProgress } from "./InProgress";
import { ReadingActivity } from "./ReadingActivity";
import { RecentlyAdded } from "./RecentlyAdded";
import { QuickLinks } from "./QuickLinks";
import { ResumeHero } from "./ResumeHero";
import { SuggestedReading } from "./SuggestedReading";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; home: HomeViewModel };

export function Home({
  refreshKey,
  onNavigate,
  onOpenLibrary,
  onImportBooks,
  onImportFolder,
  onLoaded,
  onOpenBook,
  onOpenCompendium,
  onOpenCollection,
}: {
  refreshKey: number;
  onNavigate: (route: Route) => void;
  onOpenLibrary: (view?: Partial<LibraryView>) => void;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onLoaded?: (home: HomeViewModel) => void;
  onOpenBook: (bookId: string) => void;
  /** Opens one of the smart compendiums, for "View all". */
  onOpenCompendium: (kind: SmartKind) => void;
  /** Opens one of your collections. */
  onOpenCollection: (id: string) => void;
}) {
  const narrow = useNarrow();
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

  // The first screen is drawn: the splash can go once covers and fonts are in.
  useEffect(() => {
    if (load.state === "loading") return;
    startupStep("library");
    startupStep("sanctum");
  }, [load.state]);

  const actions = makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook);
  const openLibrary = useCallback(() => onOpenLibrary({ tab: "all" }), [onOpenLibrary]);

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
            <button type="button" className="btn btn-quiet btn-large" onClick={() => onNavigate("sync")}>
              <Icon name="link" size={16} /> Join an existing library
            </button>
          </div>
          <p className="muted welcome-hint">You can also drag book files anywhere into this window. EPUB, PDF, Kindle (MOBI, AZW3), comics (CBZ), FB2, TXT and Word (DOCX, DOC) are accepted.</p>
        </section>
      </div>
    );
  }

  // On a computer: cards in three rows, as in embre's picture. A phone keeps its own layout.
  if (!narrow)
    return (
      <div className="home home-desk">
        <ResumeHero book={home.resumeBook} actions={actions} onOpenLibrary={openLibrary} />
        <ReadingActivity finished={home.libraryCounts.read} finishedDates={home.finishedDates} refreshKey={refreshKey} wide />
        <RecentlyAdded books={home.recentlyAdded} actions={actions} onViewAll={() => onOpenCompendium("recently_added")} menus />
        <InProgress books={home.inProgress} actions={actions} onViewAll={() => onOpenCompendium("in_progress")} list />
        <QuickLinks refreshKey={refreshKey} onNavigate={onNavigate} onOpenBook={onOpenBook} onOpenCollection={onOpenCollection} />
        <SuggestedReading shelves={home.suggested ?? []} readAuthors={home.readAuthors ?? []} actions={actions} onNavigate={onNavigate} />
        <CompendiumRow refreshKey={refreshKey} onOpenCollection={onOpenCollection} onOpenCompendium={onOpenCompendium} onViewAll={() => onNavigate("collections")} />
      </div>
    );

  return (
    <div className="home">
      <div className="home-top">
        <ResumeHero book={home.resumeBook} actions={actions} onOpenLibrary={openLibrary} />
        <ReadingActivity finished={home.libraryCounts.read} finishedDates={home.finishedDates} refreshKey={refreshKey} />
      </div>
      <div className="home-middle">
        <InProgress books={home.inProgress} actions={actions} onViewAll={() => onOpenCompendium("in_progress")} />
        <RecentlyAdded
          books={home.recentlyAdded}
          actions={actions}
          onViewAll={() => onOpenCompendium("recently_added")}
        />
      </div>
    </div>
  );
}
