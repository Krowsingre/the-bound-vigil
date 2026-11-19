import { describe, expect, it, vi } from "vitest";
import type { MenuEntry } from "./Menu";
import { itemAt, textOf, toPopup } from "./menuPopups";

describe("menus in a window of their own", () => {
  const bookmark = vi.fn();
  const site = vi.fn();
  const items: MenuEntry[] = [
    { label: "Add to library", icon: "plus", onSelect: vi.fn() },
    "divider",
    { label: "Bookmarks", icon: "bookmark", submenu: [
      { label: "Bookmark this page", onSelect: bookmark },
      { heading: <strong>Saved sites</strong> },
      { label: "Project Gutenberg", onSelect: site },
    ] },
  ];

  it("sends words only, headings as their text", () => {
    const sent = toPopup(items);
    expect(sent[1]).toEqual({ kind: "divider" });
    expect(sent[2]).toMatchObject({ kind: "item", label: "Bookmarks", submenu: [{ kind: "item", label: "Bookmark this page" }, { kind: "heading", text: "Saved sites" }, { kind: "item" }] });
    expect(JSON.parse(JSON.stringify(sent))).toEqual(sent);
    expect(textOf(<span>Saved <b>sites</b></span>)).toBe("Saved sites");
  });

  it("finds the item chosen by its place", () => {
    itemAt(items, [2, 2])?.onSelect?.();
    expect(site).toHaveBeenCalled();
    expect(itemAt(items, [1])).toBeNull();
    expect(itemAt(items, [2, 1])).toBeNull();
  });
});
