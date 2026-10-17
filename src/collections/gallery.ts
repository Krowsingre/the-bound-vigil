// The TBV picture gallery for collections. The painted gallery images are
// still to come, so each entry draws a quiet placeholder scene for now.
// When the real images arrive, each entry gets a `src` and the placeholder
// is no longer used; the names stay the same, so saved choices keep working.

export interface GalleryPicture {
  name: string;
  label: string;
  /** The real image, once it ships. */
  src?: string;
}

export const GALLERY: GalleryPicture[] = [
  { name: "archive", label: "Archive" },
  { name: "peaks", label: "Peaks" },
  { name: "forest", label: "Forest" },
  { name: "coast", label: "Coast" },
  { name: "colonnade", label: "Colonnade" },
  { name: "night", label: "Night towers" },
  { name: "harbour", label: "Harbour" },
  { name: "moor", label: "Moor" },
  { name: "garden", label: "Garden" },
  { name: "tower", label: "Tower" },
];

/** A small repeatable random sequence, so a scene looks the same every time. */
function seeded(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const W = 320;
const H = 200;

function ridge(rand: () => number, base: number, rough: number, fill: string, steps = 9): string {
  const pts: string[] = [`0,${H}`];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W;
    const y = base - rand() * rough;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  pts.push(`${W},${H}`);
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
}

function peaks(rand: () => number, base: number, fill: string, count: number): string {
  const pts: string[] = [`0,${H}`, `0,${base}`];
  let x = 0;
  for (let i = 0; i < count; i++) {
    const w = W / count;
    const peak = base - 40 - rand() * 60;
    pts.push(`${(x + w * (0.3 + rand() * 0.4)).toFixed(1)},${peak.toFixed(1)}`);
    x += w;
    pts.push(`${x.toFixed(1)},${(base - rand() * 15).toFixed(1)}`);
  }
  pts.push(`${W},${H}`);
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
}

function trees(rand: () => number, base: number, fill: string, count: number, height: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = rand() * W;
    const h = height * (0.6 + rand() * 0.6);
    const w = h * 0.28;
    out += `<polygon points="${x - w},${base} ${x},${base - h} ${x + w},${base}" fill="${fill}"/>`;
  }
  return out + `<rect x="0" y="${base}" width="${W}" height="${H - base}" fill="${fill}"/>`;
}

function arches(fill: string, light: string): string {
  let out = `<rect width="${W}" height="${H}" fill="${fill}"/>`;
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 100;
    out += `<path d="M${x} ${H}V90a40 40 0 0 1 80 0V${H}z" fill="${light}" opacity="${0.55 - i * 0.12}"/>`;
  }
  return out;
}

function columns(fill: string, light: string): string {
  let out = `<rect width="${W}" height="${H}" fill="${light}"/>`;
  for (let i = 0; i < 6; i++) out += `<rect x="${14 + i * 54}" y="40" width="16" height="${H - 40}" fill="${fill}"/>`;
  return out + `<rect x="0" y="28" width="${W}" height="16" fill="${fill}"/>`;
}

function towers(rand: () => number, base: number, fill: string): string {
  let out = "";
  for (let i = 0; i < 7; i++) {
    const x = 20 + i * 44 + rand() * 10;
    const h = 40 + rand() * 80;
    out += `<rect x="${x}" y="${base - h}" width="14" height="${h}" fill="${fill}"/><polygon points="${x - 3},${base - h} ${x + 7},${base - h - 22} ${x + 17},${base - h}" fill="${fill}"/>`;
  }
  return out + `<rect x="0" y="${base}" width="${W}" height="${H - base}" fill="${fill}"/>`;
}

function blooms(rand: () => number, fill: string): string {
  let out = "";
  for (let i = 0; i < 9; i++) {
    const x = rand() * W;
    const y = 40 + rand() * 120;
    const r = 6 + rand() * 10;
    out += `<path d="M${x} ${H} Q${x - 20 + rand() * 40} ${(y + H) / 2} ${x} ${y}" stroke="${fill}" stroke-width="1.5" fill="none"/>`;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      out += `<circle cx="${(x + Math.cos(a) * r).toFixed(1)}" cy="${(y + Math.sin(a) * r).toFixed(1)}" r="${(r * 0.6).toFixed(1)}" fill="${fill}" opacity=".55"/>`;
    }
  }
  return out;
}

function scene(name: string): string {
  const rand = seeded(name);
  const sky = (top: string, bottom: string) =>
    `<defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><linearGradient id="f" x2="0" y2="1"><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#d5d1ca" stop-opacity=".35"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#s)"/>`;
  const mist = `<rect width="${W}" height="${H}" fill="url(#f)"/>`;
  switch (name) {
    case "peaks":
      return sky("#8f969c", "#d9d6d0") + peaks(rand, 150, "#6b7177", 4) + peaks(rand, 175, "#3f454b", 5) + mist + ridge(rand, 190, 12, "#23272b");
    case "forest":
      return sky("#4a5157", "#9aa0a4") + trees(rand, 160, "#3a4045", 26, 70) + mist + trees(rand, 185, "#1a1c1e", 14, 110);
    case "coast":
      return (
        sky("#7d868d", "#cfccc5") +
        `<rect y="140" width="${W}" height="60" fill="#5e6368"/>` +
        `<polygon points="200,${H} 215,90 250,70 290,85 ${W},80 ${W},${H}" fill="#2f3439"/>` +
        mist
      );
    case "archive":
      return arches("#2a2724", "#c9b89b");
    case "colonnade":
      return sky("#bdb7ad", "#e6e3de") + columns("#5a5652", "#d8d2c8");
    case "night":
      return sky("#121416", "#3d444b") + `<circle cx="250" cy="55" r="22" fill="#e6e3de" opacity=".85"/>` + towers(rand, 170, "#0d0f10") + mist;
    case "harbour":
      return (
        sky("#59626a", "#b8bcbd") +
        `<rect y="130" width="${W}" height="70" fill="#3e464d"/>` +
        `<rect x="60" y="80" width="4" height="60" fill="#1a1c1e"/><circle cx="62" cy="78" r="7" fill="#e8c88a" opacity=".9"/>` +
        ridge(rand, 135, 10, "#2a3036") +
        mist
      );
    case "moor":
      return sky("#8a8f93", "#cbc7bf") + ridge(rand, 130, 25, "#7a7c74", 5) + ridge(rand, 160, 20, "#55584f", 6) + ridge(rand, 185, 15, "#30332e", 7) + mist;
    case "garden":
      return sky("#e6e3de", "#d5d1ca") + blooms(rand, "#6b4a4a");
    case "tower":
      return (
        sky("#a2a5a6", "#dedad3") +
        peaks(rand, 170, "#7e8387", 3) +
        `<rect x="140" y="50" width="40" height="150" fill="#2b2f33"/><polygon points="134,50 160,8 186,50" fill="#2b2f33"/>` +
        mist +
        ridge(rand, 188, 10, "#1a1c1e")
      );
    default:
      return sky("#5e6368", "#d5d1ca") + ridge(rand, 160, 30, "#2f3a44");
  }
}

const cache = new Map<string, string>();

/** The address of a gallery picture: the real image once it ships, else its placeholder. */
export function galleryUrl(name: string): string {
  const real = GALLERY.find((g) => g.name === name)?.src;
  if (real) return real;
  let url = cache.get(name);
  if (!url) {
    url =
      "data:image/svg+xml," +
      encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${scene(name)}</svg>`);
    cache.set(name, url);
  }
  return url;
}
