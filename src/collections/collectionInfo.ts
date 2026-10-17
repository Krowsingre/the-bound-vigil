// Names, descriptions and pictures for the kinds of collection.

import { api } from "../api";
import type { CollectionKind, CollectionRef, CollectionSummary, SmartKind } from "../api/types";
import { galleryUrl } from "./gallery";

export const SMART_INFO: Record<SmartKind, { name: string; badge: string; description: string }> = {
  recently_added: { name: "Recently added", badge: "sparkle", description: "Books added in the last 30 days." },
  unread: { name: "Unread", badge: "book", description: "Books you haven't opened yet." },
  read: { name: "Read", badge: "check", description: "Books you've finished." },
  in_progress: { name: "In progress", badge: "bookmark", description: "Books you've started and not finished." },
  favorites: { name: "Favourites", badge: "heart", description: "Books you've marked as a favourite." },
};

export const KIND_LABEL: Record<CollectionKind, string> = {
  shelf: "Built-in shelf",
  collection: "Collection",
  reading_list: "Reading list",
};

export const bookCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "book" : "books"}`;

/** The picture to show for a collection, or null to show its covers instead. */
export function pictureUrl(c: Pick<CollectionSummary, "picture" | "picturePath">): string | null {
  if (c.picture?.startsWith("gallery:")) return galleryUrl(c.picture.slice("gallery:".length));
  if (c.picturePath) return api.coverUrl(c.picturePath) || null;
  return null;
}

export const sameRef = (a: CollectionRef | null, b: CollectionRef | null) =>
  !!a &&
  !!b &&
  a.kind === b.kind &&
  (a.kind === "collection"
    ? a.id === (b as typeof a).id
    : a.kind === "series"
      ? a.name === (b as typeof a).name
      : a.smart === (b as typeof a).smart);
