// The web version's side of the Api: the same answers the desktop core
// gives, worked out in the page from the records synced through Supabase.
// It is lighter than the desktop app: no importing, backups, folder sync or
// Hardcover, and books open from the cloud.

import type { Api } from "../api";
import type {
  Annotation,
  AnnotationKind,
  BookId,
  BookPreview,
  CollectionInput,
  CollectionKind,
  CollectionPreview,
  CollectionRef,
  CollectionRules,
  CollectionSummary,
  CoverRef,
  DetailField,
  HighlightColor,
  HomeViewModel,
  NoteItem,
  NoteKind,
  ReaderLocator,
  ReadStatus,
  SmartKind,
  TagCount,
  AudioChapter,
  AudioPart,
  ImportResult,
} from "../api/types";
import { matches, usable } from "../collections/rules";
import { cleanTag, isAudio, queryBooks, tagCounts } from "../lib/queryBooks";
import { cleanValue, DETAIL_FIELDS, listOf } from "../lib/details";
import { copyName } from "../lib/format";
import { DESKTOP_ONLY as SENDING_DESKTOP_ONLY } from "../ereaders/ereaders";
import { WebDb } from "./db";
import { UP_NEXT, WebLibrary, type BookRow } from "./library";
import { WebSync } from "./sync";
import { moveStub } from "../api/moveStub";
import { serverStub } from "../api/serverStub";
import { projectFromLink } from "./link";
import { formatOf, PHONE_MAX_BYTES, PhoneImports, readDetails, sha256Hex, smallCover } from "./phoneImport";
import { languageCode } from "../lib/language";

type Row = { [column: string]: unknown };

const DESKTOP_ONLY = "This works in the desktop app.";
const SMART: SmartKind[] = ["recently_added", "unread", "in_progress", "read", "favorites"];
const DAY = 86_400_000;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_TITLE = 200;

const now = () => new Date().toISOString();
const clean = (text: string | null | undefined, max = 100_000) => {
  const t = text?.trim();
  return t ? [...t].slice(0, max).join("") : null;
};
const cleanBadge = (badge: string | null | undefined) => {
  const b = badge?.trim();
  return b && b.length <= 32 && /^[a-z-]+$/.test(b) ? b : null;
};
const parse = <T>(json: unknown, fallback: T): T => {
  if (typeof json !== "string") return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};
const articles = /^(the|an|a) /i;
const byTitle = (a: BookPreview, b: BookPreview) =>
  a.title.replace(articles, "").localeCompare(b.title.replace(articles, ""), undefined, { sensitivity: "base" });
const newest = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");
const coverOf = ({ id, title, authors, coverPath }: BookPreview): CoverRef => ({ id, title, authors, coverPath });

