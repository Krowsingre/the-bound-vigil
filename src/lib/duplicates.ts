// Books that look like the same book, as the core finds them (manage.rs),
// for the browser preview and the web version.

import type { BookPreview } from "../api/types";
import { isAudio } from "./queryBooks";

/** A title as it compares: lowercase words, without a leading article or a subtitle. */
export function titleKey(title: string): string {
  const main = title.split(/[:([]/)[0];
  const words = main
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const skip = words.length > 1 && ["the", "a", "an"].includes(words[0]) ? 1 : 0;
  return words.slice(skip).join(" ");
}

/** The first author's surname: "Stoker, Bram" and "Bram Stoker" alike. */
export function authorKey(authors: string[]): string {
  const first = authors[0] ?? "";
  const surname = first.includes(",") ? first.split(",")[0] : (first.trim().split(/\s+/).pop() ?? "");
  return surname.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

export function duplicateGroups<B extends BookPreview>(books: B[]): { key: string; reason: string; books: B[] }[] {
  const byTitle = new Map<string, B[]>();
  for (const b of [...books].sort((x, y) => x.addedAt.localeCompare(y.addedAt))) {
    const title = titleKey(b.title);
    if (!title) continue;
    // An audiobook and the ebook of the same title are a pair, not two copies.
    const k = `${isAudio(b.format) ? "audio" : "text"}|${title}|${authorKey(b.authors)}`;
    byTitle.set(k, [...(byTitle.get(k) ?? []), b]);
  }
  return [...byTitle.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      key: g
        .map((b) => b.id as string)
        .sort()
        .join("+"),
      reason: "The same title and author",
      books: g,
    }));
}
