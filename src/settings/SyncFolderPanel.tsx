// Preferences › Sync: keeping the library in a folder a cloud app syncs
// (iCloud Drive, Dropbox, Google Drive, OneDrive, MEGA…), or on a WebDAV
// server. TBV makes a folder called "The Bound Vigil" inside the one chosen.

import { useEffect, useState } from "react";
import { api, isApp, isIOS } from "../api";
import type { ProviderChoice, ProviderView } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";

export type FolderService = "icloud" | "dropbox" | "gdrive" | "onedrive" | "mega" | "custom";

const SERVICE: Record<FolderService, { name: string; app: string; steps: string[] }> = {
  icloud: {
    name: "iCloud Drive",
    app: "iCloud for Windows",
    steps: [
      "Install iCloud for Windows from the Microsoft Store and sign in with your Apple Account.",
      "Turn on iCloud Drive in it. A folder called iCloud Drive appears in File Explorer.",
      "Choose that folder below.",
    ],
  },
  dropbox: {
    name: "Dropbox",
    app: "the Dropbox app",
    steps: ["Install the Dropbox app and sign in.", "Choose your Dropbox folder below."],
  },
  gdrive: {
    name: "Google Drive",
    app: "Google Drive for desktop",
    steps: [
      "Install Google Drive for desktop and sign in.",
      "Choose My Drive below. It's usually on drive G: in File Explorer.",
    ],
  },
  onedrive: {
    name: "OneDrive",
    app: "OneDrive",
    steps: ["OneDrive comes with Windows. Sign in to it if you haven't.", "Choose your OneDrive folder below."],
  },
  mega: {
    name: "MEGA",
    app: "the MEGA app",
    steps: ["Install the MEGA desktop app and sign in.", "Set up a sync between a folder on this computer and your MEGA cloud.", "Choose that folder below."],
  },
  custom: {
    name: "another service",
    app: "its app",
    steps: [
      "If the service has an app that keeps a folder in sync (pCloud, Box, Sync.com, Proton Drive…), choose that folder.",
      "Or, if it speaks WebDAV (Nextcloud, ownCloud, Koofr, a home server…), connect to it below instead.",
    ],
  },
};

/** On iPhone every folder is chosen in the Files app. */
function iphoneSteps(service: FolderService, name: string): string[] {
  const shows =
    service === "icloud"
      ? "iCloud Drive is already in the Files app if it's turned on (Settings › your name › iCloud)."
      : service === "custom"
        ? "If the service has an app, install it and sign in so it shows in the Files app."
        : `Install the ${name} app and sign in, so ${name} shows in the Files app.`;
  return [
    shows,
    "Tap Choose folder and pick the folder called The Bound Vigil that your computer made there.",
    "No library there yet? Pick the place to start one instead, and TBV makes the folder.",
  ];
}

export function serviceName(service: string | null): string {
  return service && service in SERVICE ? SERVICE[service as FolderService].name : "a folder";
}

export function SyncFolderPanel({
  service,
  current,
  onChanged,
  onUse,
  useLabel,
}: {
  service: FolderService;
  current: ProviderView;
  onChanged: () => void;
  /** Takes the folder or server instead of syncing through it (moving a library there, say). */
  onUse?: (choice: ProviderChoice) => void;
  useLabel?: string;
}) {
  const toast = useToast();
  const info = SERVICE[service];
  const usingThis = current.kind === "folder" && current.service === service;
  const [path, setPath] = useState<string | null>(usingThis ? current.location : null);
  const [busy, setBusy] = useState(false);
  const [dav, setDav] = useState({ url: current.kind === "webdav" ? (current.location ?? "") : "", username: current.username ?? "", password: "" });

  useEffect(() => {
    if (usingThis) setPath(current.location);
    else if (service !== "custom") void api.suggestSyncFolder(service).then((p) => setPath((now) => now ?? p), () => undefined);
  }, [service, usingThis, current.location]);

  const use = async (choice: ProviderChoice, where: string) => {
    if (onUse) return onUse(choice);
    if (!isApp) toast("This is the browser preview: nothing is synced here.");
    setBusy(true);
    try {
      const joined = await api.setSyncProvider(choice);
      toast(joined ? `Joined the library already in ${where}. Syncing now.` : `Your library now syncs through ${where}.`);
      onChanged();
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const picked = await api.chooseFolder(`Choose your ${info.name} folder`, path);
    if (picked) setPath(picked);
  };

  const davReady = /^https?:\/\/\S+$/i.test(dav.url.trim()) && dav.username.trim() && dav.password;

  return (
    <div className="settings-subpanel sync-folder">
      <h3>{service === "custom" ? "Another service" : `Sync with ${info.name}`}</h3>
      <ol className="setup-steps">
        {(isIOS ? iphoneSteps(service, info.name) : info.steps).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="folder-pick">
        <code className="folder-path">{path ?? "No folder chosen"}</code>
        <button type="button" className="btn btn-quiet" onClick={() => void choose()}>
          <Icon name="folder" size={16} /> Choose folder…
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!path || busy || (usingThis && path === current.location)}
          onClick={() => path && void use({ kind: "folder", service, path }, info.name === "another service" ? "that folder" : info.name)}
        >
          {usingThis && path === current.location ? "In use" : (useLabel ?? "Use this folder")}
        </button>
      </div>
      <p className="settings-row-hint">
        TBV keeps your library in a folder called The Bound Vigil inside it, and {info.app} carries it to your other devices. Choose the same
        folder on each device. Book files only go there if Sync book files is on.
      </p>

      {service === "custom" && (
        <form
          className="webdav-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (davReady) void use({ kind: "webdav", url: dav.url.trim(), username: dav.username.trim(), password: dav.password }, "your WebDAV server");
          }}
        >
          <h4>Connect with WebDAV</h4>
          <label className="field">
            <span>WebDAV address</span>
            <input
              value={dav.url}
              onChange={(e) => setDav({ ...dav, url: e.target.value })}
              placeholder="https://cloud.example.com/remote.php/dav/files/you/"
              spellCheck={false}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Username</span>
              <input value={dav.username} onChange={(e) => setDav({ ...dav, username: e.target.value })} autoComplete="username" spellCheck={false} />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={dav.password}
                onChange={(e) => setDav({ ...dav, password: e.target.value })}
                autoComplete="current-password"
                placeholder={current.kind === "webdav" ? "Enter it again to change anything" : ""}
              />
            </label>
          </div>
          <p className="settings-row-hint">
            Many services want an app password here rather than your usual one (Nextcloud: Settings › Security). It's kept on this computer only.
          </p>
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary" disabled={!davReady || busy}>
              {busy ? "Connecting…" : (useLabel ?? (current.kind === "webdav" ? "Save" : "Connect"))}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
