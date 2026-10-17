import type { BookPreview } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import type { MenuEntry } from "../components/Menu";

export interface BookActions {
  open: (book: BookPreview) => void;
  setStatus: (book: BookPreview, status: BookPreview["status"]) => void;
  setFavorite: (book: BookPreview, favorite: boolean) => void;
  setWantToRead: (book: BookPreview, want: boolean) => void;
  /** Set when the books are shown inside one of the user's collections. */
  removeFromCollection?: { name: string; remove: (book: BookPreview) => void };
}

/** The "…" menu for a book. Actions that arrive in later steps are shown but disabled. */
export function bookMenu(book: BookPreview, actions: BookActions): MenuEntry[] {
  return [
    { label: "Book details", hint: "Coming soon", disabled: true },
    "divider",
    book.favorite
      ? { label: "Remove from favourites", icon: "heart", onSelect: () => actions.setFavorite(book, false) }
      : { label: "Add to favourites", icon: "heart", onSelect: () => actions.setFavorite(book, true) },
    book.wantToRead
      ? { label: "Remove from Up next", icon: "bookmark", onSelect: () => actions.setWantToRead(book, false) }
      : { label: "Add to Up next", icon: "bookmark", onSelect: () => actions.setWantToRead(book, true) },
    { label: "Add to collection…", icon: "collections", onSelect: () => askAddToCollection(book) },
    ...(actions.removeFromCollection
      ? [{ label: `Remove from ${actions.removeFromCollection.name}`, onSelect: () => actions.removeFromCollection?.remove(book) }]
      : []),
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

/** Why a book can't be opened here, or null when it can. */
export function cannotOpen(book: BookPreview): string | null {
  switch (book.availability) {
    case "missing":
      return `The file for “${book.title}” is missing from this device. Relinking arrives in a later step.`;
    // A cloud book downloads as it opens.
    default:
      return null;
  }
}

/** The shared actions, refreshing the current view after each change. */
export function makeBookActions(
  api: Pick<import("../api").Api, "setBookStatus" | "setFavorite" | "setWantToRead">,
  toast: (text: string) => void,
  refresh: () => void,
  openBook: (bookId: string) => void,
): BookActions {
  const run = (book: BookPreview, work: Promise<void>) =>
    work.then(refresh, (e: unknown) => toast(`Couldn't update “${book.title}”: ${String(e)}`));
  return {
    open: (book) => {
      const reason = cannotOpen(book);
      if (reason) toast(reason);
      else openBook(book.id);
    },
    setStatus: (book, status) => void run(book, api.setBookStatus(book.id, status)),
    setFavorite: (book, favorite) => void run(book, api.setFavorite(book.id, favorite)),
    setWantToRead: (book, want) => void run(book, api.setWantToRead(book.id, want)),
  };
}
