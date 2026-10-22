// The Book details page: everything about one book, with its details in their
// layers (your edits, fetched online, the book's own) and ways to change them.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { BookDetails, DetailField, DetailFieldName } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import { BookCover } from "../components/BookCover";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { StarRating } from "../components/StarRating";
import { useToast } from "../components/Toast";
import { bookMenu, makeBookActions } from "../home/bookActions";
import { askEditTags } from "../library/BookDialogs";
import { effective, listOf } from "../lib/details";
import { formatLength, formatLabel, isAudio, isDocument } from "../lib/queryBooks";
import { formatBytes } from "../settings/controls";
import { askEditDetails, askFetchDetails } from "./openDetails";
import { PairRow } from "./PairRow";
import { SeriesRow } from "./SeriesRow";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: BookDetails };

const SOURCE = { google: "Google Books", openlibrary: "Open Library", audible: "Audible", hardcover: "Hardcover", file: "the book file" } as const;

/** Where a detail's value comes from, when it isn't the book's own. */
function origin(f: DetailField | undefined): string | null {
  if (!f) return null;
  if (f.edited !== null) return "Your edit";
  if (f.fetched !== null && f.fetchedFrom) return `From ${SOURCE[f.fetchedFrom]}`;
  return null;
}

export function BookDetailsPage({
  bookId,
  refreshKey,
  onBack,
  onOpenBook,
  onOpenCollection,
  onOpenLibrary,
}: {
  bookId: string;
  refreshKey: number;
  onBack: () => void;
  onOpenBook: (bookId: string) => void;
  onOpenCollection: (id: string) => void;
  /** Shows the Library (or Documents) filtered to one genre. */
  onOpenLibrary: (genre: string, documents: boolean) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const [resetting, setResetting] = useState(false);
  const toast = useToast();
  const refresh = () => setReload((n) => n + 1);
  const actions = useMemo(() => makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook), [toast, onOpenBook]);

  useEffect(() => {
    let current = true;
    api.bookDetails(bookId).then(
      (data) => current && setLoad({ state: "ready", data }),
      (e: unknown) => current && setLoad({ state: "error", message: String(e) }),
    );
    return () => {
      current = false;
    };
  }, [bookId, refreshKey, reload]);

  useEffect(() => {
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }, [bookId]);

  const back = (
    <button type="button" className="details-back view-all" onClick={onBack}>
      <Icon name="arrowLeft" size={16} /> Back
    </button>
  );

  if (load.state === "loading") return <div className="library-loading" aria-busy="true" aria-label="Loading the book" />;
  if (load.state === "error")
    return (
      <div className="book-details">
        {back}
        <div className="library-empty" role="alert">
          <h2>This book couldn't be shown</h2>
          <p className="muted">{load.message}</p>
        </div>
      </div>
    );

  const { book, fields, fileSize, collections, annotations } = load.data;
  const field = (name: DetailFieldName) => fields.find((f) => f.field === name);
  const value = (name: DetailFieldName) => {
    const f = field(name);
    return f ? effective(f) : null;
  };
  const genres = listOf(value("genres"));
  const synopsis = value("synopsis");
  const changed = fields.some((f) => f.edited !== null || (f.fetched !== null && f.fetchedFrom !== "file"));
  const started = book.status === "in_progress" && book.totalProgression;
  const facts: [string, string | null, DetailFieldName | null][] = [
    ["Publisher", value("publisher"), "publisher"],
    ["Published", value("published"), "published"],
    ["Language", value("language"), "language"],
    ["ISBN", value("isbn"), "isbn"],
    ...(isAudio(book.format)
      ? ([
          ["Narrators", listOf(value("narrators")).join(", ") || null, "narrators"],
          ["Length", formatLength(book.durationMs), null],
        ] as [string, string | null, DetailFieldName | null][])
      : []),
    ["Format", formatLabel(book.format), null],
    ["File size", fileSize ? formatBytes(fileSize) : null, null],
    ["Added", new Date(book.addedAt).toLocaleDateString(), null],
    ["Finished", book.finishedAt ? new Date(book.finishedAt).toLocaleDateString() : null, null],
    [
      "Where",
      book.fileUnavailable
        ? "Its file isn't in the cloud yet"
        : book.availability === "cloud"
          ? "In the cloud only"
          : book.availability === "missing"
            ? "File missing"
            : book.inCloud
              ? "On this device and in the cloud"
              : "On this device",
      null,
    ],
  ];

  return (
    <div className="book-details">
      {back}
      <div className="details-layout">
        <aside className="details-side">
          <BookCover book={book} size="l" />
          <button type="button" className="btn btn-primary btn-wide" onClick={() => actions.open(book)}>
            <Icon name="play" size={16} />{" "}
            {isAudio(book.format)
              ? started
                ? "Continue listening"
                : book.status === "read"
                  ? "Listen again"
                  : "Listen"
              : started
                ? "Continue reading"
                : book.status === "read"
                  ? "Read again"
                  : "Read"}
          </button>
          {started ? (
            <ProgressBar value={book.totalProgression} label={`${Math.round((book.totalProgression ?? 0) * 100)}% read`} />
          ) : null}
          <div className="details-side-actions">
            <button type="button" className="btn btn-quiet" onClick={() => askEditDetails([book])}>
              <Icon name="edit" size={16} /> Edit details
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => askFetchDetails(book)}>
              <Icon name="search" size={16} /> Find details online
            </button>
            {changed && (
              <button type="button" className="btn btn-quiet" onClick={() => setResetting(true)}>
                <Icon name="restore" size={16} /> Show the book's own details
              </button>
            )}
          </div>
        </aside>

        <div className="details-main">
          <header className="details-head">
            <div>
              <h1 className="details-title" title={origin(field("title")) ?? undefined}>
                {book.title}
              </h1>
              <p className="details-authors">{book.authors.join(", ") || "Unknown author"}</p>
              {book.series && (
                <p className="muted">
                  {book.series}
                  {book.seriesIndex !== null && `, book ${book.seriesIndex}`}
                </p>
              )}
            </div>
            <Menu
              label={`More for ${book.title}`}
              className="icon-btn"
              trigger={<Icon name="more" size={18} />}
              items={bookMenu(book, actions).filter(
                (e) => typeof e === "string" || !("label" in e) || e.label !== "Book details",
              )}
            />
          </header>

          <div className="details-rating">
            <StarRating value={book.rating} size={22} onChange={(r) => actions.setRating(book, r)} />
            <span className="muted">
              {book.status === "read" ? "Read" : book.status === "in_progress" ? "Reading" : "Not started"}
              {book.favorite && " · Favourite"}
              {book.wantToRead && " · Up next"}
            </span>
          </div>

          {genres.length > 0 && (
            <div className="details-chips" aria-label="Genres">
              {genres.map((g) => (
                <button
                  key={g}
                  type="button"
                  className="tag-chip tag-chip-add"
                  title={`Show ${g} books`}
                  onClick={() => onOpenLibrary(g, isDocument(book.format))}
                >
                  {g}
                </button>
              ))}
              {origin(field("genres")) && <span className="details-origin">{origin(field("genres"))}</span>}
            </div>
          )}

          <section className="details-section">
            <h2>
              Description
              {origin(field("synopsis")) && <span className="details-origin">{origin(field("synopsis"))}</span>}
            </h2>
            {synopsis ? (
              <div className="details-synopsis">
                {synopsis.split(/\n{2,}/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            ) : (
              <p className="muted">
                No description yet.{" "}
                <button type="button" className="view-all" onClick={() => askFetchDetails(book)}>
                  Find one online
                </button>
              </p>
            )}
          </section>

          <section className="details-section">
            <h2>Details</h2>
            <dl className="details-facts">
              {facts
                .filter(([, v]) => v)
                .map(([label, v, name]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {v}
                      {name && origin(field(name)) && <span className="details-origin">{origin(field(name))}</span>}
                    </dd>
                  </div>
                ))}
              <PairRow book={book} refreshKey={refreshKey + reload} />
            </dl>
          </section>

          {book.series && <SeriesRow name={book.series} author={book.authors[0] ?? ""} bookId={book.id} refreshKey={refreshKey + reload} />}

          <section className="details-section">
            <h2>Tags and collections</h2>
            <div className="details-chips">
              {book.tags.map((t) => (
                <span key={t} className="tag-chip">
                  <Icon name="tag" size={12} /> {t}
                </span>
              ))}
              <button type="button" className="view-all" onClick={() => askEditTags(book)}>
                {book.tags.length ? "Edit tags" : "Add tags"}
              </button>
            </div>
            <div className="details-chips">
              {collections.map((c) => (
                <button key={c.id} type="button" className="tag-chip tag-chip-add" onClick={() => onOpenCollection(c.id)}>
                  <Icon name="collections" size={12} /> {c.name}
                </button>
              ))}
              <button type="button" className="view-all" onClick={() => askAddToCollection(book)}>
                Add to a collection
              </button>
            </div>
            <p className="muted">
              {annotations
                ? `${annotations} ${annotations === 1 ? "highlight or note" : "highlights and notes"}`
                : "No highlights or notes yet."}
            </p>
          </section>
        </div>
      </div>

      {resetting && (
        <ConfirmDialog
          title="Show the book's own details?"
          body="This takes away your edits and the details found online for this book, on every device, and brings back the cover it came with. The book file was never changed, so its own details come back as they were."
          confirm="Show the book's own"
          onCancel={() => setResetting(false)}
          onConfirm={() => {
            setResetting(false);
            api.resetDetails(book.id, true).then(
              () => {
                toast(`“${book.title}” shows its own details again.`);
                refresh();
              },
              (e: unknown) => toast(`Couldn't reset the details: ${String(e)}`),
            );
          }}
        />
      )}
    </div>
  );
}
