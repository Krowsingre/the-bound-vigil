// Linked books in Scribe (embre, 4 November 2026): books linked as editions
// of one book show as one card, not separately. Opening it shows the
// editions in order, each a book you can still write in, and under each
// edition the drafts kept of it, which are locked copies to read.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { WritingDraft, WritingProject } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { relativeTime } from "../lib/format";
import type { EditionInfo } from "./bookEditions";
import { readExport } from "./epub";
import { isSample } from "./sampleBook";

export type Shelf = { kind: "book"; book: WritingProject } | { kind: "linked"; group: string; editions: { book: WritingProject; edition: EditionInfo }[] };

/** The books as they show in Scribe: editions of one book together, every other book on its own, in the order given. */
export function shelve(books: WritingProject[]): Shelf[] {
  const groups = new Map<string, { book: WritingProject; edition: EditionInfo }[]>();
  for (const book of books) {
    const edition = isSample(book) ? null : readExport(book.export).edition;
    if (edition) groups.set(edition.group, [...(groups.get(edition.group) ?? []), { book, edition }]);
  }
  const out: Shelf[] = [];
  const placed = new Set<string>();
  for (const book of books) {
    const group = isSample(book) ? null : readExport(book.export).edition?.group;
    const editions = group ? groups.get(group) : undefined;
    if (!group || !editions || editions.length < 2) out.push({ kind: "book", book });
    else if (!placed.has(group)) {
      placed.add(group);
      out.push({ kind: "linked", group, editions: [...editions].sort((a, b) => a.edition.number - b.edition.number) });
    }
  }
  return out;
}

/** The edition that stands for the whole book on its card: the latest. */
export const latestOf = (shelf: Extract<Shelf, { kind: "linked" }>) => shelf.editions[shelf.editions.length - 1].book;

const words = (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;
const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/** Everything kept under one linked book: its editions, and each one's drafts. */
export function LinkedBookView({
  shelf,
  cover,
  menuFor,
  onOpen,
  onOpenDraft,
  onBack,
  refresh,
}: {
  shelf: Extract<Shelf, { kind: "linked" }>;
  cover: (p: WritingProject) => string | null;
  menuFor: (p: WritingProject) => MenuEntry[];
  onOpen: (id: string) => void;
  /** Opens a locked draft to read, like a book in the Archive. */
  onOpenDraft: (bookId: string) => void;
  onBack: () => void;
  /** Changes whenever something may have added or removed drafts, so they're listed again. */
  refresh: number;
}) {
  const latest = latestOf(shelf);
  const [drafts, setDrafts] = useState<Record<string, WritingDraft[] | "error">>({});
  const ids = shelf.editions.map((e) => e.book.id).join(",");
  useEffect(() => {
    let live = true;
    for (const id of ids.split(",")) {
      api.writingDrafts(id).then(
        (list) => live && setDrafts((d) => ({ ...d, [id]: list })),
        () => live && setDrafts((d) => ({ ...d, [id]: "error" })),
      );
    }
    return () => void (live = false);
  }, [ids, refresh]);

  return (
    <section className="scribe-linked" aria-labelledby="scribe-linked-title">
      <button type="button" className="link-btn scribe-linked-back" onClick={onBack}>
        <Icon name="chevronLeft" size={15} /> All your books
      </button>
      <header className="scribe-linked-head">
        <span className="scribe-linked-cover">{cover(latest) ? <img src={cover(latest)!} alt="" /> : <span className="scribe-book-blank">{latest.title}</span>}</span>
        <div>
          <h2 id="scribe-linked-title" className="scribe-section-title">
            {latest.title}
          </h2>
          <p className="muted">{latest.author || "No author yet"}</p>
          <p className="muted scribe-linked-count">
            {shelf.editions.length} editions, each with its own drafts
          </p>
        </div>
      </header>
      <p className="muted scribe-linked-key">
        <span className="scribe-edition-badge scribe-linked-key-badge">Edition</span> a book you can still write in, with its own ISBNs.{" "}
        <span className="scribe-linked-key-draft">
          <Icon name="lock" size={13} /> Draft
        </span>{" "}
        a locked copy of that edition, kept to read, highlight and make notes in.
      </p>
      <ol className="scribe-editions">
        {[...shelf.editions].reverse().map(({ book, edition }) => {
          const kept = drafts[book.id];
          return (
            <li key={book.id} className="scribe-edition">
              <div className="scribe-edition-main">
                <span className="scribe-edition-number" aria-hidden>
                  {edition.number}
                </span>
                <button type="button" className="scribe-edition-open" onClick={() => onOpen(book.id)}>
                  <span className="scribe-edition-name">
                    <strong>{edition.name}</strong>
                    {edition.year && <span className="muted"> · {edition.year}</span>}
                    {book.id === latest.id && <span className="scribe-edition-badge">Latest</span>}
                  </span>
                  {edition.note && <span className="muted scribe-edition-note">{edition.note}</span>}
                  <span className="muted scribe-edition-meta">
                    {book.title !== latest.title ? `${book.title} · ` : ""}
                    {book.chapters} {book.chapters === 1 ? "chapter" : "chapters"} · {words(book.words)} · Edited {relativeTime(book.updatedAt)}
                  </span>
                </button>
                <button type="button" className="btn btn-quiet btn-small scribe-edition-write" onClick={() => onOpen(book.id)}>
                  <Icon name="pen" size={14} /> Write
                </button>
                <Menu label={`More for the ${edition.name.toLowerCase()}`} className="icon-btn" align="end" trigger={<Icon name="more" size={18} />} items={menuFor(book)} />
              </div>
              <div className="scribe-edition-drafts">
                {kept === undefined ? (
                  <span className="muted">Looking for drafts…</span>
                ) : kept === "error" ? (
                  <span className="muted">Its drafts couldn't be listed.</span>
                ) : kept.length === 0 ? (
                  <span className="muted">No drafts kept of this edition yet. Keep one from Drafts inside the book.</span>
                ) : (
                  <ul aria-label={`Drafts of the ${edition.name.toLowerCase()}`}>
                    {[...kept].reverse().map((d) => (
                      <li key={d.id}>
                        <button type="button" className="scribe-draft" onClick={() => onOpenDraft(d.bookId)}>
                          <Icon name="lock" size={14} />
                          <span className="scribe-draft-name">Draft {d.number}</span>
                          <span className="muted">
                            {dateOf(d.createdAt)} · {words(d.words)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
