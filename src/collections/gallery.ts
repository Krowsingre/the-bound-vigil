// The TBV picture gallery for collections: 25 paintings, each in a wide
// shape (for banners and cards) and a square one (for tiles). They ship
// inside TBV, so every device shows the same picture for the same name.

export interface GalleryPicture {
  name: string;
  label: string;
}

export type GalleryShape = "wide" | "square";

const NAMES = [
  "aurelian-castle",
  "moonlit-towers",
  "blush-botanical",
  "silent-library",
  "coastal-ruins",
  "twilight-sanctuary",
  "snowbound-peaks",
  "citadel-beneath-the-planet",
  "classical-coastal-ruins",
  "celestial-astrolabe",
  "lantern-ruins",
  "stormbound-harbor",
  "vintage-herbarium",
  "alien-desert",
  "golden-marble-terrace",
  "forest-shrine",
  "winter-valley",
  "golden-marble-city",
  "colossal-planet",
  "waterfall-citadel",
  "ancient-halls",
  "twin-moons",
  "quiet-blossoms",
  "celestial-cartography",
  "stormlight-beacon",
];

const SMALL_WORDS = new Set(["the", "of", "and"]);

export const GALLERY: GalleryPicture[] = NAMES.map((name) => ({
  name,
  label: name
    .split("-")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" "),
}));

/** Placeholder scenes from before the paintings arrived, and the painting
 *  that now stands in for each, so a collection that chose one keeps a picture. */
const RENAMED: Record<string, string> = {
  archive: "silent-library",
  peaks: "snowbound-peaks",
  forest: "forest-shrine",
  coast: "coastal-ruins",
  colonnade: "golden-marble-terrace",
  night: "moonlit-towers",
  harbour: "stormbound-harbor",
  moor: "winter-valley",
  garden: "blush-botanical",
  tower: "stormlight-beacon",
};

const FILES = import.meta.glob<string>("../assets/gallery/*.webp", { eager: true, query: "?url", import: "default" });

/** The address of a gallery picture, or null for a name TBV doesn't know. */
export function galleryUrl(name: string, shape: GalleryShape = "wide"): string | null {
  const real = RENAMED[name] ?? name;
  return FILES[`../assets/gallery/${real}-${shape}.webp`] ?? null;
}

/** The name a saved choice stands for now (old placeholder names move on). */
export function galleryName(name: string): string {
  return RENAMED[name] ?? name;
}
