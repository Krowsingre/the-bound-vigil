// Discover's Downloads list: what the browser brought down, kept on this
// device (the last 50), so it's still there next time with Retry, Read now
// and Send with Grimoire.

export interface Fetched {
  id: string;
  name: string;
  state: "coming" | "done" | "failed" | "added" | "kept";
  path?: string;
  /** Where it came from, for Retry. */
  url?: string;
  /** The tab it came down in. */
  tab?: string;
  /** Once added: the id its book has in the library. */
  bookId?: string;
  /** Still waiting for an answer: add it, keep it, or not. */
  asking?: boolean;
  /** When it started, as milliseconds since 1970. */
  at: number;
}

const KEY = "tbv.browser.downloads";
export const MOST_DOWNLOADS = 50;

export function readDownloads(): Fetched[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(saved)) return [];
    return (
      saved
        .filter((d): d is Fetched => !!d && typeof d.id === "string" && typeof d.name === "string" && typeof d.state === "string")
        // One still coming down when TBV closed never finished.
        .map((d) => (d.state === "coming" ? { ...d, state: "failed" as const } : { ...d, at: typeof d.at === "number" ? d.at : 0 }))
    );
  } catch {
    return [];
  }
}

export function writeDownloads(list: Fetched[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MOST_DOWNLOADS)));
  } catch {
    // Forgotten after this visit.
  }
}

/** What a download's line says under its name. */
export function downloadState(d: Fetched): string {
  switch (d.state) {
    case "coming":
      return "Coming down…";
    case "failed":
      return "Didn't finish";
    case "added":
      return "Added to your library";
    case "kept":
      return "Kept in Downloads";
    default:
      return "Downloaded";
  }
}
