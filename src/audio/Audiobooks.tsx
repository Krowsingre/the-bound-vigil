// The Audiobooks page: Continue listening, every audiobook (searched, filtered
// by genre, author, narrator and status), and a panel for the one chosen, with
// its chapters, details, files and collections.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Audiobook, BookDetails, BookPreview } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { showBookDetails } from "../details/openDetails";
import { bookContextMenu, makeBookActions } from "../home/bookActions";
import { useToast } from "../components/Toast";
import { Library } from "../library/Library";
import type { LibraryView } from "../library/libraryView";
import { formatLength } from "../lib/queryBooks";
import { formatBytes } from "../settings/controls";
import { LinkEbook } from "./LinkEbook";
import { chapterAt, chapterLength, clock, usePlayer } from "./player";

type PanelTab = "chapters" | "details" | "files" | "collections";
const PANEL_TABS: { tab: PanelTab; label: string }[] = [
  { tab: "chapters", label: "Chapters" },
  { tab: "details", label: "Details" },
  { tab: "files", label: "Files" },
  { tab: "collections", label: "Collections" },
];

/** "8h 24m left", from where you are. */
function timeLeft(book: BookPreview): string | null {
  if (!book.durationMs) return null;
  const left = book.durationMs - (book.resumeLocator?.audioMs ?? 0);
  return left > 0 ? `${formatLength(left)} left` : null;
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
}) {
  const player = usePlayer();
  const [chosen, setChosen] = useState<string | null>(null);
  const [listening, setListening] = useState<BookPreview[] | null>(null);
  const [reload, setReload] = useState(0);
  const toast = useToast();
  const actions = makeBookActions(
    api,
    toast,
    () => setReload((n) => n + 1),
    (id) => void player.load(id),
  );

  useEffect(() => {
    let current = true;
    api
      .getLibrary({
        kind: "audiobooks",
        shelf: "in_progress",
        sort: "recently_opened",
        search: null,
        formats: [],
        location: null,
        page: 0,
        pageSize: 10,
      })
      .then(
        (page) => current && setListening(page.books),
        () => current && setListening([]),
      );
    return () => {
      current = false;
    };
  }, [refreshKey, reload, player.playing]);

  // The panel shows the book chosen, else the one playing, else the last listened to.
  const shown = chosen ?? player.book?.book.id ?? listening?.[0]?.id ?? null;
  const showContinue = view.tab === "all" && !search.trim() && listening !== null && listening.length > 0;

  // Clicking a cover shows the audiobook's details in the panel; playing stays on
  // the panel's Listen button. Where the panel sits below the list, it scrolls into view.
  const choose = useCallback((id: string) => {
    setChosen(id);
    if (window.matchMedia?.("(max-width: 1180px)").matches) {
      requestAnimationFrame(() => document.querySelector(".audio-panel")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }, []);

  return (
    <div className="audiobooks">
      <div className="audiobooks-main">
        <Library
          kind="audiobooks"
          view={view}
          search={search}
          refreshKey={refreshKey + reload}
          onChange={onChange}
          onClearSearch={onClearSearch}
          onImportBooks={onImportBooks}
          onImportFolder={onImportFolder}
          onOpenBook={choose}
          onOpenCollection={onOpenCollection}
          intro={
            showContinue && (
              <section className="listen-row" aria-label="Continue listening">
                <h2 className="section-title">Continue listening</h2>
                <ul className="listen-cards">
                  {listening.map((b) => (
                    <li
                      key={b.id}
                      className={`listen-card${b.id === shown ? " is-chosen" : ""}`}
                      {...bookContextMenu(b, actions)}
                    >
                      <button
                        type="button"
                        className="listen-open"
                        onClick={() => choose(b.id)}
                        onDoubleClick={() => void player.load(b.id)}
                      >
                        <BookCover book={b} size="m" />
                        <span className="listen-title">{b.title}</span>
                        <span className="muted listen-author">{b.authors.join(", ") || "Unknown author"}</span>
                      </button>
                      <ProgressBar
                        value={b.totalProgression}
                        label={`${Math.round((b.totalProgression ?? 0) * 100)}% listened`}
                      />
                      <span className="muted listen-meta">
                        {[b.resumeLocator?.chapter, timeLeft(b)].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          }
        />
      </div>
      {shown && (
        <AudiobookPanel
          key={shown}
          bookId={shown}
          refreshKey={refreshKey + reload}
          onOpenCollection={onOpenCollection}
          onReadAlong={onReadAlong}
          onChanged={() => setReload((n) => n + 1)}
        />
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
}: {
  bookId: string;
  refreshKey: number;
  onOpenCollection: (id: string) => void;
  onReadAlong: (ebookId: string) => void;
  onChanged: () => void;
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

  if (!book) return <aside className="audio-panel" aria-busy="true" />;

  const playing = player.book?.book.id === bookId;
  const at = playing ? player.positionMs : book.positionMs;
  const current = chapterAt(book.chapters, at);
  const next = book.chapters[current + 1];
  const b = book.book;
  const started = at > 0 && at < book.durationMs - 1000;

  return (
    <aside className="audio-panel" aria-label={`About ${b.title}`}>
      <div className="audio-panel-head">
        <BookCover book={b} size="l" />
        <div className="audio-panel-title">
          <h2>{b.title}</h2>
          <p>{b.authors.join(", ") || "Unknown author"}</p>
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
