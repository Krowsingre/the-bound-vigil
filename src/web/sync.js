// Sync for the web version: Supabase only. Pulls what other devices changed,
// sends what changed here, and fetches covers. Runs when the page opens, a
// moment after each change, every few minutes, and when the phone comes back
// online or to the tab.
import { Offline, SignedOut, Supabase, signIn, signOut, signUp } from "./supabase";
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
/** Which change of each book's cover the copy here is (see `cover_rev`). */
const COVER_REVS = "sync.cover_revs";
/** Pictures chosen here that the cloud doesn't have yet, by name. */
const PICTURES_TO_SEND = "sync.pictures_to_send";
const PAGE = 500;
const BATCH = 200;
const SOON_MS = 2500;
const EVERY_MS = 5 * 60_000;
/** When the cloud's lists of book files and covers were last read. */
const LISTED_AT = "sync.listed_at";
/**
 * Those lists run to megabytes in a big library, and every read counts
 * against Supabase's free 5 GB a month of downloads. So they're read again
 * only when other devices changed something, when asked to sync, or hourly.
 */
const LIST_EVERY_MS = 60 * 60_000;
/** Settings kept when the library is cleared: how this device looks and reads. */
const KEEP = (key) => !key.startsWith("sync.") || key === DEVICE || key === PROJECT;
export class WebSync {
    db;
    library;
    running = null;
    again = false;
    /** The link to the audiobook last joined from its pieces, for playing. */
    joinedUrl = null;
    /** Asked to sync by the person: the cloud's file lists are read too. */
    full = false;
    soon;
    state = "disabled";
    statusListeners = new Set();
    /** Covers in the cloud, by book id without its "sha256:" (file name, e.g. "ab12….jpg"). */
    covers = new Map();
    /** Books whose file is in the cloud, so this phone can download them, by id without "sha256:". */
    bookFiles = new Set();
    /** Covers ready to show, as page addresses. */
    coverUrls = new Map();
    /** Collections' own pictures (`picture:<name>`), by name. */
    pictureUrls = new Map();
    constructor(db, library) {
        this.db = db;
        this.library = library;
        library.onLocalChange = () => this.later();
        try {
            for (const [hex, name] of Object.entries(JSON.parse(db.meta.get(COVERS) ?? "{}")))
                this.covers.set(hex, name);
        }
        catch {
            /* fetched again on the next sync */
        }
        try {
            this.bookFiles = new Set(JSON.parse(db.meta.get(BOOK_FILES) ?? "[]"));
        }
        catch {
            /* listed again on the next sync */
        }
    }
    get project() {
        try {
            const p = JSON.parse(this.db.meta.get(PROJECT) ?? "null");
            return p?.url && p.anonKey ? p : null;
        }
        catch {
            return null;
        }
    }
    get session() {
        try {
            return JSON.parse(this.db.meta.get(SESSION) ?? "null");
        }
        catch {
            return null;
        }
    }
    get deviceId() {
        let id = this.db.meta.get(DEVICE);
        if (!id) {
            id = crypto.randomUUID();
            void this.db.setMeta(DEVICE, id);
        }
        return id;
    }
    /** Starts syncing in the background. */
    start() {
        this.state = this.session && this.project ? "idle" : "disabled";
        void this.loadCovers();
        void this.now();
        setInterval(() => void this.now(), EVERY_MS);
        window.addEventListener("online", () => void this.now());
        document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void this.now());
    }
    status() {
        return { state: this.state, lastSuccessAt: this.db.meta.get(LAST_SUCCESS) ?? null };
    }
    overview() {
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
    onStatus(listener) {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }
    setState(state) {
        this.state = state;
        const s = this.status();
        this.statusListeners.forEach((l) => l(s));
    }
    connection() {
        const project = this.project;
        const session = this.session;
        if (!project || !session)
            return null;
        return new Supabase(project, session, this.deviceId, (renewed) => void this.db.setMeta(SESSION, JSON.stringify(renewed)));
    }
    later() {
        clearTimeout(this.soon);
        this.soon = setTimeout(() => void this.now(), SOON_MS);
    }
    /** Syncs now, or once more after the run that's going. `full` reads the cloud's file lists however recent. */
    now(full = false) {
        if (full)
            this.full = true;
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
            }
            finally {
                this.running = null;
            }
        })();
        return this.running;
    }
    async once() {
        const cloud = this.connection();
        if (!cloud)
            return this.setState("disabled");
        if (!navigator.onLine)
            return this.setState("offline");
        this.setState("syncing");
        try {
            let cursor = Number(this.db.meta.get(CURSOR) ?? 0) || 0;
            let pulled = 0;
            for (;;) {
                const page = await cloud.pull(cursor, PAGE);
                pulled += page.records.length;
                await this.library.merge(page.records);
                cursor = page.cursor;
                await this.db.setMeta(CURSOR, String(cursor));
                if (page.records.length < PAGE)
                    break;
            }
            for (let batch = this.library.outbox(BATCH); batch.length; batch = this.library.outbox(BATCH)) {
                await cloud.push(batch.map(({ kind, key, data, changed_at }) => ({ kind, key, data, changed_at })));
                await this.library.markSent(batch);
                if (batch.length < BATCH && !this.library.waiting())
                    break;
            }
            await this.sendPictures(cloud);
            const listedAt = Number(this.db.meta.get(LISTED_AT) ?? 0) || 0;
            if (this.full || pulled > 0 || Date.now() - listedAt > LIST_EVERY_MS) {
                this.full = false;
                await this.listBookFiles(cloud);
                await this.fetchCovers(cloud);
                await this.db.setMeta(LISTED_AT, String(Date.now()));
            }
            await this.db.setMeta(LAST_SUCCESS, new Date().toISOString());
            await this.db.setMeta(LAST_ERROR, null);
            this.setState("idle");
        }
        catch (e) {
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
    async loadCovers() {
        let added = false;
        for (const path of await this.db.filePaths()) {
            if (path.startsWith("pictures/")) {
                const blob = await this.db.getFile(path);
                if (blob)
                    this.pictureUrls.set(path.slice(9), URL.createObjectURL(blob));
                continue;
            }
            if (!path.startsWith("covers/"))
                continue;
            const hex = path.slice(7).split(".")[0];
            if (this.coverUrls.has(hex))
                continue;
            const blob = await this.db.getFile(path);
            if (blob) {
                this.coverUrls.set(hex, URL.createObjectURL(blob));
                added = true;
            }
        }
        if (added)
            this.library.changed();
    }
    picturesToSend() {
        try {
            return JSON.parse(this.db.meta.get(PICTURES_TO_SEND) ?? "[]");
        }
        catch {
            return [];
        }
    }
    /** Keeps a picture chosen here (the profile picture), and sends it at the next sync. */
    async addPicture(name, file) {
        await this.db.putFile(`pictures/${name}`, file);
        this.pictureUrls.set(name, URL.createObjectURL(file));
        await this.db.setMeta(PICTURES_TO_SEND, JSON.stringify([...this.picturesToSend().filter((n) => n !== name), name]));
    }
    async sendPictures(cloud) {
        for (const name of this.picturesToSend()) {
            const file = await this.db.getFile(`pictures/${name}`);
            if (file)
                await cloud.upload(`pictures/${name}`, file);
            await this.db.setMeta(PICTURES_TO_SEND, JSON.stringify(this.picturesToSend().filter((n) => n !== name)));
        }
    }
    /** Which books' files the cloud holds: only those can be downloaded here. */
    async listBookFiles(cloud) {
        const names = await cloud.list("books");
        const files = new Set(names.map((n) => n.split(".")[0]));
        const changed = files.size !== this.bookFiles.size || [...files].some((h) => !this.bookFiles.has(h));
        this.bookFiles = files;
        await this.db.setMeta(BOOK_FILES, JSON.stringify([...files]));
        if (changed)
            this.library.changed();
    }
    async fetchCovers(cloud) {
        const names = await cloud.list("covers");
        this.covers = new Map(names.map((n) => [n.split(".")[0], n]));
        await this.db.setMeta(COVERS, JSON.stringify(Object.fromEntries(this.covers)));
        let added = 0;
        // A cover changed on another device (its `cover_rev` detail moved on) comes down again.
        const latest = new Map();
        for (const row of this.library.rows("metadata_fetched")) {
            if (row.field === "cover_rev" && typeof row.value === "string")
                latest.set(String(row.book_id).replace(/^sha256:/, ""), row.value);
        }
        let revs = {};
        try {
            revs = JSON.parse(this.db.meta.get(COVER_REVS) ?? "{}");
        }
        catch {
            /* start afresh */
        }
        // Newest books first, a few at once: a big library has thousands of covers.
        const wanted = [...this.library.books()]
            .sort((a, b) => String(b.added_at).localeCompare(String(a.added_at)))
            .map((book) => book.id.replace(/^sha256:/, ""))
            .filter((hex) => this.covers.has(hex) && (!this.coverUrls.has(hex) || (revs[hex] ?? null) !== (latest.get(hex) ?? null)));
        const fetchOne = async (hex) => {
            const name = this.covers.get(hex);
            const blob = await cloud.download(`covers/${name}`);
            if (!blob)
                return;
            await this.db.putFile(`covers/${name}`, blob);
            const old = this.coverUrls.get(hex);
            if (old)
                URL.revokeObjectURL(old);
            this.coverUrls.set(hex, URL.createObjectURL(blob));
            if (latest.has(hex))
                revs[hex] = latest.get(hex);
            // Show covers as they arrive, a few at a time.
            if (++added % 24 === 0)
                this.library.changed();
        };
        let next = 0;
        await Promise.all(Array.from({ length: 2 }, async () => {
            while (next < wanted.length)
                await fetchOne(wanted[next++]);
        }));
        await this.db.setMeta(COVER_REVS, JSON.stringify(revs));
        const avatar = this.library.row("profile", ["me"])?.avatar;
        const pictures = [
            ...(typeof avatar === "string" ? [`picture:${avatar}`] : []),
            ...this.library.rows("collections").map((c) => (typeof c.picture === "string" && !c.deleted_at ? c.picture : "")),
            ...this.library.rows("writing_projects").map((p) => (typeof p.cover === "string" && !p.deleted_at ? p.cover : "")),
        ];
        for (const picture of pictures) {
            const name = picture.startsWith("picture:") ? picture.slice(8) : "";
            if (!name || name.includes("/") || this.pictureUrls.has(name))
                continue;
            const blob = await cloud.download(`pictures/${name}`);
            if (!blob)
                continue;
            await this.db.putFile(`pictures/${name}`, blob);
            this.pictureUrls.set(name, URL.createObjectURL(blob));
            added++;
        }
        if (added % 12)
            this.library.changed();
    }
    /**
     * Sends a book added on this phone, and its cover, to Supabase, keeping a
     * copy here so it opens straight away.
     */
    async sendBook(hex, format, file, cover) {
        const cloud = this.connection();
        if (!cloud)
            throw new Error("Sign in to Supabase to add books from the phone.");
        if (!navigator.onLine)
            throw new Error("The phone is offline. Try again once it's connected.");
        await cloud.upload(`books/${hex}.${format}`, file);
        this.bookFiles.add(hex);
        await this.db.setMeta(BOOK_FILES, JSON.stringify([...this.bookFiles]));
        await this.db.putFile(`books/${hex}.${format}`, file).catch(() => undefined);
        if (cover) {
            const name = `${hex}.jpg`;
            // The book counts as added without its cover.
            await cloud.upload(`covers/${name}`, cover).then(async () => {
                this.covers.set(hex, name);
                await this.db.putFile(`covers/${name}`, cover).catch(() => undefined);
                const old = this.coverUrls.get(hex);
                if (old)
                    URL.revokeObjectURL(old);
                this.coverUrls.set(hex, URL.createObjectURL(cover));
            }, () => undefined);
        }
    }
    /** The book's file: from this browser if it was opened before, else from the cloud. */
    /** Erases a deleted book's file and cover from the cloud. */
    async eraseBook(id, format) {
        const cloud = this.connection();
        if (!cloud)
            return;
        const hex = id.replace(/^sha256:/, "");
        const covers = (await cloud.list("covers/").catch(() => [])).filter((n) => n.startsWith(`${hex}.`));
        await Promise.all([cloud.remove(`books/${hex}.${format}`), ...covers.map((n) => cloud.remove(`covers/${n}`))]);
    }
    async bookFile(id, format) {
        const path = `books/${id.replace(/^sha256:/, "")}.${format}`;
        const saved = await this.db.getFile(path);
        if (saved)
            return saved;
        const cloud = this.connection();
        if (!cloud)
            throw new Error("Sign in to open your books.");
        const blob = await cloud.download(path);
        if (!blob)
            throw new Error("This book's file isn't in the cloud yet. On the computer that has it, turn on Preferences › Sync › Sync book files, and let it sync.");
        await this.db.putFile(path, blob).catch(() => undefined);
        this.library.changed();
        return blob;
    }
    /** A link that streams a book's file from Supabase without downloading it. */
    async streamUrl(id, format) {
        const cloud = this.connection();
        if (!cloud)
            throw new Error("Sign in to play your audiobooks.");
        const path = `books/${id.replace(/^sha256:/, "")}.${format}`;
        const url = await cloud.signedUrl(path, 6 * 60 * 60);
        // Over 50 MB, it's kept in pieces: they're fetched and joined here first.
        if (!url && (await cloud.piecesOf(path))) {
            // One joined audiobook held at a time: the last one's memory is let go.
            if (this.joinedUrl)
                URL.revokeObjectURL(this.joinedUrl);
            this.joinedUrl = URL.createObjectURL(await this.bookFile(id, format));
            return this.joinedUrl;
        }
        if (!url)
            throw new Error("This audiobook's file isn't in Supabase. On the computer that has it, turn on Preferences › Sync › Sync audiobook files, and let it sync.");
        return url;
    }
    async setProject(project) {
        const before = this.project;
        if (before?.url !== project?.url)
            await this.signOut();
        await this.db.setMeta(PROJECT, project ? JSON.stringify(project) : null);
    }
    async signIn(email, password, create) {
        const project = this.project;
        if (!project)
            throw new Error("Set up the Supabase project first.");
        const session = create ? await signUp(project, email.trim(), password) : await signIn(project, email.trim(), password);
        if (!session)
            return false;
        // Another account's library doesn't mix with this one. With no owner on
        // record, a library left here can't be shown to be this account's, so it goes.
        const owner = this.db.meta.get(OWNER) ?? this.session?.userId ?? null;
        if (owner ? owner !== session.userId : this.db.records.size > 0)
            await this.forget();
        await this.db.setMeta(OWNER, session.userId);
        await this.db.setMeta(SESSION, JSON.stringify(session));
        await this.db.setMeta(LAST_ERROR, null);
        void this.now();
        return true;
    }
    async signOut() {
        const project = this.project;
        const session = this.session;
        if (project && session)
            signOut(project, session);
        await this.forget();
        this.setState("disabled");
    }
    /** Clears this browser's copy of the library. The cloud keeps everything. */
    async forget() {
        await this.db.clearLibrary(KEEP);
        this.coverUrls.forEach((u) => URL.revokeObjectURL(u));
        this.coverUrls.clear();
        this.pictureUrls.forEach((u) => URL.revokeObjectURL(u));
        this.pictureUrls.clear();
        this.covers.clear();
        this.library.changed();
    }
}
