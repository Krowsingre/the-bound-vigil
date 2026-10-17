// Any book menu can open a book's details page or its editor. App and the
// details host listen; the menus only ask.

import type { BookPreview } from "../api/types";

type Ask = { kind: "edit"; books: BookPreview[] } | { kind: "fetch"; book: BookPreview };

let pageListener: ((bookId: string) => void) | null = null;
let dialogListener: ((ask: Ask) => void) | null = null;

export function showBookDetails(bookId: string) {
  pageListener?.(bookId);
}

/** Edits one book's details, or the same details on many books at once. */
export function askEditDetails(books: BookPreview[]) {
  if (books.length) dialogListener?.({ kind: "edit", books });
}

/** Looks a book up online and keeps what the person picks. */
export function askFetchDetails(book: BookPreview) {
  dialogListener?.({ kind: "fetch", book });
}

export function onShowBookDetails(listen: (bookId: string) => void) {
  pageListener = listen;
  return () => {
    if (pageListener === listen) pageListener = null;
  };
}

export function onDetailsDialog(listen: (ask: Ask) => void) {
  dialogListener = listen;
  return () => {
    if (dialogListener === listen) dialogListener = null;
  };
}

export type DetailsAsk = Ask;
