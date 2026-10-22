// The pages inside Settings, and what the settings search can find.

import type { IconName } from "../components/Icon";

export type SettingsTab =
  | "appearance"
  | "reading"
  | "library"
  | "collections"
  | "notes"
  | "sync"
  | "files"
  | "ereaders"
  | "servers"
  | "accessibility"
  | "shortcuts"
  | "advanced"
  | "about";

export const SETTINGS_TABS: {
  tab: SettingsTab;
  label: string;
  icon: IconName;
  lede: string;
}[] = [
  {
    tab: "appearance",
    label: "Appearance",
    icon: "palette",
    lede: "Choose how The Bound Vigil looks and feels.",
  },
  {
    tab: "reading",
    label: "Reading",
    icon: "readingA",
    lede: "How the text of your books looks when you open them.",
  },
  {
    tab: "library",
    label: "Library",
    icon: "library",
    lede: "How your library is shown, and where its files live.",
  },
  {
    tab: "collections",
    label: "Collections",
    icon: "grid",
    lede: "What the Collections page shows.",
  },
  {
    tab: "notes",
    label: "Notes",
    icon: "notes",
    lede: "How your notes are shown, and taking them with you.",
  },
  {
    tab: "sync",
    label: "Sync & Backup",
    icon: "cloud",
    lede: "Keep your library, reading progress and notes in step and safe.",
  },
  {
    tab: "files",
    label: "File Handling",
    icon: "file",
    lede: "Which books TBV opens, and how it treats your files.",
  },
  {
    tab: "ereaders",
    label: "E-readers",
    icon: "ereader",
    lede: "Send books to your Kindle, Kobo or other e-reader.",
  },
  {
    tab: "servers",
    label: "Servers",
    icon: "database",
    lede: "Bring in books and audiobooks from a seedbox, a NAS or another computer.",
  },
  {
    tab: "accessibility",
    label: "Accessibility",
    icon: "accessibility",
    lede: "Make TBV easier to see and use.",
  },
  {
    tab: "shortcuts",
    label: "Shortcuts",
    icon: "keyboard",
    lede: "Keys that save a trip to the mouse.",
  },
  {
    tab: "advanced",
    label: "Advanced",
    icon: "sliders",
    lede: "Where TBV keeps its data, and starting settings afresh.",
  },
  {
    tab: "about",
    label: "About",
    icon: "info",
    lede: "The Bound Vigil, and the work it is built on.",
  },
];

