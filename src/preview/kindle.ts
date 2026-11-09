// The Kindle import in the design preview: a short made-up purchase list,
// matched against the preview's books the way the real one is.

import type { BookPreview, KindleMatch, KindlePurchase, KindleReview } from "../api/types";

type Purchase = KindlePurchase & { borrowed: boolean; bookId: string | null; state: "auto" | "probable" | "confirmed" | "rejected" | null };

const SAMPLE: [string, string, string, boolean][] = [
  ["Middlemarch (Penguin Classics)", "George Eliot", "2026-10-17", true],
  ["Dracula", "Bram Stoker", "2026-10-02", true],
  ["Emma", "Jane Austen", "2026-09-21", false],
  ["The Moonstone: A Romance", "Wilkie Collins", "2026-08-30", false],
  ["Weight of the Heart (Bruna Husky Book 2)", "Rosa Montero", "2026-10-17", false],
  ["Tears in Rain (Bruna Husky Book 1)", "Rosa Montero", "2026-10-17", true],
  ["Warlock: Book One", "Mark Tufo", "2026-07-11", false],
  ["The Name of the Wind (The Kingkiller Chronicle Book 1)", "Patrick Rothfuss", "2026-06-02", true],
  ["Piranesi", "Susanna Clarke", "2026-05-19", true],
  ["Station Eleven: A novel", "Emily St. John Mandel", "2026-04-08", false],
  ["Dune (Dune Chronicles Book 1)", "Frank Herbert", "2025-12-24", false],
  ["Space Colony One Books 1 - 3 (SPACE COLONY ONE SERIES)", "Kathryn Weston", "2025-11-30", false],
];

const key = (t: string) => t.split(" (")[0].split(":")[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const surname = (a: string) => a.trim().split(/\s+/).pop()?.toLowerCase() ?? "";

export function previewKindle(library: () => BookPreview[], tag: (ids: string[]) => void, markRead: (id: string) => void) {
  let purchases: Purchase[] = [];
  let markReadChoice = true;
  const bookOf = (p: Purchase) => library().find((b) => b.id === p.bookId);
  const complete = (p: Purchase) => p.bookIds?.length ? p.bookIds.every((id) => library().some((b) => b.id === id)) : !!bookOf(p);
  const missing = () => purchases.filter((p) => !p.borrowed && !((p.state === "auto" || p.state === "confirmed") && complete(p)));
  const asMatch = (p: Purchase): KindleMatch => {
    const b = bookOf(p)!;
    return { asin: p.asin, title: p.title, author: p.author, coverUrl: p.coverUrl, read: p.read, borrowed: p.borrowed, bookId: b.id, bookTitle: b.title, bookAuthors: b.authors };
  };
  const review = (): KindleReview => {
    const matched = purchases.filter((p) => p.state === "auto" && bookOf(p)).map(asMatch);
    const probable = purchases.filter((p) => p.state === "probable" && bookOf(p)).map(asMatch);
    return {
      matched,
      probable,
      missing: missing().filter((p) => !p.removed).length - probable.length,
      readToMark: [...matched, ...probable].filter((m) => m.read && library().find((b) => b.id === m.bookId)?.status === "unread").length,
      markRead: markReadChoice,
    };
  };
  const match = () => {
    for (const p of purchases) {
      if (p.state) continue;
      const found = library().find((b) => key(b.title) === key(p.title) && b.authors.some((a) => surname(a) === surname(p.author)));
      if (!found) continue;
      p.bookId = found.id;
      p.state = p.title.includes(":") ? "probable" : "auto";
    }
  };
  return {
    importKindle: async () => {
      const fresh = purchases.length === 0;
      if (fresh) {
        purchases = SAMPLE.map(([title, author, day, read], i) => {
          const asin = `B0PREVIEW${i}`;
          return {
            asin,
            title,
            author,
            acquiredAt: `${day}T12:00:00.000Z`,
            read,
            link: `https://www.amazon.com/dp/${asin}`,
            coverUrl: "",
            removed: false,
            borrowed: i === SAMPLE.length - 1,
            bookId: null,
            state: null,
          };
        });
      }
      match();
      return { total: 3873, newPurchases: fresh ? 3873 : 0, borrowed: 8, review: review() };
    },
    kindleReview: async () => review(),
    applyKindle: async (confirmed: string[], markReadNow: boolean) => {
      markReadChoice = markReadNow;
      const yes: Purchase[] = [];
      for (const p of purchases) {
        if (p.state === "auto" || (p.state === "probable" && confirmed.includes(p.asin))) {
          p.state = "confirmed";
          yes.push(p);
        } else if (p.state === "probable") p.state = "rejected";
      }
      const ids = [...new Set(yes.filter((p) => !p.borrowed && p.bookId).map((p) => p.bookId!))];
      const untagged = ids.filter((id) => !library().find((b) => b.id === id)?.tags.includes("Kindle")).length;
      tag(ids);
      let marked = 0;
      if (markReadNow)
        for (const p of yes)
          if (p.read && bookOf(p)?.status === "unread") {
            markRead(p.bookId!);
            marked++;
          }
      return { tagged: untagged, markedRead: marked, missing: missing().filter((p) => !p.removed).length };
    },
    kindleSummary: async () => ({
      total: purchases.length,
      inLibrary: purchases.filter((p) => p.state === "confirmed" && complete(p)).length,
      missing: missing().filter((p) => !p.removed).length,
      removed: missing().filter((p) => p.removed).length,
      waiting: purchases.filter((p) => p.state === "auto" || p.state === "probable").length,
      lastAdded: purchases.length ? new Date().toISOString() : null,
      covers: missing()
        .filter((p) => !p.removed)
        .sort((a, b) => (b.acquiredAt ?? "").localeCompare(a.acquiredAt ?? ""))
        .slice(0, 3)
        .map((p) => ({ title: p.title, coverUrl: p.coverUrl || null })),
    }),
    kindleMissing: async (removed: boolean) =>
      missing()
        .filter((p) => p.removed === removed)
        .sort((a, b) => (b.acquiredAt ?? "").localeCompare(a.acquiredAt ?? ""))
        .map(({ asin, title, author, acquiredAt, read, link, coverUrl, removed, bookIds }) => ({ asin, title, author, acquiredAt, read, link, coverUrl, removed, bookIds })),
    matchKindleManually: async (asin: string, bookIds: string[], mark: boolean) => {
      const purchase = purchases.find((p) => p.asin === asin);
      if (!purchase || !bookIds.length || bookIds.some((id) => !library().some((b) => b.id === id))) throw new Error("Choose Archive books for this purchase.");
      const ids = [...new Set(bookIds)];
      const tagged = ids.filter((id) => !library().find((b) => b.id === id)?.tags.includes("Kindle")).length;
      const read = mark && purchase.read ? ids.filter((id) => library().find((b) => b.id === id)?.status === "unread") : [];
      Object.assign(purchase, { bookId: ids[0], bookIds: ids, state: "confirmed", removed: false });
      tag(ids);
      read.forEach(markRead);
      return { tagged, markedRead: read.length, missing: missing().filter((p) => !p.removed).length };
    },
    setKindleRemoved: async (asins: string[], removed: boolean) => {
      for (const p of purchases) if (asins.includes(p.asin)) p.removed = removed;
    },
  };
}
