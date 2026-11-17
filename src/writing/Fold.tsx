// A side panel in Scribe that folds away to one line (the link bar under a
// page, the book styles in Preview), remembered on this device.

import { useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";

const read = (key: string, fallback: boolean) => {
  try {
    const saved = localStorage.getItem(`tbv.scribe.fold.${key}`);
    return saved === null ? fallback : saved === "open";
  } catch {
    return fallback;
  }
};

export function Fold({ name, title, summary, className = "", startOpen = false, children }: {
  /** Remembers this panel's open or folded state under this name. */
  name: string;
  title: ReactNode;
  /** A word on what's set, shown beside the title while folded. */
  summary?: ReactNode;
  className?: string;
  startOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => read(name, startOpen));
  const toggle = () =>
    setOpen((was) => {
      try {
        localStorage.setItem(`tbv.scribe.fold.${name}`, was ? "folded" : "open");
      } catch {
        /* remembered for now only */
      }
      return !was;
    });
  return (
    <section className={`scribe-fold${open ? " is-open" : ""} ${className}`}>
      <button type="button" className="scribe-fold-head" aria-expanded={open} onClick={toggle}>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
        <span className="scribe-fold-title">{title}</span>
        {!open && summary && <span className="muted scribe-fold-summary">{summary}</span>}
      </button>
      {open && children}
    </section>
  );
}
