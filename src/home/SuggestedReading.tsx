// Sanctum's Suggested reading. It fills from three places, in this order,
// leaving out books already in the library and any marked Not interested:
// 1. Krowsingre Publishing's own list, read from krowsingre.github.io, so a
//    new book shows without an update;
// 2. other books by the authors you read most, found on Open Library (only
//    author names are sent; off in Preferences › Appearance › Sanctum);
// 3. books you own and haven't started, Up next first.
// The online ones are looked up once a day and kept here till the next.

import { useEffect, useMemo, useState } from "react";
import { api, isApp, openExternal } from "../api";
import type { BookPreview } from "../api/types";
import { askBrowser } from "../browse/browserAsk";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { authorLine } from "../lib/format";
import { useAppSettings } from "../settings/appSettings";
import type { Route } from "../shell/routes";
import { clickBook, type BookActions } from "./bookActions";
import { EmptyNote, Section } from "./Section";

/** The publisher's list. Each entry: title, authors, cover (an address, or a
 * path beside the list), about, and a free `download` or a `buy` link;
 * `pinned` ones come first. */
export const PUBLISHER_LIST = "https://krowsingre.github.io/the-bound-vigil/suggested.json";

const CACHE_KEY = "tbv.sanctum.suggestions";
const HIDDEN_KEY = "sanctum.notInterested";
const SHOWN = 4;

type Source = "publisher" | "authors" | "shelves";

const SOURCE_TITLE: Record<Source, string> = {
  publisher: "From Krowsingre Publishing",
  authors: "More from authors you read",
  shelves: "From your shelves",
};

export interface Suggestion {
  /** The title and first author, folded, so the same book is the same everywhere. */
  key: string;
  source: Source;
  title: string;
  authors: string[];
  coverUrl: string | null;
  about?: string | null;
  download?: string | null;
  buy?: string | null;
  /** Its page on Open Library. */
  page?: string | null;
  /** A book you own. */
  book?: BookPreview;
}

