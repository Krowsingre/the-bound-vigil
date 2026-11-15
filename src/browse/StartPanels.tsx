// The start page's Bookmarks and Reading List tiles open these, in the same
// kind of panel as History and Downloads.

import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { siteOf } from "./browserPrefs";
import { onReadingList, readReadingList, removeFromReadingList } from "./readingList";
import { Panel } from "./BookmarksWindow";

export { BookmarksPanel, Panel } from "./BookmarksWindow";

export function ReadingListPanel({ onOpenBook, onClose }: { onOpenBook: (bookId: string) => void; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState(readReadingList);
  useEffect(() => onReadingList(() => setList(readReadingList())), []);

  const open = async (bookId: string) => {
    try {
      // Still being added, or since deleted from the library.
      await api.bookDetails(bookId);
    } catch {
      toast("That page isn't in your library yet. If you saved it just now, it's still being added.");
      return;
    }
    onClose();
    onOpenBook(bookId);
  };

  return (
    <Panel title="Reading List" onClose={onClose}>
      {list.length === 0 ? (
        <p className="muted">Open a page in reader view and choose Save to Reading List. It's kept as a book in your library, to read here or on any device.</p>
      ) : (
        <ul className="browser-download-list browser-history-list">
          {list.map((e) => (
            <li key={e.bookId}>
              <button type="button" className="browser-history-open" onClick={() => void open(e.bookId)} title={e.url}>
                <Icon name="notes" size={18} />
                <span className="browser-download-name">
                  <b>{e.title}</b>
                  <span className="muted">
                    {siteOf(e.url) ?? e.url} · {new Date(e.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </span>
                </span>
              </button>
              <button type="button" className="icon-btn" aria-label={`Take ${e.title} off the Reading List`} title="Take off the list (the book stays in your library)" onClick={() => removeFromReadingList(e.bookId)}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
