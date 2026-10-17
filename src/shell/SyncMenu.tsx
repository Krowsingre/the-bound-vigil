import type { SyncStatus } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { relativeTime } from "../lib/format";

const SUMMARY: Record<SyncStatus["state"], string> = {
  disabled: "Sync is off",
  idle: "Up to date",
  syncing: "Syncing…",
  offline: "Offline. Changes are saved here and will sync later",
  attention: "Sync needs your attention",
  error: "Sync failed",
};

/**
 * The header circle. TBV has no account of its own, so this shows sync
 * state, and its menu holds sync, import and library setup actions.
 */
export function SyncMenu({
  sync,
  onImportBooks,
  onImportFolder,
  onOpenSyncSettings,
}: {
  sync: SyncStatus | null;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenSyncSettings: () => void;
}) {
  const state = sync?.state ?? "disabled";
  const off = state === "disabled";
  return (
    <Menu
      label={`Sync and import: ${SUMMARY[state]}`}
      className={`sync-circle sync-${state}`}
      trigger={
        <>
          <Icon name={off ? "cloudOff" : state === "syncing" ? "sync" : "cloud"} size={18} />
          <span className="sync-chevron" aria-hidden>
            ▾
          </span>
        </>
      }
      items={[
        {
          heading: (
            <>
              <strong>{SUMMARY[state]}</strong>
              <span>
                {off
                  ? "No cloud service connected yet."
                  : sync?.lastSuccessAt
                    ? `Last synced ${relativeTime(sync.lastSuccessAt)}`
                    : "Not synced yet"}
              </span>
            </>
          ),
        },
        { label: "Sync now", icon: "sync", disabled: off },
        "divider",
        { label: "Import books…", icon: "importFile", hint: "Ctrl+O", onSelect: onImportBooks },
        { label: "Import a folder…", icon: "folder", onSelect: onImportFolder },
        "divider",
        { label: "Connect a cloud service", icon: "cloud", hint: "Coming soon", disabled: true },
        { label: "Join an existing library", icon: "link", hint: "Coming soon", disabled: true },
        "divider",
        { label: "Sync & Accounts", icon: "settings", onSelect: onOpenSyncSettings },
      ]}
    />
  );
}
