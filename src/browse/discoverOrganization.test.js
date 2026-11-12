// @vitest-environment jsdom
import { expect, it } from "vitest";
import { readBookmarkHtml, writeBookmarkHtml } from "./bookmarkHtml";
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
    expect(readBookmarkHtml(html)).toEqual(marks);
    expect(readBookmarkHtml('<DL><DT><A HREF="javascript:alert(1)">Ignore</A><DT><A HREF="https://valid.test/">Keep</A></DL>')).toEqual([
        { title: "Keep", url: "https://valid.test/", folder: null },
    ]);
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
