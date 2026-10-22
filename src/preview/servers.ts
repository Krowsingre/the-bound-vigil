// The browser preview's pretend seedbox, so Settings › Servers can be tried
// without one. `?servers` starts with it saved.

import { NO_SERVER_QUEUE, type ServerApi } from "../api/serverStub";
import type { LocalSendOffer, LocalSendSending, LocalSendStatus, NearbyDevice, QueuedServerFile, RemoteEntry, SentFile, ServerView } from "../api/types";

const PRETEND_OFFER: LocalSendOffer = {
  session: "preview-offer",
  from: "Wren's iPhone",
  files: [
    { id: "a", name: "Carmilla - Le Fanu.epub", size: 412_000, importable: true },
    { id: "b", name: "Uncle Silas.m4b", size: 310_000_000, importable: true },
    { id: "c", name: "IMG_2041.HEIC", size: 2_100_000, importable: false },
  ],
};

/** What a server TBV hasn't met shows: an SFTP key, or an FTPS server's own certificate. */
const PRETEND_FINGERPRINT = {
  sftp: "SHA256:q3Vx1d2Yw9pZ8bKcR4mT7nLs0aEfGhJiUoPyXwVb6kM",
  ftps: "SHA256:2C:78:7E:87:C9:4F:03:AC:24:D0:0B:C2:31:6D:8E:6C:45:29:40:AA:57:DF:B5:5B:C2:D5:F4:24:85:DD:B3:2E",
};

const TREE: Record<string, RemoteEntry[]> = {
  "/home/wren": [
    { name: "Audiobooks", path: "/home/wren/Audiobooks", isDir: true, size: 0 },
    { name: "Books", path: "/home/wren/Books", isDir: true, size: 0 },
    { name: "Carmilla - Le Fanu.epub", path: "/home/wren/Carmilla - Le Fanu.epub", isDir: false, size: 412_000 },
  ],
  "/home/wren/Books": [
    { name: "Dracula - Bram Stoker.epub", path: "/home/wren/Books/Dracula - Bram Stoker.epub", isDir: false, size: 1_204_000 },
    { name: "The Monk - Lewis.pdf", path: "/home/wren/Books/The Monk - Lewis.pdf", isDir: false, size: 3_480_000 },
  ],
  "/home/wren/Audiobooks": [
    { name: "Frankenstein", path: "/home/wren/Audiobooks/Frankenstein", isDir: true, size: 0 },
    { name: "Uncle Silas.m4b", path: "/home/wren/Audiobooks/Uncle Silas.m4b", isDir: false, size: 310_000_000 },
  ],
  "/home/wren/Audiobooks/Frankenstein": [
    { name: "01 Letter One.mp3", path: "/home/wren/Audiobooks/Frankenstein/01 Letter One.mp3", isDir: false, size: 9_800_000 },
    { name: "02 Letter Two.mp3", path: "/home/wren/Audiobooks/Frankenstein/02 Letter Two.mp3", isDir: false, size: 8_100_000 },
  ],
};

const SEEDBOX: ServerView = {
  id: "preview-seedbox",
  name: "Seedbox",
  protocol: "sftp",
  host: "seedbox.example.net",
  port: 22,
  username: "wren",
  hasPassword: true,
  login: "password",
  keyFile: null,
  folder: "",
  hostKey: "SHA256:q3Vx1d2Yw9pZ8bKcR4mT7nLs0aEfGhJiUoPyXwVb6kM",
};

const PRETEND_NEARBY: NearbyDevice[] = [
  { alias: "Wren's iPhone", fingerprint: "wren", deviceType: "mobile", address: "192.168.1.24", port: 53317, https: true },
  { alias: "Study laptop", fingerprint: "study", deviceType: "desktop", address: "192.168.1.31", port: 53317, https: true },
];

