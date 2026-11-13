// Discover › Scry: a web browser, with ebooks you download offered to your
// library. Whatever comes in joins the import queue like any other book. The
// catalogues are Discover's Libram page now (catalogs/Libram.tsx).

import { Browser } from "./Browser";
import type { Route } from "../shell/routes";

export function Browse({
  onOpenBook,
  search,
  onSearchChange,
  allowTabSplit,
  onSplitWith,
}: {
  onOpenBook: (bookId: string, at?: string) => void;
  /** The top search box, which the start page's own box mirrors. */
  search: string;
  onSearchChange: (text: string) => void;
  allowTabSplit: boolean;
  onSplitWith?: (route: Route) => void;
}) {
  return (
    <div className="library browse-page browse-browser">
      <Browser onOpenBook={onOpenBook} search={search} onSearchChange={onSearchChange}
        allowSplit={allowTabSplit} companion={false} onSplitWith={onSplitWith} />
    </div>
  );
}
