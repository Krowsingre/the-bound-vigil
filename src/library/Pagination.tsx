import { Icon } from "../components/Icon";
import { pageItems } from "./libraryView";

export function Pagination({
  page,
  pageSize,
  total,
  noun = ["book", "books"],
  onPage,
}: {
  /** What's being counted, one and many. */
  noun?: [string, string];
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="pagination">
      <p className="muted num">
        Showing {first}–{last} of {total} {total === 1 ? noun[0] : noun[1]}
      </p>
      {count > 1 && (
        <nav aria-label="Pages" className="pages">
          <button type="button" className="icon-btn" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
            <Icon name="chevronLeft" />
          </button>
          {pageItems(page, count).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="page-gap" aria-hidden>
                …
              </span>
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
      )}
    </div>
  );
}
