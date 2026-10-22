import { api } from "../api";
import type { Profile, SyncStatus } from "../api/types";
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
  onChooseAvatar,
  onClearAvatar,
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
  onChooseAvatar: () => void;
  onClearAvatar: () => void;
}) {
  const state = sync?.state ?? "disabled";
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
        {
          heading: (
            <>
              <strong>{SUMMARY[state]}</strong>
              <span>
                {off
                  ? "No cloud service connected yet."
                  : state === "attention"
                    ? "Some changes need you to choose. See Sync & Accounts."
                    : sync?.lastSuccessAt
                    ? `Last synced ${relativeTime(sync.lastSuccessAt)}`
                    : "Not synced yet"}
              </span>
            </>
          ),
        },
        { label: "Sync now", icon: "sync", disabled: off || state === "syncing", onSelect: () => void api.syncNow() },
        ...(onOpenActivity ? [{ label: "Sync activity", icon: "list" as const, hint: "File by file", onSelect: onOpenActivity }] : []),
        ...(onOpenPlaces ? [{ label: "Where your books are", icon: "cloud" as const, hint: "Computer and cloud", onSelect: onOpenPlaces }] : []),
        "divider",
        { label: "Import books…", icon: "importFile", hint: "Ctrl+O", onSelect: onImportBooks },
        { label: "Import a folder…", icon: "folder", onSelect: onImportFolder },
        "divider",
        ...(off
          ? [
              { label: "Connect a cloud service", icon: "cloud" as const, onSelect: onOpenSyncSettings },
              { label: "Join an existing library", icon: "link" as const, hint: "Sign in on this device", onSelect: onOpenSyncSettings },
              "divider" as const,
            ]
          : []),
        { label: "Sync & Accounts", icon: "settings", onSelect: onOpenSyncSettings },
        "divider",
        {
          label: hidden ? "Show covers" : "Hide covers",
          icon: hidden ? "focus" : "eyeOff",
          hint: PRIVACY_SHORTCUT,
          onSelect: togglePrivacy,
        },
        "divider",
        { label: avatar ? "Change profile picture…" : "Choose a profile picture…", icon: "image", onSelect: onChooseAvatar },
        ...(avatar ? [{ label: "Remove profile picture", onSelect: onClearAvatar }] : []),
      ]}
    />
  );
}
