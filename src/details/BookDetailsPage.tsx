// The Book details page: everything about one book, with its details in their
// layers (your edits, fetched online, the book's own) and ways to change them.

import { useDownloadsChanging } from "../library/cloudDownloads";
import { useEffect, useMemo, useState } from "react";
import { api, isAndroid, isApp, isIOS } from "../api";
import type { BookDetails, BookFile, DetailField, DetailFieldName } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import { useAppSettings } from "../settings/appSettings";
import { BookCover } from "../components/BookCover";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { StarRating } from "../components/StarRating";
import { useToast } from "../components/Toast";
import { bookMenu, detailsLabel, makeBookActions } from "../home/bookActions";
import { askEditTags } from "../library/BookDialogs";
import { detailsKindOf, effective, groupPlaces, labelFor, listOf, placesOf, placesWords } from "../lib/details";
import { formatLength, formatLabel, isAudio, isDocument } from "../lib/queryBooks";
import { formatBytes } from "../settings/controls";
import { askEditDetails, askFetchDetails } from "./openDetails";
import { FormatsRow } from "./FormatsRow";
import { LocationsRow } from "./LocationsRow";
import { PairRow } from "./PairRow";
import { SeriesRow } from "./SeriesRow";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: BookDetails };

const SOURCE = { google: "Google Books", openlibrary: "Open Library", audible: "Audible", apple: "Apple Books", hardcover: "Hardcover", musicbrainz: "MusicBrainz", applemusic: "Apple Music", file: "the file" } as const;

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
  /** Opens the book; `fileId` picks one of its files when copies are kept together. */
  onOpenBook: (bookId: string, at?: string, fileId?: string) => void;
  onOpenCollection: (id: string) => void;
  /** Shows the Library (or Documents) filtered to one genre. */
  onOpenLibrary: (genre: string, documents: boolean) => void;
}) {
  useDownloadsChanging();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const [expandedCover, setExpandedCover] = useState<string | null>(null);
  const { privacy } = useAppSettings().settings;
  useEffect(() => { setExpandedCover(null); }, [bookId, privacy.on]);
  const [resetting, setResetting] = useState(false);
  const toast = useToast();
  const refresh = () => setReload((n) => n + 1);
  const actions = useMemo(() => makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook), [toast, onOpenBook]);

  // "Find on device" (computers only): where this book's file is here.
  const onComputer = !isIOS && !isAndroid;
  const [places, setPlaces] = useState<{ here: string | null; cloud: string | null; service: string | null } | null>(null);
  useEffect(() => {
    if (!onComputer) return;
    let current = true;
    setPlaces(null);
    api.bookFilePlaces(bookId).then((p) => current && setPlaces(p), () => current && setPlaces(null));
    return () => {
      current = false;
    };
  }, [bookId, reload, onComputer]);
  const reveal = (path: string) =>
    isApp ? api.showFolder(path).catch((e: unknown) => toast(String(e))) : toast("This opens File Explorer in the desktop app.");
  const serviceName = (service: string | null) =>
    ({ icloud: "iCloud Drive", dropbox: "Dropbox", onedrive: "OneDrive", gdrive: "Google Drive", mega: "MEGA" } as Record<string, string>)[service ?? ""] ?? "the synced folder";
  const findItems: MenuEntry[] = [
    ...(places?.here ? [{ label: "Find on device", icon: "folder" as const, onSelect: () => void reveal(places.here!) }] : []),
    ...(places?.cloud ? [{ label: `Find in ${serviceName(places.service)}`, icon: "folder" as const, onSelect: () => void reveal(places.cloud!) }] : []),
  ];

  const [files, setFiles] = useState<BookFile[]>([]);
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
    let current = true;
    api.bookFiles(bookId).then(
      (list) => current && setFiles(list),
      () => current && setFiles([]),
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
  // Songs, podcasts and other audio show details of their own (embre, 19 November).
  const kind = detailsKindOf([book]);
  const shownAs = (name: DetailFieldName): [string, string | null, DetailFieldName] => [labelFor(name, kind), value(name), name];
  const facts: [string, string | null, DetailFieldName | null][] = [
    ...(kind === "music"
      ? [shownAs("series"), shownAs("series_index"), shownAs("disc"), shownAs("album_artist"), shownAs("published"), shownAs("composer")]
      : kind === "spoken"
        ? [shownAs("episode"), shownAs("published")]
        : ([
            ["Publisher", value("publisher"), "publisher"],
            ["Published", value("published"), "published"],
            ["Language", value("language"), "language"],
            ["ISBN", value("isbn"), "isbn"],
          ] as [string, string | null, DetailFieldName | null][])),
    ...(isAudio(book.format)
      ? ([
          ...(kind === "book" ? [["Narrators", listOf(value("narrators")).join(", ") || null, "narrators"]] : []),
          ["Length", formatLength(book.durationMs), null],
        ] as [string, string | null, DetailFieldName | null][])
      : []),
    // Several files are listed under Formats instead.
    ["Format", files.length > 1 ? null : formatLabel(book.format), null],
    ["File size", fileSize && files.length <= 1 ? formatBytes(fileSize) : null, null],
    ["Added", new Date(book.addedAt).toLocaleDateString(), null],
    ["Finished", book.finishedAt ? new Date(book.finishedAt).toLocaleDateString() : null, null],
  ];
  // Said this way when no device or place has noted the book yet.
  const where = book.fileUnavailable
    ? "Its file isn't in the cloud yet"
    : book.availability === "cloud"
      ? "In the cloud only"
      : book.availability === "missing"
        ? "File missing"
        : book.inCloud
          ? "On this device and in the cloud"
          : "On this device";

  return (
    <div className="book-details">
      {back}
      <div className="details-layout">
        <aside className="details-side" data-item-menu>
          <BookCover book={book} size="l" onExpand={privacy.on ? undefined : setExpandedCover} />
          {expandedCover && !privacy.on && (
            <div className="dialog-backdrop book-cover-preview" role="dialog" aria-modal="true" aria-label={"Cover for " + book.title}
              onPointerDown={(event) => { if (event.target === event.currentTarget) setExpandedCover(null); }}
              onKeyDown={(event) => { if (event.key === "Escape") setExpandedCover(null); }}>
              <button type="button" autoFocus aria-label="Close cover preview" onClick={() => setExpandedCover(null)}>
                <img src={expandedCover} alt={book.title} />
              </button>
            </div>
          )}
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
                <Icon name="restore" size={16} /> Reset to the file's details
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
              {kind === "music" && book.series && (
                <p className="muted">
                  {book.series}
                  {book.seriesIndex != null ? `, track ${book.seriesIndex}` : ""}
                </p>
              )}
              {kind !== "music" && groupPlaces(placesOf(book)).map(({ name, places }) => (
                <p key={name} className="muted">
                  {name}
                  {places.some((p) => p.number != null || p.after != null) ? `, ${placesWords(places).toLowerCase()}` : ""}
                </p>
              ))}
            </div>
            <Menu
              label={`More for ${book.title}`}
              className="icon-btn"
              trigger={<Icon name="more" size={18} />}
              items={[
                ...bookMenu(book, actions).filter(
                  (e) => typeof e === "string" || !("label" in e) || e.label !== detailsLabel(book),
                ),
                ...(findItems.length ? ["divider" as const, ...findItems] : []),
              ]}
            />
          </header>

          <div className="details-rating">
            <StarRating value={book.rating} size={22} onChange={(r) => actions.setRating(book, r)} />
            <span className="muted">
              {book.status === "read" ? "Read" : book.status === "dropped" ? "Dropped" : book.status === "in_progress" ? "Reading" : "Not started"}
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
              <LocationsRow bookId={book.id} refreshKey={refreshKey + reload} fallback={where} />
              {files.length > 1 && <FormatsRow bookId={book.id} files={files} onOpen={(fileId) => onOpenBook(book.id, undefined, fileId)} onChanged={refresh} />}
              {kind !== "music" && <PairRow book={book} refreshKey={refreshKey + reload} />}
            </dl>
          </section>

          {kind !== "music" && groupPlaces(placesOf(book)).map(({ name }, _, all) => (
            <SeriesRow key={name} name={name} author={book.authors[0] ?? ""} bookId={book.id} refreshKey={refreshKey + reload} titled={all.length > 1} />
          ))}

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
          title="Reset to the file's details?"
          body={`This takes away your edits and the details found online for this ${kind === "music" ? "song" : kind === "spoken" ? "recording" : "book"}, on every device, and brings back the cover it came with. The file was never changed, so its details come back as they were.`}
          confirm="Reset"
          onCancel={() => setResetting(false)}
          onConfirm={() => {
            setResetting(false);
            api.resetDetails(book.id, true).then(
              () => {
                toast(`“${book.title}” shows the file's details again.`);
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
