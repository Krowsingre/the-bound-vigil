// The services a library can be kept in, as Preferences › Sync shows them.

import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";

export type Provider = "supabase" | "dropbox" | "gdrive" | "onedrive" | "icloud" | "mega" | "custom";

export const PROVIDERS: { id: Provider; name: string; art: React.ReactNode }[] = [
  {
    id: "supabase",
    name: "Supabase",
    art: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "dropbox",
    name: "Dropbox",
    art: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <path
          d="m7 3-5 3.2L7 9.4l5-3.2zm10 0-5 3.2 5 3.2 5-3.2zM2 12.6l5 3.2 5-3.2-5-3.2zm15-3.2-5 3.2 5 3.2 5-3.2zM7 17l5 3.2 5-3.2-5-3.2z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "gdrive",
    name: "Google Drive",
    art: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <path d="M8.5 3h7l6.5 11.3h-7zM8.5 3 2 14.3l3.5 6 6.5-11.3zm-3 17.3h13l3.5-6H9z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "onedrive",
    name: "OneDrive",
    art: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <path d="M7 18h11a4 4 0 0 0 .6-7.9A6 6 0 0 0 7.2 8.6 4.8 4.8 0 0 0 7 18z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "icloud",
    name: "iCloud Drive",
    art: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <path
          d="M6.5 19h11a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6.6 9.2 5 5 0 0 0 6.5 19z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "mega",
    name: "MEGA",
    art: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path d="M7.5 16V8.5l4.5 4.5 4.5-4.5V16" fill="none" stroke="var(--surface)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "custom",
    name: "Another service",
    art: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.6" />
        <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
];

/**
 * The place chosen, as a card, and every other one in a dropdown. With
 * nothing chosen there is only the dropdown.
 */
export function ProviderPicker({
  picked,
  onPick,
  label,
  status,
  inUse,
}: {
  picked: Provider | null;
  onPick: (provider: Provider) => void;
  label: string;
  /** A line under each name, like whether it's set up. */
  status?: (provider: Provider) => string;
  /** The one syncing now, marked with a ready dot. */
  inUse?: Provider | null;
}) {
  const card = PROVIDERS.find((p) => p.id === picked);
  const others = PROVIDERS.filter((p) => p.id !== picked);
  return (
    <div className="provider-picker">
      {card && (
        <div className="provider-card is-active">
          <span className="provider-art">{card.art}</span>
          <span className="provider-text">
            <span className="settings-row-label">{card.name}</span>
            {status && (
              <span className="settings-row-hint">
                <span className={`status-dot${card.id === inUse ? " is-ready" : ""}`} aria-hidden />
                {status(card.id)}
              </span>
            )}
          </span>
        </div>
      )}
      <Menu
        label={label}
        className="btn btn-quiet provider-more"
        trigger={
          <>
            {card ? "Choose another place" : "Choose a place"} <Icon name="chevronDown" size={14} />
          </>
        }
        items={others.map((p) => ({ label: p.name, hint: status?.(p.id), onSelect: () => onPick(p.id) }))}
      />
    </div>
  );
}
