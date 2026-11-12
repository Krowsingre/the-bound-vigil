// Editions of one book (embre, 3 November 2026): a first, second or revised
// edition is a copy of the book of its own, linked to the others by a shared
// group, and each edition can come in several formats (ebook, paperback,
// hardcover...), each with its own ISBN. ISBNs are optional: a writer who
// gets one from their publisher or printer can leave these empty.
// It's all kept in the book's export settings, so it syncs with the book.
export const EDITION_FORMATS = [
    { id: "ebook", label: "Ebook" },
    { id: "paperback", label: "Paperback" },
    { id: "hardcover", label: "Hardcover" },
    { id: "large_print", label: "Large print" },
    { id: "audiobook", label: "Audiobook" },
];
const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
/** "First edition", "Second edition"… */
export function editionName(number) {
    if (number >= 1 && number <= ORDINALS.length)
        return `${ORDINALS[number - 1]} edition`;
    const n = Math.max(1, Math.floor(number));
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
    return `${n}${suffix} edition`;
}
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export function readEdition(saved) {
    if (!saved || typeof saved !== "object")
        return null;
    const e = saved;
    const group = text(e.group, 60);
    if (!group)
        return null;
    const number = typeof e.number === "number" && Number.isFinite(e.number) ? Math.min(99, Math.max(1, Math.floor(e.number))) : 1;
    const raw = (e.isbns && typeof e.isbns === "object" ? e.isbns : {});
    const isbns = {};
    for (const f of EDITION_FORMATS) {
        const isbn = text(raw[f.id], 40);
        if (isbn)
            isbns[f.id] = isbn;
    }
    const earlier = (Array.isArray(e.earlier) ? e.earlier : [])
        .filter((x) => !!x && typeof x === "object")
        .slice(0, 30)
        .map((x) => ({ name: text(x.name, 200), year: text(x.year, 20) }))
        .filter((x) => x.name || x.year);
    return { group, number, name: text(e.name, 200) || editionName(number), year: text(e.year, 20), note: text(e.note, 300), isbns, earlier };
}
/** A first edition, for a book that hasn't said which it is. */
export function firstEdition(year = String(new Date().getFullYear())) {
    return { group: crypto.randomUUID(), number: 1, name: editionName(1), year, note: "", isbns: {}, earlier: [] };
}
/** The next edition after `current`: same group, a new number, no ISBNs yet (a new edition needs new ones). */
export function nextEdition(current, year = String(new Date().getFullYear())) {
    const number = current.number + 1;
    return {
        group: current.group,
        number,
        name: editionName(number),
        year,
        note: "",
        isbns: {},
        earlier: [...current.earlier, { name: current.name, year: current.year }],
    };
}
/** "978-1-..." without its "ISBN" prefix. */
export const bareIsbn = (isbn) => isbn.trim().replace(/^isbn[:\s-]*/i, "");
/** The ISBN lines on the copyright page: one per format, named, like "ISBN 978-… (paperback)". */
export function isbnLines(edition) {
    if (!edition)
        return [];
    return EDITION_FORMATS.filter((f) => edition.isbns[f.id]?.trim()).map((f) => `ISBN ${bareIsbn(edition.isbns[f.id])} (${f.label.toLowerCase()})`);
}
/** The edition's own line, like "Second edition, 2027. Revised and expanded." */
export function editionLine(edition) {
    const name = edition.name.trim() || editionName(edition.number);
    return `${name}${edition.year.trim() ? `, ${edition.year.trim()}` : ""}${edition.note.trim() ? `. ${edition.note.trim().replace(/\.$/, "")}.` : ""}`;
}
/** The earlier editions, oldest first, like "First edition, 2025". */
export function historyLines(edition) {
    if (!edition)
        return [];
    return edition.earlier.map((e) => [e.name.trim(), e.year.trim()].filter(Boolean).join(", "));
}
/** The ISBN to name inside an EPUB: the ebook's. */
export function ebookIsbn(edition) {
    const isbn = edition?.isbns.ebook?.trim();
    return isbn ? bareIsbn(isbn) : null;
}
/** The editions of one book among `projects`, in order, given each one's export settings. */
export function editionsOf(group, projects, editionFor) {
    return projects
        .map((p) => ({ ...p, edition: editionFor(p) }))
        .filter((p) => p.edition?.group === group)
        .sort((a, b) => a.edition.number - b.edition.number);
}
/** The edition a book's settings name, or a first edition made from its old Edition and Year boxes. */
export function editionOrFirst(settings, fallbackYear) {
    return settings.edition ?? { ...firstEdition(settings.copyright.year.trim() || fallbackYear), name: settings.copyright.edition.trim() || editionName(1) };
}
