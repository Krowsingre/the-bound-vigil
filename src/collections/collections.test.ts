import { describe, expect, it } from "vitest";
import { BADGE_NAMES, isBadge } from "./badges";
import { bookCount, pictureUrl, sameRef } from "./collectionInfo";
import { GALLERY, galleryUrl } from "./gallery";

describe("collections", () => {
  it("knows the built-in shelves' badges", () => {
    for (const b of ["star", "compass", "bookmark", "check"]) expect(isBadge(b)).toBe(true);
    expect(isBadge("from-a-newer-version")).toBe(false);
    expect(new Set(BADGE_NAMES).size).toBe(BADGE_NAMES.length);
  });

  it("has both shapes of every gallery picture", () => {
    expect(GALLERY).toHaveLength(25);
    for (const g of GALLERY) {
      expect(galleryUrl(g.name, "wide")).toMatch(/-wide\.webp/);
      expect(galleryUrl(g.name, "square")).toMatch(/-square\.webp/);
    }
    expect(GALLERY.find((g) => g.name === "citadel-beneath-the-planet")?.label).toBe("Citadel Beneath the Planet");
    // Names the core accepts: lower-case letters and hyphens, 32 at most.
    for (const g of GALLERY) expect(g.name).toMatch(/^[a-z-]{1,32}$/);
  });

  it("keeps pictures chosen before the paintings arrived", () => {
    expect(galleryUrl("peaks")).toBe(galleryUrl("snowbound-peaks"));
    expect(galleryUrl("not-a-picture")).toBeNull();
  });

  it("shows covers when there's no picture", () => {
    expect(pictureUrl({ picture: null, picturePath: null })).toBeNull();
    expect(pictureUrl({ picture: "gallery:coast", picturePath: null })).toBe(galleryUrl("coast"));
  });

  it("tells collections apart", () => {
    expect(sameRef({ kind: "collection", id: "a" }, { kind: "collection", id: "a" })).toBe(true);
    expect(sameRef({ kind: "collection", id: "a" }, { kind: "collection", id: "b" })).toBe(false);
    expect(sameRef({ kind: "series", name: "Holmes" }, { kind: "smart", smart: "unread" })).toBe(false);
    expect(sameRef({ kind: "smart", smart: "read" }, { kind: "smart", smart: "read" })).toBe(true);
    expect(sameRef(null, { kind: "series", name: "x" })).toBe(false);
  });

  it("counts books in words", () => {
    expect(bookCount(1)).toBe("1 book");
    expect(bookCount(1200)).toBe("1,200 books");
  });
});