export async function webApi(): Promise<Api> {
  const db = await WebDb.open();
  const library = new WebLibrary(db);
  const sync = new WebSync(db, library);
  // The desktop app's "Copy phone link" carries the project in the address.
  const linked = projectFromLink(location.hash);
  if (linked) {
    if (sync.project?.url !== linked.url || sync.project.anonKey !== linked.anonKey) await sync.setProject(linked);
    history.replaceState(null, "", location.pathname + location.search);
  }
  sync.start();

  // ---- Books ----

  // Your edits, then details fetched online or from the file, by book and field.
  const layer = (table: "metadata_overrides" | "metadata_fetched") => {
    const map = new Map<string, Map<string, { value: string | null; source: string | null }>>();
    for (const o of library.rows(table)) {
      const id = String(o.book_id);
      if (!map.has(id)) map.set(id, new Map());
      map.get(id)!.set(String(o.field), { value: (o.value as string | null) ?? null, source: (o.source as string | null) ?? null });
    }
    return map;
  };
  const overrides = () => {
    const edits = layer("metadata_overrides");
    const found = layer("metadata_fetched");
    const map = new Map<string, Map<string, string | null>>();
    for (const [id, fields] of found) map.set(id, new Map([...fields].filter(([, v]) => v.value !== null).map(([f, v]) => [f, v.value])));
    for (const [id, fields] of edits) {
      if (!map.has(id)) map.set(id, new Map());
      for (const [f, v] of fields) if (v.value !== null) map.get(id)!.set(f, v.value);
    }
    return map;
  };
  const audioRow = (id: string) =>
    library.rows("audiobooks").find((a) => a.book_id === id) as
      | { book_id: string; narrators: string | null; duration_ms: number | null; chapters: string | null; parts: string | null; ebook_id: string | null }
      | undefined;
  const detailFields = (b: BookRow): DetailField[] => {
    const edits = layer("metadata_overrides").get(b.id);
    const found = layer("metadata_fetched").get(b.id);
    const own: Record<string, string | null> = {
      title: b.title,
      authors: b.authors,
      series: b.series,
      series_index: b.series_index === null || b.series_index === undefined ? null : String(b.series_index),
      synopsis: b.synopsis,
      publisher: b.publisher,
      language: b.language,
      isbn: b.isbn,
      narrators: audioRow(b.id)?.narrators ?? null,
    };
    return DETAIL_FIELDS.map(({ field }) => ({
      field,
      own: own[field] ?? null,
      fetched: found?.get(field)?.value ?? null,
      fetchedFrom: (found?.get(field)?.source as DetailField["fetchedFrom"]) ?? null,
      edited: edits?.get(field)?.value ?? null,
    }));
  };

  const downloaded = new Set<string>();
  const refreshDownloaded = async () => {
    downloaded.clear();
    for (const p of await db.filePaths()) if (p.startsWith("books/")) downloaded.add(p.slice(6).split(".")[0]);
  };
  await refreshDownloaded();

  // A book's tags, A to Z.
  const tagsByBook = () => {
    const map = new Map<string, string[]>();
    for (const t of library.rows("book_tags")) {
      if (t.removed_at) continue;
      const id = String(t.book_id);
      map.set(id, [...(map.get(id) ?? []), String(t.tag)]);
    }
    for (const list of map.values()) list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return map;
  };
  let tagCache: { at: number; map: Map<string, string[]> } | null = null;
  let libraryVersion = 0;
  library.subscribe(() => libraryVersion++);
  const tagsOf = (id: string) => {
    if (tagCache?.at !== libraryVersion) tagCache = { at: libraryVersion, map: tagsByBook() };
    return tagCache.map.get(id) ?? [];
  };

  // Ebooks linked to an audiobook and audiobooks linked to an ebook, both still in the library.
  let pairCache: { at: number; ids: Set<string> } | null = null;
  const isPaired = (id: string) => {
    if (pairCache?.at !== libraryVersion) {
      const ids = new Set<string>();
      for (const a of library.rows("audiobooks")) {
        const audio = String(a.book_id);
        const ebook = a.ebook_id ? String(a.ebook_id) : null;
        if (ebook && library.book(audio) && library.book(ebook)) ids.add(audio).add(ebook);
      }
      pairCache = { at: libraryVersion, ids };
    }
    return pairCache.ids.has(id);
  };

  /** A number typed as text; blank or not a number shows what's beneath. */
  const numberOr = (text: string | null | undefined, beneath: number | null) =>
    text?.trim() && Number.isFinite(Number(text)) ? Number(text) : beneath;

  const preview = (b: BookRow, edits: Map<string, string | null> | undefined): BookPreview => {
    const hex = b.id.replace(/^sha256:/, "");
    const o = (field: string, own: string | null) => (edits?.has(field) ? edits.get(field)! : own);
    return {
      id: b.id as BookId,
      title: o("title", b.title) ?? b.title,
      authors: parse<string[]>(o("authors", b.authors), []),
      coverPath: sync.coverUrls.get(hex) ?? null,
      format: b.format,
      synopsis: o("synopsis", b.synopsis),
      series: o("series", b.series)?.trim() || null,
      seriesIndex: numberOr(edits?.get("series_index"), b.series_index ?? null),
      addedAt: b.added_at,
      lastOpenedAt: b.last_opened_at ?? null,
      status: (["unread", "in_progress", "read"].includes(b.status) ? b.status : "unread") as ReadStatus,
      totalProgression: b.total_progression ?? null,
      resumeLocator: parse<ReaderLocator | null>(b.resume_locator, null),
      availability: downloaded.has(hex) ? "local" : "cloud",
      remotePositions: [],
      favorite: !!b.favorite,
      wantToRead: !!b.want_to_read,
      rating: b.rating ?? null,
      finishedAt: b.finished_at ?? null,
      tags: tagsOf(b.id),
      // Only books whose file is in the cloud (or already here) can be opened on the phone.
      inCloud: sync.bookFiles.has(hex) || downloaded.has(hex),
      language: languageCode(o("language", b.language)),
      fileUnavailable: !sync.bookFiles.has(hex) && !downloaded.has(hex),
      genres: listOf(edits?.get("genres") ?? null),
      durationMs: audioRow(b.id)?.duration_ms ?? null,
      narrators: listOf(edits?.get("narrators") ?? audioRow(b.id)?.narrators ?? null),
      paired: isPaired(b.id),
      phoneWanted: !!b.phone_wanted,
      phoneHas: !!b.phone_has,
    };
  };

  const books = (): BookPreview[] => {
    const edits = overrides();
    return library.books().map((b) => preview(b, edits.get(b.id)));
  };
  const bookById = () => new Map(books().map((b) => [b.id as string, b]));
  const find = (id: string) => {
    const row = library.book(id);
    if (!row) throw new Error("This book is no longer in your library.");
    return row;
  };
  const bookPreview = (id: string) => preview(find(id), overrides().get(id));

  const writeProgress = (id: string, change: Partial<BookRow>) => library.write("book_progress", { ...find(id), ...change });
  const writeShelves = (id: string, change: Partial<BookRow>) => library.write("book_shelves", { ...find(id), ...change });
  /** Tells the computer whether this phone holds a book, so tidying Supabase keeps it. */
  const notePhoneHas = async (id: string, has: boolean) => {
    const b = library.book(id);
    if (b && !!b.phone_has !== has) await library.write("book_phone", { ...b, phone_has: has ? 1 : 0 });
  };
  // ---- Adding books on the phone ----

  const addFromPhone = async (file: File): Promise<ImportResult> => {
    const path = file.webkitRelativePath || file.name;
    const format = formatOf(file.name);
    if (file.size > PHONE_MAX_BYTES)
      return { outcome: "failed", path, reason: "Too big to add from the phone. Add it with TBV on the computer instead." };
    const hex = await sha256Hex(await file.arrayBuffer());
    const id = `sha256:${hex}`;
    const known = library.book(id);
    if (known) {
      // On the phone already as a book only in the cloud: this copy is kept.
      if (!downloaded.has(hex) && !sync.bookFiles.has(hex)) await sync.sendBook(hex, format, file, null);
      return { outcome: "alreadyInLibrary", path, bookId: id as BookId, title: known.title };
    }
    const details = await readDetails(file, format);
    const cover = details.cover ? await smallCover(details.cover) : null;
    await sync.sendBook(hex, format, file, cover);
    await refreshDownloaded();
    const row: Row = {
      id,
      title: details.title,
      authors: JSON.stringify(details.authors),
      format,
      file_size: file.size,
      synopsis: null,
      publisher: null,
      language: details.language,
      series: null,
      series_index: null,
      added_at: now(),
      deleted_at: null,
      isbn: null,
      phone_wanted: 0,
      phone_has: 1,
      from_phone: 1,
    };
    // Sent only now the file is in Supabase, so the computer never looks for a file that isn't there.
    await library.writeAll([
      ["book", row],
      ["book_phone", row],
    ]);
    return { outcome: "imported", path, bookId: id as BookId, title: details.title };
  };
  const phoneImports = new PhoneImports(addFromPhone);

  // Books downloaded before the phone told the computer about them.
  void (async () => {
    for (const hex of downloaded) await notePhoneHas(`sha256:${hex}`, true);
  })().catch(() => undefined);

  // ---- Collections ----

  const collectionRows = () =>
    library
      .rows("collections")
      .filter((c) => !c.deleted_at)
      .sort(
        (a, b) =>
          Number(a.position == null) - Number(b.position == null) ||
          Number(a.position ?? 0) - Number(b.position ?? 0) ||
          String(a.created_at).localeCompare(String(b.created_at)),
      );
  const collectionRow = (id: string) => {
    const c = library.row("collections", [id]);
    if (!c || c.deleted_at) throw new Error("that collection no longer exists");
    return c;
  };
  const memberRows = (id: string) => library.rows("collection_books").filter((m) => m.collection_id === id && !m.removed_at);
  const rulesOf = (c: Row) => (c.rules ? parse<CollectionRules | null>(c.rules, null) : null);

  const membersOf = (c: Row, all = bookById()): BookPreview[] => {
    const list = [...all.values()];
    if (c.kind === "shelf") return c.id === UP_NEXT.id ? list.filter((b) => b.wantToRead).sort((a, b) => newest(a.addedAt, b.addedAt) || byTitle(a, b)) : [];
    const rules = rulesOf(c);
    if (rules) return list.filter((b) => matches(b, rules, extras(b.id))).sort((a, b) => newest(a.addedAt, b.addedAt) || byTitle(a, b));
    const members = memberRows(String(c.id));
    const reading = c.kind === "reading_list";
    const order = (m: Row) => (reading ? Number(m.position ?? 1e12) : -Date.parse(String(m.added_at)));
    return members
      .sort((a, b) => order(a) - order(b))
      .map((m) => all.get(String(m.book_id)))
      .filter((b): b is BookPreview => !!b);
  };
  const extras = (id: string) => {
    const b = library.book(id);
    return { publisher: b?.publisher ?? undefined, language: b?.language ?? undefined };
  };
  const averageRating = (list: BookPreview[]) => {
    const rated = list.map((b) => b.rating).filter((r): r is number => r !== null);
    return rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
  };

  const summary = (c: Row, all = bookById()): CollectionSummary => {
    const members = membersOf(c, all);
    const picture = (c.picture as string | null) ?? null;
    const picturePath = picture?.startsWith("cover:")
      ? (all.get(picture.slice(6))?.coverPath ?? null)
      : picture?.startsWith("picture:")
        ? (sync.pictureUrls.get(picture.slice(8)) ?? null)
        : null;
    return {
      id: String(c.id),
      name: String(c.name),
      description: (c.description as string | null) ?? null,
      kind: (c.kind as CollectionKind) ?? "collection",
      badge: (c.badge as string | null) ?? null,
      picture,
      picturePath,
      pinned: !!c.pinned,
      rules: rulesOf(c),
      count: members.length,
      rating: averageRating(members),
      covers: members.slice(0, 3).map(coverOf),
      createdAt: String(c.created_at),
      updatedAt: String(c.updated_at ?? c.created_at),
    };
  };

  const smartBooks: Record<SmartKind, (b: BookPreview) => boolean> = {
    recently_added: (b) => Date.now() - Date.parse(b.addedAt) < 30 * DAY,
    unread: (b) => b.status === "unread",
    read: (b) => b.status === "read",
    in_progress: (b) => b.status === "in_progress",
    favorites: (b) => b.favorite,
  };
  const smartOrder: Record<SmartKind, (a: BookPreview, b: BookPreview) => number> = {
    recently_added: (a, b) => newest(a.addedAt, b.addedAt),
    unread: (a, b) => newest(a.addedAt, b.addedAt),
    favorites: (a, b) => newest(a.addedAt, b.addedAt),
    read: (a, b) => Number(!a.lastOpenedAt) - Number(!b.lastOpenedAt) || newest(a.lastOpenedAt, b.lastOpenedAt),
    in_progress: (a, b) => Number(!a.lastOpenedAt) - Number(!b.lastOpenedAt) || newest(a.lastOpenedAt, b.lastOpenedAt),
  };

  const booksFor = (ref: CollectionRef): BookPreview[] => {
    if (ref.kind === "collection") return membersOf(collectionRow(ref.id));
    if (ref.kind === "series")
      return books()
        .filter((b) => b.series === ref.name)
        .sort((a, b) => (a.seriesIndex ?? 1e9) - (b.seriesIndex ?? 1e9) || byTitle(a, b));
    return books()
      .filter(smartBooks[ref.smart])
      .sort((a, b) => smartOrder[ref.smart](a, b) || byTitle(a, b));
  };

  const previews = (): CollectionPreview[] => {
    const all = bookById();
    return collectionRows()
      .filter((c) => c.kind !== "shelf")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((c) => {
        const members = membersOf(c, all);
        return { id: String(c.id), name: String(c.name), count: members.length, coverPaths: members.slice(0, 4).flatMap((b) => (b.coverPath ? [b.coverPath] : [])) };
      });
  };

  const checkRules = (input: CollectionInput): { kind: CollectionKind; rules: string | null } => {
    if (!input.rules) return { kind: input.kind, rules: null };
    const rules = { any: input.rules.any, rules: input.rules.rules.filter(usable).slice(0, 12) };
    if (!rules.rules.length) throw new Error("add at least one rule, or choose books by hand");
    return { kind: "collection", rules: JSON.stringify(rules) };
  };

  const renumber = (id: string, order: string[]) => {
    const rows = new Map(memberRows(id).map((m) => [String(m.book_id), m]));
    const stamp = now();
    const changes: [string, Row][] = [];
    order.forEach((bookId, i) => {
      const m = rows.get(bookId);
      if (m && Number(m.position) !== i + 1) changes.push(["collection_book", { ...m, position: i + 1, updated_at: stamp }]);
    });
    return library.writeAll(changes);
  };

  // ---- Notes ----

  const annotationRows = () => library.rows("annotations").filter((a) => !a.deleted_at);
  const toAnnotation = (a: Row): Annotation => ({
    id: String(a.id),
    bookId: String(a.book_id) as BookId,
    kind: String(a.kind) as AnnotationKind,
    excerpt: String(a.excerpt ?? ""),
    note: (a.note as string | null) ?? null,
    color: (a.color as HighlightColor | null) ?? null,
    locator: parse<ReaderLocator>(a.locator, {}),
    createdAt: String(a.created_at ?? a.updated_at),
    updatedAt: String(a.updated_at),
  });

  const noteItems = (): NoteItem[] => {
    const all = bookById();
    const items: NoteItem[] = [];
    for (const row of annotationRows()) {
      const a = toAnnotation(row);
      const b = all.get(a.bookId);
      if (!b || a.kind === "bookmark") continue;
      const bookNote = (a.kind as string) === "book_note";
      items.push({
        id: a.id,
        kind: bookNote ? "book_note" : a.note?.trim() || a.kind === "note" ? "annotation" : "highlight",
        book: coverOf(b),
        excerpt: a.excerpt,
        note: a.note,
        title: null,
        color: a.color,
        locator: bookNote ? null : a.locator,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      });
    }
    for (const p of library.rows("personal_notes")) {
      if (p.deleted_at) continue;
      items.push({
        id: String(p.id),
        kind: "personal",
        book: null,
        excerpt: "",
        note: String(p.body ?? ""),
        title: (p.title as string | null) ?? null,
        color: null,
        locator: null,
        createdAt: String(p.created_at),
        updatedAt: String(p.updated_at),
      });
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };
  const note = (id: string) => {
    const n = noteItems().find((x) => x.id === id);
    if (!n) throw new Error("that note no longer exists");
    return n;
  };
  const annotationRow = (id: string) => {
    const a = library.row("annotations", [id]);
    if (!a || a.deleted_at) throw new Error("that note no longer exists");
    return a;
  };

  // ---- Settings and profile, kept in this browser only ----

  /** Where early web versions kept a picture for this browser only. */
  const AVATAR = "profile.avatar";
  /** The library's profile picture, shared by every device; else one this browser kept before pictures synced. */
  const profile = () => {
    const avatar = library.row("profile", ["me"])?.avatar;
    if (typeof avatar === "string") return { avatarPath: sync.pictureUrls.get(avatar) ?? null };
    return { avatarPath: avatar === null ? null : (db.meta.get(AVATAR) ?? null) };
  };

  const api: Api = {
    kind: "web",
    ...moveStub(),
    getHome: async (): Promise<HomeViewModel> => {
      const all = books();
      // Home is for reading; audiobooks have their own page.
      const reading = all.filter((b) => !isAudio(b.format));
      const inProgress = reading.filter((b) => b.status === "in_progress").sort((a, b) => newest(a.lastOpenedAt, b.lastOpenedAt));
      const titles = new Map(all.map((b) => [b.id as string, b.title]));
      return {
        resumeBook: inProgress[0] ?? null,
        recentlyAdded: [...reading].sort((a, b) => newest(a.addedAt, b.addedAt)).slice(0, 5),
        inProgress: inProgress.slice(0, 3),
        collections: previews().slice(0, 4),
        annotations: annotationRows()
          .map(toAnnotation)
          .filter((a) => (a.kind === "note" || a.kind === "highlight") && titles.has(a.bookId))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 2)
          .map((a) => ({ ...a, bookTitle: titles.get(a.bookId)! })),
        libraryCounts: {
          total: all.length,
          unread: all.filter((b) => b.status === "unread").length,
          inProgress: inProgress.length,
          read: all.filter((b) => b.status === "read").length,
        },
        activity: null,
        sync: sync.status(),
      };
    },
    queueImports: async (paths) => phoneImports.queue(paths),
    importQueue: async () => phoneImports.view(),
    takePdfCovers: async () => [],
    cancelImports: async () => phoneImports.cancel(),
    clearFinishedImports: async () => phoneImports.clearFinished(),
    onImports: (listener) => phoneImports.subscribe(listener),
    syncActivity: async () => ({ running: false, startedAt: null, finishedAt: null, places: [], recent: [] }),
    onSyncActivity: (listener) => {
      let stopped = false;
      void Promise.resolve().then(() => !stopped && listener({ running: false, startedAt: null, finishedAt: null, places: [], recent: [] }));
      return () => {
        stopped = true;
      };
    },
    setBookStatus: async (bookId, status) => {
      const b = find(bookId);
      const at = now();
      if (status === "unread") await writeProgress(bookId, { status, total_progression: null, resume_locator: null, finished_at: null });
      else if (status === "in_progress") await writeProgress(bookId, { status, last_opened_at: b.last_opened_at ?? at });
      else await writeProgress(bookId, { status, finished_at: b.finished_at ?? at });
    },
    getLibrary: async (query) => queryBooks(books(), query, previews().length),
    getCollections: async () => previews(),
    setFavorite: async (bookId, favorite) => writeShelves(bookId, { favorite: favorite ? 1 : 0 }),
    setWantToRead: async (bookId, want) => writeShelves(bookId, { want_to_read: want ? 1 : 0 }),
    setPhoneWanted: async (bookIds, wanted) => {
      const changes: [string, Row][] = [];
      for (const id of bookIds) {
        const b = library.book(id);
        if (b && !!b.phone_wanted !== wanted) changes.push(["book_phone", { ...b, phone_wanted: wanted ? 1 : 0 }]);
      }
      if (changes.length) await library.writeAll(changes);
    },
    setRating: async (bookId, rating) => writeShelves(bookId, { rating: rating === null ? null : Math.min(5, Math.max(1, Math.round(rating))) }),
    importGoodreads: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    exportGoodreads: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    hardcoverStatus: async () => ({ available: false, username: null, sendRatings: false }),
    hardcoverSignIn: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    hardcoverSignOut: async () => ({ available: false, username: null, sendRatings: false }),
    hardcoverSetSending: async () => ({ available: false, username: null, sendRatings: false }),
    hardcoverSendAll: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    onHardcoverNotice: () => () => undefined,
    bookText: async () => {
      throw new Error("Old Word (DOC) files open in the desktop app.");
    },
    fillCover: async () => false,
    fetchCover: async () => false,
    getProfile: async () => profile(),
    chooseAvatar: async () => {
      const file = await pickFile("image/png,image/jpeg,image/webp,image/gif");
      if (!file) return null;
      if (file.size > 4 * 1024 * 1024) throw new Error("choose a picture under 4 MB");
      const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[file.type] ?? "png";
      // The same kind of name the desktop app gives it, so every device finds it.
      const name = `avatar-${crypto.randomUUID()}.${extension}`;
      await sync.addPicture(name, file);
      await db.setMeta(AVATAR, null);
      await library.write("profile", { id: "me", avatar: name, updated_at: now() });
      return profile();
    },
    clearAvatar: async () => {
      await db.setMeta(AVATAR, null);
      await library.write("profile", { id: "me", avatar: null, updated_at: now() });
      return profile();
    },
    pickBooks: () => phoneImports.pick(false),
    pickFolder: () => phoneImports.pick(true),
    coverUrl: (path) => (/^(blob|data|https?):/.test(path) ? path : ""),
    openBook: async (bookId) => {
      const before = find(bookId);
      await writeProgress(bookId, { last_opened_at: now(), status: before.status === "unread" ? "in_progress" : before.status });
      return {
        book: bookPreview(bookId),
        publisher: before.publisher,
        language: before.language,
        fileSize: before.file_size ?? 0,
        previouslyOpenedAt: before.last_opened_at,
      };
    },
    readBookFile: async (bookId) => {
      const b = find(bookId);
      const blob = await sync.bookFile(b.id, b.format);
      await refreshDownloaded();
      if (downloaded.has(b.id.replace(/^sha256:/, ""))) await notePhoneHas(b.id, true);
      return blob;
    },
    savePosition: async (bookId, locator) => {
      const p = locator.totalProgression;
      await writeProgress(bookId, {
        resume_locator: JSON.stringify(locator),
        total_progression: typeof p === "number" ? Math.min(1, Math.max(0, p)) : (find(bookId).total_progression ?? null),
      });
    },
    audiobook: async (bookId) => {
      const book = bookPreview(bookId);
      const a = audioRow(bookId);
      const ebook = a?.ebook_id ? library.book(a.ebook_id) : null;
      return {
        book,
        narrators: book.narrators ?? [],
        durationMs: a?.duration_ms ?? 0,
        chapters: parse<AudioChapter[]>(a?.chapters ?? null, []),
        parts: parse<AudioPart[]>(a?.parts ?? null, []),
        positionMs: book.resumeLocator?.audioMs ?? 0,
        ebook: ebook ? { id: ebook.id, name: bookPreview(ebook.id).title } : null,
      };
    },
    saveListening: async (bookId, positionMs, chapter) => {
      const duration = audioRow(bookId)?.duration_ms ?? 0;
      const before = find(bookId);
      const totalProgression = duration > 0 ? Math.min(1, Math.max(0, positionMs / duration)) : (before.total_progression ?? null);
      await writeProgress(bookId, {
        resume_locator: JSON.stringify({ audioMs: Math.round(positionMs), totalProgression, chapter }),
        total_progression: totalProgression,
        last_opened_at: now(),
        status: before.status === "unread" && positionMs > 0 ? "in_progress" : before.status,
      });
    },
    linkEbook: async (audiobookId, ebookId) => {
      const a = audioRow(audiobookId);
      if (!a) throw new Error("That audiobook's details haven't arrived here yet.");
      await library.write("audiobook", { ...a, ebook_id: ebookId, updated_at: now() });
    },
    audiobookForEbook: async (ebookId) =>
      (library.rows("audiobooks").find((a) => a.ebook_id === ebookId && library.book(String(a.book_id)))?.book_id as string) ?? null,
    // Audiobooks stream from Supabase here; nothing is kept on the phone.
    audioUrl: () => null,
    prepareStream: async (bookId) => {
      const b = library.book(bookId);
      if (!b) throw new Error("That audiobook's details haven't arrived here yet.");
      if (b.format === "tbvaudio")
        throw new Error("This audiobook is a folder of several files, which plays in the desktop app. Single-file audiobooks (M4B, MP3) play here.");
      const url = await sync.streamUrl(bookId, String(b.format));
      // Listened to here, so tidying Supabase keeps it.
      await notePhoneHas(bookId, true);
      return [url];
    },
    getAnnotations: async (bookId) =>
      annotationRows()
        .filter((a) => a.book_id === bookId && a.kind !== "book_note")
        .map(toAnnotation)
        .sort((a, b) => (a.locator.totalProgression ?? 0) - (b.locator.totalProgression ?? 0) || a.createdAt.localeCompare(b.createdAt)),
    saveAnnotation: async (input) => {
      if (input.color && !["rose", "amber", "sage", "slate"].includes(input.color)) throw new Error(`“${input.color}” isn't a highlight colour.`);
      const id = input.id ?? crypto.randomUUID();
      const old = library.row("annotations", [id]);
      const at = now();
      const row: Row = {
        id,
        book_id: input.bookId,
        kind: input.kind,
        excerpt: input.excerpt,
        note: clean(input.note),
        locator: JSON.stringify(input.locator),
        color: input.color ?? null,
        created_at: old?.created_at ?? at,
        updated_at: at,
        deleted_at: null,
      };
      await library.write("annotation", row);
      return toAnnotation(row);
    },
    deleteAnnotation: async (id) => {
      const a = library.row("annotations", [id]);
      if (a) await library.write("annotation", { ...a, deleted_at: now(), updated_at: now() });
    },
    getSetting: async (key) => db.meta.get(`setting.${key}`) ?? null,
    setSetting: async (key, value) => db.setMeta(`setting.${key}`, value),
    quit: async () => undefined,

    getCollectionsOverview: async () => {
      const all = bookById();
      const list = [...all.values()];
      const rows = collectionRows();
      const series = new Map<string, BookPreview[]>();
      for (const b of list) if (b.series?.trim()) series.set(b.series, [...(series.get(b.series) ?? []), b]);
      return {
        pinned: rows.filter((c) => c.pinned).map((c) => summary(c, all)),
        smart: SMART.map((kind) => {
          const members = list.filter(smartBooks[kind]);
          return { kind, count: members.length, rating: averageRating(members) };
        }),
        collections: rows.filter((c) => c.kind !== "shelf").map((c) => summary(c, all)),
        series: [...series.entries()]
          .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
          .map(([name, members]) => {
            const ordered = members.sort((a, b) => (a.seriesIndex ?? 1e9) - (b.seriesIndex ?? 1e9) || byTitle(a, b));
            return { name, count: members.length, authors: [...new Set(ordered.map((b) => b.authors[0]).filter(Boolean))], covers: ordered.slice(0, 3).map(coverOf) };
          }),
      };
    },
    getCollection: async (ref) => ({
      collection: ref.kind === "collection" ? summary(collectionRow(ref.id)) : null,
      books: booksFor(ref),
    }),
    createCollection: async (input) => {
      if (input.kind === "shelf") throw new Error("only collections and reading lists can be made");
      const name = clean(input.name, MAX_NAME);
      if (!name) throw new Error("give the collection a name");
      const { kind, rules } = checkRules(input);
      const at = now();
      const position = Math.max(0, ...library.rows("collections").map((c) => Number(c.position ?? 0))) + 1;
      const row: Row = {
        id: crypto.randomUUID(),
        name,
        description: clean(input.description, MAX_DESCRIPTION),
        kind,
        badge: cleanBadge(input.badge),
        picture: null,
        pinned: input.pinned ? 1 : 0,
        position,
        created_at: at,
        updated_at: at,
        deleted_at: null,
        rules,
      };
      await library.write("collection", row);
      return summary(row);
    },
    countRuleMatches: async (rules) => books().filter((b) => matches(b, rules, extras(b.id))).length,
    updateCollection: async (id, input) => {
      const c = collectionRow(id);
      const at = now();
      if (c.kind === "shelf") {
        await library.write("collection", { ...c, badge: cleanBadge(input.badge), pinned: input.pinned ? 1 : 0, updated_at: at });
      } else {
        if (input.kind === "shelf") throw new Error("a collection can't become a shelf");
        const name = clean(input.name, MAX_NAME);
        if (!name) throw new Error("give the collection a name");
        const { kind, rules } = checkRules(input);
        await library.write("collection", {
          ...c,
          name,
          description: clean(input.description, MAX_DESCRIPTION),
          kind,
          badge: cleanBadge(input.badge),
          pinned: input.pinned ? 1 : 0,
          updated_at: at,
          rules,
        });
        if (c.kind !== "reading_list" && kind === "reading_list") {
          const order = memberRows(id)
            .sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)))
            .map((m) => String(m.book_id));
          await renumber(id, order);
        }
      }
      return summary(collectionRow(id));
    },
    deleteCollection: async (id) => {
      const c = collectionRow(id);
      if (c.kind === "shelf") throw new Error("the built-in shelves can't be deleted");
      await library.write("collection", { ...c, deleted_at: now(), updated_at: now() });
    },
    setCollectionPicture: async (id, picture) => {
      const ok = !picture || /^gallery:[a-z-]{1,32}$/.test(picture) || /^cover:sha256:/.test(picture);
      if (!ok) throw new Error("that picture can't be used");
      await library.write("collection", { ...collectionRow(id), picture, updated_at: now() });
      return summary(collectionRow(id));
    },
    pickCollectionPicture: async () => {
      throw new Error("Choosing a picture of your own works in the desktop app.");
    },
    setCollectionPictureFile: async () => {
      throw new Error("Choosing a picture of your own works in the desktop app.");
    },
    addToCollection: async (id, bookIds) => {
      const c = collectionRow(id);
      if (c.kind === "shelf") throw new Error("books join a shelf from their own menu");
      if (c.rules) throw new Error("this collection fills itself from its rules");
      const at = now();
      const live = memberRows(id);
      let position = Math.max(0, ...live.map((m) => Number(m.position ?? 0)));
      const changes: [string, Row][] = [];
      for (const bookId of bookIds) {
        if (!library.book(bookId) || live.some((m) => m.book_id === bookId)) continue;
        changes.push(["collection_book", { collection_id: id, book_id: bookId, added_at: at, position: ++position, removed_at: null, updated_at: at }]);
      }
      await library.writeAll(changes);
    },
    removeFromCollection: async (id, bookId) => {
      const m = library.row("collection_books", [id, bookId]);
      if (m && !m.removed_at) await library.write("collection_book", { ...m, removed_at: now(), updated_at: now() });
    },
    moveCollection: async (id, toIndex) => {
      const own = collectionRows().filter((c) => c.kind !== "shelf");
      const from = own.findIndex((c) => c.id === id);
      if (from < 0) throw new Error("that collection no longer exists");
      const [moved] = own.splice(from, 1);
      own.splice(Math.min(toIndex, own.length), 0, moved);
      const at = now();
      await library.writeAll(
        own.flatMap((c, i): [string, Row][] => (Number(c.position) === i + 2 ? [] : [["collection", { ...c, position: i + 2, updated_at: at }]])),
      );
    },
    moveInCollection: async (id, bookId, toIndex) => {
      const order = membersOf(collectionRow(id)).map((b) => b.id as string);
      const from = order.indexOf(bookId);
      if (from < 0) return;
      order.splice(from, 1);
      order.splice(Math.min(toIndex, order.length), 0, bookId);
      await renumber(id, order);
    },
    collectionsForBook: async (bookId) => {
      const live = new Set(collectionRows().filter((c) => c.kind !== "shelf").map((c) => String(c.id)));
      return library
        .rows("collection_books")
        .filter((m) => m.book_id === bookId && !m.removed_at && live.has(String(m.collection_id)))
        .map((m) => String(m.collection_id));
    },

    getNotes: async (q) => {
      const list = noteItems();
      const noteBooks = new Map<string, CoverRef>();
      for (const n of list) if (n.book) noteBooks.set(n.book.id, n.book);
      const s = q.search?.trim().toLowerCase();
      const tabOf: Record<string, NoteKind | null> = { all: null, highlights: "highlight", annotations: "annotation", book_notes: "book_note", personal: "personal" };
      let notes = list.filter(
        (n) =>
          (!tabOf[q.tab] || n.kind === tabOf[q.tab]) &&
          (!q.bookId || n.book?.id === q.bookId) &&
          (!q.colors.length || (n.color && q.colors.includes(n.color))) &&
          (!s || [n.excerpt, n.note, n.title, n.book?.title, n.locator?.chapter, ...(n.book?.authors ?? [])].some((t) => t?.toLowerCase().includes(s))),
      );
      if (q.sort === "updated") notes = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (q.sort === "book")
        notes = [...notes].sort(
          (a, b) =>
            Number(!a.book) - Number(!b.book) ||
            (a.book?.title ?? "").localeCompare(b.book?.title ?? "") ||
            (a.locator?.totalProgression ?? -1) - (b.locator?.totalProgression ?? -1),
        );
      return {
        notes,
        counts: {
          all: list.length,
          highlights: list.filter((n) => n.kind === "highlight").length,
          annotations: list.filter((n) => n.kind === "annotation").length,
          bookNotes: list.filter((n) => n.kind === "book_note").length,
          personal: list.filter((n) => n.kind === "personal").length,
        },
        books: [...noteBooks.values()].sort((a, b) => a.title.localeCompare(b.title)),
      };
    },
    saveBookNote: async (bookId, id, text) => {
      const body = clean(text);
      if (!body) throw new Error("the note is empty");
      const at = now();
      if (id) {
        const a = annotationRow(id);
        if (a.kind !== "book_note") throw new Error("that note no longer exists");
        await library.write("annotation", { ...a, note: body, updated_at: at });
        return note(id);
      }
      find(bookId);
      const fresh = crypto.randomUUID();
      await library.write("annotation", {
        id: fresh,
        book_id: bookId,
        kind: "book_note",
        excerpt: "",
        note: body,
        locator: "{}",
        color: null,
        created_at: at,
        updated_at: at,
        deleted_at: null,
      });
      return note(fresh);
    },
    savePersonalNote: async (id, title, body) => {
      const t = clean(title, MAX_TITLE);
      const b = clean(body);
      if (!t && !b) throw new Error("the note is empty");
      const at = now();
      if (id) {
        const p = library.row("personal_notes", [id]);
        if (!p || p.deleted_at) throw new Error("that note no longer exists");
        await library.write("personal_note", { ...p, title: t, body: b ?? "", updated_at: at });
        return note(id);
      }
      const fresh = crypto.randomUUID();
      await library.write("personal_note", { id: fresh, title: t, body: b ?? "", created_at: at, updated_at: at, deleted_at: null });
      return note(fresh);
    },
    setAnnotationNote: async (id, text) => {
      const a = annotationRow(id);
      if (a.kind !== "highlight" && a.kind !== "note") throw new Error("that note no longer exists");
      await library.write("annotation", { ...a, note: clean(text), updated_at: now() });
      return note(id);
    },
    deleteNote: async (id, kind) => {
      if (kind === "personal") {
        const p = library.row("personal_notes", [id]);
        if (p) await library.write("personal_note", { ...p, deleted_at: now(), updated_at: now() });
      } else await api.deleteAnnotation(id);
    },

    libraryInfo: async () => {
      let bytes = 0;
      for (const p of await db.filePaths()) bytes += (await db.getFile(p))?.size ?? 0;
      return { database: "This browser", booksDir: "This browser", schemaVersion: 8, bookCount: library.books().length, databaseBytes: 0, booksBytes: bytes };
    },
    exportLibrary: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    exportNotesMarkdown: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    createBackup: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    restoreBackup: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    coverAccent: async (bookId) => {
      const url = sync.coverUrls.get(bookId.replace(/^sha256:/, ""));
      return url ? accentOf(url) : null;
    },
    showFolder: async () => undefined,
    syncOverview: async () => sync.overview(),
    syncNow: () => sync.now(),
    syncSignIn: (email, password, create) => sync.signIn(email, password, create),
    syncSignOut: () => sync.signOut(),
    setSupabaseProject: (project) => sync.setProject(project),
    setSyncProvider: async (provider) => {
      if (provider.kind !== "supabase") throw new Error("The web version syncs through Supabase only.");
      return false;
    },
    setAlsoSync: async () => {
      throw new Error("The web version syncs through Supabase only.");
    },
    chooseFolder: async () => null,
    suggestSyncFolder: async () => null,
    resolveSyncConflict: async () => undefined,
    downloadBook: async (bookId) => {
      await api.readBookFile(bookId);
    },
    allTags: async (): Promise<TagCount[]> => tagCounts(books()),
    addTag: async (bookIds, tag) => {
      const typed = cleanTag(tag);
      if (!typed) throw new Error("Type a tag first.");
      const kept = tagCounts(books()).find((t) => t.name.toLowerCase() === typed.toLowerCase())?.name ?? typed;
      const at = now();
      const changes: [string, Row][] = [];
      for (const id of bookIds) {
        if (!library.book(id)) continue;
        const has = tagsOf(id);
        if (has.length >= 50 || has.some((t) => t.toLowerCase() === kept.toLowerCase())) continue;
        changes.push(["book_tag", { book_id: id, tag: kept, added_at: at, removed_at: null, updated_at: at }]);
      }
      await library.writeAll(changes);
      return kept;
    },
    removeTag: async (bookIds, tag) => {
      const ids = new Set(bookIds);
      const at = now();
      await library.writeAll(
        library
          .rows("book_tags")
          .filter((t) => ids.has(String(t.book_id)) && !t.removed_at && String(t.tag).toLowerCase() === tag.toLowerCase())
          .map((t): [string, Row] => ["book_tag", { ...t, removed_at: at, updated_at: at }]),
      );
    },
    setBookTags: async (bookId, tags) => {
      find(bookId);
      const wanted = new Map<string, string>();
      for (const t of tags.map(cleanTag)) if (t && wanted.size < 50) wanted.set(t.toLowerCase(), t);
      const have = tagsOf(bookId);
      for (const t of have) if (!wanted.has(t.toLowerCase())) await api.removeTag([bookId], t);
      for (const t of wanted.values()) if (!have.some((h) => h.toLowerCase() === t.toLowerCase())) await api.addTag([bookId], t);
    },
    deleteBook: async (bookId) => {
      const b = find(bookId);
      const at = now();
      const changes: [string, Row][] = [["book", { ...b, deleted_at: at }]];
      for (const a of library.rows("annotations"))
        if (a.book_id === bookId && !a.deleted_at) changes.push(["annotation", { ...a, deleted_at: at, updated_at: at }]);
      for (const m of library.rows("collection_books"))
        if (m.book_id === bookId && !m.removed_at) changes.push(["collection_book", { ...m, removed_at: at, updated_at: at }]);
      for (const t of library.rows("book_tags"))
        if (t.book_id === bookId && !t.removed_at) changes.push(["book_tag", { ...t, removed_at: at, updated_at: at }]);
      await library.writeAll(changes);
      await db.deleteFile(`books/${bookId.replace(/^sha256:/, "")}.${b.format}`).catch(() => undefined);
      await sync.eraseBook(bookId, b.format).catch(() => undefined);
      await refreshDownloaded();
    },
    // A browser saves each book to its downloads.
    saveCopies: async (bookIds) => {
      let saved = 0;
      for (const id of bookIds) {
        const b = find(id);
        const blob = await sync.bookFile(b.id, b.format);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = copyName(b.title, listOf(b.authors), b.format);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        saved++;
      }
      return { saved, folder: "your downloads" };
    },
    // Out of the library everywhere; notes, tags, collections and the cloud file wait for it to come back.
    removeFromLibrary: async (bookId) => {
      const b = find(bookId);
      await library.writeAll([["book", { ...b, deleted_at: now() }]]);
      await db.deleteFile(`books/${bookId.replace(/^sha256:/, "")}.${b.format}`).catch(() => undefined);
      await refreshDownloaded();
    },
    removeDownload: async (bookId) => {
      const b = find(bookId);
      await db.deleteFile(`books/${bookId.replace(/^sha256:/, "")}.${b.format}`);
      await refreshDownloaded();
      await notePhoneHas(bookId, false);
      library.changed();
    },
    findDuplicates: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    bookDetails: async (bookId) => {
      const b = find(bookId);
      const own = new Set(collectionRows().filter((c) => c.kind !== "shelf").map((c) => String(c.id)));
      const names = new Map(collectionRows().map((c) => [String(c.id), String(c.name)]));
      return {
        book: bookPreview(bookId),
        fields: detailFields(b),
        fileSize: Number(b.file_size) || 0,
        filePath: null,
        collections: library
          .rows("collection_books")
          .filter((m) => m.book_id === bookId && !m.removed_at && own.has(String(m.collection_id)))
          .map((m) => ({ id: String(m.collection_id), name: names.get(String(m.collection_id)) ?? "" })),
        annotations: annotationRows().filter((a) => a.book_id === bookId).length,
      };
    },
    editDetails: async (bookIds, changes) => {
      const cleaned = changes.map((c) => ({ ...c, value: c.value === null ? null : cleanValue(c.field, c.value) }));
      const at = now();
      const writes: [string, Row][] = [];
      const removes: [string, unknown[]][] = [];
      for (const id of bookIds) {
        if (!library.book(id)) continue;
        for (const c of cleaned) {
          if (c.value === null) {
            if (library.row("metadata_overrides", [id, c.field])) removes.push(["override", [id, c.field]]);
          } else writes.push(["override", { book_id: id, field: c.field, value: c.value, updated_at: at }]);
        }
      }
      await library.writeAll(writes);
      await library.remove(removes);
    },
    resetDetails: async (bookId, alsoFetched) => {
      const mine = (table: "metadata_overrides" | "metadata_fetched", kind: string) =>
        library
          .rows(table)
          .filter((o) => o.book_id === bookId && (table === "metadata_overrides" || o.source !== "file"))
          .map((o): [string, unknown[]] => [kind, [bookId, o.field]]);
      await library.remove([...mine("metadata_overrides", "override"), ...(alsoFetched ? mine("metadata_fetched", "fetched") : [])]);
    },
    searchDetailsMore: async () => [],
    // The phone version served by the computer is turned on there.
    homeStatus: async () => ({ on: false, addresses: [], code: null, qr: null, phones: 0, problem: null }),
    setHome: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    newHomeCode: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    forgetHomePhones: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    onHomeChanged: () => () => undefined,
    // Finding a series' missing books happens in the desktop app.
    findSeriesBooks: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    seriesReview: async (name) => ({ name, checkedAt: null, listed: 0, owned: 0, missing: [], matches: [] }),
    hideSeriesBook: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    approveSeriesMatches: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    denySeriesMatches: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    saveFetched: async (bookId, source, values) => {
      find(bookId);
      const at = now();
      const writes: [string, Row][] = [];
      for (const [field, value] of Object.entries(values)) {
        const v = cleanValue(field as DetailField["field"], value);
        if (v && v !== "[]") writes.push(["fetched", { book_id: bookId, field, value: v, source, updated_at: at }]);
      }
      await library.writeAll(writes);
    },
    dismissDuplicates: async () => undefined,
    // A browser can't reach drives or send email; the desktop app does that.
    listEreaders: async () => [],
    copyToEreader: async () => {
      throw new Error(SENDING_DESKTOP_ONLY);
    },
    kindleEmailSettings: async () => null,
    saveKindleEmail: async () => {
      throw new Error(SENDING_DESKTOP_ONLY);
    },
    forgetKindleEmail: async () => undefined,
    sendToKindle: async () => {
      throw new Error(SENDING_DESKTOP_ONLY);
    },
    sendKindleTest: async () => {
      throw new Error(SENDING_DESKTOP_ONLY);
    },
    ...serverStub(),
    onSync: ({ status, libraryChanged }) => {
      const stops: (() => void)[] = [];
      if (status) stops.push(sync.onStatus(status));
      if (libraryChanged) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        stops.push(
          library.subscribe(() => {
            clearTimeout(timer);
            timer = setTimeout(libraryChanged, 150);
          }),
        );
      }
      return () => stops.forEach((s) => s());
    },
  };
  return api;
}

/** Asks for one file from the phone or computer. Null if cancelled. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** The cover's most telling colour, as #rrggbb: its average, skipping near-white and near-black. */
async function accentOf(url: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(img, 0, 0, 24, 24);
    const px = g.getImageData(0, 0, 24, 24).data;
    let r = 0,
      gr = 0,
      b = 0,
      n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const sum = px[i] + px[i + 1] + px[i + 2];
      if (sum < 60 || sum > 700) continue;
      r += px[i];
      gr += px[i + 1];
      b += px[i + 2];
      n++;
    }
    if (!n) return null;
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(gr)}${hex(b)}`;
  } catch {
    return null;
  }
}
