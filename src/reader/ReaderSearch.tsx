import { forwardRef, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import type { SearchExcerpt, SearchResult } from "../vendor/foliate-js/view.js";

interface Group {
  label: string;
  hits: { cfi: string; excerpt: SearchExcerpt }[];
}

/** Search inside the book (Ctrl+K). Results list by chapter; picking one goes there. */
export const ReaderSearch = forwardRef<
  HTMLInputElement,
  {
    run: (query: string) => AsyncGenerator<SearchResult> | null;
    clear: () => void;
    onGo: (cfi: string) => void;
    autoFocus?: boolean;
  }
>(function ReaderSearch({ run, clear, onGo, autoFocus }, inputRef) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  const reset = () => {
    runId.current++;
    setGroups([]);
    setProgress(null);
    clear();
  };

  const start = async () => {
    const q = query.trim();
    reset();
    if (!q) return;
    const id = runId.current;
    const results = run(q);
    if (!results) return;
    setOpen(true);
    setProgress(0);
    for await (const r of results) {
      if (id !== runId.current) return;
      if (r === "done") break;
      if ("progress" in r) setProgress(r.progress);
      else if (r.subitems.length) setGroups((g) => [...g, { label: r.label, hits: r.subitems }]);
    }
    if (id === runId.current) setProgress(null);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const count = groups.reduce((n, g) => n + g.hits.length, 0);
  return (
    <div className="reader-search" ref={root}>
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search in this book"
          placeholder="Search in this book…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) {
              reset();
              setOpen(false);
            }
          }}
          onFocus={() => groups.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              reset();
              setOpen(false);
              e.currentTarget.blur();
            }
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>Ctrl K</kbd>
      </form>
      {open && (query.trim() || progress !== null) && (
        <div className="reader-search-results" role="listbox" aria-label="Search results">
          <p className="reader-search-status">
            {progress !== null
              ? `Searching… ${Math.round(progress * 100)}%`
              : count
                ? `${count} ${count === 1 ? "match" : "matches"}`
                : "No matches in this book."}
          </p>
          {groups.map((g, gi) => (
            <div key={gi} className="reader-search-group">
              {g.label && <p className="reader-search-chapter">{g.label}</p>}
              {g.hits.map((h) => (
                <button
                  key={h.cfi}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="reader-search-hit"
                  onClick={() => {
                    setOpen(false);
                    onGo(h.cfi);
                  }}
                >
                  {h.excerpt.pre}
                  <mark>{h.excerpt.match}</mark>
                  {h.excerpt.post}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
