import { api } from "../api";
import type { Profile, SyncBehind, SyncStatus } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { relativeTime } from "../lib/format";
import { PRIVACY_SHORTCUT, useAppSettings } from "../settings/appSettings";

const SUMMARY: Record<SyncStatus["state"], string> = {
  disabled: "Sync is off",
  idle: "Up to date",
  syncing: "Syncing…",
  offline: "Offline. Changes are saved here and will sync later",
  attention: "Sync needs your attention",
  error: "Sync failed",
};

/** In words, for the sync menu and Settings: which devices this one is behind. */
export function behindText(behind: SyncBehind[]): string {
  return behind
    .map(
      (b) =>
        `${b.label} (${b.books.toLocaleString()} books) has ${(b.written - b.read).toLocaleString()} ${b.written - b.read === 1 ? "batch" : "batches"} of changes this device hasn't received yet. Its cloud app is still bringing them over.`,
    )
    .join(" ");
}

/**
 * The header circle. TBV has no account of its own, so this shows sync
 * state, and its menu holds sync, import and library setup actions. It can
 * frame a picture of the user's choosing; sync state then shows as a badge.
 */
export function SyncMenu({
  sync,
  profile,
  onImportBooks,
  onImportFolder,
  onOpenSyncSettings,
  onOpenActivity,
  onOpenPlaces,
  onOpenProfile,
  onOpenPlan,
}: {
  sync: SyncStatus | null;
  profile: Profile | null;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenSyncSettings: () => void;
  /** The Sync activity page; left out where there's none (the phone version). */
  onOpenActivity?: () => void;
  /** The Where your books are page; desktop only too. */
  onOpenPlaces?: () => void;
  /** Preferences › Appearance › Profile: picture, name and device name. */
  onOpenProfile: () => void;
  /** Preferences › Your plan; left out where nothing can be bought (the web version). */
  onOpenPlan?: () => void;
}) {
  const state = sync?.state ?? "disabled";
  // Up to date as far as this device knows, but another has more.
  const behind = state === "idle" && sync?.behind?.length ? sync.behind : null;
  const off = state === "disabled";
  const icon = off ? "cloudOff" : state === "syncing" ? "sync" : "cloud";
  const avatar = profile?.avatarPath ? api.coverUrl(profile.avatarPath) : "";
  const { settings, togglePrivacy } = useAppSettings();
  const hidden = settings.privacy.on;
  return (
    <Menu
      label={`Sync and import: ${SUMMARY[state]}`}
      className={`sync-circle sync-${state}${avatar ? " has-avatar" : ""}`}
      trigger={
        <>
          {avatar ? (
            <span className="sync-avatar">
              <img src={avatar} alt="" draggable={false} />
              <span className="sync-badge">
                <Icon name={icon} size={11} />
              </span>
            </span>
          ) : (
            <Icon name={icon} size={18} />
          )}
          <span className="sync-chevron" aria-hidden>
            ▾
          </span>
        </>
      }
      items={[
        // Who and where, opening the Profile card.
        {
          label: profile?.name ?? "Your profile",
          icon: "edit",
          hint: profile?.deviceName ? `On ${profile.deviceName}` : "Picture and names",
          onSelect: onOpenProfile,
        },
        "divider",
        {
          heading: (
            <>
              <strong>{behind ? "Not caught up yet" : SUMMARY[state]}</strong>
              <span>
                {off
                  ? "No cloud service connected yet."
                  : state === "attention"
                    ? "Some changes need you to choose. See Sync & Accounts."
                    : behind
                    ? behindText(behind)
                    : sync?.lastSuccessAt
                    ? `Last synced ${relativeTime(sync.lastSuccessAt)}`
                    : "Not synced yet"}
              </span>
            </>
          ),
        },
        ...(off
          ? [{ label: "Connect a cloud service", icon: "cloud" as const, hint: "Or join a library", onSelect: onOpenSyncSettings }]
          : [
              { label: state === "syncing" ? "Syncing…" : "Sync now", icon: "sync" as const, disabled: state === "syncing", onSelect: () => void api.syncNow() },
              ...(onOpenActivity ? [{ label: "Sync activity", icon: "list" as const, hint: "File by file", onSelect: onOpenActivity }] : []),
              { label: "Sync & Accounts", icon: "settings" as const, onSelect: onOpenSyncSettings },
            ]),
        ...(onOpenPlaces ? [{ label: "Where your books are", icon: "cloud" as const, hint: "Computer and cloud", onSelect: onOpenPlaces }] : []),
        "divider",
        { label: "Import books…", icon: "importFile", hint: "Ctrl+O", onSelect: onImportBooks },
        { label: "Import a folder…", icon: "folder", onSelect: onImportFolder },
        "divider",
        {
          label: hidden ? "Show covers" : "Hide covers",
          icon: hidden ? "focus" : "eyeOff",
          hint: PRIVACY_SHORTCUT,
          onSelect: togglePrivacy,
        },
        ...(onOpenPlan ? [{ label: "Your plan…", icon: "tag" as const, hint: "Plans and purchases", onSelect: onOpenPlan }] : []),
      ]}
    />
  );
}
