// What the cover maker keeps on this device for each book, so it opens again
// as you left it (embre, 3 November 2026): the design itself in local
// storage, and your own background picture, which is too big for that, in
// the browser's database. Both are only conveniences: when either can't be
// read, the maker simply starts fresh.
const DB = "tbv-cover-maker";
const STORE = "pictures";
function open() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function run(mode, act) {
    try {
        const db = await open();
        return await new Promise((resolve) => {
            const request = act(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => resolve(null);
        });
    }
    catch {
        return null;
    }
}
/** Keeps (or, with null, forgets) a book's background picture. */
export async function keepCoverPicture(projectId, picture) {
    await run("readwrite", (s) => (picture ? s.put(picture, projectId) : s.delete(projectId)));
}
export async function keptCoverPicture(projectId) {
    const found = await run("readonly", (s) => s.get(projectId));
    return found instanceof Blob ? found : null;
}
const key = (projectId) => `tbv.coverMaker.${projectId}`;
export function keptDesign(projectId) {
    try {
        const raw = JSON.parse(localStorage.getItem(key(projectId)) ?? "null");
        return raw && typeof raw === "object" ? raw : {};
    }
    catch {
        return {};
    }
}
export function keepDesign(projectId, design) {
    try {
        localStorage.setItem(key(projectId), JSON.stringify(design));
    }
    catch {
        // Only a convenience.
    }
}
