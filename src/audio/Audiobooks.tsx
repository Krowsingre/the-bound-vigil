// The Audiobooks page: every audiobook (searched, filtered
// by genre, author, narrator and status), and a panel for the one chosen, with
// its chapters, details, files and collections.

import { authorName } from "../lib/authorNames";
import { useCallback, useEffect, useState } from "react";
import { api, isServerBook } from "../api";
import type { AudioType, Audiobook, BookDetails, BookPreview } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { showBookDetails } from "../details/openDetails";
import { useToast } from "../components/Toast";
import { Library } from "../library/Library";
import type { LibraryView } from "../library/libraryView";
import { formatLength } from "../lib/queryBooks";
import { formatBytes } from "../settings/controls";
import { LinkEbook } from "./LinkEbook";
import { useNarrow } from "../lib/useNarrow";
import { chapterAt, chapterLength, clock, onCue, usePlayer } from "./player";

type PanelTab = "chapters" | "details" | "files" | "collections";
const PANEL_TABS: { tab: PanelTab; label: string }[] = [
  { tab: "chapters", label: "Chapters" },
  { tab: "details", label: "Details" },
  { tab: "files", label: "Files" },
  { tab: "collections", label: "Collections" },
];

const AUDIO_VIEWS: { type: AudioType; label: string }[] = [
  { type: "audiobook", label: "Audiobooks" },
  { type: "podcast", label: "Podcasts" },
  { type: "music", label: "Music" },
  // Audio that says nothing about what it is (embre, 19 November).
  { type: "other", label: "Other" },
];

type Pairing = "all" | "paired" | "alone";
const PAIRING_KEY = "tbv.audiobooks.pairing";

function readPairing(): Pairing {
  try {
    const saved = localStorage.getItem(PAIRING_KEY);
    return saved === "paired" || saved === "alone" ? saved : "all";
  } catch {
    return "all";
  }
}

