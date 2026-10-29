// The library as the web version sees it: tables rebuilt from the synced
// records, and changes written back as records, the same way the desktop
// app's triggers record them (see crates/tbv-core/src/sync/mod.rs, KINDS).

import { recordId, type Stored, type WebDb } from "./db";

type Row = { [column: string]: unknown };

interface Kind {
  name: string;
  table: Table;
  keys: string[];
  cols: string[];
}

export type Table =
  | "books"
  | "audiobooks"
  | "metadata_overrides"
  | "metadata_fetched"
  | "collections"
  | "collection_books"
  | "book_tags"
  | "annotations"
  | "profile"
  | "read_along"
  | "read_along_pieces"
  | "personal_notes"
  | "writing_projects"
  | "writing_chapters"
  | "bookmarks"
  | "time_log";

/** Keep in step with KINDS in the core. */
export const KINDS: Kind[] = [
  {
    name: "book",
    table: "books",
    keys: ["id"],
    cols: ["title", "authors", "format", "file_size", "synopsis", "publisher", "language", "series", "series_index", "added_at", "deleted_at", "isbn"],
  },
  { name: "audiobook", table: "audiobooks", keys: ["book_id"], cols: ["narrators", "duration_ms", "chapters", "parts", "ebook_id", "updated_at"] },
  { name: "read_along", table: "read_along", keys: ["ebook_id", "audiobook_id"], cols: ["timing", "updated_at"] },
  { name: "read_along_piece", table: "read_along_pieces", keys: ["ebook_id", "audiobook_id", "piece"], cols: ["anchors", "updated_at"] },
  { name: "book_phone", table: "books", keys: ["id"], cols: ["phone_wanted", "phone_has", "from_phone"] },
  { name: "book_same", table: "books", keys: ["id"], cols: ["same_as"] },
  { name: "book_progress", table: "books", keys: ["id"], cols: ["status", "total_progression", "resume_locator", "last_opened_at", "finished_at"] },
  { name: "book_shelves", table: "books", keys: ["id"], cols: ["favorite", "want_to_read", "rating"] },
  { name: "override", table: "metadata_overrides", keys: ["book_id", "field"], cols: ["value", "updated_at"] },
  { name: "fetched", table: "metadata_fetched", keys: ["book_id", "field"], cols: ["value", "source", "updated_at"] },
  {
    name: "collection",
    table: "collections",
    keys: ["id"],
    cols: ["name", "created_at", "deleted_at", "description", "kind", "badge", "picture", "pinned", "position", "updated_at", "rules"],
  },
  { name: "collection_book", table: "collection_books", keys: ["collection_id", "book_id"], cols: ["added_at", "position", "removed_at", "updated_at"] },
  { name: "book_tag", table: "book_tags", keys: ["book_id", "tag"], cols: ["added_at", "removed_at", "updated_at"] },
  {
    name: "annotation",
    table: "annotations",
    keys: ["id"],
    cols: ["book_id", "kind", "excerpt", "note", "locator", "color", "created_at", "updated_at", "deleted_at"],
  },
  { name: "profile", table: "profile", keys: ["id"], cols: ["avatar", "name", "updated_at"] },
  { name: "personal_note", table: "personal_notes", keys: ["id"], cols: ["title", "body", "created_at", "updated_at", "deleted_at"] },
  {
    name: "writing_project",
    table: "writing_projects",
    keys: ["id"],
    cols: ["title", "author", "series", "series_index", "language", "description", "cover", "export", "created_at", "updated_at", "deleted_at"],
  },
  { name: "writing_chapter", table: "writing_chapters", keys: ["id"], cols: ["project_id", "title", "body", "position", "created_at", "updated_at", "deleted_at", "role"] },
  { name: "bookmark", table: "bookmarks", keys: ["id"], cols: ["title", "url", "position", "created_at", "updated_at", "deleted_at"] },
  { name: "time_log", table: "time_log", keys: ["device_id", "day", "kind"], cols: ["seconds", "updated_at"] },
];

const kindNamed = new Map(KINDS.map((k) => [k.name, k]));

export interface BookRow {
  id: string;
  title: string;
  authors: string;
  format: string;
  file_size: number;
  synopsis: string | null;
  publisher: string | null;
  language: string | null;
  series: string | null;
  series_index: number | null;
  added_at: string;
  deleted_at: string | null;
  isbn: string | null;
  status: string;
  total_progression: number | null;
  resume_locator: string | null;
  last_opened_at: string | null;
  finished_at: string | null;
  favorite: number;
  want_to_read: number;
  rating: number | null;
  /** Asked for on the phone, from the computer. */
  phone_wanted: number;
  /** Downloaded on the phone. */
  phone_has: number;
  /** Added on the phone, waiting for the computer to take it in. */
  from_phone: number;
  /** Set when this file is another copy of that book, kept with it and not listed. */
  same_as?: string | null;
}

/** The built-in Up next shelf, as every device starts with it. */
export const UP_NEXT: Row = {
  id: "shelf:want_to_read",
  name: "Up next",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  kind: "shelf",
  badge: "bookmark",
  picture: "gallery:forest",
  pinned: 1,
  position: 1,
  deleted_at: null,
  description: null,
  rules: null,
};

/** The built-in Sent to device shelf: the books chosen for the phone. */
export const SEND_TO_DEVICE: Row = {
  ...UP_NEXT,
  id: "shelf:send_to_device",
  name: "Sent to device",
  badge: "phone",
  picture: "gallery:stormlight-beacon",
  position: 1.5,
};