export function previewServers(): ServerApi {
  let servers: ServerView[] = new URLSearchParams(location.search).has("servers") ? [SEEDBOX] : [];
  // A pretend list of files coming down: a few at once, a step every half second.
  let files: QueuedServerFile[] = [];
  let connections = 3;
  let version = 0;
  let nextId = 1;
  const listeners = new Set<() => void>();
  let localSend: LocalSendStatus = { enabled: false, running: false, alias: "The Bound Vigil on PREVIEW", problem: null };
  const offerListeners = new Set<(offer: LocalSendOffer) => void>();
  const sendingListeners = new Set<(sending: LocalSendSending) => void>();
  let stopSending = false;
  const changedListeners = new Set<() => void>();
  let sent: SentFile[] = [];
  const tell = () => {
    version += 1;
    listeners.forEach((l) => l());
  };
  const expand = (path: string, isDir: boolean, size: number): { path: string; size: number }[] =>
    isDir ? (TREE[path] ?? []).flatMap((e) => expand(e.path, e.isDir, e.size)) : [{ path, size }];
  const step = () => {
    const now = new Date().toISOString();
    for (const f of files.filter((f) => f.state === "downloading")) {
      f.bytesDone = Math.min(f.size, f.bytesDone + Math.max(2_000_000, f.size / 4));
      if (f.bytesDone >= f.size) Object.assign(f, { state: "done", finishedAt: now });
    }
    for (const f of files.filter((f) => f.state === "waiting").slice(0, connections - files.filter((f) => f.state === "downloading").length))
      Object.assign(f, { state: "downloading", startedAt: now });
    tell();
  };
  setInterval(() => files.some((f) => f.state === "waiting" || f.state === "downloading") && step(), 500);
  const find = (id: string) => {
    const s = servers.find((x) => x.id === id);
    if (!s) throw new Error("That server isn't saved any more. Add it again in Settings › Servers.");
    return s;
  };
  return {
    listServers: async () => servers,
    saveServer: async ({ password, ...input }) => {
      const before = servers.find((s) => s.id === input.id);
      const saved: ServerView = {
        ...input,
        id: before?.id ?? `preview-${Date.now()}`,
        name: input.name.trim() || input.host.trim(),
        hasPassword: Boolean(password) || Boolean(before?.hasPassword),
        hostKey: before?.hostKey ?? null,
      };
      servers = before ? servers.map((s) => (s.id === saved.id ? saved : s)) : [...servers, saved];
      return saved;
    },
    removeServer: async (id) => {
      servers = servers.filter((s) => s.id !== id);
    },
    trustServerKey: async (id, fingerprint) => {
      const s = { ...find(id), hostKey: fingerprint };
      servers = servers.map((x) => (x.id === id ? s : x));
      return s;
    },
    testServer: async (id) => {
      const s = find(id);
      if (s.protocol !== "ftp" && !s.hostKey) throw new Error(`new-host-key:${PRETEND_FINGERPRINT[s.protocol]}`);
      return `Connected to ${s.name}. /home/wren has 2 folders and 1 file TBV can import.`;
    },
    browseServer: async (id, path) => {
      const s = find(id);
      if (s.protocol !== "ftp" && !s.hostKey) throw new Error(`new-host-key:${PRETEND_FINGERPRINT[s.protocol]}`);
      const at = path ?? (s.folder || "/home/wren");
      return { path: at, entries: TREE[at] ?? [], hidden: at === "/home/wren" ? 2 : 0 };
    },
    downloadFromServer: async (id, chosen) => {
      const s = find(id);
      for (const c of chosen)
        for (const f of expand(c.path, c.isDir, c.size))
          files.push({
            id: nextId++,
            serverName: s.name,
            remote: f.path,
            name: f.path.split("/").pop() ?? f.path,
            size: f.size,
            bytesDone: 0,
            state: "waiting",
            error: null,
            startedAt: null,
            finishedAt: null,
          });
      tell();
    },
    serverQueue: async () => {
      const count = (...states: QueuedServerFile["state"][]) => files.filter((f) => states.includes(f.state)).length;
      return {
        ...NO_SERVER_QUEUE,
        counts: {
          total: files.length,
          waiting: count("waiting"),
          downloading: count("downloading"),
          downloaded: count("downloaded", "importing"),
          done: count("done"),
          failed: count("failed"),
          bytesTotal: files.reduce((n, f) => n + f.size, 0),
          bytesDone: files.reduce((n, f) => n + f.bytesDone, 0),
        },
        connections,
        active: files.filter((f) => f.state === "downloading"),
        version,
      };
    },
    serverQueuePage: async (offset, limit) => files.slice(offset, offset + limit).map((f) => ({ ...f })),
    retryServerFile: async (id) => {
      files = files.map((f) => (f.id === id && f.state === "failed" ? { ...f, state: "waiting", error: null } : f));
      tell();
    },
    removeServerFile: async (id) => {
      files = files.filter((f) => f.id !== id);
      tell();
    },
    cancelServerQueue: async () => {
      files = files.filter((f) => f.state !== "waiting" && f.state !== "downloading");
      tell();
    },
    clearServerFinished: async () => {
      files = files.filter((f) => f.state !== "done" && f.state !== "failed");
      tell();
    },
    setServerConnections: async (count) => {
      connections = count;
      tell();
    },
    localSendStatus: async () => ({ ...localSend }),
    setLocalSend: async (on) => {
      localSend = { ...localSend, enabled: on, running: on };
      // The preview pretends a phone offers two books a moment after it's switched on.
      if (on) setTimeout(() => offerListeners.forEach((l) => l(PRETEND_OFFER)), 1500);
      return { ...localSend };
    },
    answerLocalSend: async (_session, accept) => {
      const row = (f: (typeof PRETEND_OFFER.files)[number]): SentFile => ({
        session: PRETEND_OFFER.session,
        id: f.id,
        from: PRETEND_OFFER.from,
        name: f.name,
        size: f.size,
        bytes: 0,
        state: !f.importable ? "skipped" : accept ? "waiting" : "skipped",
        reason: !f.importable ? `TBV doesn't take .${f.name.split(".").pop()} files` : accept ? null : "Turned down",
      });
      sent = PRETEND_OFFER.files.map(row);
      changedListeners.forEach((l) => l());
      if (!accept) return;
      // The first arrives, the second is cut off part way.
      setTimeout(() => {
        sent = sent.map((f, i) =>
          f.state !== "waiting"
            ? f
            : i === 0
              ? { ...f, state: "arrived", bytes: f.size }
              : { ...f, state: "failed", bytes: Math.round(f.size / 3), reason: "The connection dropped after 103.3 MB of 295.6 MB" },
        );
        changedListeners.forEach((l) => l());
      }, 800);
    },
    onLocalSendOffer: (listener) => {
      offerListeners.add(listener);
      return () => offerListeners.delete(listener);
    },
    localSendFiles: async () => sent,
    clearLocalSendFinished: async () => {
      sent = sent.filter((f) => f.state === "waiting" || f.state === "arriving");
      changedListeners.forEach((l) => l());
    },
    onLocalSendChanged: (listener) => {
      changedListeners.add(listener);
      return () => changedListeners.delete(listener);
    },
    localSendNearby: async () => {
      await new Promise((r) => setTimeout(r, 1200));
      return PRETEND_NEARBY;
    },
    localSendDeviceAt: async (address) => ({ ...PRETEND_NEARBY[0], alias: `Grimoire at ${address}`, address, fingerprint: address }),
    sendWithLocalSend: async (device, bookIds) => {
      // The preview pretends each book takes a moment to go.
      stopSending = false;
      for (let i = 0; i < bookIds.length; i++) {
        const size = 2_000_000 + i * 700_000;
        for (let bytes = 0; bytes <= size; bytes += size / 5) {
          if (stopSending) throw new Error("Sending was stopped.");
          sendingListeners.forEach((l) => l({ book: i + 1, books: bookIds.length, title: `Book ${i + 1}`, bytes, size }));
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      if (device.deviceType === "headless") throw new Error(`${device.alias} turned them down.`);
      return { sent: bookIds.length, skipped: [] };
    },
    stopSendingWithLocalSend: async () => {
      stopSending = true;
    },
    onLocalSendSending: (listener) => {
      sendingListeners.add(listener);
      return () => sendingListeners.delete(listener);
    },
    onServerQueue: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pickKeyFile: async () => "C:\\Users\\you\\.ssh\\id_ed25519",
  };
}
