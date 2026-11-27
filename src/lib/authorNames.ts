// How authors' names are shown (embre, 19 November): as the book gives them,
// as "First Last", or as "Last, First". Searching finds either order, and
// both spellings of a name count as one author. The same rules are in
// crates/tbv-core/src/people.rs.

export type AuthorStyle = "asBook" | "firstLast" | "lastFirst";

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "ph.d.", "md", "m.d."]);
const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "di", "da", "du", "la", "le", "st", "st.", "dos", "das", "ten", "ter", "bin", "al"]);

const isSuffix = (word: string) => SUFFIXES.has(word.trim().toLowerCase());

/** "Primo, Jaz" → "Jaz Primo". A name with no comma is kept as it is. */
export function firstLast(name: string): string {
  const parts = name.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2 && !isSuffix(parts[1])) return `${parts[1]} ${parts[0]}`;
  if (parts.length === 3 && isSuffix(parts[2])) return `${parts[1]} ${parts[0]} ${parts[2]}`;
  return name.trim();
}

/** "Jaz Primo" → "Primo, Jaz"; "Ursula K. Le Guin" → "Le Guin, Ursula K.". One word, a comma already, or "The …" is kept. */
export function lastFirst(name: string): string {
  const trimmed = name.trim();
  if (trimmed.includes(",")) return trimmed;
  const words = trimmed.split(/\s+/).filter(Boolean);
  const suffix = words.length > 2 && isSuffix(words[words.length - 1]) ? words.pop() : undefined;
  if (words.length < 2 || words[0].toLowerCase() === "the") return trimmed;
  let at = words.length - 1;
  while (at > 1 && PARTICLES.has(words[at - 1].toLowerCase())) at--;
  return `${words.slice(at).join(" ")}, ${words.slice(0, at).join(" ")}${suffix ? `, ${suffix}` : ""}`;
}

/** One key for a person however the name is written, for counting and matching. */
export function personKey(name: string): string {
  return firstLast(name).toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();
}

let style: AuthorStyle = "asBook";

/** Set from Attune; shown names follow it from the next draw. */
export function setAuthorStyle(next: AuthorStyle) {
  style = next;
}

export function authorStyle(): AuthorStyle {
  return style;
}

/**
 * A name as Attune asks for it. Music keeps names as they are: an
 * artist is often a band, and "Choir, Ash" would be wrong.
 */
export function authorName(name: string, audioType?: string | null): string {
  if (style === "asBook" || audioType === "music") return name;
  return style === "firstLast" ? firstLast(name) : lastFirst(name);
}
