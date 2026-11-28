import type { ShowToast } from "../components/Toast";
import { offerFinishedDownloadRemoval } from "../library/FinishedDownloadPrompt";
import { createElement } from "react";
import type { AudioType, BookPreview } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import { holdForMenu } from "../components/ContextMenu";
import type { MenuEntry } from "../components/Menu";
import { StarRating } from "../components/StarRating";
import { askAlbum, askEditDetails, askFetchDetails, showBookDetails, showInLibrary } from "../details/openDetails";
import { askSendToEreader } from "../ereaders/SendToEreader";
import { askSendWithLocalSend, canSendWithLocalSend } from "../localsend/SendWithLocalSend";
import { askDeleteBook, askEditTags, askRemoveBook } from "../library/BookDialogs";
import { cueAudiobook, playAudiobook } from "../audio/player";
import { askPair } from "../audio/LinkEbook";
import { isAudio, kindOf } from "../lib/queryBooks";
import { UP_NEXT_FULL } from "../library/shelfLimits";
import { bookTopKey, favouritesChanged, isTopFive, setTopFive } from "../library/favourites";
import { askUpNextReplacement } from "../library/UpNextReplacement";
import { NO_FILTERS } from "../library/libraryView";
import { isWeb } from "../api";
import { bookDownload, isDownloading, tracked, wasStopped } from "../library/cloudDownloads";
import { canWatch, isWatchingAuthor, unwatch, watchAuthor } from "../library/watchList";
import { askHide } from "../library/hidden";

/** The PWA transfer controls are hidden while the PWA is disabled. */
export const phoneChoiceShown = () => false;

export interface BookActions {
  open: (book: BookPreview) => void;
  setStatus: (book: BookPreview, status: BookPreview["status"]) => void;
  setFavorite: (book: BookPreview, favorite: boolean) => void;
  /** Marks a favourite as one of the Top five, or takes it out. */
  setTopFive?: (book: BookPreview, top: boolean) => void;
  setWantToRead: (book: BookPreview, want: boolean) => void;
  setAudioType?: (book: BookPreview, kind: AudioType | null) => void;
  setRating: (book: BookPreview, rating: number | null) => void;
  /** Pins it to the top of the Archive, or unpins it. */
  setPinned?: (book: BookPreview, pinned: boolean) => void;
  /** Fetches a cloud-only book onto this device. */
  download?: (book: BookPreview) => void;
  /** Send to a TBV friend: iCloud carries the books, and the Share sheet sends the link. */
  sendToFriend?: (books: BookPreview[]) => void;
  /** Stops the book's download while it's coming down. */
  stopDownload?: (book: BookPreview) => void;
  /** Removes the copy here, keeping the one in the cloud. */
  removeDownload?: (book: BookPreview) => void;
  /** Saves a copy named "Title - Author" somewhere of your choosing. */
  saveCopy?: (book: BookPreview) => void;
  /** iPhone and iPad: the Share sheet with the books' files (AirDrop, Messages, Mail…). */
  shareFiles?: (books: BookPreview[]) => void;
  /** On a computer: chooses books for the phone. On the phone: asks the computer to send them. */
  setPhoneWanted?: (books: BookPreview[], wanted: boolean) => void;
  /** Set when the books are shown inside one of the user's collections. */
  removeFromCollection?: { name: string; remove: (book: BookPreview) => void };
  /** Archive only: turns Select on with this book already chosen. */
  select?: (book: BookPreview) => void;
  /** Archive and Resonance on a computer: Find alike, starting from this book (embre, 21 November). */
  findAlike?: (book: BookPreview) => void;
  /** Hides the book: out of every list and count, into the locked Hidden collection. */
  hide?: (book: BookPreview) => void;
  /** Set inside the Hidden collection: brings the book back. */
  unhide?: (book: BookPreview) => void;
}

/** The "…" menu for a book, and its right-click menu. */
/** The menu item that opens an item's page: a song isn't a book (embre, 20 November). */
/** Showing an audio item's series or author opens Resonance on that item's own tab. */
const audioTab = (book: BookPreview): { audioType?: AudioType } =>
  isAudio(book.format) ? { audioType: book.audioType ?? "audiobook" } : {};

export function detailsLabel(book: BookPreview): string {
  if (!isAudio(book.format) || !book.audioType || book.audioType === "audiobook") return "Book details";
  return book.audioType === "music" ? "Song details" : book.audioType === "podcast" ? "Episode details" : "Details";
}

