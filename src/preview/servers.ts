// The browser preview's pretend seedbox, so Settings › Servers can be tried
// without one. `?servers` starts with it saved.

import { IDLE_SERVER_DOWNLOAD, type ServerApi } from "../api/serverStub";
import type { RemoteEntry, ServerDownloadStatus, ServerView } from "../api/types";

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
  let status: ServerDownloadStatus = IDLE_SERVER_DOWNLOAD;
  const listeners = new Set<(s: ServerDownloadStatus) => void>();
  const tell = (next: ServerDownloadStatus) => {
    status = next;
    listeners.forEach((l) => l(status));
  };
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
      if (s.protocol === "sftp" && !s.hostKey) throw new Error("new-host-key:SHA256:q3Vx1d2Yw9pZ8bKcR4mT7nLs0aEfGhJiUoPyXwVb6kM");
      return `Connected to ${s.name}. /home/wren has 2 folders and 1 file TBV can import.`;
    },
    browseServer: async (id, path) => {
      const s = find(id);
      if (s.protocol === "sftp" && !s.hostKey) throw new Error("new-host-key:SHA256:q3Vx1d2Yw9pZ8bKcR4mT7nLs0aEfGhJiUoPyXwVb6kM");
      const at = path ?? (s.folder || "/home/wren");
      return { path: at, entries: TREE[at] ?? [], hidden: at === "/home/wren" ? 2 : 0 };
    },
    downloadFromServer: async (id, chosen) => {
      const s = find(id);
      const total = chosen.length * 3;
      let done = 0;
      tell({ ...IDLE_SERVER_DOWNLOAD, running: true, server: s.name });
      const tick = setInterval(() => {
        done += 1;
        if (done > total) {
          clearInterval(tick);
          tell({ ...status, running: false, queued: chosen.length });
          return;
        }
        tell({
          ...status,
          progress: {
            stage: "downloading",
            filesDone: done - 1,
            filesTotal: total,
            bytesDone: done * 4_000_000,
            bytesTotal: total * 4_000_000,
            current: chosen[Math.min(chosen.length - 1, Math.floor((done - 1) / 3))].path.split("/").pop() ?? null,
          },
        });
      }, 500);
    },
    serverDownloadStatus: async () => status,
    cancelServerDownload: async () => tell({ ...status, running: false, stopped: true }),
    clearServerDownload: async () => tell(IDLE_SERVER_DOWNLOAD),
    onServerDownload: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pickKeyFile: async () => "C:\\Users\\you\\.ssh\\id_ed25519",
  };
}
