// The browser preview's pretend seedbox, so Settings › Servers can be tried
// without one. `?servers` starts with it saved.

import { NO_SERVER_QUEUE, type ServerApi } from "../api/serverStub";
import type { QueuedServerFile, RemoteEntry, ServerView } from "../api/types";

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

export function previewServers(): ServerApi {
  let servers: ServerView[] = new URLSearchParams(location.search).has("servers") ? [SEEDBOX] : [];
  // A pretend list of files coming down: a few at once, a step every half second.
  let files: QueuedServerFile[] = [];
  let connections = 3;
  let version = 0;
  let nextId = 1;
  const listeners = new Set<() => void>();
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
    onServerQueue: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pickKeyFile: async () => "C:\\Users\\you\\.ssh\\id_ed25519",
  };
}
