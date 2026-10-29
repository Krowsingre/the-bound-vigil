// The pages inside Settings, and what the settings search can find.

import type { IconName } from "../components/Icon";

export type SettingsTab =
  | "appearance"
  | "reading"
  | "library"
  | "collections"
  | "notes"
  | "browser"
  | "sync"
  | "activity"
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
    label: "Archive",
    icon: "library",
    lede: "How your books and documents are shown, and where their files live.",
  },
  {
    tab: "collections",
    label: "Compendium",
    icon: "layers",
    lede: "What the Compendium shows.",
  },
  {
    tab: "notes",
    label: "Scribe",
    icon: "notes",
    lede: "How your notes are shown, and taking them with you.",
  },
  {
    tab: "browser",
    label: "Discover",
    icon: "compass",
    lede: "Discover's start page, search engine, bar, downloads and site data.",
  },
  {
    tab: "sync",
    label: "Sync & Backup",
    icon: "cloud",
    lede: "Keep your library, reading progress and notes in step and safe.",
  },
  {
    tab: "activity",
    label: "Activity",
    icon: "list",
    lede: "What TBV is doing in the background: imports, sync, and lining up read-along.",
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
    tab: "activity",
    section: "activity",
    label: "Imports, sync activity and lining up",
    words: "imports importing adding progress sync activity files uploads downloads recent changes clear lining up read along aligning alignment audiobook pairs",
  },
  {
    tab: "reading",
    section: "read-along",
    label: "Read-along",
    words: "read along listen along lining up align alignment audiobook narrator speech model whisper accuracy background charging processor",
  },
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
    words: "scale size zoom sidebar menu full screen phone interface font typeface typography echolume serif georgia segoe",
  },
  {
    tab: "appearance",
    section: "privacy",
    label: "Privacy mode",
    words: "privacy private hide covers blank discreet shortcut profile picture",
  },
  {
    tab: "appearance",
    section: "theme",
    label: "Surface style and progress bars",
    words: "colour color surface paper matte clean progress bars",
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
    label: "Archive view",
    words: "library archive default layout grid list compact covers cover display sort order pages page numbers scroll continuous endless",
  },
  {
    tab: "library",
    section: "folder",
    label: "Archive folder",
    words: "library folder location storage files explorer size",
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
    label: "What the Compendium shows",
    words: "collections smart series layout cards list",
  },
  {
    tab: "notes",
    section: "view",
    label: "Notes view",
    words: "notes layout cards list compact sort",
  },
  {
    tab: "notes",
    section: "view",
    label: "Export notes",
    words: "markdown export highlights annotations",
  },
  {
    tab: "browser",
    section: "search",
    label: "Search engine",
    words: "discover browser search engine duckduckgo google bing brave startpage ecosia web suggestions suggest autocomplete typing",
  },
  {
    tab: "browser",
    section: "home",
    label: "Discover home page",
    words: "discover browser home page start page startpage quick links recent sites gutenberg website address coming back tabs close reset last page",
  },
  {
    tab: "browser",
    section: "bar",
    label: "Discover bar",
    words: "discover browser bar buttons row hide scrolling scroll back to top",
  },
  {
    tab: "browser",
    section: "history",
    label: "Discover history",
    words: "discover browser history pages visited searches searched clear delete keep days privacy sync synced every device",
  },
  {
    tab: "browser",
    section: "downloads",
    label: "Discover downloads",
    words: "discover browser download downloads ebook add library automatically without asking",
  },
  {
    tab: "browser",
    section: "playing",
    label: "Discover videos and sound",
    words: "discover browser video videos sound music audio youtube background playing keep pause leave",
  },
  {
    tab: "browser",
    section: "protection",
    label: "Discover protection",
    words: "discover browser protection trackers ads advertising block blocking strict balanced off privacy cookies lowered sites",
  },
  {
    tab: "browser",
    section: "sitedata",
    label: "Discover site data",
    words: "discover browser cookies site data clear logins signed in privacy start starting each time",
  },
  {
    tab: "browser",
    section: "sites",
    label: "Discover sites with their own settings",
    words: "discover browser site sites settings zoom size text larger smaller desktop version mobile reset per-site",
  },
  {
    tab: "browser",
    section: "apps",
    label: "Discover links for other apps",
    words: "discover browser other apps mail email phone call links open ask before external",
  },
  {
    tab: "appearance",
    section: "profile",
    label: "Profile: picture, your name and this device's name",
    words: "name account profile picture photo avatar image remove person user device computer phone ipad iphone called rename grimoire",
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
    tab: "library",
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
    label: "Seeing and motion",
    words: "contrast focus ring underline links reduce motion animation transitions accessibility",
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
