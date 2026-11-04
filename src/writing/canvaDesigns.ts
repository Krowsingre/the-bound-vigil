// Canva designs kept with a book (embre, 3 November 2026): each one by what
// it's for (the ebook cover, the paperback cover, the printed pages, a
// picture), so "Design in Canva" opens the same design again. Kept in the
// book's export settings, so they sync with the book.

export type CanvaFor = "cover" | "paperback" | "interior" | `picture:${string}`;

export interface CanvaDesignRecord {
  id: string;
  /** When it was made. */
  made: string;
  /** For the printed pages: a fingerprint of the book's words when they went to Canva, to warn when they change after. */
  stamp?: string;
  /** For the printed pages: how many pages Canva's PDF came back with. */
  pages?: number;
}

export type CanvaDesigns = Partial<Record<CanvaFor, CanvaDesignRecord>>;

export function readCanva(saved: unknown): CanvaDesigns {
  if (!saved || typeof saved !== "object") return {};
  const out: CanvaDesigns = {};
  for (const [key, value] of Object.entries(saved as Record<string, unknown>).slice(0, 200)) {
    if (!/^(cover|paperback|interior|picture:[\w-]{1,80})$/.test(key) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (typeof v.id !== "string" || !/^[\w-]{1,80}$/.test(v.id)) continue;
    out[key as CanvaFor] = {
      id: v.id,
      made: typeof v.made === "string" ? v.made.slice(0, 40) : "",
      ...(typeof v.stamp === "string" ? { stamp: v.stamp.slice(0, 80) } : {}),
      ...(typeof v.pages === "number" && Number.isFinite(v.pages) ? { pages: Math.max(0, Math.floor(v.pages)) } : {}),
    };
  }
  return out;
}

/** A short fingerprint of the book's words (not its styles), to notice when they change. */
export async function wordsStamp(bodies: string[]): Promise<string> {
  const text = bodies.map((b) => b.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).join("\n");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
