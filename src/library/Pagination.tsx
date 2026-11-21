import { useState } from "react";
import { Icon } from "../components/Icon";
import { pageItems } from "./libraryView";

/** How many pages the books take, with the first page's uncounted cards. */
export function pageCount(total: number, pageSize: number, lead = 0): number {
  return Math.max(1, Math.ceil((total + lead) / pageSize));
}

export function Pagination({
  page,
  pageSize,
  total,
  noun = ["book", "books"],
  lead = 0,
  onPage,
}: {
  /** Places on the first page taken by cards that aren't counted (Pinned, Last read). */
  lead?: number;
  /** What's being counted, one and many. */
  noun?: [string, string];
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const count = pageCount(total, pageSize, lead);
  const first = total === 0 ? 0 : page === 0 ? 1 : page * pageSize - lead + 1;
  const last = Math.min(total, (page + 1) * pageSize - lead);
  return (
    <div className="pagination">
      <p className="muted num">
        Showing {first}–{last} of {total} {total === 1 ? noun[0] : noun[1]}
      </p>
      {count > 1 && <PageNumbers page={page} count={count} onPage={onPage} />}
    </div>
  );
}

/** Previous, the page numbers and Next. The … between numbers takes a typed page to jump to. */
export function PageNumbers({
  page,
  count,
  label = "Pages",
  onPage,
}: {
  page: number;
  count: number;
  label?: string;
  onPage: (page: number) => void;
}) {
  return (
    <nav aria-label={label} className="pages">
      <button type="button" className="icon-btn" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <Icon name="chevronLeft" />
      </button>
      {pageItems(page, count).map((p, i) =>
        p === null ? (
          <PageJump key={`gap-${i}`} count={count} onPage={onPage} />
        ) : (
          <button
            key={p}
            type="button"
            className={`page${p === page ? " is-active" : ""}`}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p + 1}`}
            onClick={() => onPage(p)}
          >
            {p + 1}
          </button>
        ),
      )}
      <button type="button" className="icon-btn" aria-label="Next page" disabled={page >= count - 1} onClick={() => onPage(page + 1)}>
        <Icon name="chevronRight" />
      </button>
    </nav>
  );
}

/** The … in the page numbers: pressed, it turns into a box for a page number. Enter goes there. */
export function PageJump({ count, onPage }: { count: number; onPage: (page: number) => void }) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  if (!typing) {
    return (
      <button
        type="button"
        className="page page-gap"
        aria-label="Go to a page"
        title="Go to a page"
        onClick={() => {
          setText("");
          setTyping(true);
        }}
      >
        …
      </button>
    );
  }
  const go = () => {
    const n = Number.parseInt(text, 10);
    setTyping(false);
    if (Number.isFinite(n)) onPage(Math.min(count, Math.max(1, n)) - 1);
  };
  return (
    <input
      className="page-jump num"
      type="text"
      inputMode="numeric"
      aria-label={`Page number, 1 to ${count}`}
      placeholder="#"
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 6))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          go();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setTyping(false);
        }
      }}
      onBlur={() => setTyping(false)}
    />
  );
}
