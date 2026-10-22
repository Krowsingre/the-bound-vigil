// Opens a book of the Bible at a chapter, in whatever way that copy is
// made: its contents list, its file names, or the marks on its pages.

import type { TocItem, View } from "../vendor/foliate-js/view.js";
import { bookFiles, booksInContents, chapterEntry, chapterFile, chapterMark, type BibleBook } from "./bible";

const rangeOf = (el: Element) => (doc: Document) => {
  const range = doc.createRange();
  range.selectNode(el.ownerDocument === doc ? el : (doc.getElementById(el.id) ?? doc.body));
  return range;
};

/** True once the reader is at the chapter (or the book, when that's the nearest it could find). */
export async function openChapter(view: View, toc: TocItem[], book: BibleBook, chapter: number): Promise<boolean> {
  const entries = booksInContents(toc);
  const bookEntry = entries.get(book.code);
  const listed = bookEntry && chapterEntry(bookEntry, chapter);
  if (listed) {
    await view.goTo(listed.href);
    return true;
  }
  const ids = view.book.sections.map((s) => s.id ?? "");
  const file = chapterFile(ids, book.code, chapter);
  if (file) {
    await view.goTo(ids.indexOf(file));
    return true;
  }
  // The chapter's mark, in the book's own part or the parts after it.
  const start = bookEntry ? (view.book.resolveHref(bookEntry.href)?.index ?? null) : null;
  const candidates = start != null ? [start, start + 1, start + 2] : bookFiles(ids, book.code);
  for (const index of candidates) {
    const doc = await view.book.sections[index]?.createDocument?.().catch(() => null);
    const mark = doc && chapterMark(doc, book.code, chapter);
    if (mark) {
      await view.renderer.goTo({ index, anchor: rangeOf(mark) });
      return true;
    }
  }
  if (bookEntry) {
    await view.goTo(bookEntry.href);
    return chapter === 1;
  }
  return false;
}
