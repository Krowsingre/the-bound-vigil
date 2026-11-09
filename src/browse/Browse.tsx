// Discover: a web browser, with ebooks you download offered to your library.
// The row's globe-plus button opens the catalogues: the Bible picker and any
// you add (free ones are suggested, none built in).
// Whatever comes in joins the import queue like any other book.

import { Catalogs } from "../catalogs/Catalogs";
import { Icon } from "../components/Icon";
import { askBrowser } from "./browserAsk";
import { BROWSER_GO, Browser, BrowserNav, BrowserSiteButton } from "./Browser";
import type { Route } from "../shell/routes";

export function Browse({
  refreshKey,
  onOpenBook,
  catalogues,
  onOpenCatalogues,
  onCloseCatalogues,
  search,
  onSearchChange,
  allowSplit,
  companion,
  address,
  onSplitWith,
  onCloseSplit,
}: {
  refreshKey: number;
  onOpenBook: (bookId: string, at?: string) => void;
  /** The catalogues panel is open over the browser. */
  catalogues: boolean;
  onOpenCatalogues: () => void;
  onCloseCatalogues: () => void;
  /** The top search box, which the start page's own box mirrors. */
  search: string;
  onSearchChange: (text: string) => void;
  allowSplit: boolean;
  companion: boolean;
  address: string;
  onSplitWith: (route: Route) => void;
  onCloseSplit: () => void;
}) {
  return (
    <div className="library browse-page browse-browser">
      {companion && <div className="discover-companion-bar">
        <BrowserNav compact />
        <form onSubmit={(event) => {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent(BROWSER_GO, { detail: search }));
          onSearchChange("");
          document.getElementById("discover-split-search")?.blur();
        }}>
          <BrowserSiteButton url={address} />
          <input id="discover-split-search" type="search" aria-label="Discover address"
            placeholder={address || "Search or enter a website…"} value={search}
            onChange={(event) => onSearchChange(event.target.value)} />
        </form>
        <button type="button" className="icon-btn" aria-label="Close Discover split" title="Close Discover split" onClick={onCloseSplit}>
          <Icon name="close" size={16} />
        </button>
      </div>}
      <Browser onOpenCatalogues={onOpenCatalogues} onOpenBook={onOpenBook} search={search} onSearchChange={onSearchChange}
        allowSplit={allowSplit} companion={companion} onSplitWith={onSplitWith} />
      {catalogues && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCloseCatalogues()}>
          <div className="dialog catalogues-panel" role="dialog" aria-label="Catalogues" onKeyDown={(e) => e.key === "Escape" && onCloseCatalogues()}>
            <header className="catalogues-head">
              <h2>Catalogues</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={onCloseCatalogues}>
                <Icon name="close" size={18} />
              </button>
            </header>
            <Catalogs
              refreshKey={refreshKey}
              onOpenBook={(id, at) => {
                onCloseCatalogues();
                onOpenBook(id, at);
              }}
              onOpenSite={(url) => {
                onCloseCatalogues();
                askBrowser({ url });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

