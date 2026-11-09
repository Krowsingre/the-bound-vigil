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

export function BookmarksPanel({ onGo, onClose, onChanged, initial }: {
  onGo: (url: string) => void;
  onClose: () => void;
  onChanged: () => void;
  initial?: { title: string; url: string };
}) {
  const toast = useToast();
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [draft, setDraft] = useState<Bookmark | null>(initial ? { id: "", ...initial } : null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.bookmarks().then(setMarks, (e) => toast(String(e))); }, [toast]);

  const change = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await work();
      after?.();
      setMarks(await api.bookmarks());
      onChanged();
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };
  const folders = new Map<string, Bookmark[]>();
  for (const mark of marks) {
    const name = mark.folder ?? "";
    const group = folders.get(name) ?? [];
    group.push(mark);
    folders.set(name, group);
  }
  const save = () => {
    if (!draft) return;
    const folder = draft.folder?.trim() || null;
    void change(() => draft.id
      ? api.editBookmark(draft.id, draft.title, draft.url, folder)
      : api.addBookmark(draft.title, draft.url, folder), () => setDraft(null));
  };

  return (
    <Panel title="Bookmarks" onClose={onClose}>
      {draft ? (
        <form className="bookmark-editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label>Name <input autoFocus value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Address <input type="url" required value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></label>
          <label>Folder <input list="bookmark-folders" placeholder="No folder" value={draft.folder ?? ""} maxLength={120} onChange={(e) => setDraft({ ...draft, folder: e.target.value })} /></label>
          <datalist id="bookmark-folders">{[...folders.keys()].filter(Boolean).map((name) => <option key={name} value={name} />)}</datalist>
          <div className="bookmark-editor-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>Save</button>
            <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setDraft({ id: "", title: "", url: "" })}>Add bookmark</button>
      )}
      <ul className="browser-download-list browser-history-list">
        {[...folders].flatMap(([name, group]) => [
          <li key={"folder:" + name}><h3>{name || "No folder"}</h3></li>,
          ...group.map((m, index) => (
            <li key={m.id}>
              <button type="button" className="browser-history-open" onClick={() => onGo(m.url)} title={m.url}>
                <SiteBadge url={m.url} title={m.title} size={22} />
                <span className="browser-download-name">
                  <b>{m.title}</b>
                  <span className="muted">{siteOf(m.url) ?? m.url}</span>
                </span>
              </button>
              <button type="button" className="icon-btn" disabled={busy || index === 0} aria-label={"Move " + m.title + " up"} onClick={() => void change(() => api.moveBookmark(m.id, -1))}>↑</button>
              <button type="button" className="icon-btn" disabled={busy || index === group.length - 1} aria-label={"Move " + m.title + " down"} onClick={() => void change(() => api.moveBookmark(m.id, 1))}>↓</button>
              <button type="button" className="icon-btn" disabled={busy} aria-label={"Edit " + m.title} onClick={() => setDraft(m)}>
                <Icon name="edit" size={15} />
              </button>
              <button type="button" className="icon-btn" disabled={busy} aria-label={"Remove the bookmark for " + m.title} onClick={() => void change(() => api.removeBookmark(m.id), () => { if (draft?.id === m.id) setDraft(null); })}>
                <Icon name="close" size={14} />
              </button>
            </li>
          )),
        ])}
      </ul>
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
