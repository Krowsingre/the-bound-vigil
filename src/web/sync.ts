// Sync for the web version: Supabase only. Pulls what other devices changed,
// sends what changed here, and fetches covers. Runs when the page opens, a
// moment after each change, every few minutes, and when the phone comes back
// online or to the tab.

import type { SupabaseProject, SyncOverview, SyncStatus } from "../api/types";
import type { WebDb } from "./db";
import type { WebLibrary } from "./library";
import { Offline, SignedOut, Supabase, signIn, signOut, signUp, type Session } from "./supabase";

const PROJECT = "sync.supabase";
const SESSION = "sync.session";
/** Whose library this browser holds. Outlives the session, which goes when renewing it fails. */
const OWNER = "sync.owner";
const CURSOR = "sync.cursor";
const DEVICE = "sync.device_id";
const LAST_SUCCESS = "sync.last_success_at";
const LAST_ERROR = "sync.last_error";
const COVERS = "sync.covers";
const BOOK_FILES = "sync.book_files";
/** Pictures chosen here that the cloud doesn't have yet, by name. */
const PICTURES_TO_SEND = "sync.pictures_to_send";

const PAGE = 500;
const BATCH = 200;
const SOON_MS = 2500;
const EVERY_MS = 5 * 60_000;

/** Settings kept when the library is cleared: how this device looks and reads. */
const KEEP = (key: string) => !key.startsWith("sync.") || key === DEVICE || key === PROJECT;

export class WebSync {
  private running: Promise<void> | null = null;
  private again = false;
  private soon: ReturnType<typeof setTimeout> | undefined;
  private state: SyncStatus["state"] = "disabled";
  private readonly statusListeners = new Set<(s: SyncStatus) => void>();
  /** Covers in the cloud, by book id without its "sha256:" (file name, e.g. "ab12….jpg"). */
  covers = new Map<string, string>();
  /** Books whose file is in the cloud, so this phone can download them, by id without "sha256:". */
  bookFiles = new Set<string>();
  /** Covers ready to show, as page addresses. */
  readonly coverUrls = new Map<string, string>();
  /** Collections' own pictures (`picture:<name>`), by name. */
  readonly pictureUrls = new Map<string, string>();

  constructor(
    private readonly db: WebDb,
    private readonly library: WebLibrary,
  ) {
    library.onLocalChange = () => this.later();
    try {
      for (const [hex, name] of Object.entries(JSON.parse(db.meta.get(COVERS) ?? "{}") as Record<string, string>)) this.covers.set(hex, name);
    } catch {
      /* fetched again on the next sync */
    }
    try {
      this.bookFiles = new Set(JSON.parse(db.meta.get(BOOK_FILES) ?? "[]") as string[]);
    } catch {
      /* listed again on the next sync */
    }
  }

  get project(): SupabaseProject | null {
    try {
      const p = JSON.parse(this.db.meta.get(PROJECT) ?? "null") as SupabaseProject | null;
      return p?.url && p.anonKey ? p : null;
    } catch {
      return null;
    }
  }

  get session(): Session | null {
    try {
      return JSON.parse(this.db.meta.get(SESSION) ?? "null") as Session | null;
    } catch {
      return null;
    }
  }

  get deviceId(): string {
    let id = this.db.meta.get(DEVICE);
    if (!id) {
      id = crypto.randomUUID();
      void this.db.setMeta(DEVICE, id);
    }
    return id;
  }

