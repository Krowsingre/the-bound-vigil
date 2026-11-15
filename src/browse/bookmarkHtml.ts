import type { Bookmark, BookmarkFolder } from "../api/types";

/** A bookmark from a file: `path` is the folders it's in, outermost first; `folder` the same joined up. */
type BookmarkFileEntry = Pick<Bookmark, "title" | "url" | "folder"> & { path?: string[] };

export function readBookmarkHtml(html: string): BookmarkFileEntry[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const entries: BookmarkFileEntry[] = [];
  const lists = [...template.content.children].filter((element) => element.tagName === "DL");
  if (!lists.length) return entries;

  const walk = (parent: ParentNode, folders: string[]) => {
    let folder: string | undefined;
    for (const element of parent.children) {
      switch (element.tagName) {
        case "H3":
          folder = element.textContent?.trim();
          break;
        case "DL":
          walk(element, folder ? [...folders, folder] : folders);
          folder = undefined;
          break;
        case "A": {
          const url = element.getAttribute("href")?.trim() ?? "";
          if (isWebBookmark(url)) {
            entries.push({ url, title: element.textContent?.trim() || url, folder: folders.join(" / ") || null, path: folders });
          }
          break;
        }
        case "DT":
        case "DD":
        case "P":
          // Browser exports can put the next list inside or after the DT.
          folder = walk(element, folders);
          break;
      }
    }
    return folder;
  };
  for (const list of lists) walk(list, []);
  return entries;
}

function isWebBookmark(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return !!new URL(url).hostname;
  } catch {
    return false;
  }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!
));

interface Folder {
  entries: BookmarkFileEntry[];
  children: Map<string, Folder>;
}

export function writeBookmarkHtml(bookmarks: BookmarkFileEntry[]): string {
  const root: Folder = { entries: [], children: new Map() };
  for (const bookmark of bookmarks) {
    let folder = root;
    for (const name of bookmark.folder?.split(" / ").filter(Boolean) ?? []) {
      let child = folder.children.get(name);
      if (!child) {
        child = { entries: [], children: new Map() };
        folder.children.set(name, child);
      }
      folder = child;
    }
    folder.entries.push(bookmark);
  }
  const list = (folder: Folder): string => [
    "<DL><p>",
    ...folder.entries.map(({ url, title }) => `<DT><A HREF="${escapeHtml(url)}">${escapeHtml(title)}</A>`),
    ...[...folder.children].map(([name, child]) => `<DT><H3>${escapeHtml(name)}</H3>\n${list(child)}`),
    "</DL><p>",
  ].join("\n");
  return ["<!DOCTYPE NETSCAPE-Bookmark-file-1>", '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', "<TITLE>Bookmarks</TITLE>", "<H1>Bookmarks</H1>", list(root)].join("\n");
}

/** The standard bookmarks file from TBV's folders, nested and in their order (folders first, as TBV shows them). */
export function writeBookmarkTree(folders: BookmarkFolder[], marks: Bookmark[]): string {
  const list = (parent: string | null): string => [
    "<DL><p>",
    ...folders.filter((f) => f.parentId === parent).map((f) => `<DT><H3>${escapeHtml(f.name)}</H3>\n${list(f.id)}`),
    ...marks.filter((m) => (m.folderId ?? null) === parent).map(({ url, title }) => `<DT><A HREF="${escapeHtml(url)}">${escapeHtml(title)}</A>`),
    "</DL><p>",
  ].join("\n");
  return ["<!DOCTYPE NETSCAPE-Bookmark-file-1>", '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', "<TITLE>Bookmarks</TITLE>", "<H1>Bookmarks</H1>", list(null)].join("\n");
}
