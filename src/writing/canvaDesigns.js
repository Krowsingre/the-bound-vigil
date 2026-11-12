// Canva designs kept with a book (embre, 3 November 2026): each one by what
// it's for (the ebook cover, the paperback cover, the printed pages, a
// picture), so "Design in Canva" opens the same design again. Kept in the
// book's export settings, so they sync with the book.
export function readCanva(saved) {
    if (!saved || typeof saved !== "object")
        return {};
    const out = {};
    for (const [key, value] of Object.entries(saved).slice(0, 200)) {
        if (!/^(cover|paperback|interior|picture:[\w-]{1,80})$/.test(key) || !value || typeof value !== "object")
            continue;
        const v = value;
        if (typeof v.id !== "string" || !/^[\w-]{1,80}$/.test(v.id))
            continue;
        out[key] = {
            id: v.id,
            made: typeof v.made === "string" ? v.made.slice(0, 40) : "",
            ...(typeof v.stamp === "string" ? { stamp: v.stamp.slice(0, 80) } : {}),
            ...(typeof v.pages === "number" && Number.isFinite(v.pages) ? { pages: Math.max(0, Math.floor(v.pages)) } : {}),
        };
    }
    return out;
}
/** A short fingerprint of the book's words (not its styles), to notice when they change. */
export async function wordsStamp(bodies) {
    const text = bodies.map((b) => b.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).join("\n");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(hash)]
        .slice(0, 12)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
