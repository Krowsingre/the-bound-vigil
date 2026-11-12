// Collections for the browser preview, mirroring the core closely enough to
// look at the Collections page while designing. Never used in the app.
import { matches } from "../collections/rules";
const day = 86_400_000;
const stamp = () => new Date().toISOString();
const ago = (days) => new Date(Date.now() - days * day).toISOString();
const coverOf = ({ id, title, authors, coverPath }) => ({ id, title, authors, coverPath });
const SMART = ["send_to_device", "in_progress", "up_next", "favorites", "read"];
export function previewCollections(books, empty) {
    const shelf = (id, name, badge, picture) => ({
        id: `shelf:${id}`,
        name,
        description: null,
        kind: "shelf",
        badge,
        picture,
        pinned: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        members: [],
    });
    const byTitle = (...titles) => titles
        .map((t) => books().find((b) => b.title === t))
        .filter((b) => !!b)
        .map((b, i) => ({ bookId: b.id, addedAt: ago(20 - i) }));
    const own = (id, name, extra, titles, createdDaysAgo) => ({
        id,
        name,
        description: null,
        kind: "collection",
        badge: null,
        picture: null,
        pinned: false,
        createdAt: ago(createdDaysAgo),
        updatedAt: ago(createdDaysAgo),
        members: byTitle(...titles),
        ...extra,
    });
    let stored = [
        shelf("want_to_read", "Up next", "bookmark", "gallery:forest-shrine"),
        shelf("send_to_device", "Sent to device", "phone", "gallery:stormlight-beacon"),
        ...(empty
            ? []
            : [
                own("c1", "Gothic", {
                    badge: "moon",
                    picture: "gallery:moonlit-towers",
                    pinned: true,
                    description: "Old houses, long shadows and letters that arrive too late.",
                }, ["Dracula", "Frankenstein", "Wuthering Heights", "The Turn of the Screw", "The Woman in White", "The Moonstone"], 40),
                own("c2", "Long Victorians", { kind: "reading_list", badge: "hourglass", description: "The big ones, one per winter." }, ["Middlemarch", "Bleak House", "North and South", "Anna Karenina", "The Brothers Karamazov"], 30),
                own("c3", "Adventure", { badge: "compass", picture: "gallery:stormbound-harbor", description: "Voyages, escapes and maps with edges." }, [
                    "Twenty Thousand Leagues Under the Seas",
                    "Around the World in Eighty Days",
                    "The Time Machine",
                    "The War of the Worlds",
                    "The Count of Monte Cristo",
                ], 22),
                own("c4", "Austen & the Brontës", { badge: "feather" }, ["Persuasion", "Emma", "Jane Eyre", "Wuthering Heights"], 12),
                own("c5", "Russian winters", { badge: "tower", picture: "gallery:winter-valley" }, ["Anna Karenina", "Crime and Punishment", "The Brothers Karamazov"], 6),
                own("c6", "Comfort reads", { badge: "lantern", kind: "reading_list" }, ["Little Women", "The Secret Garden"], 2),
            ]),
    ];
    const live = () => new Map(books().map((b) => [b.id, b]));
    const shelfBooks = {
        "shelf:want_to_read": (b) => b.wantToRead,
        "shelf:send_to_device": (b) => !!b.phoneWanted,
    };
    const smartBooks = {
        recently_added: (b) => Date.now() - Date.parse(b.addedAt) < 7 * day,
        unread: (b) => b.status === "unread",
        read: (b) => b.status === "read" || b.status === "dropped",
        in_progress: (b) => b.status === "in_progress",
        favorites: (b) => b.favorite,
        up_next: (b) => b.wantToRead,
        send_to_device: (b) => !!b.phoneWanted,
    };
    function membersOf(c) {
        if (c.kind === "shelf")
            return books().filter(shelfBooks[c.id] ?? (() => false));
        if (c.rules)
            return books().filter((b) => matches(b, c.rules)).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
        const map = live();
        const list = c.members.map((m) => map.get(m.bookId)).filter((b) => !!b);
        return c.kind === "reading_list" ? list : list.reverse();
    }
    function averageRating(list) {
        const rated = list.map((b) => b.rating).filter((r) => r !== null);
        return rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
    }
    function summary(c) {
        const members = membersOf(c);
        const coverBook = c.picture?.startsWith("cover:") ? live().get(c.picture.slice(6)) : undefined;
        return {
            id: c.id,
            name: c.name,
            description: c.description,
            kind: c.kind,
            badge: c.badge,
            picture: c.picture,
            picturePath: coverBook?.coverPath ?? null,
            pinned: c.pinned,
            rules: c.rules ?? null,
            count: members.length,
            rating: averageRating(members),
            covers: members.slice(0, 3).map(coverOf),
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
        };
    }
    const find = (id) => {
        const c = stored.find((x) => x.id === id);
        if (!c)
            throw new Error("that collection no longer exists");
        return c;
    };
    const change = (id, edit) => {
        stored = stored.map((c) => (c.id === id ? { ...edit(c), updatedAt: stamp() } : c));
        return summary(find(id));
    };
    function booksFor(ref) {
        if (ref.kind === "collection")
            return membersOf(find(ref.id));
        if (ref.kind === "series")
            return books()
                .filter((b) => b.series?.trim().toLowerCase() === ref.name.trim().toLowerCase())
                .sort((a, b) => (a.seriesIndex ?? 1e9) - (b.seriesIndex ?? 1e9));
        return books().filter(smartBooks[ref.smart]);
    }
    const api = {
        getCollectionsOverview: async () => {
            const series = new Map();
            for (const b of books())
                if (b.series)
                    series.set(b.series, [...(series.get(b.series) ?? []), b]);
            return {
                pinned: stored.filter((c) => c.pinned && c.kind !== "shelf").map(summary),
                smart: SMART.map((kind) => {
                    const list = books().filter(smartBooks[kind]);
                    return { kind, count: list.length, rating: averageRating(list) };
                }),
                collections: stored.filter((c) => c.kind !== "shelf").map(summary),
                series: [...series.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([name, list]) => ({
                    name,
                    count: list.length,
                    authors: [...new Set(list.map((b) => b.authors[0]).filter(Boolean))],
                    covers: list.slice(0, 3).map(coverOf),
                })),
            };
        },
        getCollection: async (ref) => ({
            collection: ref.kind === "collection" ? summary(find(ref.id)) : null,
            books: booksFor(ref),
        }),
        createCollection: async (input) => {
            const name = input.name.trim();
            if (!name)
                throw new Error("give the collection a name");
            const c = {
                id: `c${Math.random().toString(36).slice(2)}`,
                name,
                description: input.description?.trim() || null,
                kind: input.kind,
                badge: input.badge ?? null,
                picture: null,
                pinned: input.pinned,
                rules: input.rules ?? null,
                createdAt: stamp(),
                updatedAt: stamp(),
                members: [],
            };
            stored = [...stored, c];
            return summary(c);
        },
        updateCollection: async (id, input) => change(id, (c) => c.kind === "shelf"
            ? { ...c, badge: input.badge ?? null, pinned: input.pinned }
            : {
                ...c,
                name: input.name.trim() || c.name,
                description: input.description?.trim() || null,
                kind: input.kind,
                badge: input.badge ?? null,
                pinned: input.pinned,
                rules: input.rules ?? null,
            }),
        countRuleMatches: async (rules) => books().filter((b) => matches(b, rules)).length,
        deleteCollection: async (id) => {
            if (find(id).kind === "shelf")
                throw new Error("the built-in shelves can't be deleted");
            stored = stored.filter((c) => c.id !== id);
        },
        setCollectionPicture: async (id, picture) => change(id, (c) => ({ ...c, picture })),
        pickCollectionPicture: async () => {
            throw new Error("Choosing a picture from your computer works in the desktop app.");
        },
        setCollectionPictureFile: async () => {
            throw new Error("Choosing a picture from your computer works in the desktop app.");
        },
        addToCollection: async (id, bookIds) => {
            if (find(id).rules)
                throw new Error("this collection fills itself from its rules");
            change(id, (c) => ({
                ...c,
                members: [
                    ...c.members,
                    ...bookIds.filter((b) => !c.members.some((m) => m.bookId === b)).map((bookId) => ({ bookId, addedAt: stamp() })),
                ],
            }));
        },
        removeFromCollection: async (id, bookId) => {
            change(id, (c) => ({ ...c, members: c.members.filter((m) => m.bookId !== bookId) }));
        },
        moveCollection: async (id, toIndex) => {
            const own = stored.filter((c) => c.kind !== "shelf");
            const from = own.findIndex((c) => c.id === id);
            if (from < 0)
                throw new Error("that collection no longer exists");
            const [c] = own.splice(from, 1);
            own.splice(Math.min(toIndex, own.length), 0, c);
            stored = [...stored.filter((x) => x.kind === "shelf"), ...own];
        },
        moveInCollection: async (id, bookId, toIndex) => {
            change(id, (c) => {
                const members = [...c.members];
                const from = members.findIndex((m) => m.bookId === bookId);
                if (from < 0)
                    return c;
                const [m] = members.splice(from, 1);
                members.splice(Math.min(toIndex, members.length), 0, m);
                return { ...c, members };
            });
        },
        collectionsForBook: async (bookId) => stored.filter((c) => c.kind !== "shelf" && c.members.some((m) => m.bookId === bookId)).map((c) => c.id),
    };
    /** The user's collections in the shape Home and the Library tab use. */
    const previews = () => stored
        .filter((c) => c.kind !== "shelf")
        .map(summary)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ id, name, count, covers }) => ({
        id,
        name,
        count,
        coverPaths: covers.map((c) => c.coverPath).filter((p) => !!p),
    }));
    return { api, previews };
}