const keyOf = (title: string, authors: string[]) => `${title.trim().toLowerCase()}|${(authors[0] ?? "").trim().toLowerCase()}`;
/** "Dune: Deluxe Edition" is Dune, for finding it in the library. */
const mainTitle = (title: string) => title.split(/\s*[:(]/)[0].trim() || title;

interface PublisherEntry {
  title?: string;
  authors?: string[] | string;
  cover?: string;
  about?: string;
  download?: string;
  buy?: string;
  pinned?: boolean;
}

async function fromPublisher(signal: AbortSignal): Promise<Suggestion[]> {
  const res = await fetch(PUBLISHER_LIST, { signal, cache: "no-cache" });
  if (!res.ok) return [];
  const data = (await res.json()) as { books?: PublisherEntry[] };
  const books = (data.books ?? []).filter((b) => typeof b.title === "string" && b.title.trim());
  books.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  return books.map((b) => {
    const authors = Array.isArray(b.authors) ? b.authors : b.authors ? [b.authors] : [];
    return {
      key: keyOf(b.title!, authors),
      source: "publisher" as const,
      title: b.title!.trim(),
      authors,
      coverUrl: b.cover ? new URL(b.cover, PUBLISHER_LIST).href : null,
      about: b.about ?? null,
      download: b.download ?? null,
      buy: b.buy ?? null,
    };
  });
}

async function fromAuthors(authors: string[], signal: AbortSignal): Promise<Suggestion[]> {
  const found = await Promise.all(
    authors.slice(0, 3).map(async (author) => {
      const params = new URLSearchParams({ author, sort: "rating", limit: "8", fields: "key,title,author_name,cover_i" });
      const res = await fetch(`https://openlibrary.org/search.json?${params}`, { signal });
      if (!res.ok) return [];
      const data = (await res.json()) as { docs?: { key?: string; title?: string; author_name?: string[]; cover_i?: number }[] };
      return (data.docs ?? [])
        .filter((d) => d.title && d.cover_i)
        .map(
          (d): Suggestion => ({
            key: keyOf(d.title!, d.author_name ?? [author]),
            source: "authors",
            title: d.title!,
            authors: d.author_name?.slice(0, 2) ?? [author],
            coverUrl: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`,
            page: d.key ? `https://openlibrary.org${d.key}` : null,
          }),
        );
    }),
  );
  // A few from each author in turn, so one prolific author doesn't fill the row.
  const mixed: Suggestion[] = [];
  for (let i = 0; i < 8; i++) for (const list of found) if (list[i]) mixed.push(list[i]);
  return mixed;
}

interface Cached {
  day: string;
  authors: string;
  items: Suggestion[];
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

/** The online suggestions, looked up once a day (and again when your authors change). */
function useOnline(on: boolean, authors: string[]): Suggestion[] {
  const authorsKey = authors.join("|");
  const today = new Date().toISOString().slice(0, 10);
  const [items, setItems] = useState<Suggestion[]>(() => {
    const cached = readCache();
    return on && cached ? cached.items : [];
  });
  useEffect(() => {
    if (!on || !isApp) return setItems([]);
    const cached = readCache();
    if (cached && cached.day === today && cached.authors === authorsKey) return setItems(cached.items);
    const stop = new AbortController();
    const names = authorsKey ? authorsKey.split("|") : [];
    void Promise.all([fromPublisher(stop.signal).catch(() => []), fromAuthors(names, stop.signal).catch(() => [])]).then(async ([publisher, byAuthors]) => {
      const all = [...publisher, ...byAuthors];
      const owned = await api.ownedTitles(all.map((s) => mainTitle(s.title))).catch(() => all.map(() => false));
      // Your own picks stay even when owned; the rest only when new to you.
      const fresh = all.filter((s, i) => s.source === "publisher" || !owned[i]);
      if (stop.signal.aborted) return;
      setItems(fresh);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ day: today, authors: authorsKey, items: fresh } satisfies Cached));
      } catch {
        // Looked up again next time.
      }
    });
    return () => stop.abort();
  }, [on, authorsKey, today]);
  return items;
}

