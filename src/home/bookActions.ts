import type { BookPreview } from "../api/types";
import type { MenuEntry } from "../components/Menu";

export interface BookActions {
  open: (book: BookPreview) => void;
  setStatus: (book: BookPreview, status: BookPreview["status"]) => void;
}

/** The "…" menu for a book. Actions that arrive in later steps are shown but disabled. */
export function bookMenu(book: BookPreview, actions: BookActions): MenuEntry[] {
  return [
    { label: "Book details", hint: "Coming soon", disabled: true },
    "divider",
    book.status === "read"
      ? { label: "Mark as unread", onSelect: () => actions.setStatus(book, "unread") }
      : { label: "Mark as read", onSelect: () => actions.setStatus(book, "read") },
    ...(book.status === "in_progress"
      ? [{ label: "Stop reading (mark unread)", onSelect: () => actions.setStatus(book, "unread") }]
      : []),
    "divider",
    { label: "Remove from this device", hint: "Coming soon", disabled: true },
    { label: "Delete from library…", hint: "Coming soon", disabled: true, danger: true },
  ];
}

/** What opening a book does today, given where its file is. */
export function openMessage(book: BookPreview): string {
  switch (book.availability) {
    case "missing":
      return `The file for “${book.title}” is missing from this device. Relinking arrives in a later step.`;
    case "cloud":
      return `“${book.title}” isn't downloaded to this device yet. Downloading arrives with sync.`;
    default:
      return `The reader arrives in a later step. “${book.title}” will open right where you left off.`;
  }
}