  /** Starts syncing in the background. */
  start(): void {
    this.state = this.session && this.project ? "idle" : "disabled";
    void this.loadCovers();
    void this.now();
    setInterval(() => void this.now(), EVERY_MS);
    window.addEventListener("online", () => void this.now());
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void this.now());
  }

  status(): SyncStatus {
    return { state: this.state, lastSuccessAt: this.db.meta.get(LAST_SUCCESS) ?? null };
  }

  overview(): SyncOverview {
    const session = this.session;
    return {
      status: this.status(),
      provider: { kind: "supabase", service: null, location: null, username: null },
      project: this.project,
      signedInAs: session?.email ?? null,
      lastError: this.db.meta.get(LAST_ERROR) ?? null,
      waitingToSend: this.library.waiting(),
      conflicts: [],
      also: null,
    };
  }

  onStatus(listener: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setState(state: SyncStatus["state"]) {
    this.state = state;
    const s = this.status();
    this.statusListeners.forEach((l) => l(s));
  }

  private connection(): Supabase | null {
    const project = this.project;
    const session = this.session;
    if (!project || !session) return null;
    return new Supabase(project, session, this.deviceId, (renewed) => void this.db.setMeta(SESSION, JSON.stringify(renewed)));
  }

  later(): void {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => void this.now(), SOON_MS);
  }

  /** Syncs now, or once more after the run that's going. */
  now(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.once();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async once(): Promise<void> {
    const cloud = this.connection();
    if (!cloud) return this.setState("disabled");
    if (!navigator.onLine) return this.setState("offline");
    this.setState("syncing");
    try {
      let cursor = Number(this.db.meta.get(CURSOR) ?? 0) || 0;
      for (;;) {
        const page = await cloud.pull(cursor, PAGE);
        await this.library.merge(page.records);
        cursor = page.cursor;
        await this.db.setMeta(CURSOR, String(cursor));
        if (page.records.length < PAGE) break;
      }
      for (let batch = this.library.outbox(BATCH); batch.length; batch = this.library.outbox(BATCH)) {
        await cloud.push(batch.map(({ kind, key, data, changed_at }) => ({ kind, key, data, changed_at })));
        await this.library.markSent(batch);
        if (batch.length < BATCH && !this.library.waiting()) break;
      }
      await this.sendPictures(cloud);
      await this.listBookFiles(cloud);
      await this.fetchCovers(cloud);
      await this.db.setMeta(LAST_SUCCESS, new Date().toISOString());
      await this.db.setMeta(LAST_ERROR, null);
      this.setState("idle");
    } catch (e) {
      if (e instanceof SignedOut) {
        await this.db.setMeta(SESSION, null);
        await this.db.setMeta(LAST_ERROR, "Your sign-in ran out. Sign in again to keep syncing.");
        return this.setState("disabled");
      }
      await this.db.setMeta(LAST_ERROR, e instanceof Error ? e.message : String(e));
      this.setState(e instanceof Offline ? "offline" : "error");
    }
  }

  /** Shows the covers already saved here. */
  private async loadCovers(): Promise<void> {
    let added = false;
    for (const path of await this.db.filePaths()) {
      if (path.startsWith("pictures/")) {
        const blob = await this.db.getFile(path);
        if (blob) this.pictureUrls.set(path.slice(9), URL.createObjectURL(blob));
        continue;
      }
      if (!path.startsWith("covers/")) continue;
      const hex = path.slice(7).split(".")[0];
      if (this.coverUrls.has(hex)) continue;
      const blob = await this.db.getFile(path);
      if (blob) {
        this.coverUrls.set(hex, URL.createObjectURL(blob));
        added = true;
      }
    }
    if (added) this.library.changed();
  }

  private picturesToSend(): string[] {
    try {
      return JSON.parse(this.db.meta.get(PICTURES_TO_SEND) ?? "[]") as string[];
    } catch {
      return [];
    }
  }

  /** Keeps a picture chosen here (the profile picture), and sends it at the next sync. */
  async addPicture(name: string, file: Blob): Promise<void> {
    await this.db.putFile(`pictures/${name}`, file);
    this.pictureUrls.set(name, URL.createObjectURL(file));
    await this.db.setMeta(PICTURES_TO_SEND, JSON.stringify([...this.picturesToSend().filter((n) => n !== name), name]));
  }

  private async sendPictures(cloud: Supabase): Promise<void> {
    for (const name of this.picturesToSend()) {
      const file = await this.db.getFile(`pictures/${name}`);
      if (file) await cloud.upload(`pictures/${name}`, file);
      await this.db.setMeta(PICTURES_TO_SEND, JSON.stringify(this.picturesToSend().filter((n) => n !== name)));
    }
  }

  /** Which books' files the cloud holds: only those can be downloaded here. */
  private async listBookFiles(cloud: Supabase): Promise<void> {
    const names = await cloud.list("books");
    const files = new Set(names.map((n) => n.split(".")[0]));
    const changed = files.size !== this.bookFiles.size || [...files].some((h) => !this.bookFiles.has(h));
    this.bookFiles = files;
    await this.db.setMeta(BOOK_FILES, JSON.stringify([...files]));
    if (changed) this.library.changed();
  }

  private async fetchCovers(cloud: Supabase): Promise<void> {
    const names = await cloud.list("covers");
    this.covers = new Map(names.map((n) => [n.split(".")[0], n]));
    await this.db.setMeta(COVERS, JSON.stringify(Object.fromEntries(this.covers)));
    let added = 0;
    // Newest books first, a few at once: a big library has thousands of covers.
    const wanted = [...this.library.books()]
      .sort((a, b) => String(b.added_at).localeCompare(String(a.added_at)))
      .map((book) => book.id.replace(/^sha256:/, ""))
      .filter((hex) => this.covers.has(hex) && !this.coverUrls.has(hex));
    const fetchOne = async (hex: string) => {
      const name = this.covers.get(hex)!;
      const blob = await cloud.download(`covers/${name}`);
      if (!blob) return;
      await this.db.putFile(`covers/${name}`, blob);
      this.coverUrls.set(hex, URL.createObjectURL(blob));
      // Show covers as they arrive, a few at a time.
      if (++added % 24 === 0) this.library.changed();
    };
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < wanted.length) await fetchOne(wanted[next++]);
      }),
    );
    const avatar = this.library.row("profile", ["me"])?.avatar;
    const pictures = [
      ...(typeof avatar === "string" ? [`picture:${avatar}`] : []),
      ...this.library.rows("collections").map((c) => (typeof c.picture === "string" && !c.deleted_at ? c.picture : "")),
    ];
    for (const picture of pictures) {
      const name = picture.startsWith("picture:") ? picture.slice(8) : "";
      if (!name || name.includes("/") || this.pictureUrls.has(name)) continue;
      const blob = await cloud.download(`pictures/${name}`);
      if (!blob) continue;
      await this.db.putFile(`pictures/${name}`, blob);
      this.pictureUrls.set(name, URL.createObjectURL(blob));
      added++;
    }
    if (added % 12) this.library.changed();
  }

  /** The book's file: from this browser if it was opened before, else from the cloud. */
  /** Erases a deleted book's file and cover from the cloud. */
  async eraseBook(id: string, format: string): Promise<void> {
    const cloud = this.connection();
    if (!cloud) return;
    const hex = id.replace(/^sha256:/, "");
    const covers = (await cloud.list("covers/").catch(() => [] as string[])).filter((n) => n.startsWith(`${hex}.`));
    await Promise.all([cloud.remove(`books/${hex}.${format}`), ...covers.map((n) => cloud.remove(`covers/${n}`))]);
  }

  async bookFile(id: string, format: string): Promise<Blob> {
    const path = `books/${id.replace(/^sha256:/, "")}.${format}`;
    const saved = await this.db.getFile(path);
    if (saved) return saved;
    const cloud = this.connection();
    if (!cloud) throw new Error("Sign in to open your books.");
    const blob = await cloud.download(path);
    if (!blob)
      throw new Error(
        "This book's file isn't in the cloud yet. On the computer that has it, turn on Settings › Sync › Sync book files, and let it sync.",
      );
    await this.db.putFile(path, blob).catch(() => undefined);
    this.library.changed();
    return blob;
  }

  async setProject(project: SupabaseProject | null): Promise<void> {
    const before = this.project;
    if (before?.url !== project?.url) await this.signOut();
    await this.db.setMeta(PROJECT, project ? JSON.stringify(project) : null);
  }

  async signIn(email: string, password: string, create: boolean): Promise<boolean> {
    const project = this.project;
    if (!project) throw new Error("Set up the Supabase project first.");
    const session = create ? await signUp(project, email.trim(), password) : await signIn(project, email.trim(), password);
    if (!session) return false;
    // Another account's library doesn't mix with this one. With no owner on
    // record, a library left here can't be shown to be this account's, so it goes.
    const owner = this.db.meta.get(OWNER) ?? this.session?.userId ?? null;
    if (owner ? owner !== session.userId : this.db.records.size > 0) await this.forget();
    await this.db.setMeta(OWNER, session.userId);
    await this.db.setMeta(SESSION, JSON.stringify(session));
    await this.db.setMeta(LAST_ERROR, null);
    void this.now();
    return true;
  }

  async signOut(): Promise<void> {
    const project = this.project;
    const session = this.session;
    if (project && session) signOut(project, session);
    await this.forget();
    this.setState("disabled");
  }

  /** Clears this browser's copy of the library. The cloud keeps everything. */
  private async forget(): Promise<void> {
    await this.db.clearLibrary(KEEP);
    this.coverUrls.forEach((u) => URL.revokeObjectURL(u));
    this.coverUrls.clear();
    this.pictureUrls.forEach((u) => URL.revokeObjectURL(u));
    this.pictureUrls.clear();
    this.covers.clear();
    this.library.changed();
  }
}
