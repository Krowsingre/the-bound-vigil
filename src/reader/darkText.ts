// Books often colour their own text, usually black or a dark grey, and on a
// dark page that text all but disappears. When the page is dark, each piece
// of text in the book is checked: colourless dark text (black, greys) takes
// the page's text colour, and real colours (a red heading, a blue aside) are
// kept, lightened only as far as they need to be readable.

type Rgb = [number, number, number];

/** Reads the `rgb(…)` / `rgba(…)` strings getComputedStyle gives back. */
export function parseRgb(css: string): { rgb: Rgb; alpha: number } | null {
  const m = css.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { rgb: [+m[1], +m[2], +m[3]], alpha };
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** Relative luminance, as WCAG defines it. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** How colourful a colour is, from 0 (grey) to 1 (fully saturated). */
export function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Text this faint on the page is hard to read (WCAG's 4.5:1 for body text). */
const READABLE = 4.5;

/**
 * The colour a piece of text should have on a dark page, or null to leave it
 * as the book has it.
 */
export function darkPageColor(text: Rgb, page: Rgb, pageText: Rgb): Rgb | null {
  if (contrast(text, page) >= READABLE) return null;
  if (saturation(text) < 0.25) return pageText;
  // A real colour: mix it towards white until it reads, keeping its hue.
  for (let mix = 0.1; mix <= 1.001; mix += 0.1) {
    const lighter = text.map((c) => Math.round(c + (255 - c) * mix)) as Rgb;
    if (contrast(lighter, page) >= READABLE) return lighter;
  }
  return pageText;
}

const MARK = "data-tbv-color";
const TEXT_TAGS = new Set(["SCRIPT", "STYLE", "svg", "IMG", "VIDEO", "AUDIO", "CANVAS", "IMAGE"]);

/**
 * Recolours text in one section of the book. Elements TBV recoloured before
 * get the book's own colour back first, so changing the page colour (to
 * light, say) undoes it.
 */
export function fitTextToPage(doc: Document, colors: { background: string; text: string }, dark: boolean) {
  for (const el of doc.querySelectorAll<HTMLElement>(`[${MARK}]`)) {
    const original = el.getAttribute(MARK) ?? "";
    if (original) el.style.setProperty("color", original);
    else el.style.removeProperty("color");
    el.removeAttribute(MARK);
  }
  if (!dark || !doc.body) return;
  const win = doc.defaultView;
  if (!win) return;
  const page = hexToRgb(colors.background);
  const pageText = hexToRgb(colors.text);
  const changes: [HTMLElement, string][] = [];
  for (const el of doc.body.querySelectorAll<HTMLElement>("*")) {
    if (TEXT_TAGS.has(el.tagName) || !el.style) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
    if (!hasText) continue;
    const parsed = parseRgb(win.getComputedStyle(el).color);
    if (!parsed || parsed.alpha === 0) continue;
    const fitted = darkPageColor(parsed.rgb, page, pageText);
    if (fitted) changes.push([el, `rgb(${fitted.join(" ")})`]);
  }
  // Read every colour first, then write, so one change can't skew the next read.
  for (const [el, color] of changes) {
    el.setAttribute(MARK, el.style.getPropertyValue("color"));
    el.style.setProperty("color", color, "important");
  }
}
