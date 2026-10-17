// The browser's own copy of the library, kept in IndexedDB: every synced
// record, this device's settings, and downloaded covers and books. The whole
// list of records is small enough to hold in memory; each change is also
// written straight through so nothing is lost if the tab closes.

import type { Record } from "./supabase";

export interface Stored extends Record {
  /** Whether the cloud has this change yet. */
  pushed: boolean;
}

const NAME = "tbv-web";
const VERSION = 1;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const recordId = (kind: string, key: string) => `${kind}\u0000${key}`;

export class WebDb {
  readonly records = new Map<string, Stored>();
  readonly meta = new Map<string, string>();

  private constructor(private readonly db: IDBDatabase | null) {}

  static async open(): Promise<WebDb> {
    let db: IDBDatabase | null = null;
    try {
      const opening = indexedDB.open(NAME, VERSION);
      opening.onupgradeneeded = () => {
        const d = opening.result;
        for (const store of ["records", "meta", "files"]) if (!d.objectStoreNames.contains(store)) d.createObjectStore(store);
      };
      db = await request(opening);
    } catch {
      // A private window may refuse storage: work from memory until the tab closes.
      db = null;
    }
    const web = new WebDb(db);
    if (db) {
      const tx = db.transaction(["records", "meta"], "readonly");
      const [records, metaKeys, metaValues] = await Promise.all([
        request(tx.objectStore("records").getAll() as IDBRequest<Stored[]>),
        request(tx.objectStore("meta").getAllKeys()),
        request(tx.objectStore("meta").getAll() as IDBRequest<string[]>),
      ]);
      for (const r of records) web.records.set(recordId(r.kind, r.key), r);
      metaKeys.forEach((k, i) => web.meta.set(String(k), metaValues[i]));
    }
    return web;
  }

  async putRecords(list: Stored[]): Promise<void> {
    for (const r of list) this.records.set(recordId(r.kind, r.key), r);
    if (!this.db || !list.length) return;
    const tx = this.db.transaction("records", "readwrite");
    const store = tx.objectStore("records");
    for (const r of list) store.put(r, recordId(r.kind, r.key));
    await done(tx);
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    if (value === null) this.meta.delete(key);
    else this.meta.set(key, value);
    if (!this.db) return;
    const tx = this.db.transaction("meta", "readwrite");
    if (value === null) tx.objectStore("meta").delete(key);
    else tx.objectStore("meta").put(value, key);
    await done(tx);
  }

  /** Forgets everything synced, for signing out or changing project. Settings stay. */
  async clearLibrary(keepMeta: (key: string) => boolean): Promise<void> {
    this.records.clear();
    for (const key of [...this.meta.keys()]) if (!keepMeta(key)) this.meta.delete(key);
    if (!this.db) return;
    const tx = this.db.transaction(["records", "meta", "files"], "readwrite");
    tx.objectStore("records").clear();
    tx.objectStore("files").clear();
    const meta = tx.objectStore("meta");
    meta.clear();
    for (const [k, v] of this.meta) meta.put(v, k);
    await done(tx);
  }

  async getFile(path: string): Promise<Blob | null> {
    if (!this.db) return null;
    const tx = this.db.transaction("files", "readonly");
    return ((await request(tx.objectStore("files").get(path))) as Blob | undefined) ?? null;
  }

  async putFile(path: string, file: Blob): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, path);
    await done(tx);
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction("files", "readwrite");
    tx.objectStore("files").delete(path);
    await done(tx);
  }

  async filePaths(): Promise<string[]> {
    if (!this.db) return [];
    const tx = this.db.transaction("files", "readonly");
    return (await request(tx.objectStore("files").getAllKeys())).map(String);
  }
}
