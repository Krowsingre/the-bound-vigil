// What the cover maker keeps on this device for each book, so it opens again
// as you left it (embre, 3 November 2026): the design itself in local
// storage, and your own background picture, which is too big for that, in
// the browser's database. Both are only conveniences: when either can't be
// read, the maker simply starts fresh.

const DB = "tbv-cover-maker";
const STORE = "pictures";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve) => {
      const request = act(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Keeps (or, with null, forgets) a book's background picture. */
export async function keepCoverPicture(projectId: string, picture: Blob | null): Promise<void> {
  await run<unknown>("readwrite", (s) => (picture ? (s.put(picture, projectId) as IDBRequest<unknown>) : (s.delete(projectId) as IDBRequest<unknown>)));
}

export async function keptCoverPicture(projectId: string): Promise<Blob | null> {
  const found = await run<unknown>("readonly", (s) => s.get(projectId));
  return found instanceof Blob ? found : null;
}

const key = (projectId: string) => `tbv.coverMaker.${projectId}`;

export function keptDesign<T>(projectId: string): Partial<T> & { bookTitle?: string; bookAuthor?: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(key(projectId)) ?? "null");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function keepDesign(projectId: string, design: object): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(design));
  } catch {
    // Only a convenience.
  }
}
