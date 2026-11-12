// Any book menu can open a book's details page or its editor. App and the
// details host listen; the menus only ask.
let pageListener = null;
let libraryListener = null;
let dialogListener = null;
export function showBookDetails(bookId) {
    pageListener?.(bookId);
}
/** Opens the page for this kind of book with only these filters on (Show series, Show author). */
export function showInLibrary(kind, change) {
    libraryListener?.(kind, change);
}
/** Edits one book's details, or the same details on many books at once. */
export function askEditDetails(books) {
    if (books.length)
        dialogListener?.({ kind: "edit", books });
}
/** Looks a book up online and keeps what the person picks. */
export function askFetchDetails(book) {
    dialogListener?.({ kind: "fetch", book });
}
export function onShowBookDetails(listen) {
    pageListener = listen;
    return () => {
        if (pageListener === listen)
            pageListener = null;
    };
}
export function onShowInLibrary(listen) {
    libraryListener = listen;
    return () => {
        if (libraryListener === listen)
            libraryListener = null;
    };
}
export function onDetailsDialog(listen) {
    dialogListener = listen;
    return () => {
        if (dialogListener === listen)
            dialogListener = null;
    };
}
