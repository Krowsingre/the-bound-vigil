import type { ReactNode } from "react";

export function Section({
  title,
  onViewAll,
  className = "",
  children,
}: {
  title: string;
  onViewAll?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const id = `section-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className={`section ${className}`} aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id} className="section-title">
          {title}
        </h2>
        {onViewAll && (
          <button type="button" className="view-all" onClick={onViewAll}>
            View all <span aria-hidden>→</span>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>;
}
