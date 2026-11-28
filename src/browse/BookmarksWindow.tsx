// Discover's bookmarks: folders (which can hold folders) on the left and
// what's in the chosen one on the right; a phone shows one folder at a time.
// Everything can be dragged into place (held, then slid, on a touch screen),
// and every move or removal can be undone.

import { useRangePick, withShift } from "../lib/rangePick";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Bookmark, BookmarkFolder, BookmarkUndo } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { useNarrow } from "../lib/useNarrow";
import { siteOf } from "./browserPrefs";
import { readBookmarkHtml, writeBookmarkTree } from "./bookmarkHtml";
import { SiteBadge } from "./SiteBadge";
import { useBookmarkDrag, type Drop } from "./useBookmarkDrag";

const LAST_FOLDER = "tbv.bookmarks.folder";
const FOLDED = "tbv.bookmarks.folded";

const said = (e: unknown) => String(e).replace(/^Error: /, "");

function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Only a convenience.
  }
}

/** The folder a new bookmark goes in: the one used last, if it's still there. */
export function lastBookmarkFolder(folders: BookmarkFolder[]): string | null {
  const id = remembered<string | null>(LAST_FOLDER, null);
  return id && folders.some((f) => f.id === id) ? id : null;
}

/** Folders in the order they're shown, each with how deep it is. */
export function folderTree(folders: BookmarkFolder[]): { folder: BookmarkFolder; depth: number }[] {
  const out: { folder: BookmarkFolder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const folder of folders.filter((f) => f.parentId === parent)) {
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The names of the folders a folder is in, outermost first, ending with its own. */
export function folderPath(folders: BookmarkFolder[], id: string | null | undefined): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let at = folders.find((f) => f.id === id); at && !seen.has(at.id); at = folders.find((f) => f.id === at!.parentId)) {
    seen.add(at.id);
    names.unshift(at.name);
  }
  return names;
}

function FolderPicker({ folders, value, onChange, id }: { folders: BookmarkFolder[]; value: string | null; onChange: (id: string | null) => void; id?: string }) {
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Bookmarks (no folder)</option>
      {folderTree(folders).map(({ folder, depth }) => (
        <option key={folder.id} value={folder.id}>{"  ".repeat(depth) + folder.name}</option>
      ))}
    </select>
  );
}

