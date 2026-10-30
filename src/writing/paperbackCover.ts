// A paperback's full cover: back, spine and front in one picture, with bleed
// on every side, sized for the printer from the trim size, the page count
// and the paper. Saved as a PDF at the exact size KDP and IngramSpark ask
// for. The spine's width follows each printer's published paper thickness.

import { BACKGROUNDS, drawCover, type CoverDesign } from "./CoverMaker";
import { TRIMS, type TrimSize } from "./printSettings";

export type Printer = "kdp" | "ingram";
export type Paper = "white" | "cream" | "colour" | "premium";

/** Inches of spine per page, by printer and paper. */
const THICKNESS: Record<Printer, Partial<Record<Paper, number>>> = {
  // KDP's cover calculator.
  kdp: { white: 0.002252, cream: 0.0025, colour: 0.002252, premium: 0.002347 },
  // IngramSpark's 50 lb white and creme, close to its own template's spine.
  ingram: { white: 1 / 444, cream: 1 / 426, colour: 1 / 444 },
};

export const PAPERS: { value: Paper; label: string; printers: Printer[] }[] = [
  { value: "cream", label: "Cream", printers: ["kdp", "ingram"] },
  { value: "white", label: "White", printers: ["kdp", "ingram"] },
  { value: "colour", label: "Colour, standard", printers: ["kdp", "ingram"] },
  { value: "premium", label: "Colour, premium", printers: ["kdp"] },
];

export const BLEED = 0.125;
/** Words stay this far inside the trimmed edge. */
export const SAFE = 0.25;
/** KDP prints words on the spine only from this many pages. */
export const SPINE_TEXT_PAGES = 80;
/** The barcode's space on the back, bottom corner by the spine. */
export const BARCODE = { width: 2, height: 1.2 };

export function spineWidth(pages: number, printer: Printer, paper: Paper): number {
  const per = THICKNESS[printer][paper] ?? THICKNESS[printer].white!;
  return Math.max(0, pages) * per;
}

export interface Wrap {
  trim: { width: number; height: number };
  spine: number;
  /** Whether the spine is wide enough for words. */
  spineText: boolean;
  /** The whole cover, bleed included, in inches. */
  width: number;
  height: number;
  /** Where each part starts from the left edge, in inches (bleed included). */
  backX: number;
  spineX: number;
  frontX: number;
}

export function wrapFor(trim: TrimSize, pages: number, printer: Printer, paper: Paper): Wrap {
  const t = TRIMS.find((x) => x.value === trim) ?? TRIMS[3];
  const spine = spineWidth(pages, printer, paper);
  return {
    trim: { width: t.width, height: t.height },
    spine,
    spineText: pages >= SPINE_TEXT_PAGES,
    width: BLEED + t.width + spine + t.width + BLEED,
    height: BLEED + t.height + BLEED,
    backX: BLEED,
    spineX: BLEED + t.width,
    frontX: BLEED + t.width + spine,
  };
}

/** Printers ask for 300 dots an inch; a phone can only draw so many, so very large covers drop a little. */
export function dpiFor(wrap: Wrap, most = 16_000_000): number {
  return Math.min(300, Math.floor(Math.sqrt(most / (wrap.width * wrap.height))));
}

export interface PaperbackDesign {
  title: string;
  author: string;
  /** Background colour for the back and spine (and the front, when designed here). */
  background: number;
  font: CoverDesign["font"];
  /** The book's own cover picture for the front, or null to letter the front here. */
  front: string | null;
  /** A picture behind the lettered front, when there's no cover picture. */
  frontPicture: string | null;
  blurb: string;
  bio: string;
  /** The author's photo, as an object URL. */
  photo: string | null;
  barcodeBox: boolean;
}

const load = async (src: string) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
};

