// What the reader hands the page engine for each kind of book. foliate-js
// reads EPUB, Kindle, FB2, comic and PDF files itself; plain text and Word
// documents are first laid out as chapters here.

import { api } from "../../api";
import { makeHtmlBook, type BookInfo, type HtmlBook } from "./htmlBook";
import { decodeText, textToChapters } from "./plainText";
import { wordDocumentChapters } from "./wordDocument";

export type ReaderSource = File | HtmlBook;

export async function readerSource(file: File, format: string, bookId: string, info: BookInfo): Promise<ReaderSource> {
  switch (format) {
    case "txt":
      return makeHtmlBook(info, textToChapters(decodeText(await file.arrayBuffer())));
    case "docx":
      return makeHtmlBook(info, await wordDocumentChapters(await file.arrayBuffer()));
    case "doc":
      // Old Word files are read by TBV's core, as text only.
      return makeHtmlBook(info, textToChapters(await api.bookText(bookId), true));
    default:
      return file;
  }
}

/** A picture of a PDF's first page, to use as its cover. */
export async function drawPdfCover(file: Blob): Promise<Blob | null> {
  const { makePDF } = await import("../../vendor/foliate-js/pdf.js");
  const book = await makePDF(file);
  try {
    return await book.getCover();
  } finally {
    book.destroy();
  }
}

/**
 * Gives newly imported PDFs a cover, one at a time with a pause between, so
 * a big import of PDFs never keeps the window busy. Returns whether any was added.
 */
export async function drawImportedCovers(bookIds: string[]): Promise<boolean> {
  let added = false;
  for (const bookId of bookIds) {
    try {
      const cover = await drawPdfCover(await api.readBookFile(bookId));
      if (cover && (await api.fillCover(bookId, new Uint8Array(await cover.arrayBuffer())))) added = true;
    } catch {
      // A PDF the engine can't draw keeps TBV's plain cover.
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  return added;
}
