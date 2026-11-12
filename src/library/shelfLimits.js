export const PIN_LIMIT = 10;
export const UP_NEXT_LIMIT = 15;
export const UP_NEXT_FULL = "Up Next is full.";
export const PIN_LIMIT_MESSAGE = "The Archive holds ten pins. Unpin a book or series first.";
export function upNextChanges(books, bookId, want, replace) {
    const current = books.find((book) => book.id === bookId);
    if (!current || current.wantToRead === want)
        return [];
    if (!want)
        return [bookId];
    const members = books.filter((book) => book.wantToRead);
    if (members.length > UP_NEXT_LIMIT)
        throw new Error("Up Next already exceeds 15 books. Remove books before adding another.");
    if (replace && !members.some((book) => book.id === replace)) {
        throw new Error("That book is no longer in Up Next. Choose another book.");
    }
    if (!replace && members.length === UP_NEXT_LIMIT)
        throw new Error(UP_NEXT_FULL);
    return replace ? [replace, bookId] : [bookId];
}