const BOOK_DEFAULTS = { status: "unread", total_progression: null, resume_locator: null, last_opened_at: null, finished_at: null, favorite: 0, want_to_read: 0, rating: null, phone_wanted: 0, phone_has: 0, from_phone: 0 };

/** A time that sorts after `previous`, so a change on this device never looks older than the last. */
export function stampAfter(previous: string | undefined): string {
  const now = new Date().toISOString();
  if (!previous || previous < now) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

export class WebLibrary {
  private version = 0;
  private cached: { version: number; tables: Map<Table, Map<string, Row>> } | null = null;
  private readonly listeners = new Set<() => void>();
  /** Called after each change made here, so it can be sent. */
  onLocalChange: () => void = () => undefined;

  constructor(readonly db: WebDb) {}

  /** Hears every change, from here or from sync. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private tables(): Map<Table, Map<string, Row>> {
    if (this.cached?.version === this.version) return this.cached.tables;
    const tables = new Map<Table, Map<string, Row>>(KINDS.map((k) => [k.table, new Map()]));
    // Records are laid over each other in KINDS order, so a book's own record comes first.
    const byKind = new Map<string, Stored[]>();
    for (const r of this.db.records.values()) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
    for (const kind of KINDS) {
      const table = tables.get(kind.table)!;
      for (const r of byKind.get(kind.name) ?? []) {
        if (!r.data) {
          if (kind.name === "book" || kind.table !== "books") table.delete(r.key);
          continue;
        }
        const existing = table.get(r.key);
        // Progress and shelves only change books that are already here.
        if (kind.table === "books" && kind.name !== "book" && !existing) continue;
        table.set(r.key, { ...(existing ?? (kind.table === "books" ? BOOK_DEFAULTS : {})), ...r.data });
      }
    }
    const collections = tables.get("collections")!;
    for (const shelf of [UP_NEXT, SEND_TO_DEVICE]) {
      const key = JSON.stringify([shelf.id]);
      if (!collections.has(key)) collections.set(key, shelf);
    }
    this.cached = { version: this.version, tables };
    return tables;
  }

  rows(table: Table): Row[] {
    return [...this.tables().get(table)!.values()];
  }

  row(table: Table, keys: unknown[]): Row | undefined {
    return this.tables().get(table)!.get(JSON.stringify(keys));
  }

  /** The books still in the library. */
  books(): BookRow[] {
    return (this.rows("books") as unknown as BookRow[]).filter((b) => !b.deleted_at);
  }

  /** The books as they're listed: a copy kept with another book shows as that book. */
  listed(): BookRow[] {
    return this.books().filter((b) => !b.same_as);
  }

  book(id: string): BookRow | undefined {
    const b = this.row("books", [id]) as unknown as BookRow | undefined;
    return b && !b.deleted_at ? b : undefined;
  }

  /** Writes one kind of record from a whole row: the columns of that kind are taken from `row`. */
  async write(kindName: string, row: Row): Promise<void> {
    await this.writeAll([[kindName, row]]);
  }

  async writeAll(changes: [kind: string, row: Row][]): Promise<void> {
    const out: Stored[] = [];
    for (const [kindName, row] of changes) {
      const kind = kindNamed.get(kindName)!;
      const keys = kind.keys.map((k) => row[k]);
      const key = JSON.stringify(keys);
      const data: Row = {};
      for (const c of [...kind.keys, ...kind.cols]) data[c] = row[c] ?? null;
      const previous = this.db.records.get(recordId(kind.name, key));
      out.push({ kind: kind.name, key, data, changed_at: stampAfter(previous?.changed_at), pushed: false });
    }
    await this.db.putRecords(out);
    this.changed();
    this.onLocalChange();
  }

  /** Removes records, as the desktop app records a deleted row. */
  async remove(changes: [kind: string, keys: unknown[]][]): Promise<void> {
    const out: Stored[] = changes.map(([kindName, keys]) => {
      const key = JSON.stringify(keys);
      const previous = this.db.records.get(recordId(kindName, key));
      return { kind: kindName, key, data: null, changed_at: stampAfter(previous?.changed_at), pushed: false };
    });
    if (!out.length) return;
    await this.db.putRecords(out);
    this.changed();
    this.onLocalChange();
  }

  /** Changes waiting to go to the cloud. */
  outbox(limit: number): Stored[] {
    const out: Stored[] = [];
    for (const r of this.db.records.values()) {
      if (!r.pushed) out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  waiting(): number {
    let n = 0;
    for (const r of this.db.records.values()) if (!r.pushed) n++;
    return n;
  }

  /**
   * Takes in records from the cloud. The newest change wins, as the desktop
   * app's "most recent change" rule does. Returns how many changed anything.
   */
  async merge(incoming: { kind: string; key: string; data: Row | null; changed_at: string }[]): Promise<number> {
    const take: Stored[] = [];
    for (const r of incoming) {
      const local = this.db.records.get(recordId(r.kind, r.key));
      if (local && local.changed_at === r.changed_at) {
        // This device's own change coming back: the cloud has it.
        if (!local.pushed) take.push({ ...local, pushed: true });
        continue;
      }
      if (!local || r.changed_at > local.changed_at) take.push({ ...r, pushed: true });
    }
    await this.db.putRecords(take);
    if (take.length) this.changed();
    return take.length;
  }

  async markSent(sent: Stored[]): Promise<void> {
    const done = sent
      .filter((s) => this.db.records.get(recordId(s.kind, s.key))?.changed_at === s.changed_at)
      .map((s) => ({ ...s, pushed: true }));
    await this.db.putRecords(done);
  }
}
