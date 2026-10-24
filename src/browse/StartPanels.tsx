// The start page's Bookmarks and Reading List tiles open these, in the same
// kind of panel as History and Downloads.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { Bookmark } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { siteOf } from "./browserPrefs";
import { onReadingList, readReadingList, removeFromReadingList } from "./readingList";
import { SiteBadge } from "./SiteBadge";

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog browser-history" role="dialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header className="catalogues-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function BookmarksPanel({ onGo, onClose }: { onGo: (url: string) => void; onClose: () => void }) {
  const toast = useToast();
  const [marks, setMarks] = useState<Bookmark[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const reload = () => api.bookmarks().then(setMarks, () => setMarks([]));
  useEffect(() => void reload(), []);

  const rename = async () => {
    if (!renaming) return;
    try {
      await api.renameBookmark(renaming.id, renaming.title);
      setRenaming(null);
      await reload();
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    }
  };

  return (
    <Panel title="Bookmarks" onClose={onClose}>
      {marks && marks.length === 0 && <p className="muted">Pages you bookmark with the bookmark button show here, on every device.</p>}
      {marks && marks.length > 0 && (
        <ul className="browser-download-list browser-history-list">
          {marks.map((m) =>
            renaming?.id === m.id ? (
              <li key={m.id}>
                <form
                  className="bookmark-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename();
                  }}
                >
                  <input autoFocus value={renaming.title} maxLength={120} aria-label="Bookmark name" onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} />
                  <button type="submit" className="btn btn-primary btn-small">
                    Save
                  </button>
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </form>
              </li>
            ) : (
              <li key={m.id}>
                <button type="button" className="browser-history-open" onClick={() => onGo(m.url)} title={m.url}>
                  <SiteBadge url={m.url} title={m.title} size={22} />
                  <span className="browser-download-name">
                    <b>{m.title}</b>
                    <span className="muted">{siteOf(m.url) ?? m.url}</span>
                  </span>
                </button>
                <button type="button" className="icon-btn" aria-label={`Rename ${m.title}`} onClick={() => setRenaming({ id: m.id, title: m.title })}>
                  <Icon name="edit" size={15} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Remove the bookmark for ${m.title}`} onClick={() => void api.removeBookmark(m.id).then(reload)}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}

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
