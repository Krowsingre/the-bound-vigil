// Discover: a web browser, with ebooks you download offered to your library.
// The row's globe-plus button opens the catalogues: the Bible picker and any
// you add (free ones are suggested, none built in).
// Whatever comes in joins the import queue like any other book.

import { Catalogs } from "../catalogs/Catalogs";
import { Icon } from "../components/Icon";
import { askBrowser } from "./browserAsk";
import { Browser } from "./Browser";

export function Browse({
  refreshKey,
  onOpenBook,
  catalogues,
  onOpenCatalogues,
  onCloseCatalogues,
  search,
  onSearchChange,
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
}) {
  return (
    <div className="library browse-page browse-browser">
      <Browser onOpenCatalogues={onOpenCatalogues} onOpenBook={onOpenBook} search={search} onSearchChange={onSearchChange} />
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

