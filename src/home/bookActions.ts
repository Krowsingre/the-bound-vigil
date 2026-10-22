import { createElement } from "react";
import type { BookPreview } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import { holdForMenu } from "../components/ContextMenu";
import type { MenuEntry } from "../components/Menu";
import { StarRating } from "../components/StarRating";
import { askEditDetails, showBookDetails, showInLibrary } from "../details/openDetails";
import { askSendToEreader } from "../ereaders/SendToEreader";
import { askSendWithLocalSend, canSendWithLocalSend } from "../localsend/SendWithLocalSend";
import { askDeleteBook, askEditTags, askRemoveBook } from "../library/BookDialogs";
import { cueAudiobook, playAudiobook } from "../audio/player";
import { askPair } from "../audio/LinkEbook";
import { isAudio, kindOf } from "../lib/queryBooks";
import { NO_FILTERS } from "../library/libraryView";
import { isApp, isHome, isWeb } from "../api";

/** Where choosing books for the phone shows: on a computer (the Sent to device shelf), and on the phone. */
export const phoneChoiceShown = () => (isApp && !isHome) || isWeb;

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
  /** Saves a copy named "Title - Author" somewhere of your choosing. */
  saveCopy?: (book: BookPreview) => void;
  /** On a computer: chooses books for the phone. On the phone: asks the computer to send them. */
  setPhoneWanted?: (books: BookPreview[], wanted: boolean) => void;
  /** Set when the books are shown inside one of the user's collections. */
  removeFromCollection?: { name: string; remove: (book: BookPreview) => void };
}

/** The "…" menu for a book, and its right-click menu. */
export function bookMenu(book: BookPreview, actions: BookActions): MenuEntry[] {
  return [
    ...(isAudio(book.format) ? [{ label: "Listen", icon: "play" as const, onSelect: () => playAudiobook(book.id) }] : []),
    { label: "Book details", icon: "info", onSelect: () => showBookDetails(book.id) },
    { label: "Edit details…", icon: "edit", onSelect: () => askEditDetails([book]) },
    {
      label: isAudio(book.format) ? "Pair with an ebook or document…" : "Pair with an audiobook…",
      icon: "headphones",
      onSelect: () => askPair(book),
    },
    ...(book.series
      ? [
          {
            label: "Show series",
            icon: "library" as const,
            onSelect: () => showInLibrary(kindOf(book.format), { ...NO_FILTERS, tab: "all", series: [book.series!], sort: "series" }),
          },
        ]
      : []),
    ...(book.authors.length
      ? [
          {
            label: book.authors.length > 1 ? `Show author (${book.authors[0]})` : "Show author",
            icon: "search" as const,
            onSelect: () => showInLibrary(kindOf(book.format), { ...NO_FILTERS, tab: "all", authors: [book.authors[0]] }),
          },
        ]
      : []),
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
    ...(isAudio(book.format) ? [] : [{ label: "Send to e-reader…", icon: "ereader" as const, onSelect: () => askSendToEreader([book]) }]),
    ...(canSendWithLocalSend ? [{ label: "Send with LocalSend…", icon: "upload" as const, onSelect: () => askSendWithLocalSend([book]) }] : []),
    ...(actions.saveCopy ? [{ label: "Save a copy…", icon: "copy" as const, onSelect: () => actions.saveCopy?.(book) }] : []),
    downloadItem(book, actions),
    ...phoneItem(book, actions),
    "divider",
    { label: "Remove from library…", icon: "close", onSelect: () => askRemoveBook(book) },
    { label: "Delete for good…", icon: "trash", danger: true, onSelect: () => askDeleteBook(book) },
  ];
}

/** The audiobook tapped last, to tell a double tap (iPhone has no double-click). */
const lastTap = { id: "", at: 0 };
const DOUBLE_TAP_MS = 400;
/** The Audiobooks page shows a tapped audiobook in its own panel. */
const onAudiobooksPage = () => !!document.querySelector(".audiobooks");

/** Right-clicking a book, or holding a finger on it, opens its menu. Spread onto the book's card or row. */
export function bookContextMenu(book: BookPreview, actions: BookActions) {
  return holdForMenu(`More for ${book.title}`, () => bookMenu(book, actions));
}

