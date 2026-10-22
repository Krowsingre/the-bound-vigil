// The Browse page: online catalogs (Project Gutenberg, Standard Ebooks, your
// own), the Bible in three public-domain translations, and a web browser.
// Whatever comes in joins the import queue like any other book.

import { useState } from "react";
import { Catalogs } from "../catalogs/Catalogs";
import { Bible } from "./Bible";
import { Browser } from "./Browser";

type Tab = "catalogs" | "bible" | "browser";

const TABS: { tab: Tab; label: string }[] = [
  { tab: "catalogs", label: "Catalogs" },
  { tab: "bible", label: "Bible" },
  { tab: "browser", label: "Browser" },
];

const TAB_KEY = "tbv.browse.tab";

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.tab === t) ? (t as Tab) : "catalogs";
  } catch {
    return "catalogs";
  }
}

const LEDE: Record<Tab, string> = {
  catalogs: "Online bookshelves to browse and bring books in from",
  bible: "The Bible in three free translations, opened at any chapter",
  browser: "Any website, with ebooks you download offered to your library",
};

export function Browse({ refreshKey, onOpenBook }: { refreshKey: number; onOpenBook: (bookId: string, at?: string) => void }) {
  const [tab, setTab] = useState<Tab>(readTab);
  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Remembered for this visit only.
    }
  };
  return (
    <div className={`library browse-page browse-${tab}`}>
      <header className="library-head">
        <div>
          <h1 className="library-title">Browse</h1>
          <p className="eyebrow">{LEDE[tab]}</p>
        </div>
      </header>
      <div className="library-toolbar">
        <div className="tabs" role="tablist" aria-label="What to browse">
          {TABS.map((t) => (
            <button key={t.tab} type="button" role="tab" aria-selected={tab === t.tab} className={`tab${tab === t.tab ? " is-active" : ""}`} onClick={() => choose(t.tab)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "catalogs" && <Catalogs />}
      {tab === "bible" && <Bible refreshKey={refreshKey} onOpenBook={onOpenBook} />}
      {tab === "browser" && <Browser />}
    </div>
  );
}