export function bookMenu(book: BookPreview, actions: BookActions): MenuEntry[] {
  const audio = isAudio(book.format);
  const types: [AudioType, string][] = [["audiobook", "Audiobook"], ["podcast", "Podcast"], ["music", "Music"], ["other", "Other"]];
  return [
    isAudio(book.format)
      ? { label: "Listen", icon: "play" as const, onSelect: () => playAudiobook(book.id) }
      : { label: "Open", icon: "bookOpen" as const, onSelect: () => actions.open(book) },
    { label: detailsLabel(book), icon: "info", onSelect: () => showBookDetails(book.id) },
    ...(actions.select ? [{ label: "Select", icon: "check" as const, onSelect: () => actions.select?.(book) }] : []),
    { label: "Edit details…", icon: "edit", onSelect: () => askEditDetails([book]) },
    // Everything the selection's Actions menu offers is here too (embre, 20 November).
    { label: "Find details online…", icon: "search", onSelect: () => askFetchDetails(book) },
    ...(actions.findAlike ? [{ label: "Find alike…", icon: "search" as const, onSelect: () => actions.findAlike?.(book) }] : []),
    ...(book.audioType === "music" && book.series ? [{ label: "Take out of its album", icon: "close" as const, onSelect: () => askAlbum([book], true) }] : []),
    {
      heading: createElement(
        "span",
        { className: "menu-rating" },
        "Your rating",
        createElement(StarRating, { value: book.rating, size: 18, onChange: (r) => actions.setRating(book, r) }),
      ),
    },
    "divider",
    { label: "Organize", icon: "collections", submenu: [
    book.favorite
      ? { label: "Remove from favourites", icon: "heart", onSelect: () => actions.setFavorite(book, false) }
      : { label: "Add to favourites", icon: "heart", onSelect: () => actions.setFavorite(book, true) },
    ...(book.favorite && actions.setTopFive
      ? [
          isTopFive(bookTopKey(book.id))
            ? { label: "Take out of Top five", icon: "star" as const, onSelect: () => actions.setTopFive!(book, false) }
            : { label: "Add to Top five", icon: "star" as const, onSelect: () => actions.setTopFive!(book, true) },
        ]
      : []),
    book.wantToRead
      ? { label: "Remove from Up next", icon: "bookmark", onSelect: () => actions.setWantToRead(book, false) }
      : { label: "Add to Up next", icon: "bookmark", onSelect: () => actions.setWantToRead(book, true) },
    ...(actions.setPinned
      ? [
          book.pinnedAt
            ? { label: `Unpin from ${isAudio(book.format) ? "Resonance" : "the Archive"}`, icon: "pin" as const, onSelect: () => actions.setPinned?.(book, false) }
            : { label: `Pin to the top of ${isAudio(book.format) ? "Resonance" : "the Archive"}`, icon: "pin" as const, onSelect: () => actions.setPinned?.(book, true) },
        ]
      : []),
    { label: "Add to collection…", icon: "collections", onSelect: () => askAddToCollection(book) },
    { label: book.tags.length ? "Edit tags…" : "Add tags…", icon: "tag", onSelect: () => askEditTags(book) },
    ...(actions.removeFromCollection
      ? [{ label: `Remove from ${actions.removeFromCollection.name}`, onSelect: () => actions.removeFromCollection?.remove(book) }]
      : []),
      ...(audio && actions.setAudioType ? [
        "divider" as const,
        { heading: "Audio type" },
        ...types.map(([kind, label]) => ({ label, checked: (book.audioType ?? "audiobook") === kind, onSelect: () => actions.setAudioType?.(book, kind) })),
      ] : []),
    ] },
    { label: audio ? "Listening status" : "Reading status", icon: "checkCircle", submenu: [
    book.status === "read"
      ? { label: audio ? "Mark as unplayed" : "Mark as unread", onSelect: () => actions.setStatus(book, "unread") }
      : { label: audio ? "Mark as listened" : "Mark as read", onSelect: () => actions.setStatus(book, "read") },
    book.status === "dropped"
      ? { label: "Not dropped after all", hint: "Marks it unread", onSelect: () => actions.setStatus(book, "unread") }
      : { label: "Mark as dropped", hint: "Stopped, not going back", onSelect: () => actions.setStatus(book, "dropped") },
    ...(book.status === "in_progress"
      ? [{ label: "Stop reading (mark unread)", onSelect: () => actions.setStatus(book, "unread") }]
      : []),
    ] },
    { label: "Find related", icon: "search", submenu: [
    {
      label: isAudio(book.format) ? "Pair with an ebook or document…" : "Pair with an audiobook…",
      icon: "headphones",
      onSelect: () => askPair(book),
    },
    ...(book.series
      ? [
          {
            label: book.audioType === "music" ? "Show album" : "Show series",
            icon: "library" as const,
            onSelect: () => showInLibrary(kindOf(book.format), { ...NO_FILTERS, ...audioTab(book), tab: "all", series: [book.series!], sort: "series" }),
          },
        ]
      : []),
    ...(book.authors.length
      ? [
          {
            label: book.authors.length > 1 ? `Show author (${book.authors[0]})` : "Show author",
            icon: "search" as const,
            onSelect: () => showInLibrary(kindOf(book.format), { ...NO_FILTERS, ...audioTab(book), tab: "all", authors: [book.authors[0]] }),
          },
          ...(canWatch() ? [watchAuthorItem(book.authors[0])] : []),
        ]
      : []),
    ] },
    { label: "Download & send", icon: "download", submenu: [
    ...(isAudio(book.format) ? [] : [{ label: "Send to e-reader…", icon: "ereader" as const, onSelect: () => askSendToEreader([book]) }]),
    ...(canSendWithLocalSend ? [{ label: "Send with Grimoire…", icon: "upload" as const, onSelect: () => askSendWithLocalSend([book]) }] : []),
    ...(actions.sendToFriend ? [{ label: "Send to a TBV friend…", icon: "person" as const, onSelect: () => actions.sendToFriend?.([book]) }] : []),
    ...(actions.shareFiles ? [{ label: "Share the file…", icon: "share" as const, onSelect: () => actions.shareFiles?.([book]) }] : []),
    ...(actions.saveCopy ? [{ label: "Save a copy…", icon: "copy" as const, onSelect: () => actions.saveCopy?.(book) }] : []),
    ...(!isWeb && actions.setPhoneWanted && phoneChoiceShown()
      ? [book.phoneWanted
          ? { label: "Stop sending to device", icon: "cloudOff" as const, onSelect: () => actions.setPhoneWanted?.([book], false) }
          : { label: "Send to device", icon: "upload" as const, onSelect: () => actions.setPhoneWanted?.([book], true) }]
      : []),
    downloadItem(book, actions),
    ] },
    ...(actions.unhide
      ? [{ label: "Unhide", icon: "eye" as const, onSelect: () => actions.unhide?.(book) }]
      : actions.hide
        ? [{ label: "Hide", icon: "eyeOff" as const, onSelect: () => actions.hide?.(book) }]
        : []),
    "divider",
    { label: "Removal options", icon: "trash", submenu: [
    { label: "Remove from library…", icon: "close", onSelect: () => askRemoveBook(book) },
    { label: "Delete…", icon: "trash", danger: true, onSelect: () => askDeleteBook(book) },
    ] },
  ];
}

