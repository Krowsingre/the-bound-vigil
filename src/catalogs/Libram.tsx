// Discover › Libram: the catalogues (any you add, including the Bibles and an
// Audiobookshelf server), as cards to browse, after embre's picture of 13 November.
import { DiscoverHeader } from "../browse/DiscoverPage";
import { Catalogs } from "./Catalogs";

export function Libram({ refreshKey, onOpenBook, onOpenSite }: {
  refreshKey: number;
  onOpenBook: (bookId: string, at?: string) => void;
  /** A catalogue's website, opened in Scry. */
  onOpenSite: (url: string) => void;
}) {
  return (
    <div className="discover-page libram-page">
      <DiscoverHeader
        layout="stacked"
        icon="chapel"
        title="Libram"
        caption="Catalogues and Bibles"
        about="Add and manage catalogues to discover books and bring them into your Archive."
      />
      <Catalogs refreshKey={refreshKey} onOpenBook={onOpenBook} onOpenSite={onOpenSite} />
    </div>
  );
}