function downloadItem(book: BookPreview, actions: BookActions): MenuEntry {
  if (book.fileUnavailable) return { label: "Download to this device", icon: "download", hint: "File not in the cloud", disabled: true };
  if (book.availability === "cloud")
    return { label: "Download to this device", icon: "download", disabled: !actions.download, onSelect: () => actions.download?.(book) };
  // Gone from this device, but the cloud may still have it.
  if (book.availability === "missing")
    return { label: "Download again", icon: "download", hint: "File missing here", disabled: !actions.download, onSelect: () => actions.download?.(book) };
  if (!book.inCloud) return { label: "Remove download", icon: "cloudOff", hint: "Not in the cloud yet", disabled: true };
  return { label: "Remove download (keep in cloud)", icon: "cloudOff", disabled: !actions.removeDownload, onSelect: () => actions.removeDownload?.(book) };
}

function phoneItem(book: BookPreview, actions: BookActions): MenuEntry[] {
  const set = actions.setPhoneWanted;
  if (!set || !phoneChoiceShown()) return [];
  if (isWeb) {
    // Only a book whose file isn't in Supabase needs asking for.
    if (!book.fileUnavailable) return [];
    return book.phoneWanted
      ? [{ label: "Don't ask the computer for it", icon: "close", hint: "Asked for", onSelect: () => set([book], false) }]
      : [{ label: "Ask the computer to send it", icon: "download", onSelect: () => set([book], true) }];
  }
  if (book.phoneWanted) return [{ label: "Stop sending to device", icon: "cloudOff", hint: book.phoneHas ? "On the phone" : undefined, onSelect: () => set([book], false) }];
  return [{ label: "Send to device", icon: "upload", hint: book.phoneHas ? "On the phone" : undefined, onSelect: () => set([book], true) }];
}

/** Why a book can't be opened here, or null when it can. */
export function cannotOpen(book: BookPreview): string | null {
  if (book.fileUnavailable) return `“${book.title}” isn't in the cloud yet, so it can't be opened here. Send its file from the computer that has it.`;
  // A cloud book, or one whose file has gone from here, downloads as it opens.
  return null;
}

/** The shared actions, refreshing the current view after each change. */
export function makeBookActions(
  api: Pick<import("../api").Api, "setBookStatus" | "setFavorite" | "setWantToRead" | "setRating"> &
    Partial<Pick<import("../api").Api, "downloadBook" | "removeDownload" | "saveCopies" | "setPhoneWanted">>,
  toast: (text: string) => void,
  refresh: () => void,
  openBook: (bookId: string) => void,
): BookActions {
  const run = (book: BookPreview, work: Promise<void>) =>
    work.then(refresh, (e: unknown) => toast(`Couldn't update “${book.title}”: ${String(e)}`));
  return {
    open: (book) => {
      // Audiobooks never start on a tap. One tap puts it in the player bar,
      // ready to play (or, while another plays, shows its details); a second
      // tap soon after opens its details page.
      if (isAudio(book.format)) {
        const now = Date.now();
        if (lastTap.id === book.id && now - lastTap.at < DOUBLE_TAP_MS) {
          lastTap.id = "";
          showBookDetails(book.id);
          return;
        }
        lastTap.id = book.id;
        lastTap.at = now;
        if (!cueAudiobook(book.id) && !onAudiobooksPage()) showBookDetails(book.id);
        return;
      }
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
    setPhoneWanted: api.setPhoneWanted && ((books, wanted) => {
      const what = books.length === 1 ? `“${books[0].title}”` : `${books.length} books`;
      void api.setPhoneWanted!(books.map((b) => b.id), wanted).then(
        () => {
          toast(
            isWeb
              ? wanted ? `Asked the computer for ${what}. It sends it at its next sync.` : `Stopped asking for ${what}.`
              : wanted ? `${what} will go to your phone at the next sync.` : `${what} won't be sent to your phone.`,
          );
          refresh();
        },
        (e: unknown) => toast(`Couldn't change ${what}: ${String(e)}`),
      );
    }),
    saveCopy: api.saveCopies && ((book) =>
      void api.saveCopies!([book.id]).then(
        (done) => done && toast(`Saved a copy of “${book.title}” to ${done.folder}.`),
        (e: unknown) => toast(`Couldn't save a copy of “${book.title}”: ${String(e)}`),
      )),
  };
}
