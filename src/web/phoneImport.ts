// Adding books on the phone. Each file is read here for its title, author
// and cover, sent to Supabase, and recorded as added on the phone; the
// computer takes it in at its next sync and copies it on to its own sync
// place (iCloud, say). One book at a time, so the phone stays usable.

import type { ImportItem, ImportResult, ImportsView } from "../api/types";
import { importsViewOf } from "../imports/view";

/** What the phone can add. Folders of audiobook parts need the computer. */
export const PHONE_FORMATS = [
  "epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz", "cbz", "cbr", "txt", "docx", "doc",
  "m4b", "m4a", "mp3", "aac", "ogg", "oga", "opus", "flac",
];
/** Read whole to work out its id, so a bigger file could run a phone out of memory. */
export const PHONE_MAX_BYTES = 250 * 1024 * 1024;

const FOLIATE = ["epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz", "cbz"];

export function formatOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

/** "the_hobbit-2nd.epub" → "the hobbit 2nd", as the computer titles a book without one. */
export function titleFromName(name: string): string {
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return stem.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

/** foliate-js gives a name as text, as {name}, as text by language, or a list of those. */
export function textOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return textOf(value[0]);
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("name" in v) return textOf(v.name);
    return textOf(Object.values(v)[0]);
  }
  return null;
}

function namesOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(textOf).filter((n): n is string => !!n);
}

export interface PhoneBookDetails {
  title: string;
  authors: string[];
  language: string | null;
  cover: Blob | null;
}

/** What the phone can read of a book before the computer reads the rest. */
export async function readDetails(file: File, format: string): Promise<PhoneBookDetails> {
  const details: PhoneBookDetails = { title: titleFromName(file.name), authors: [], language: null, cover: null };
  if (!FOLIATE.includes(format)) return details;
  try {
    const { makeBook } = await import("../vendor/foliate-js/view.js");
    const book = await makeBook(file);
    try {
      const m = (book.metadata ?? {}) as { title?: unknown; author?: unknown; language?: unknown };
      details.title = textOf(m.title) ?? details.title;
      details.authors = namesOf(m.author);
      details.language = textOf(m.language);
      details.cover = (await book.getCover?.()) ?? null;
    } finally {
      book.destroy?.();
    }
  } catch {
    // Unreadable here: the computer reads it properly once it has it.
  }
  return details;
}

/** A small JPEG of a cover, so a phone's covers don't fill Supabase. */
export async function smallCover(picture: Blob, height = 600): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(picture);
    const scale = Math.min(1, height / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.82));
  } catch {
    return null;
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The phone's Imports list. `add` takes in one file. */
export class PhoneImports {
  private items: ImportItem[] = [];
  private readonly files = new Map<number, File>();
  private readonly listeners = new Set<(view: ImportsView) => void>();
  private running = false;
  private nextId = 1;
  private picked = new Map<string, File>();

  constructor(private readonly add: (file: File) => Promise<ImportResult>) {}

  /**
   * Opens the phone's file picker. Runs up to the picker without waiting, so
   * the tap that asked for it still counts as the person's own.
   */
  pick(folder: boolean): Promise<string[]> {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (folder && "webkitdirectory" in input) input.webkitdirectory = true;
    else input.accept = PHONE_FORMATS.map((f) => `.${f}`).join(",");
    input.style.display = "none";
    document.body.append(input);
    const chosen = new Promise<string[]>((done) => {
      const finish = () => {
        input.remove();
        const keys = [...(input.files ?? [])].map((file) => {
          const key = `phone:${this.nextId++}:${file.name}`;
          this.picked.set(key, file);
          return key;
        });
        done(keys);
      };
      input.addEventListener("change", finish, { once: true });
      input.addEventListener("cancel", finish, { once: true });
    });
    input.click();
    return chosen;
  }

  /** Lines up picked files; returns how many are books. */
  queue(keys: string[]): number {
    let found = 0;
    for (const key of keys) {
      const file = this.picked.get(key);
      this.picked.delete(key);
      // A folder holds covers, notes and the like: only books are listed.
      if (!file || !PHONE_FORMATS.includes(formatOf(file.name))) continue;
      const id = this.nextId++;
      this.files.set(id, file);
      this.items.push({ id, path: file.webkitRelativePath || file.name, name: file.name, bytes: file.size, bytesRead: 0, stage: "waiting", result: null });
      found++;
    }
    if (found) {
      this.tell();
      void this.run();
    }
    return found;
  }

  view(): ImportsView {
    return importsViewOf(this.items);
  }

  subscribe(listener: (view: ImportsView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancel(): void {
    this.items = this.items.filter((i) => i.stage !== "waiting");
    this.tell();
  }

  clearFinished(): void {
    this.items = this.items.filter((i) => i.stage !== "done");
    this.tell();
  }

  private tell() {
    const view = this.view();
    this.listeners.forEach((l) => l(view));
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (let item = this.items.find((i) => i.stage === "waiting"); item; item = this.items.find((i) => i.stage === "waiting")) {
        const file = this.files.get(item.id)!;
        item.stage = "reading";
        this.tell();
        try {
          item.result = await this.add(file);
        } catch (e) {
          item.result = { outcome: "failed", path: item.path, reason: e instanceof Error ? e.message : String(e) };
        }
        item.bytesRead = item.bytes;
        item.stage = "done";
        this.files.delete(item.id);
        this.tell();
      }
    } finally {
      this.running = false;
    }
  }
}
