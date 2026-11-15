// @vitest-environment jsdom
import { expect, it } from "vitest";
import { readBookmarkHtml, writeBookmarkHtml, writeBookmarkTree } from "./bookmarkHtml";
import { restoreSession, snapshotSession } from "./SessionsPanel";

it("round trips root and nested bookmarks while escaping HTML", () => {
  const marks = [
    { title: 'Read <this> & "that"', url: "https://example.test/?a=1&b=2", folder: null },
    { title: "One", url: "https://example.test/one", folder: "Books / Reference" },
    { title: "Two", url: "https://example.test/two", folder: "Books / Reference" },
    { title: "Three", url: "https://example.test/three", folder: "Other" },
  ];
  const html = writeBookmarkHtml(marks);
  expect(html).toContain("&lt;this&gt;");
  expect(readBookmarkHtml(html).map(({ path: _, ...entry }) => entry)).toEqual(marks);
  expect(readBookmarkHtml(html)[1].path).toEqual(["Books", "Reference"]);
  expect(readBookmarkHtml('<DL><DT><A HREF="javascript:alert(1)">Ignore</A><DT><A HREF="https://valid.test/">Keep</A></DL>')).toEqual([
    { title: "Keep", url: "https://valid.test/", folder: null, path: [] },
  ]);
});

it("writes nested folders in order and reads them back with their names intact", () => {
  const folders = [
    { id: "a", name: "Poems / Verse", parentId: null },
    { id: "b", name: "Inner", parentId: "a" },
  ];
  const marks = [
    { id: "1", title: "Top", url: "https://top.test/", folderId: null },
    { id: "2", title: "Deep", url: "https://deep.test/", folderId: "b" },
  ];
  const back = readBookmarkHtml(writeBookmarkTree(folders, marks));
  expect(back.map((m) => [m.title, m.path])).toEqual([["Deep", ["Poems / Verse", "Inner"]], ["Top", []]]);
});

it("saves and restores URL, order, pinned state and selection without private tabs or URL passwords", () => {
  const snapshot = snapshotSession({
    tabs: [
      { id: "pin", url: "https://example.test/pin", title: "Pin", pinned: true },
      { id: "private", url: "https://private.test/", title: "Private", private: true },
      { id: "secret", url: "https://user:pass@example.test/", title: null },
      { id: "active", url: "tbv:start", title: null },
    ],
    active: "active",
  });
  expect(snapshot.tabs.map((tab) => tab.url)).toEqual(["https://example.test/pin", "tbv:start"]);
  expect(snapshot.tabs[0].pinned).toBe(true);
  const restored = restoreSession({ id: "saved", name: "Saved", ...snapshot });
  expect(restored.tabs[0].id).not.toBe("pin");
  expect(restored.tabs[1].id).toBe(restored.active);
  expect(snapshotSession(restored)).toEqual(snapshot);
});
