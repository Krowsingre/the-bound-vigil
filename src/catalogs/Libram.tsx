// Discover › Libram: the catalogues (the Bibles, and any you add, including
// an Audiobookshelf server), as a page of its own.
import { Catalogs } from "./Catalogs";

export function Libram({ refreshKey, onOpenBook, onOpenSite }: {
  refreshKey: number;
  onOpenBook: (bookId: string, at?: string) => void;
  /** A catalogue's website, opened in Locus. */
  onOpenSite: (url: string) => void;
}) {
  return (
    <div className="library libram-page">
      <header className="library-head is-stacked">
        <div className="library-title-row">
          <h1 className="library-title">Libram</h1>
        </div>
        <p className="muted">Catalogues and Bibles. Add a catalogue to find books to bring into your Archive.</p>
      </header>
      <Catalogs refreshKey={refreshKey} onOpenBook={onOpenBook} onOpenSite={onOpenSite} />
    </div>
  );
}
