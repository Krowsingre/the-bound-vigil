// The start page's Bookmarks and Reading List tiles open these, in the same
// kind of panel as History and Downloads.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Bookmark } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { siteOf } from "./browserPrefs";
import { onReadingList, readReadingList, removeFromReadingList } from "./readingList";
import { readBookmarkHtml, writeBookmarkHtml } from "./bookmarkHtml";
import { SiteBadge } from "./SiteBadge";

export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

export function BookmarksPanel({ onGo, onClose, onChanged, page }: {
  page?: Bookmark;
  onGo: (url: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [draft, setDraft] = useState<Bookmark | null>(page ?? null);
  const [busy, setBusy] = useState(false);
  const importFile = useRef<HTMLInputElement>(null);
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
  const importBookmarks = (file: File) => void change(async () => {
    const entries = readBookmarkHtml(await file.text());
    if (!entries.length) {
      toast("No web bookmarks found in that file.");
      return;
    }
    const existing = new Set((await api.bookmarks()).map((mark) => mark.url));
    let added = 0;
    let failed = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (existing.has(entry.url)) {
        skipped += 1;
        continue;
      }
      try {
        await api.addBookmark(entry.title, entry.url, entry.folder);
        existing.add(entry.url);
        added += 1;
      } catch {
        failed += 1;
      }
    }
    toast([added + " imported", skipped + " duplicates skipped", ...(failed ? [failed + " failed"] : [])].join(" · "));
  });
  const exportBookmarks = async () => {
    setBusy(true);
    try {
      const name = "TBV Bookmarks.html";
      const bytes = new TextEncoder().encode(writeBookmarkHtml(await api.bookmarks()));
      if (api.kind === "app") {
        const path = await api.pickExportPath(name, "html");
        if (path) await api.saveExportFile(bytes, name, path);
      } else {
        const url = URL.createObjectURL(new Blob([bytes], { type: "text/html;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      toast(String(error).replace(/^Error: /, ""));
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
      : api.addBookmark(draft.title, draft.url, folder), () => page ? onClose() : setDraft(null));
  };

  return (
    <Panel title={page ? (page.id ? "Edit bookmark" : "Add bookmark") : "Bookmarks"} onClose={onClose}>
      {draft ? (
        <form className="bookmark-editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label>Name <input autoFocus value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Address <input type="url" required value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></label>
          <label>Folder <input list="bookmark-folders" placeholder="No folder" value={draft.folder ?? ""} maxLength={120} onChange={(e) => setDraft({ ...draft, folder: e.target.value })} /></label>
          <datalist id="bookmark-folders">{[...folders.keys()].filter(Boolean).map((name) => <option key={name} value={name} />)}</datalist>
          <div className="bookmark-editor-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>{page && !page.id ? "Add bookmark" : "Save"}</button>
            {page?.id && <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => void change(() => api.removeBookmark(page.id), onClose)}>Remove bookmark</button>}
            <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => page ? onClose() : setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="bookmark-editor-actions">
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setDraft({ id: "", title: "", url: "" })}>Add bookmark</button>
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => importFile.current?.click()}>Import HTML</button>
          <button type="button" className="btn btn-quiet btn-small" disabled={busy || !marks.length} onClick={() => void exportBookmarks()}>Export HTML</button>
          <input ref={importFile} type="file" accept=".html,.htm,text/html" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) importBookmarks(file);
          }} />
        </div>
      )}
      {!page && <ul className="browser-download-list browser-history-list">
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
      </ul>}
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