export function Audiobooks({
  view,
  search,
  refreshKey,
  onChange,
  onClearSearch,
  onImportBooks,
  onImportFolder,
  onOpenCollection,
  onReadAlong,
  onOpenSeries,
  seriesBack,
  onShowAllSeries,
  restoreScroll,
  onScrollRestored,
}: {
  view: LibraryView;
  search: string;
  refreshKey: number;
  onChange: (change: Partial<LibraryView>) => void;
  onClearSearch: () => void;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenCollection: (id: string) => void;
  /** Opens the linked ebook to read along with the audiobook. */
  onReadAlong: (ebookId: string) => void;
  onOpenSeries?: (name: string) => void;
  seriesBack?: () => void;
  onShowAllSeries?: () => void;
  restoreScroll?: number | null;
  onScrollRestored?: () => void;
}) {
  const player = usePlayer();
  const [chosen, setChosen] = useState<string | null>(null);
  // Resonance's switch: every audiobook, the ones paired with their ebook, or the ones on their own.
  const [pairing, setPairing] = useState(readPairing);
  const choosePairing = (next: Pairing) => {
    setPairing(next);
    onChange({ page: 0 });
    try {
      localStorage.setItem(PAIRING_KEY, next);
    } catch {
      // Remembered until TBV closes.
    }
  };
  const [listening, setListening] = useState<BookPreview[] | null>(null);
  const [reload, setReload] = useState(0);
  // Bumped when the list changes something, such as an item's type, so the tab counts are read again.
  const [libraryChanges, setLibraryChanges] = useState(0);
  // Resonance always shows one kind of audio, Audiobooks to start (embre, 20 November).
  const audioType: AudioType = view.audioType ?? "audiobook";
  useEffect(() => {
    if (!view.audioType && !seriesBack) onChange({ audioType: "audiobook", page: view.page });
  }, [view.audioType, seriesBack]); // eslint-disable-line react-hooks/exhaustive-deps
  // How many items each kind has: a kind with none is greyed out.
  const [typeCounts, setTypeCounts] = useState<Record<AudioType, number> | null>(null);
  useEffect(() => {
    let current = true;
    void Promise.all(
      AUDIO_VIEWS.map(({ type }) =>
        api.getLibrary({ kind: "audiobooks", shelf: "all", sort: "recently_added", search: null, formats: [], location: null, audioType: type, page: 0, pageSize: 1, omitFacets: true })
          .then((page) => [type, page.total] as const),
      ),
    ).then(
      (pairs) => current && setTypeCounts(Object.fromEntries(pairs) as Record<AudioType, number>),
      () => current && setTypeCounts(null),
    );
    return () => {
      current = false;
    };
  }, [refreshKey, reload, libraryChanges]);
  // Opening on a kind with nothing in it moves to the first kind that has something.
  useEffect(() => {
    if (!typeCounts || seriesBack || typeCounts[audioType] > 0) return;
    const first = AUDIO_VIEWS.find(({ type }) => typeCounts[type] > 0);
    if (first) onChange({ audioType: first.type, page: 0 });
  }, [typeCounts]); // eslint-disable-line react-hooks/exhaustive-deps
  // The item last listened to on this tab, finished or not: it leads the list and fills the side bar.
  useEffect(() => {
    let current = true;
    api
      .getLibrary({
        kind: "audiobooks",
        shelf: "all",
        sort: "recently_opened",
        paired: pairing === "all" ? null : pairing === "paired",
        search: null,
        formats: [],
        location: view.location,
        audioType,
        page: 0,
        pageSize: 1,
        omitFacets: true,
      })
      .then(
        (page) => current && setListening(page.books.filter((b) => b.lastOpenedAt)),
        () => current && setListening([]),
      );
    return () => {
      current = false;
    };
  }, [refreshKey, reload, player.playing, pairing, view.location, audioType]);

  // The side bar is always there (embre, 20 November): the item chosen, else the one playing
  // (if it's on this tab and in the library, not played from a server), else the last listened
  // to, else the first in the list.
  const [firstShown, setFirstShown] = useState<string | null>(null);
  const playingHere = player.book && !isServerBook(player.book.book.id) && (player.book.book.audioType ?? "audiobook") === audioType ? player.book.book.id : null;
  const lastListened = listening?.[0] ?? null;
  const shown = chosen ?? playingHere ?? lastListened?.id ?? firstShown ?? null;
  // A new tab starts from its own last listened item.
  useEffect(() => setChosen(null), [audioType]);

  // Tapping a cover shows the audiobook in the panel (and the player bar);
  // playing stays on the Listen and Play buttons. On a phone the panel opens
  // as a sheet over the list; where it sits below the list, it scrolls into view.
  const narrow = useNarrow();
  const [sheet, setSheet] = useState(false);
  const choose = useCallback(
    (id: string) => {
      setChosen(id);
      if (narrow) setSheet(true);
      else if (window.matchMedia?.("(max-width: 1180px)").matches) {
        requestAnimationFrame(() => document.querySelector(".audio-panel")?.scrollIntoView({ block: "start", behavior: "smooth" }));
      }
    },
    [narrow],
  );
  useEffect(() => onCue(choose), [choose]);

  return (
    <div className="audiobooks">
      <div className="audiobooks-main">
        <Library
          kind="audiobooks"
          onOpenSeries={onOpenSeries}
          seriesBack={seriesBack}
          onShowAllSeries={onShowAllSeries}
          restoreScroll={restoreScroll}
          onScrollRestored={onScrollRestored}
          paired={(seriesBack && !onShowAllSeries) || pairing === "all" ? null : pairing === "paired"}
          onPairing={(value) => choosePairing(value === null ? "all" : value ? "paired" : "alone")}
          switcher={!seriesBack && (
            <div className="segmented page-switch" role="group" aria-label="Audio type">
              {AUDIO_VIEWS.map(({ type, label }) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={audioType === type}
                  // A kind with nothing in it can't be opened.
                  disabled={audioType !== type && typeCounts !== null && typeCounts[type] === 0}
                  title={audioType !== type && typeCounts?.[type] === 0 ? `No ${label.toLowerCase()} yet` : undefined}
                  onClick={() => audioType !== type && onChange({ audioType: type, page: 0 })}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          view={view}
          search={search}
          refreshKey={refreshKey + reload}
          onChange={onChange}
          onClearSearch={onClearSearch}
          onImportBooks={onImportBooks}
          onImportFolder={onImportFolder}
          onOpenBook={choose}
          onLibraryChanged={() => setLibraryChanges((n) => n + 1)}
          lead={lastListened}
          onFirstShown={setFirstShown}
          onOpenCollection={onOpenCollection}
        />
      </div>
      {shown && (!narrow || sheet) && (
        <>
          {narrow && <div className="audio-sheet-backdrop" aria-hidden onClick={() => setSheet(false)} />}
          <AudiobookPanel
            key={shown}
            bookId={shown}
            refreshKey={refreshKey + reload}
            onOpenCollection={onOpenCollection}
            onReadAlong={onReadAlong}
            onChanged={() => setReload((n) => n + 1)}
            onClose={narrow ? () => setSheet(false) : undefined}
          />
        </>
      )}
    </div>
  );
}

function AudiobookPanel({
  bookId,
  refreshKey,
  onOpenCollection,
  onReadAlong,
  onChanged,
  onClose,
}: {
  bookId: string;
  refreshKey: number;
  onOpenCollection: (id: string) => void;
  onReadAlong: (ebookId: string) => void;
  onChanged: () => void;
  /** On a phone, where the panel is a sheet: closes it. */
  onClose?: () => void;
}) {
  const player = usePlayer();
  const [book, setBook] = useState<Audiobook | null>(null);
  const [details, setDetails] = useState<BookDetails | null>(null);
  const [tab, setTab] = useState<PanelTab>("chapters");
  const [linking, setLinking] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let current = true;
    api.audiobook(bookId).then(
      (b) => current && setBook(b),
      () => current && setBook(null),
    );
    api.bookDetails(bookId).then(
      (d) => current && setDetails(d),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [bookId, refreshKey]);

  if (!book) return <aside className={`audio-panel${onClose ? " is-sheet" : ""}`} aria-busy="true" />;

  const playing = player.book?.book.id === bookId;
  const at = playing ? player.positionMs : book.positionMs;
  const current = chapterAt(book.chapters, at);
  const next = book.chapters[current + 1];
  const b = book.book;
  const started = at > 0 && at < book.durationMs - 1000;

  return (
    <aside className={`audio-panel${onClose ? " is-sheet" : ""}`} aria-label={`About ${b.title}`}>
      {onClose && (
        <button type="button" className="icon-btn audio-sheet-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      )}
      <div className="audio-panel-head">
        <BookCover book={b} size="l" />
        <div className="audio-panel-title">
          <h2>{b.title}</h2>
          <p>{b.authors.map((a) => authorName(a, b.audioType)).join(", ") || "Unknown author"}</p>
          {book.narrators.length > 0 && <p className="muted">Narrated by {book.narrators.join(", ")}</p>}
          {b.genres.length > 0 && (
            <div className="details-chips">
              {b.genres.slice(0, 3).map((g) => (
                <span key={g} className="tag-chip">
                  {g}
                </span>
              ))}
            </div>
          )}
          <div className="audio-panel-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => (playing ? player.toggle() : void player.load(bookId))}
            >
              <Icon name={playing && player.playing ? "pause" : "play"} size={16} />{" "}
              {playing && player.playing ? "Pause" : started ? "Resume" : b.status === "read" ? "Listen again" : "Listen"}
            </button>
            {book.ebook && (
              <button
                type="button"
                className="btn btn-quiet"
                title={`Read ${book.ebook.name} as you listen`}
                onClick={() => onReadAlong(book.ebook!.id)}
              >
                <Icon name="library" size={16} /> Read along
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label="Book details"
              title="Book details"
              onClick={() => showBookDetails(bookId)}
            >
              <Icon name="info" size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="tabs audio-panel-tabs" role="tablist" aria-label="About this audiobook">
        {PANEL_TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={tab === t.tab}
            className={`tab${tab === t.tab ? " is-active" : ""}`}
            onClick={() => setTab(t.tab)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="audio-panel-body">
        {tab === "chapters" &&
          (book.chapters.length ? (
            <>
              <div className="audio-where">
                <span>
                  {book.chapters[current]?.title}{" "}
                  <span className="muted">
                    · {clock(at)} / {clock(book.durationMs)}
                  </span>
                </span>
                <span className="num">{Math.round((at / Math.max(1, book.durationMs)) * 100)}%</span>
              </div>
              <ProgressBar value={at / Math.max(1, book.durationMs)} label="Listened" />
              <ol className="chapter-list">
                {book.chapters.map((c, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={`chapter-row${i === current ? " is-current" : ""}`}
                      aria-current={i === current || undefined}
                      onClick={() => {
                        if (playing) player.seek(c.startMs);
                        else void player.load(bookId).then(() => player.seek(c.startMs));
                      }}
                    >
                      <span className="num muted">{i + 1}</span>
                      <span className="chapter-name">{c.title}</span>
                      <span className="num muted">{clock(chapterLength(book, i))}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">This audiobook has no chapters marked. Skip 30 seconds at a time, or use the bar below.</p>
          ))}

        {tab === "details" && (
          <dl className="details-facts audio-facts">
            <div>
              <dt>Length</dt>
              <dd>{formatLength(book.durationMs) || "Unknown"}</dd>
            </div>
            <div>
              <dt>Narrators</dt>
              <dd>{book.narrators.join(", ") || "Not known"}</dd>
            </div>
            {b.series && (
              <div>
                <dt>Series</dt>
                <dd>
                  {b.series}
                  {b.seriesIndex !== null && `, book ${b.seriesIndex}`}
                </dd>
              </div>
            )}
            <div>
              <dt>Status</dt>
              <dd>{b.status === "read" ? "Finished" : b.status === "in_progress" ? "Listening" : "Not started"}</dd>
            </div>
            <div>
              <dt>Read along with</dt>
              <dd>
                {book.ebook ? book.ebook.name : <span className="muted">No ebook linked</span>}{" "}
                <button type="button" className="view-all" onClick={() => setLinking(true)}>
                  {book.ebook ? "Change" : "Link an ebook"}
                </button>
                {book.ebook && (
                  <button
                    type="button"
                    className="view-all"
                    onClick={() =>
                      api.linkEbook(bookId, null).then(
                        () => {
                          setBook({ ...book, ebook: null });
                          player.refresh();
                        },
                        (e: unknown) => toast(String(e)),
                      )
                    }
                  >
                    Unlink
                  </button>
                )}
              </dd>
            </div>
          </dl>
        )}

        {tab === "files" && (
          <>
            <p className="muted">
              {b.availability === "cloud"
                ? "In the cloud only. It downloads when you play it."
                : b.inCloud
                  ? "On this device and in the cloud."
                  : "On this device."}
              {details?.fileSize ? ` ${formatBytes(details.fileSize)} in all.` : ""}
            </p>
            <ol className="chapter-list">
              {book.parts.map((p, i) => (
                <li key={i} className="chapter-row is-static">
                  <span className="num muted">{i + 1}</span>
                  <span className="chapter-name">{p.name}</span>
                  <span className="num muted">{clock(p.durationMs)}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        {tab === "collections" && (
          <div className="details-chips">
            {(details?.collections ?? []).map((c) => (
              <button key={c.id} type="button" className="tag-chip tag-chip-add" onClick={() => onOpenCollection(c.id)}>
                <Icon name="collections" size={12} /> {c.name}
              </button>
            ))}
            <button type="button" className="view-all" onClick={() => askAddToCollection(b)}>
              Add to a collection
            </button>
          </div>
        )}
      </div>

      {next && (
        <div className="audio-up-next">
          <h3>Up next</h3>
          <button
            type="button"
            className="chapter-row"
            onClick={() => (playing ? player.seek(next.startMs) : void player.load(bookId).then(() => player.seek(next.startMs)))}
          >
            <span className="num muted">{current + 2}</span>
            <span className="chapter-name">{next.title}</span>
            <span className="num muted">{clock(chapterLength(book, current + 1))}</span>
          </button>
        </div>
      )}

      {linking && (
        <LinkEbook
          audiobook={b}
          onClose={(ebook) => {
            setLinking(false);
            if (ebook !== undefined) {
              setBook({ ...book, ebook });
              player.refresh();
              onChanged();
            }
          }}
        />
      )}
    </aside>
  );
}