/** Adding or editing one bookmark: its name, address and folder. */
function BookmarkForm({ draft, folders, busy, adding, onChange, onSave, onRemove, onCancel, onNewFolder }: {
  draft: Bookmark;
  folders: BookmarkFolder[];
  busy: boolean;
  adding: boolean;
  onChange: (draft: Bookmark) => void;
  onSave: () => void;
  onRemove?: () => void;
  onCancel: () => void;
  onNewFolder: (name: string) => Promise<BookmarkFolder | null>;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  return (
    <form className="bookmark-editor" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <label>Name <input autoFocus value={draft.title} maxLength={200} onChange={(e) => onChange({ ...draft, title: e.target.value })} /></label>
      <label>Address <input type="url" required value={draft.url} onChange={(e) => onChange({ ...draft, url: e.target.value })} /></label>
      <label htmlFor="bookmark-folder-pick">Folder</label>
      <div className="bookmark-folder-row">
        <FolderPicker id="bookmark-folder-pick" folders={folders} value={draft.folderId ?? null} onChange={(folderId) => onChange({ ...draft, folderId })} />
        {naming === null && <button type="button" className="btn btn-quiet btn-small" onClick={() => setNaming("")}>New folder</button>}
      </div>
      {naming !== null && (
        <div className="bookmark-folder-row">
          <input aria-label="New folder's name" placeholder="New folder's name" value={naming} maxLength={120} autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onNewFolder(naming).then((made) => made && (onChange({ ...draft, folderId: made.id }), setNaming(null)));
              }
            }}
            onChange={(e) => setNaming(e.target.value)} />
          <button type="button" className="btn btn-quiet btn-small" disabled={!naming.trim()}
            onClick={() => void onNewFolder(naming).then((made) => made && (onChange({ ...draft, folderId: made.id }), setNaming(null)))}>Make</button>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setNaming(null)}>Cancel</button>
        </div>
      )}
      <div className="bookmark-editor-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>{adding ? "Add bookmark" : "Save"}</button>
        {onRemove && <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={onRemove}>Remove bookmark</button>}
        <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function BookmarksPanel({ onGo, onClose, onChanged, onOpenAll, page }: {
  /** Adding (no id) or editing one page's bookmark, instead of the whole list. */
  page?: Bookmark;
  onGo: (url: string) => void;
  onClose: () => void;
  onChanged: () => void;
  /** Opens these in new tabs, behind this one. */
  onOpenAll?: (urls: string[]) => void;
}) {
  const toast = useToast();
  const narrow = useNarrow();
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<Bookmark | null>(null);
  const [naming, setNaming] = useState<{ id: string | null; parentId: string | null; name: string } | null>(null);
  const [deleting, setDeleting] = useState<BookmarkFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(() => new Set(remembered<string[]>(FOLDED, [])));
  const importFile = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [m, f] = await Promise.all([api.bookmarks(), api.bookmarkFolders()]);
    setMarks(m);
    setFolders(f);
    setLoaded(true);
    return f;
  }, []);
  useEffect(() => {
    void reload().then((f) => {
      if (page) setDraft(page.id ? page : { ...page, folderId: lastBookmarkFolder(f) });
    }, (e) => toast(said(e)));
  }, [reload, toast, page]);
  // A folder taken away (here or on another device) leaves you a level up.
  useEffect(() => {
    if (loaded && at && !folders.some((f) => f.id === at)) setAt(null);
  }, [loaded, at, folders]);

  const change = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await work();
      after?.();
      await reload();
      onChanged();
      return true;
    } catch (e) {
      toast(said(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  /** A change that can be put back, with Undo on the note it leaves. */
  const undoable = (text: string, work: () => Promise<BookmarkUndo>) => {
    let undo: BookmarkUndo | null = null;
    void change(async () => { undo = await work(); }).then((done) => {
      if (!done || !undo) return;
      const back = undo;
      toast(text, { label: "Undo", run: () => void change(() => api.undoBookmarks(back)) });
    });
  };

  const inFolder = (id: string | null) => folders.filter((f) => f.parentId === id);
  const marksIn = (id: string | null) => marks.filter((m) => (m.folderId ?? null) === id);
  const here = folders.find((f) => f.id === at) ?? null;
  const countIn = (id: string): number => marksIn(id).length + inFolder(id).reduce((n, f) => n + countIn(f.id), 0);
  const allIn = (id: string | null): Bookmark[] => [...marksIn(id), ...inFolder(id).flatMap((f) => allIn(f.id))];

  const makeFolder = async (name: string, parentId: string | null) => {
    try {
      const made = await api.createBookmarkFolder(name, parentId);
      await reload();
      onChanged();
      return made;
    } catch (e) {
      toast(said(e));
      return null;
    }
  };

  const save = () => {
    if (!draft) return;
    const folderId = draft.folderId ?? null;
    remember(LAST_FOLDER, folderId);
    void change(() => draft.id
      ? api.editBookmark(draft.id, draft.title, draft.url, folderId)
      : api.addBookmark(draft.title, draft.url, folderId), () => page ? onClose() : setDraft(null));
  };

  const onDrop = (item: string, drop: Drop) => {
    const [kind, id] = [item.slice(0, item.indexOf(":")), item.slice(item.indexOf(":") + 1)];
    const [where, place] = [drop.target.slice(0, drop.target.indexOf(":")), drop.target.slice(drop.target.indexOf(":") + 1)];
    const folder = where === "folder" ? folders.find((f) => f.id === place) : undefined;
    if (kind === "mark") {
      const ids = selecting && chosen.has(id) ? marks.filter((m) => chosen.has(m.id)).map((m) => m.id) : [id];
      if (where === "mark") {
        const target = marks.find((m) => m.id === place);
        if (target && !ids.includes(place)) undoable("Moved.", () => api.moveBookmarks(ids, target.folderId ?? null, target.id));
      } else if (folder && drop.upper) {
        // Above a folder is not into it (embre, 28 November). Folders always sit above
        // a level's bookmarks, so it goes to the top of the bookmarks at that level.
        const level = folder.parentId ?? null;
        const first = marksIn(level).find((m) => !ids.includes(m.id));
        undoable("Moved.", () => api.moveBookmarks(ids, level, first?.id ?? null));
      } else if (folder) undoable(`Moved to ${folder.name}.`, () => api.moveBookmarks(ids, folder.id, null));
      else if (where === "end") undoable("Moved.", () => api.moveBookmarks(ids, place || null, null));
    } else if (kind === "folder") {
      if (folder && folder.id === id) return;
      if (folder && drop.upper) undoable("Moved.", () => api.moveBookmarkFolder(id, folder.parentId, folder.id));
      else if (folder) undoable(`Moved into ${folder.name}.`, () => api.moveBookmarkFolder(id, folder.id, null));
      else if (where === "end") undoable("Moved.", () => api.moveBookmarkFolder(id, place || null, null));
      else if (where === "mark") {
        const target = marks.find((m) => m.id === place);
        if (target) undoable("Moved.", () => api.moveBookmarkFolder(id, target.folderId ?? null, null));
      }
    }
  };
  const drag = useBookmarkDrag(onDrop);

  const importBookmarks = (file: File) => void change(async () => {
    const entries = readBookmarkHtml(await file.text());
    if (!entries.length) {
      toast("No web bookmarks found in that file.");
      return;
    }
    let known = await api.bookmarkFolders();
    const existing = new Set((await api.bookmarks()).map((mark) => mark.url));
    // Each folder in the file is matched by name within its own folder here, or made.
    const folderFor = async (path: string[]) => {
      let parent: string | null = null;
      for (const name of path) {
        const want = name.trim().slice(0, 120);
        if (!want) continue;
        let found: BookmarkFolder | undefined = known.find((f) => f.parentId === parent && f.name.toLowerCase() === want.toLowerCase());
        if (!found) {
          found = await api.createBookmarkFolder(want, parent);
          known = [...known, found];
        }
        parent = found.id;
      }
      return parent;
    };
    let added = 0;
    let failed = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (existing.has(entry.url)) {
        skipped += 1;
        continue;
      }
      try {
        await api.addBookmark(entry.title, entry.url, await folderFor(entry.path ?? []));
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
      const bytes = new TextEncoder().encode(writeBookmarkTree(await api.bookmarkFolders(), await api.bookmarks()));
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
      toast(said(error));
    } finally {
      setBusy(false);
    }
  };

  const openAll = (id: string | null) => {
    const urls = allIn(id).map((m) => m.url);
    if (!urls.length || !onOpenAll) return;
    onOpenAll(urls);
    toast(urls.length === 1 ? "Opened in a new tab." : `Opened ${urls.length} tabs.`);
  };
  const fold = (id: string) => {
    const next = new Set(folded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFolded(next);
    remember(FOLDED, [...next]);
  };
  const pickRange = useRangePick();
  const choose = (id: string, shift = false, order: readonly string[] = []) => setChosen(pickRange(chosen, order, id, shift));
  const stopChoosing = () => {
    setSelecting(false);
    setChosen(new Set());
  };

  const folderMenu = (f: BookmarkFolder): MenuEntry[] => [
    { label: "Open", icon: "folder", onSelect: () => (setAt(f.id), setQuery("")) },
    ...(onOpenAll ? [{ label: "Open all in tabs", icon: "external" as const, disabled: !countIn(f.id), onSelect: () => openAll(f.id) }] : []),
    { label: "Rename", icon: "edit", onSelect: () => setNaming({ id: f.id, parentId: f.parentId, name: f.name }) },
    { label: "New folder inside", icon: "plus", onSelect: () => setNaming({ id: null, parentId: f.id, name: "" }) },
    "divider",
    { label: "Delete folder", icon: "trash", danger: true, onSelect: () => setDeleting(f) },
  ];
  const moveChosenMenu: MenuEntry[] = [
    { label: "Bookmarks (no folder)", icon: "bookmark", onSelect: () => undoable("Moved.", () => api.moveBookmarks([...chosen], null, null)) },
    ...folderTree(folders).map(({ folder, depth }) => ({
      label: "  ".repeat(depth) + folder.name,
      icon: "folder" as const,
      onSelect: () => undoable(`Moved to ${folder.name}.`, () => api.moveBookmarks([...chosen], folder.id, null)),
    })),
  ];

  if (page) {
    return (
      <Panel title={page.id ? "Edit bookmark" : "Add bookmark"} onClose={onClose}>
        {draft && (
          <BookmarkForm draft={draft} folders={folders} busy={busy} adding={!page.id} onChange={setDraft} onSave={save} onCancel={onClose}
            onRemove={page.id ? () => void change(() => api.removeBookmark(page.id), onClose) : undefined}
            onNewFolder={(name) => makeFolder(name, null)} />
        )}
      </Panel>
    );
  }

  const term = query.trim().toLowerCase();
  const found = term ? marks.filter((m) => m.title.toLowerCase().includes(term) || m.url.toLowerCase().includes(term)) : null;

  const markRow = (m: Bookmark, showPath: boolean, index: number, list: Bookmark[]) => (
    <li key={m.id} className="bookmark-row" {...(term ? {} : drag.handle("mark:" + m.id))}>
      {selecting && <input type="checkbox" className="no-drag" aria-label={"Choose " + m.title} checked={chosen.has(m.id)} onChange={(e) => choose(m.id, withShift(e), list.map((x) => x.id))} />}
      <button type="button" className="browser-history-open" title={m.url}
        onClick={(e) => (selecting ? choose(m.id, e.shiftKey, list.map((x) => x.id)) : onGo(m.url))}
        onKeyDown={(e) => {
          if (!e.altKey || term || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          e.stopPropagation();
          const step = e.key === "ArrowUp" ? -1 : 1;
          if (list[index + step]) void change(() => api.moveBookmark(m.id, step));
        }}>
        <SiteBadge url={m.url} title={m.title} size={22} />
        <span className="browser-download-name">
          <b>{m.title}</b>
          <span className="muted">{showPath ? [...folderPath(folders, m.folderId), siteOf(m.url) ?? m.url].join(" › ") : siteOf(m.url) ?? m.url}</span>
        </span>
      </button>
      {!selecting && (
        <>
          <button type="button" className="icon-btn no-drag" disabled={busy} aria-label={"Edit " + m.title} onClick={() => setDraft(m)}>
            <Icon name="edit" size={15} />
          </button>
          <button type="button" className="icon-btn no-drag" disabled={busy} aria-label={"Remove the bookmark for " + m.title}
            onClick={() => undoable("Bookmark removed.", () => api.removeBookmarks([m.id]))}>
            <Icon name="close" size={14} />
          </button>
        </>
      )}
    </li>
  );
  const folderRow = (f: BookmarkFolder) => (
    <li key={f.id} className="bookmark-row bookmark-folder-row-item" {...drag.handle("folder:" + f.id)}>
      <button type="button" className="browser-history-open" onClick={() => (setAt(f.id), setQuery(""))}>
        <span className="bookmark-folder-icon"><Icon name="folder" size={18} /></span>
        <span className="browser-download-name">
          <b>{f.name}</b>
          <span className="muted">{countIn(f.id) === 1 ? "1 bookmark" : `${countIn(f.id)} bookmarks`}</span>
        </span>
      </button>
      <span className="no-drag">
        <Menu label={"More for " + f.name} trigger={<Icon name="more" size={16} />} items={folderMenu(f)} />
      </span>
    </li>
  );
  const treeRows = (parent: string | null, depth: number): React.ReactNode[] => inFolder(parent).flatMap((f) => {
    const kids = inFolder(f.id).length > 0;
    return [
      <li key={f.id} style={{ paddingInlineStart: 6 + depth * 14 }} className={"bookmark-tree-row" + (at === f.id ? " active" : "")} {...drag.handle("folder:" + f.id)}>
        <button type="button" className="icon-btn bookmark-tree-fold no-drag" aria-label={(folded.has(f.id) ? "Show what's in " : "Fold ") + f.name}
          aria-expanded={!folded.has(f.id)} style={{ visibility: kids ? "visible" : "hidden" }} onClick={() => fold(f.id)}>
          <Icon name={folded.has(f.id) ? "chevronRight" : "chevronDown"} size={14} />
        </button>
        <button type="button" className="bookmark-tree-open" aria-current={at === f.id ? "true" : undefined} onClick={() => (setAt(f.id), setQuery(""))}>
          <Icon name="folder" size={15} /> <span>{f.name}</span>
        </button>
      </li>,
      ...(folded.has(f.id) ? [] : treeRows(f.id, depth + 1)),
    ];
  });

  const editing = draft && (
    <BookmarkForm draft={draft} folders={folders} busy={busy} adding={!draft.id} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)}
      onNewFolder={(name) => makeFolder(name, null)} />
  );
  const namingForm = naming && (
    <form className="bookmark-folder-row bookmark-naming" onSubmit={(e) => {
      e.preventDefault();
      const n = naming;
      if (n.id) void change(() => api.renameBookmarkFolder(n.id!, n.name), () => setNaming(null));
      else void makeFolder(n.name, n.parentId).then((made) => made && setNaming(null));
    }}>
      <input autoFocus aria-label="Folder name" placeholder={naming.id ? "Folder name" : "New folder's name"} value={naming.name} maxLength={120}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setNaming(null))}
        onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
      <button type="submit" className="btn btn-primary btn-small" disabled={busy || !naming.name.trim()}>{naming.id ? "Rename" : "Make folder"}</button>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => setNaming(null)}>Cancel</button>
    </form>
  );

  const contents = found ? (
    <ul className="browser-download-list browser-history-list bookmark-list">
      {found.length ? found.map((m, i) => markRow(m, true, i, found)) : <li className="muted bookmark-empty">No bookmarks match.</li>}
    </ul>
  ) : (
    <ul className="browser-download-list browser-history-list bookmark-list">
      {inFolder(at).map(folderRow)}
      {marksIn(at).map((m, i, list) => markRow(m, false, i, list))}
      <li className="bookmark-end" {...drag.target("end:" + (at ?? ""))}>
        {!inFolder(at).length && !marksIn(at).length ? <span className="muted">{at ? "This folder is empty. Drag bookmarks here, or add one." : "No bookmarks yet."}</span> : <span className="muted bookmark-end-hint">{narrow ? "Hold a bookmark, then slide it to move it." : "Drag to arrange. Drop onto a folder to put it in."}</span>}
      </li>
    </ul>
  );

  const toolbar = selecting ? (
    <div className="bookmark-toolbar">
      <span className="bookmark-chosen">{chosen.size === 1 ? "1 chosen" : `${chosen.size} chosen`}</span>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => setChosen(new Set((found ?? marksIn(at)).map((m) => m.id)))}>Choose all</button>
      <Menu label="Move to folder" className="btn btn-quiet btn-small" align="start" trigger={<>Move to folder…</>} items={chosen.size ? moveChosenMenu : []} />
      <button type="button" className="btn btn-danger btn-small" disabled={!chosen.size || busy}
        onClick={() => undoable(chosen.size === 1 ? "Bookmark removed." : `${chosen.size} bookmarks removed.`, async () => {
          const undo = await api.removeBookmarks([...chosen]);
          setChosen(new Set());
          return undo;
        })}>Delete</button>
      <button type="button" className="btn btn-quiet btn-small" onClick={stopChoosing}>Done</button>
    </div>
  ) : (
    <div className="bookmark-toolbar">
      <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setDraft({ id: "", title: "", url: "", folderId: at })}>Add bookmark</button>
      <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setNaming({ id: null, parentId: at, name: "" })}>New folder</button>
      <button type="button" className="btn btn-quiet btn-small" disabled={busy || !marks.length} onClick={() => setSelecting(true)}>Select</button>
      <Menu label="More bookmark actions" align="end" trigger={<Icon name="more" size={18} />} items={[
        { label: "Sort this folder by name", icon: "sort", disabled: busy, onSelect: () => undoable("Sorted by name.", () => api.sortBookmarkFolder(at, "name")) },
        { label: "Sort this folder newest first", icon: "clock", disabled: busy, onSelect: () => undoable("Sorted newest first.", () => api.sortBookmarkFolder(at, "added")) },
        ...(onOpenAll ? [{ label: "Open all in tabs", icon: "external" as const, disabled: !allIn(at).length, onSelect: () => openAll(at) }] : []),
        "divider",
        { label: "Import bookmarks (HTML)", icon: "upload", disabled: busy, onSelect: () => importFile.current?.click() },
        { label: "Export bookmarks (HTML)", icon: "download", disabled: busy || !marks.length, onSelect: () => void exportBookmarks() },
        ...(here ? ["divider" as const, ...folderMenu(here).slice(1)] : []),
      ]} />
      <input ref={importFile} type="file" accept=".html,.htm,text/html" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) importBookmarks(file);
      }} />
    </div>
  );

  const heading = (
    <div className="bookmark-where">
      {narrow && here && !found && (
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setAt(here.parentId)}>
          ‹ {folders.find((f) => f.id === here.parentId)?.name ?? "Bookmarks"}
        </button>
      )}
      <h3>{found ? "Found" : here ? here.name : "Bookmarks"}</h3>
      {!narrow && here && !found && <span className="muted">{folderPath(folders, here.parentId).join(" › ")}</span>}
    </div>
  );

  return (
    <Panel title="Bookmarks" onClose={onClose} wide={!narrow}>
      <label className="search browser-history-find">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search all bookmarks…" aria-label="Search all bookmarks" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className={"bookmarks-window" + (narrow ? " narrow" : "")}>
        {!narrow && (
          <nav className="bookmark-tree" aria-label="Bookmark folders">
            <ul>
              <li className={"bookmark-tree-row" + (at === null ? " active" : "")} {...drag.target("end:")}>
                <span className="bookmark-tree-fold" />
                <button type="button" className="bookmark-tree-open" aria-current={at === null ? "true" : undefined} onClick={() => (setAt(null), setQuery(""))}>
                  <Icon name="bookmark" size={15} /> <span>Bookmarks</span>
                </button>
              </li>
              {treeRows(null, 1)}
            </ul>
          </nav>
        )}
        <section className="bookmark-contents">
          {heading}
          {toolbar}
          {namingForm}
          {editing}
          {contents}
        </section>
      </div>
      {deleting && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setDeleting(null)}>
          <div className="dialog confirm-dialog" role="alertdialog" aria-label={"Delete " + deleting.name} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setDeleting(null))}>
            <h2>Delete “{deleting.name}”?</h2>
            <p className="muted">
              {countIn(deleting.id) || inFolder(deleting.id).length
                ? `It holds ${countIn(deleting.id) === 1 ? "1 bookmark" : `${countIn(deleting.id)} bookmarks`}${inFolder(deleting.id).length ? " and folders" : ""}. You can delete them too, or keep them and move them up a level.`
                : "It's empty."}
            </p>
            <div className="dialog-actions bookmark-delete-actions">
              <button type="button" className="btn btn-quiet" autoFocus onClick={() => setDeleting(null)}>Cancel</button>
              {(countIn(deleting.id) > 0 || inFolder(deleting.id).length > 0) && (
                <button type="button" className="btn btn-quiet" onClick={() => {
                  const f = deleting;
                  setDeleting(null);
                  undoable(`Deleted ${f.name}; what was in it moved up.`, () => api.deleteBookmarkFolder(f.id, true));
                }}>Keep what's in it</button>
              )}
              <button type="button" className="btn btn-danger" onClick={() => {
                const f = deleting;
                setDeleting(null);
                undoable(`Deleted ${f.name}.`, () => api.deleteBookmarkFolder(f.id, false));
              }}>{countIn(deleting.id) || inFolder(deleting.id).length ? "Delete it all" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function Panel({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"dialog browser-history" + (wide ? " bookmarks-wide" : "")} role="dialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
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

