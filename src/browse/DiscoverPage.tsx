// The pieces Discover's own pages (Geas and Libram) are built from, after
// embre's pictures of 13 November: a heading with the page's mark, and cards
// that each start with an icon and a title.
import type { ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";

/** The page's mark, name and caption. "row" puts the line about the page beside
 * them after a short upright rule (Geas); "stacked" puts it underneath (Libram). */
export function DiscoverHeader({ icon, title, caption, about, layout = "row" }: {
  icon: IconName;
  title: string;
  caption: string;
  about: string;
  layout?: "row" | "stacked";
}) {
  return (
    <header className={`discover-head is-${layout}`}>
      <div className="discover-head-name">
        <Icon name={icon} size={layout === "stacked" ? 64 : 52} className="discover-head-mark" />
        <span>
          <h1>{title}</h1>
          <span className="discover-head-caption">{caption}</span>
        </span>
      </div>
      <p className="discover-head-about">{about}</p>
      <div className="rule-diamond discover-head-rule" aria-hidden />
    </header>
  );
}

/** One of a page's cards: an icon and title, then what it holds. */
export function DiscoverCard({ id, icon, title, lede, className = "", children }: {
  id: string;
  icon: IconName;
  title: string;
  lede?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`discover-card ${className}`} id={`discover-${id}`} aria-labelledby={`discover-${id}-title`}>
      <header className="discover-card-head">
        <Icon name={icon} size={30} />
        <h2 id={`discover-${id}-title`}>{title}</h2>
      </header>
      {lede && <p className="discover-card-lede">{lede}</p>}
      {children}
    </section>
  );
}