/** A book clicked a moment ago, waiting to see whether a second click opens it. */
let clicked: { id: string; timer: number } | null = null;
const DOUBLE_CLICK_MS = 260;
const touchFirst = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * Clicking a book's cover or row. With a mouse, one click shows its details
 * and a double click opens it; on a touch screen a tap shows its details,
 * which have an Open button. Audiobooks keep their own taps (see `open`).
 */
export function clickBook(book: BookPreview, actions: BookActions) {
  if (isAudio(book.format)) return actions.open(book);
  if (touchFirst()) return showBookDetails(book.id);
  if (clicked) window.clearTimeout(clicked.timer);
  if (clicked?.id === book.id) {
    clicked = null;
    return actions.open(book);
  }
  const id = book.id;
  clicked = {
    id,
    timer: window.setTimeout(() => {
      clicked = null;
      showBookDetails(id);
    }, DOUBLE_CLICK_MS),
  };
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

/** Watch an author: their new books are news in Sanctum (watchList.ts). */
function watchAuthorItem(author: string): MenuEntry {
  return isWatchingAuthor(author)
    ? { label: `Stop watching ${author}`, icon: "bell", onSelect: () => unwatch({ kind: "author", name: author, addedAt: "", known: [], primed: false }) }
    : { label: `Watch ${author}`, icon: "bell", hint: "News when a new book is announced or out", onSelect: () => watchAuthor(author) };
}

function downloadItem(book: BookPreview, actions: BookActions): MenuEntry {
  if (actions.stopDownload && isDownloading(book.id))
    return { label: "Stop download", icon: "close", hint: "Coming down now", onSelect: () => actions.stopDownload?.(book) };
  if (book.fileUnavailable) return { label: "Download", icon: "download", hint: "File not in the cloud", disabled: true };
  if (book.availability === "cloud")
    return { label: "Download", icon: "download", disabled: !actions.download, onSelect: () => actions.download?.(book) };
  // Gone from this device, but the cloud may still have it.
  if (book.availability === "missing")
    return { label: "Download again", icon: "download", hint: "File missing here", disabled: !actions.download, onSelect: () => actions.download?.(book) };
  if (!book.inCloud) return { label: "Remove download", icon: "cloudOff", hint: "Not in the cloud yet", disabled: true };
  return { label: "Remove download (keep in cloud)", icon: "cloudOff", disabled: !actions.removeDownload, onSelect: () => actions.removeDownload?.(book) };
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
    Partial<Pick<import("../api").Api, "downloadBook" | "stopDownload" | "removeDownload" | "saveCopies" | "shareBookFiles" | "sendToFriend" | "setPhoneWanted" | "setPinned" | "setAudioType">>,
  toast: ShowToast,
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
    setStatus: (book, status) => void run(book, api.setBookStatus(book.id, status).then(() => {
      if (status !== book.status && (status === "read" || status === "dropped")) {
        const undo = () => toast(status === "read" ? "Marked as Read." : "Marked as Dropped.", {
          label: "Undo",
          run: () => void run(book, api.setBookStatus(book.id, book.status)),
        });
        if (!api.removeDownload || !offerFinishedDownloadRemoval(book, status, refresh, undo)) undo();
      }
    })),
    setFavorite: (book, favorite) => void run(book, api.setFavorite(book.id, favorite).then(favouritesChanged)),
    setTopFive: (book, top) => void run(book, setTopFive(bookTopKey(book.id), book.title, top)),
    setWantToRead: (book, want) => {
      void run(book, api.setWantToRead(book.id, want).then(() => {
        if (!want && book.wantToRead) toast("Removed from Up Next.", { label: "Undo", run: () => void run(book, api.setWantToRead(book.id, true)) });
      }).catch((error: unknown) => {
        if (!want || !String(error).includes(UP_NEXT_FULL)) throw error;
        askUpNextReplacement(book);
      }));
    },
    setAudioType: api.setAudioType && ((book, kind) => void run(book, api.setAudioType!(book.id, kind))),
    setRating: (book, rating) => void run(book, api.setRating(book.id, rating)),
    hide: (book) => askHide([book], refresh),
    setPinned: api.setPinned && ((book, pinned) => void run(book, api.setPinned!(book.id, pinned).then(() => {
      if (!pinned && book.pinnedAt) toast(`Unpinned from ${isAudio(book.format) ? "Resonance" : "the Archive"}.`, { label: "Undo", run: () => void run(book, api.setPinned!(book.id, true)) });
    }))),
    download: api.downloadBook && ((book) => {
      const stop = api.stopDownload && { label: "Stop", run: () => void api.stopDownload!(bookDownload(book.id)) };
      toast(`Downloading “${book.title}”…`, stop || undefined);
      void tracked(book.id, api.downloadBook!(book.id)).then(
        () => (toast(`“${book.title}” is on this device.`), refresh()),
        (e: unknown) => toast(wasStopped(e) ? `Stopped downloading “${book.title}”. Nothing of it was kept.` : `Couldn't update “${book.title}”: ${String(e)}`),
      );
    }),
    stopDownload: api.stopDownload && ((book) => void api.stopDownload!(bookDownload(book.id))),
    removeDownload: api.removeDownload && ((book) =>
      void run(book, api.removeDownload!(book.id).then(() => toast(`Removed the copy of “${book.title}” here. It's still in the cloud.`)))),
    // Each book is fetched from the cloud first if it's only there.
    shareFiles: api.shareBookFiles ? (books) => {
      void api.shareBookFiles!(books.map((b) => b.id)).then(
        ({ skipped }) => {
          const title = (id: string) => books.find((b) => b.id === id)?.title ?? "a book";
          if (skipped.length) toast(skipped.length === 1 ? `Couldn't share “${title(skipped[0][0])}”: ${skipped[0][1]}` : `Couldn't share ${skipped.length} of the books.`);
        },
        (e: unknown) => toast(`Couldn't open the Share sheet: ${String(e)}`),
      );
    } : undefined,
    sendToFriend: api.sendToFriend ? (books) => {
      toast(books.length === 1 ? `Getting “${books[0].title}” ready to send…` : `Getting ${books.length} books ready to send…`);
      void api.sendToFriend!(books.map((b) => b.id)).then(
        ({ shared, skipped }) => {
          const title = (id: string) => books.find((b) => b.id === id)?.title ?? "a book";
          if (skipped.length) toast(skipped.length === 1 ? `Couldn't send “${title(skipped[0][0])}”: ${skipped[0][1]}` : `Couldn't send ${skipped.length} of the books.`);
          else if (shared) toast("Send the link to your friend. It works for 30 days.");
        },
        (e: unknown) => toast(`Couldn't send to a friend: ${String(e)}`),
      );
    } : undefined,
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
