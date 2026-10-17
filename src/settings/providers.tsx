// The services a library can be kept in, as Settings › Sync shows them.

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
