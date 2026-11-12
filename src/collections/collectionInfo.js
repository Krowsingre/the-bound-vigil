// Names, descriptions and pictures for the kinds of collection.
import { api } from "../api";
import { galleryUrl } from "./gallery";
export const SMART_INFO = {
    recently_added: { name: "Recently added", badge: "sparkle", description: "Books added in the last 7 days." },
    unread: { name: "Unread", badge: "book", description: "Books you haven't opened yet." },
    read: { name: "Read", badge: "check", description: "Books you've finished or dropped." },
    in_progress: { name: "In progress", badge: "bookmark", description: "Books you've started and not finished." },
    favorites: { name: "Favourites", badge: "heart", description: "Books you've marked as a favourite." },
    up_next: { name: "Up next", badge: "hourglass", description: "Books you want to read next." },
    send_to_device: { name: "Sent to device", badge: "phone", description: "Books you've chosen for your phone." },
};
export const KIND_LABEL = {
    shelf: "Built-in shelf",
    collection: "Collection",
    reading_list: "Reading list",
};
export const bookCount = (n) => `${n.toLocaleString()} ${n === 1 ? "book" : "books"}`;
/** The picture to show for a collection, or null to show its covers instead. */
export function pictureUrl(c, shape = "wide") {
    if (c.picture?.startsWith("gallery:"))
        return galleryUrl(c.picture.slice("gallery:".length), shape);
    if (c.picturePath)
        return api.coverUrl(c.picturePath) || null;
    return null;
}
export const sameRef = (a, b) => !!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind === "collection"
        ? a.id === b.id
        : a.kind === "series"
            ? a.name === b.name
            : a.smart === b.smart);