export function SuggestedReading({
  shelves,
  readAuthors,
  actions,
  onNavigate,
}: {
  shelves: BookPreview[];
  readAuthors: string[];
  actions: BookActions;
  onNavigate: (route: Route) => void;
}) {
  const { settings } = useAppSettings();
  const online = useOnline(settings.suggestOnline, readAuthors);
  const [hidden, setHidden] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Suggestion | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    api.getSetting(HIDDEN_KEY).then(
      (raw) => setHidden(raw ? (JSON.parse(raw) as string[]) : []),
      () => undefined,
    );
  }, []);
  const hide = (s: Suggestion) => {
    const next = [...new Set([...hidden, s.key])];
    setHidden(next);
    void api.setSetting(HIDDEN_KEY, JSON.stringify(next)).catch(() => undefined);
  };

  const list = useMemo(() => {
    const own = shelves.map((book): Suggestion => ({ key: keyOf(book.title, book.authors), source: "shelves", title: book.title, authors: book.authors, coverUrl: null, book }));
    const seen = new Set<string>();
    return [...online, ...own].filter((s) => !hidden.includes(s.key) && !seen.has(s.key) && (seen.add(s.key), true));
  }, [online, shelves, hidden]);

  const open = (s: Suggestion) => (s.book ? clickBook(s.book, actions) : setChosen(s));
  const menu = (s: Suggestion) => [
    s.book ? { label: "Open", icon: "bookOpen" as const, onSelect: () => actions.open(s.book!) } : { label: "More about it", icon: "info" as const, onSelect: () => setChosen(s) },
    { label: "Not interested", icon: "eyeOff" as const, onSelect: () => hide(s) },
  ];

  return (
    <Section title="Suggested reading" className="suggested" onViewAll={list.length > SHOWN ? () => setAll(true) : undefined}>
      {list.length === 0 ? (
        <EmptyNote>Books you might like to read next will appear here.</EmptyNote>
      ) : (
        <ul className="shelf">
          {list.slice(0, SHOWN).map((s) => (
            <SuggestionCard key={s.key} s={s} onOpen={() => open(s)} menu={menu(s)} />
          ))}
        </ul>
      )}
      {chosen && <SuggestionDialog s={chosen} onClose={() => setChosen(null)} onHide={() => (hide(chosen), setChosen(null))} onNavigate={onNavigate} />}
      {all && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setAll(false)}>
          <div className="dialog suggested-all" role="dialog" aria-label="Suggested reading" onKeyDown={(e) => e.key === "Escape" && setAll(false)}>
            <header className="catalogues-head">
              <h2>Suggested reading</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setAll(false)}>
                <Icon name="close" size={18} />
              </button>
            </header>
            {(Object.keys(SOURCE_TITLE) as Source[]).map((source) => {
              const some = list.filter((s) => s.source === source);
              if (!some.length) return null;
              return (
                <section key={source} className="suggested-group">
                  <h3 className="section-title">{SOURCE_TITLE[source]}</h3>
                  <ul className="shelf">
                    {some.map((s) => (
                      <SuggestionCard key={s.key} s={s} onOpen={() => (setAll(false), open(s))} menu={menu(s)} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

function SuggestionCard({ s, onOpen, menu }: { s: Suggestion; onOpen: () => void; menu: MenuEntry[] }) {
  return (
    <li className="has-menu">
      <button type="button" className="shelf-book" onClick={onOpen} title={`${s.title}, ${authorLine(s.authors)}`}>
        <OnlineCover s={s} />
        <span className="book-title">{s.title}</span>
        <span className="book-author">{authorLine(s.authors)}</span>
      </button>
      <Menu label={`More for ${s.title}`} className="icon-btn book-more" trigger={<Icon name="more" size={14} />} items={menu} />
    </li>
  );
}


function OnlineCover({ s }: { s: Suggestion }) {
  const [failed, setFailed] = useState(false);
  if (s.book || !s.coverUrl || failed) return <BookCover book={s.book ?? { id: `sha256:${s.key}` as const, title: s.title, authors: s.authors, coverPath: null }} />;
  return (
    <div className="cover cover-m">
      <div className="cover-private" aria-hidden>
        <span className="cover-title">{s.title}</span>
        <span className="cover-author">{authorLine(s.authors)}</span>
      </div>
      <img src={s.coverUrl} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
    </div>
  );
}

/** A book from online: what it is, and one way to get it. */
function SuggestionDialog({ s, onClose, onHide, onNavigate }: { s: Suggestion; onClose: () => void; onHide: () => void; onNavigate: (route: Route) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api.downloadWebBook(s.download!, s.title);
      toast(`${s.title} is coming into your library.`);
      onClose();
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };
  const inDiscover = (url: string) => {
    askBrowser({ url });
    onClose();
    onNavigate("catalogs");
  };
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog suggestion-dialog" role="dialog" aria-label={s.title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <OnlineCover s={s} />
        <div className="suggestion-body">
          <p className="eyebrow">{SOURCE_TITLE[s.source]}</p>
          <h2>{s.title}</h2>
          <p className="muted">{authorLine(s.authors)}</p>
          {s.about && <p className="suggestion-about">{s.about}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={onHide}>
              Not interested
            </button>
            {s.download ? (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void add()}>
                <Icon name="download" size={15} /> Add to library
              </button>
            ) : s.buy ? (
              <button type="button" className="btn btn-primary" onClick={() => void openExternal(s.buy!)}>
                Buy <Icon name="external" size={14} />
              </button>
            ) : s.page ? (
              <button type="button" className="btn btn-primary" onClick={() => inDiscover(s.page!)}>
                <Icon name="compass" size={15} /> Find it in Discover
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
