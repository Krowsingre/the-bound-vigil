import { createElement } from "react";
import type { BookPreview } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import { openContextMenu } from "../components/ContextMenu";
import type { MenuEntry } from "../components/Menu";
import { StarRating } from "../components/StarRating";
import { askEditDetails, showBookDetails } from "../details/openDetails";
import { askSendToEreader } from "../ereaders/SendToEreader";
import { askDeleteBook, askEditTags } from "../library/BookDialogs";

export interface BookActions {
  open: (book: BookPreview) => void;
  setStatus: (book: BookPreview, status: BookPreview["status"]) => void;
  setFavorite: (book: BookPreview, favorite: boolean) => void;
  setWantToRead: (book: BookPreview, want: boolean) => void;
  setRating: (book: BookPreview, rating: number | null) => void;
  /** Fetches a cloud-only book onto this device. */
  download?: (book: BookPreview) => void;
  /** Removes the copy here, keeping the one in the cloud. */
  removeDownload?: (book: BookPreview) => void;
  /** Set when the books are shown inside one of the user's collections. */
  removeFromCollection?: { name: string; remove: (book: BookPreview) => void };
}

/** The "…" menu for a book, and its right-click menu. */
export function bookMenu(book: BookPreview, actions: BookActions): MenuEntry[] {
  return [
    { label: "Book details", icon: "info", onSelect: () => showBookDetails(book.id) },
    { label: "Edit details…", icon: "edit", onSelect: () => askEditDetails([book]) },
    {
      heading: createElement(
        "span",
        { className: "menu-rating" },
        "Your rating",
        createElement(StarRating, { value: book.rating, size: 18, onChange: (r) => actions.setRating(book, r) }),
      ),
    },
    "divider",
    book.favorite
      ? { label: "Remove from favourites", icon: "heart", onSelect: () => actions.setFavorite(book, false) }
      : { label: "Add to favourites", icon: "heart", onSelect: () => actions.setFavorite(book, true) },
    book.wantToRead
      ? { label: "Remove from Up next", icon: "bookmark", onSelect: () => actions.setWantToRead(book, false) }
      : { label: "Add to Up next", icon: "bookmark", onSelect: () => actions.setWantToRead(book, true) },
    { label: "Add to collection…", icon: "collections", onSelect: () => askAddToCollection(book) },
    { label: book.tags.length ? "Edit tags…" : "Add tags…", icon: "tag", onSelect: () => askEditTags(book) },
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
    { label: "Send to e-reader…", icon: "ereader", onSelect: () => askSendToEreader([book]) },
    downloadItem(book, actions),
    { label: "Delete from library…", icon: "trash", danger: true, onSelect: () => askDeleteBook(book) },
  ];
}

/** Right-clicking a book opens its menu. Spread onto the book's card or row. */
export function bookContextMenu(book: BookPreview, actions: BookActions) {
  return { onContextMenu: (e: React.MouseEvent) => openContextMenu(e, `More for ${book.title}`, bookMenu(book, actions)) };
}

function downloadItem(book: BookPreview, actions: BookActions): MenuEntry {
  if (book.availability === "cloud")
    return { label: "Download to this device", icon: "download", disabled: !actions.download, onSelect: () => actions.download?.(book) };
  if (book.availability === "missing") return { label: "Remove download", icon: "cloudOff", hint: "File missing", disabled: true };
  if (!book.inCloud) return { label: "Remove download", icon: "cloudOff", hint: "Not in the cloud yet", disabled: true };
  return { label: "Remove download (keep in cloud)", icon: "cloudOff", disabled: !actions.removeDownload, onSelect: () => actions.removeDownload?.(book) };
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
  api: Pick<import("../api").Api, "setBookStatus" | "setFavorite" | "setWantToRead" | "setRating"> &
    Partial<Pick<import("../api").Api, "downloadBook" | "removeDownload">>,
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
    setRating: (book, rating) => void run(book, api.setRating(book.id, rating)),
    download: api.downloadBook && ((book) => {
      toast(`Downloading “${book.title}”…`);
      void run(book, api.downloadBook!(book.id).then(() => toast(`“${book.title}” is on this device.`)));
    }),
    removeDownload: api.removeDownload && ((book) =>
      void run(book, api.removeDownload!(book.id).then(() => toast(`Removed the copy of “${book.title}” here. It's still in the cloud.`)))),
  };
}
