// Browse › Bible: the King James, World English and American Standard
// versions, brought in as normal books (they sync, take highlights and open
// in the reader), and a picker that opens one at a chapter.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { bibleTarget, NEW_TESTAMENT, OLD_TESTAMENT, TRANSLATIONS, type BibleBook, type Translation } from "./bibleBooks";

const CHOSEN_KEY = "tbv.bible.translation";

function readChosen(): Translation["id"] | null {
  try {
    const id = localStorage.getItem(CHOSEN_KEY);
    return TRANSLATIONS.some((t) => t.id === id) ? (id as Translation["id"]) : null;
  } catch {
    return null;
  }
}

/** The library's copy of a translation, found by its title. */
async function findInLibrary(t: Translation): Promise<string | null> {
  for (const words of t.titled) {
    const page = await api.getLibrary({ shelf: "all", sort: "title", search: words, formats: [], location: null, page: 0, pageSize: 20 });
    const found = page.books.find((b) => b.title.toLowerCase().includes(words));
    if (found) return found.id;
  }
  return null;
}

export function Bible({ refreshKey, onOpenBook }: { refreshKey: number; onOpenBook: (bookId: string, at?: string) => void }) {
  const [owned, setOwned] = useState<Partial<Record<Translation["id"], string>>>({});
  const [adding, setAdding] = useState<Partial<Record<Translation["id"], boolean>>>({});
  const [chosen, setChosen] = useState<Translation["id"] | null>(readChosen);
  const [book, setBook] = useState<BibleBook | null>(null);
  const toast = useToast();

  const look = useCallback(async () => {
    const found = await Promise.all(TRANSLATIONS.map(async (t) => [t.id, await findInLibrary(t).catch(() => null)] as const));
    setOwned(Object.fromEntries(found.filter(([, id]) => id)));
  }, []);
  useEffect(() => {
    void look();
  }, [look, refreshKey]);
  // A translation being added shows up once the import queue has it in.
  useEffect(() => api.onImports((view) => view.done === view.total && void look()), [look]);

  const inLibrary = TRANSLATIONS.filter((t) => owned[t.id]);
  const reading = inLibrary.find((t) => t.id === chosen) ?? inLibrary[0] ?? null;
  const choose = (id: Translation["id"]) => {
    setChosen(id);
    try {
      localStorage.setItem(CHOSEN_KEY, id);
    } catch {
      // Remembered for this visit only.
    }
  };

  const add = async (t: Translation) => {
    setAdding((a) => ({ ...a, [t.id]: true }));
    try {
      await api.downloadWebBook(t.url, t.name);
      toast(`The ${t.name} is being added to your library.`);
    } catch (e) {
      toast(`The ${t.name} couldn't be brought in: ${String(e)}`);
    } finally {
      setAdding((a) => ({ ...a, [t.id]: false }));
    }
  };

  const open = (chapter: number) => {
    const id = reading && owned[reading.id];
    if (id && book) onOpenBook(id, bibleTarget(book.code, chapter));
  };

  const testament = (title: string, books: BibleBook[]) => (
    <section className="bible-testament" aria-label={title}>
      <h3>{title}</h3>
      <ul className="bible-books">
        {books.map((b) => (
          <li key={b.code}>
            <button type="button" className={b === book ? "is-current" : undefined} aria-pressed={b === book} onClick={() => setBook(b === book ? null : b)}>
              {b.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="bible">
      <ul className="bible-translations">
        {TRANSLATIONS.map((t) => (
          <li key={t.id} className="bible-translation">
            <div>
              <strong>
                {t.name} <span className="muted">({t.short})</span>
              </strong>
              <span className="muted">{t.year}</span>
              <p className="muted">{t.about}</p>
            </div>
            {owned[t.id] ? (
              <button type="button" className="btn btn-quiet btn-small" onClick={() => onOpenBook(owned[t.id]!)}>
                <Icon name="library" size={14} /> Open
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-small" disabled={adding[t.id]} onClick={() => void add(t)}>
                {adding[t.id] ? (
                  "Bringing it in…"
                ) : (
                  <>
                    <Icon name="download" size={14} /> Add to library
                  </>
                )}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted bible-note">All three are public domain, from eBible.org. Each one is a normal book in your library, so it syncs and keeps your highlights and notes.</p>

      {reading ? (
        <div className="bible-picker">
          <div className="bible-picker-head">
            <h2>Go to a chapter</h2>
            {inLibrary.length > 1 && (
              <div className="tabs" role="tablist" aria-label="Translation">
                {inLibrary.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={t === reading} className={`tab${t === reading ? " is-active" : ""}`} onClick={() => choose(t.id)}>
                    {t.short}
                  </button>
                ))}
              </div>
            )}
          </div>
          {book && (
            <section className="bible-chapters" aria-label={`Chapters of ${book.name}`}>
              <h3>
                {book.name} <span className="muted">in the {reading.short}</span>
              </h3>
              <ul>
                {Array.from({ length: book.chapters }, (_, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => open(i + 1)} aria-label={`${book.name} ${i + 1}`}>
                      {i + 1}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {testament("Old Testament", OLD_TESTAMENT)}
          {testament("New Testament", NEW_TESTAMENT)}
        </div>
      ) : (
        <p className="muted bible-empty">Add a translation above, and you can open it here at any book and chapter.</p>
      )}
    </div>
  );
}