export interface SettingsEntry {
  tab: SettingsTab;
  /** The section's id on its page. */
  section: string;
  label: string;
  /** Other words people might search for. */
  words: string;
}

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  {
    tab: "servers",
    section: "servers",
    label: "Servers",
    words: "ftp ftps sftp ssh seedbox nas server remote computer import download audiobooks books key fingerprint",
  },
  {
    tab: "appearance",
    section: "theme",
    label: "Application theme",
    words: "light dark system adaptive colour color mode night cover accent",
  },
  {
    tab: "appearance",
    section: "layout",
    label: "Interface layout",
    words: "scale size zoom sidebar cover display grid list",
  },
  {
    tab: "appearance",
    section: "typography",
    label: "Typography",
    words: "font typeface interface reading lora echolume serif size",
  },
  {
    tab: "appearance",
    section: "privacy",
    label: "Privacy mode",
    words: "privacy private hide covers blank discreet shortcut profile picture",
  },
  {
    tab: "appearance",
    section: "colour",
    label: "Colour & surface",
    words: "surface paper matte clean progress bars contrast motion",
  },
  {
    tab: "reading",
    section: "text",
    label: "Text and page",
    words: "font size line spacing width margins justify page turn scroll paging page colour",
  },
  {
    tab: "library",
    section: "view",
    label: "Library view",
    words: "default layout grid list compact sort order",
  },
  {
    tab: "library",
    section: "folder",
    label: "Library folder",
    words: "folder location storage files explorer size",
  },
  {
    tab: "library",
    section: "tags",
    label: "Tags",
    words: "tags labels remove rename filter",
  },
  {
    tab: "library",
    section: "duplicates",
    label: "Duplicates",
    words: "duplicate duplicates copies same book twice isbn find delete",
  },
  {
    tab: "library",
    section: "deleted",
    label: "Deleted books",
    words: "deleted removed books come back again import previously skip",
  },
  {
    tab: "library",
    section: "goodreads",
    label: "Goodreads",
    words: "goodreads import export csv file upload ratings stars shelves read dates",
  },
  {
    tab: "collections",
    section: "show",
    label: "What Collections shows",
    words: "smart collections series layout cards list",
  },
  {
    tab: "notes",
    section: "view",
    label: "Notes view",
    words: "layout cards list compact sort",
  },
  {
    tab: "notes",
    section: "export",
    label: "Export notes",
    words: "markdown export highlights annotations",
  },
  {
    tab: "sync",
    section: "names",
    label: "Your name and this device's name",
    words: "name account profile person user device computer phone ipad iphone called rename grimoire",
  },
  {
    tab: "sync",
    section: "provider",
    label: "Sync provider",
    words:
      "supabase dropbox google drive onedrive icloud mega webdav nextcloud owncloud pcloud box folder other custom cloud account connect sign in sign out email password setup script sync now join device",
  },
  {
    tab: "sync",
    section: "also",
    label: "Second sync",
    words: "dual two both second also another place at once icloud supabase phone audiobooks storage room",
  },
  {
    tab: "sync",
    section: "move",
    label: "Move or back up your library",
    words: "move migrate switch transfer copy backup another cloud service provider dropbox google drive onedrive icloud mega webdav supabase audio text",
  },
  {
    tab: "sync",
    section: "phone",
    label: "Books for your phone",
    words: "phone iphone mobile choose chosen send which books audiobooks supabase download",
  },
  {
    tab: "sync",
    section: "contents",
    label: "What's in Supabase",
    words: "supabase files contents storage space remove delete covers pictures ebooks documents audiobooks free plan full",
  },
  {
    tab: "sync",
    section: "options",
    label: "Sync options",
    words: "progress notes highlights collections metadata book files audiobook audio stream streaming play without downloading",
  },
  {
    tab: "sync",
    section: "home",
    label: "Use on your phone at home",
    words: "phone iphone wifi wi-fi home network qr code pair pairing serve local stream icloud",
  },
  {
    tab: "sync",
    section: "behaviour",
    label: "Sync behaviour",
    words: "frequency automatic startup close conflict resolution recent",
  },
  {
    tab: "sync",
    section: "hardcover",
    label: "Hardcover",
    words: "hardcover goodreads ratings stars rate send account sign in reading tracker",
  },
  {
    tab: "sync",
    section: "backup",
    label: "Backup & restore",
    words: "backup restore export json data safe copy",
  },
  {
    tab: "files",
    section: "formats",
    label: "Book formats",
    words: "epub pdf mobi azw azw3 cbz cbr comics fb2 fbz txt text docx doc word formats supported",
  },
  {
    tab: "files",
    section: "files",
    label: "Your book files",
    words: "import copy original modify metadata files",
  },
  {
    tab: "ereaders",
    section: "connected",
    label: "Connected e-readers",
    words: "kindle kobo pocketbook nook sony ereader e-reader device usb cable drive send copy",
  },
  {
    tab: "ereaders",
    section: "kindle",
    label: "Kindle by email",
    words: "kindle send to kindle email smtp server port password app password gmail yahoo icloud amazon approved address test",
  },
  {
    tab: "accessibility",
    section: "vision",
    label: "Seeing clearly",
    words: "contrast scale zoom larger text focus ring underline links",
  },
  {
    tab: "accessibility",
    section: "motion",
    label: "Motion",
    words: "reduce motion animation transitions",
  },
  {
    tab: "shortcuts",
    section: "everywhere",
    label: "Shortcuts everywhere",
    words: "keyboard keys ctrl",
  },
  {
    tab: "shortcuts",
    section: "reader",
    label: "Shortcuts while reading",
    words: "keyboard keys page turn bookmark focus fullscreen",
  },
  {
    tab: "advanced",
    section: "data",
    label: "Data on this device",
    words: "database data folder schema version size",
  },
  {
    tab: "advanced",
    section: "reset",
    label: "Reset settings",
    words: "reset defaults start over",
  },
  {
    tab: "about",
    section: "about",
    label: "About The Bound Vigil",
    words: "version",
  },
  {
    tab: "about",
    section: "licences",
    label: "Licences",
    words: "licenses open source credits fonts",
  },
];

/** Entries whose names or words contain every word searched for. */
export function searchSettings(query: string): SettingsEntry[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SETTINGS_ENTRIES.filter((e) => {
    const page = SETTINGS_TABS.find((t) => t.tab === e.tab)?.label ?? "";
    const text = `${e.label} ${e.words} ${page}`.toLocaleLowerCase();
    return words.every((w) => text.includes(w));
  });
}