/** Breaks text into lines no wider than `width`, keeping its own line breaks. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Draws the whole cover. With `guides`, the trim, safe area and spine show as lines (never in the saved file). */
export async function drawWrap(canvas: HTMLCanvasElement, design: PaperbackDesign, wrap: Wrap, dpi: number, guides: boolean): Promise<{ frontDpi: number | null }> {
  const px = (inches: number) => Math.round(inches * dpi);
  canvas.width = px(wrap.width);
  canvas.height = px(wrap.height);
  const ctx = canvas.getContext("2d")!;
  const bg = BACKGROUNDS[design.background] ?? BACKGROUNDS[0];
  const ink = bg.light ? "#f5f1ea" : "#1c1f24";
  const family = design.font === "sans-serif" ? "system-ui, sans-serif" : `"${design.font}", Georgia, serif`;
  await document.fonts?.load(`600 40px ${family}`).catch(() => undefined);

  // Back and spine: the colour, top to bottom.
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, bg.top);
  gradient.addColorStop(1, bg.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Front: the cover picture, filling its panel (and the bleed beyond it), or lettered here.
  const frontX = px(wrap.frontX);
  const frontW = canvas.width - frontX;
  let frontDpi: number | null = null;
  if (design.front) {
    const img = await load(design.front).catch(() => null);
    if (img?.naturalWidth) {
      const fit = Math.max(frontW / img.naturalWidth, canvas.height / img.naturalHeight);
      const w = img.naturalWidth * fit;
      const h = img.naturalHeight * fit;
      ctx.drawImage(img, frontX + (frontW - w) / 2, (canvas.height - h) / 2, w, h);
      frontDpi = Math.round(dpi / fit);
    }
  } else {
    const front = document.createElement("canvas");
    await drawCover(front, { title: design.title, author: design.author, background: design.background, picture: design.frontPicture, font: design.font, layout: "middle" }, { width: frontW, height: canvas.height });
    ctx.drawImage(front, frontX, 0);
  }

  // Spine: title down from the top, author at the foot, as English-language books read.
  const spineW = px(wrap.spine);
  const spineX = px(wrap.spineX);
  if (wrap.spineText) {
    const room = spineW - px(0.0625) * 2;
    const size = Math.max(8, Math.min(room * 0.62, px(0.3)));
    ctx.save();
    ctx.translate(spineX + spineW / 2, px(BLEED + SAFE));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = ink;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const length = px(wrap.trim.height - SAFE * 2);
    const author = design.author.trim().toUpperCase();
    ctx.font = `400 ${Math.round(size * 0.78)}px ${family}`;
    const authorW = author ? ctx.measureText(author).width : 0;
    ctx.font = `600 ${Math.round(size)}px ${family}`;
    ctx.fillText(design.title.trim() || "Untitled", 0, 0, Math.max(10, length - authorW - px(0.4)));
    if (author) {
      ctx.textAlign = "right";
      ctx.font = `400 ${Math.round(size * 0.78)}px ${family}`;
      ctx.fillText(author, length, 0);
    }
    ctx.restore();
  }

  // Back: the blurb at the top, the author's photo and a few words about them below it, the barcode's space at the foot.
  const backLeft = px(wrap.backX + SAFE + 0.15);
  const backRight = px(wrap.spineX - SAFE - 0.15);
  const backWidth = backRight - backLeft;
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const body = px(11 / 72);
  ctx.font = `400 ${body}px ${family}`;
  let y = px(BLEED + SAFE + 0.35);
  for (const line of wrapText(ctx, design.blurb.trim(), backWidth)) {
    y += body * 1.45;
    if (line) ctx.fillText(line, backLeft, y);
  }

  const barcodeTop = px(BLEED + wrap.trim.height - SAFE - BARCODE.height);
  const photoSize = px(1.1);
  const aboutTop = barcodeTop - px(0.35) - photoSize;
  let textLeft = backLeft;
  if (design.photo) {
    const img = await load(design.photo).catch(() => null);
    if (img?.naturalWidth) {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, backLeft, aboutTop, photoSize, photoSize);
      textLeft = backLeft + photoSize + px(0.2);
    }
  }
  if (design.bio.trim()) {
    const small = px(9 / 72);
    ctx.font = `400 ${small}px ${family}`;
    let by = aboutTop;
    for (const line of wrapText(ctx, design.bio.trim(), backRight - textLeft).slice(0, 7)) {
      by += small * 1.4;
      if (line) ctx.fillText(line, textLeft, by);
    }
  }

  if (design.barcodeBox) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px(wrap.spineX - SAFE - BARCODE.width), barcodeTop, px(BARCODE.width), px(BARCODE.height));
  }

  if (guides) {
    ctx.save();
    ctx.lineWidth = Math.max(2, dpi / 60);
    ctx.setLineDash([dpi / 10, dpi / 14]);
    const line = (colour: string, x: number, yy: number, w: number, h: number) => {
      ctx.strokeStyle = colour;
      ctx.strokeRect(px(x), px(yy), px(w), px(h));
    };
    // Where it's trimmed.
    line("rgba(255,64,64,0.95)", BLEED, BLEED, wrap.width - BLEED * 2, wrap.height - BLEED * 2);
    // The spine's folds.
    line("rgba(64,160,255,0.95)", wrap.spineX, BLEED, wrap.spine, wrap.trim.height);
    // Where words are safe.
    line("rgba(80,200,120,0.95)", wrap.backX + SAFE, BLEED + SAFE, wrap.trim.width - SAFE * 2, wrap.trim.height - SAFE * 2);
    line("rgba(80,200,120,0.95)", wrap.frontX + SAFE, BLEED + SAFE, wrap.trim.width - SAFE * 2, wrap.trim.height - SAFE * 2);
    ctx.restore();
    if (design.barcodeBox) {
      ctx.fillStyle = "#8a8f96";
      ctx.font = `500 ${px(0.14)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Barcode", px(wrap.spineX - SAFE - BARCODE.width / 2), barcodeTop + px(BARCODE.height / 2 + 0.05));
    }
  }
  return { frontDpi };
}

/** A one-page PDF holding a JPEG at an exact size in inches. */
export function jpegPdf(jpeg: Uint8Array, pixels: { width: number; height: number }, inches: { width: number; height: number }): Uint8Array {
  const w = (inches.width * 72).toFixed(3);
  const h = (inches.height * 72).toFixed(3);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Cover Do Q`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, head: string, stream?: Uint8Array | string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${head}\n`);
    if (stream !== undefined) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /TrimBox [${(BLEED * 72).toFixed(3)} ${(BLEED * 72).toFixed(3)} ${(inches.width * 72 - BLEED * 72).toFixed(3)} ${(inches.height * 72 - BLEED * 72).toFixed(3)}] /Resources << /XObject << /Cover 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${pixels.width} /Height ${pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  object(5, `<< /Length ${enc.encode(content).length} >>`, content);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
