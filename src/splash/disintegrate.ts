// The splash breaking up: a line sweeps across it on a slant (a different
// way each time TBV opens), and behind the line the picture breaks into
// little book pages (embre, 20 November), each with a folded corner, that
// fall away with weight (embre, 18 November): each one is nudged off the
// way the line goes, then gravity takes it, so it hangs a moment and
// gathers speed as it drops, swaying and turning over like a loose page
// (its pale back showing as it turns), fading only near the end. TBV shows underneath. The splash is drawn onto a canvas first (from where its parts
// sit on the page), then the canvas is broken up. On the iPhone it fills the
// screen; on a computer it's the card, and the pages
// fall only inside the card's edges. The drawing must match the splash exactly (the
// painting at its current zoom, each letter on its own baseline), or the
// picture visibly shifts just before it breaks up.

import emblem from "../assets/emblem.svg?raw";
import { paintings } from "./splashView";

/** How long the line takes to cross, and each piece to fall (ms). */
const SWEEP = 700;
const LIFE = 1_000;
/** A page's size, in points: taller than wide, like a book's. */
const PAGE_W = 11;
const PAGE_H = 15;
/** The folded corner, in points. */
const FOLD = 3.5;
/** The back of a page, as it turns over. */
const PAPER = "rgba(232, 226, 212, 0.92)";
/** The pull downwards, in points a second squared, and the first nudge along the sweep (points a second). */
const GRAVITY = 1_500;
const NUDGE = 45;

export async function disintegrate(splash: HTMLElement): Promise<void> {
  const box = splash.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const picture = document.createElement("canvas");
  picture.width = Math.round(box.width * dpr);
  picture.height = Math.round(box.height * dpr);
  const pen = picture.getContext("2d");
  // No canvas to draw on: give up, and the splash is simply removed (startup.ts).
  if (!pen) throw new Error("no canvas");
  pen.scale(dpr, dpr);
  await draw(pen, splash, box);

  // The pages fall inside the splash's own edges and rounded corners, as if seen
  // through a window that stays put: whatever crosses them is cut off (embre,
  // 27 November). The window itself is left as it is.
  const round = parseFloat(getComputedStyle(splash).borderTopLeftRadius) || 0;
  const room = { w: window.innerWidth, h: window.innerHeight };
  const ox = box.left * dpr;
  const oy = box.top * dpr;
  const dust = document.createElement("canvas");
  dust.className = "splash-dust";
  dust.width = Math.round(room.w * dpr);
  dust.height = Math.round(room.h * dpr);
  dust.style.width = `${room.w}px`;
  dust.style.height = `${room.h}px`;
  const out = dust.getContext("2d");
  if (!out) throw new Error("no canvas");
  document.body.appendChild(dust);
  out.drawImage(picture, ox, oy);
  splash.remove();

  const cols = Math.ceil(box.width / PAGE_W);
  const rows = Math.ceil(box.height / PAGE_H);
  const pages = cutPages(picture, cols, rows, dpr);
  const back = paperBack(dpr);
  const way = sweepWay(Math.random() * Math.PI * 2);
  const specks: { x: number; y: number; start: number; vx: number; vy: number; spin: number; turn: number; sway: number; swing: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Where the line reaches first goes first; each piece is nudged the way it's going, then falls.
      const speed = NUDGE * (0.5 + Math.random());
      const aside = (Math.random() - 0.5) * 30;
      specks.push({
        x: c * PAGE_W,
        y: r * PAGE_H,
        start: way.along(c / cols, r / rows) * SWEEP + Math.random() * 90,
        vx: way.dx * speed - way.dy * aside,
        vy: way.dy * speed + way.dx * aside - 20 * Math.random(),
        spin: (Math.random() - 0.5) * 0.9,
        // Turns over once or twice as it falls, swaying side to side.
        turn: Math.PI * 2 * (0.6 + Math.random() * 0.9) * (Math.random() < 0.5 ? -1 : 1),
        sway: 5 + Math.random() * 9,
        swing: 1.2 + Math.random() * 1.4,
      });
    }
  }
  const w = PAGE_W * dpr;
  const h = PAGE_H * dpr;
  await new Promise<void>((done) => {
    const began = performance.now();
    const frame = (now: number) => {
      const t = now - began;
      out.setTransform(1, 0, 0, 1, 0, 0);
      out.clearRect(0, 0, dust.width, dust.height);
      out.save();
      out.beginPath();
      out.roundRect(ox, oy, box.width * dpr, box.height * dpr, round * dpr);
      out.clip();
      let left = 0;
      for (const p of specks) {
        const age = (t - p.start) / LIFE;
        if (age >= 1) continue;
        left++;
        if (age <= 0) {
          out.globalAlpha = 1;
          out.setTransform(1, 0, 0, 1, 0, 0);
          out.drawImage(picture, p.x * dpr, p.y * dpr, w, h, ox + p.x * dpr, oy + p.y * dpr, w, h);
          continue;
        }
        const seconds = (age * LIFE) / 1000;
        const { dx: fallX, dy } = fall(p.vx, p.vy, seconds);
        const dx = fallX + Math.sin(seconds * p.swing * Math.PI * 2) * p.sway * Math.min(1, age * 3);
        const x = ox + (p.x + dx) * dpr;
        const y = oy + (p.y + dy) * dpr;
        const size = 1 - age * 0.2;
        out.globalAlpha = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
        const over = Math.cos(p.turn * age);
        out.setTransform(size, 0, 0, size, x + w / 2, y + h / 2);
        out.rotate(p.spin * age);
        out.scale(Math.max(Math.abs(over), 0.08), 1);
        if (over >= 0) out.drawImage(pages, p.x * dpr, p.y * dpr, w, h, -w / 2, -h / 2, w, h);
        else out.drawImage(back, -w / 2, -h / 2, w, h);
      }
      out.restore();
      if (left > 0 && t < SWEEP + LIFE + 200) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
  dust.remove();
}

/** A page's outline at (x, y), its top right corner folded over. */
export function pageOutline(pen: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fold: number) {
  pen.beginPath();
  pen.moveTo(x, y);
  pen.lineTo(x + w - fold, y);
  pen.lineTo(x + w, y + fold);
  pen.lineTo(x + w, y + h);
  pen.lineTo(x, y + h);
  pen.closePath();
}

/** The picture cut into pages, each with its corner folded: the fold shows paler, as the page's back. */
function cutPages(picture: HTMLCanvasElement, cols: number, rows: number, dpr: number): HTMLCanvasElement {
  const pages = document.createElement("canvas");
  pages.width = picture.width;
  pages.height = picture.height;
  const pen = pages.getContext("2d");
  if (!pen) return picture;
  const w = PAGE_W * dpr;
  const h = PAGE_H * dpr;
  const f = FOLD * dpr;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * w;
      const y = r * h;
      pen.save();
      pageOutline(pen, x, y, w, h, f);
      pen.clip();
      pen.drawImage(picture, x, y, w, h, x, y, w, h);
      pen.restore();
      pen.fillStyle = PAPER;
      pen.beginPath();
      pen.moveTo(x + w - f, y);
      pen.lineTo(x + w - f, y + f);
      pen.lineTo(x + w, y + f);
      pen.closePath();
      pen.fill();
    }
  }
  return pages;
}

/** A page's pale back, for when it turns over. */
function paperBack(dpr: number): HTMLCanvasElement {
  const back = document.createElement("canvas");
  back.width = Math.ceil(PAGE_W * dpr);
  back.height = Math.ceil(PAGE_H * dpr);
  const pen = back.getContext("2d");
  if (!pen) return back;
  pageOutline(pen, 0, 0, PAGE_W * dpr, PAGE_H * dpr, FOLD * dpr);
  pen.fillStyle = PAPER;
  pen.fill();
  // A few faint lines of print.
  pen.fillStyle = "rgba(60, 56, 50, 0.35)";
  for (let line = 3; line < PAGE_H - 2; line += 2.5) pen.fillRect(2 * dpr, line * dpr, (PAGE_W - 4) * dpr, 0.6 * dpr);
  return back;
}

/** How far a piece has gone after `seconds`, nudged at (vx, vy) and pulled down by gravity. */
export function fall(vx: number, vy: number, seconds: number): { dx: number; dy: number } {
  return { dx: vx * seconds, dy: vy * seconds + (GRAVITY * seconds * seconds) / 2 };
}

/**
 * The way the line sweeps, at an angle (radians, 0 = rightwards, downwards
 * positive): `along` says how far through the sweep a point is, from 0 where
 * the line starts to 1 where it ends, for points given as 0..1 across and down.
 */
export function sweepWay(angle: number): { dx: number; dy: number; along: (x: number, y: number) => number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // The corners' reach along the way, so the first corner is 0 and the last is 1.
  const reach = [0, dx, dy, dx + dy];
  const low = Math.min(...reach);
  const span = Math.max(...reach) - low || 1;
  return { dx, dy, along: (x, y) => (x * dx + y * dy - low) / span };
}

/** Draws the splash as it looks now: painting, veil, emblem, words, divider and bar. */
async function draw(pen: CanvasRenderingContext2D, splash: HTMLElement, box: DOMRect) {
  // The card's rounded corners.
  const round = parseFloat(getComputedStyle(splash).borderTopLeftRadius) || 0;
  if (round > 0) {
    pen.beginPath();
    pen.roundRect(0, 0, box.width, box.height, round);
    pen.clip();
  }
  pen.fillStyle = "#0b0c0e";
  pen.fillRect(0, 0, box.width, box.height);
  const art = paintings.get(splash);
  const layer = splash.querySelector<HTMLElement>(".splash-art");
  if (art?.complete && art.naturalWidth && layer) {
    // As the page shows it right now: background-size cover, centred, at the
    // zoom and fade it has reached as it eases in (not where it will end up).
    const look = getComputedStyle(layer);
    const zoom = look.transform && look.transform !== "none" ? new DOMMatrix(look.transform) : new DOMMatrix();
    const scale = Math.max(box.width / art.naturalWidth, box.height / art.naturalHeight);
    const w = art.naturalWidth * scale;
    const h = art.naturalHeight * scale;
    pen.save();
    pen.globalAlpha = Math.max(0, Math.min(1, parseFloat(look.opacity) || 0));
    pen.translate(box.width / 2, box.height / 2);
    pen.transform(zoom.a, zoom.b, zoom.c, zoom.d, zoom.e, zoom.f);
    pen.drawImage(art, -w / 2, -h / 2, w, h);
    pen.restore();
  }
  // The same veil as .splash-shade.
  const veil = pen.createLinearGradient(0, 0, 0, box.height);
  veil.addColorStop(0, "rgba(7, 8, 10, 0.82)");
  veil.addColorStop(0.5, "rgba(7, 8, 10, 0.62)");
  veil.addColorStop(1, "rgba(7, 8, 10, 0.86)");
  pen.fillStyle = veil;
  pen.fillRect(0, 0, box.width, box.height);

  const at = (sel: string) => {
    const el = splash.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { el, x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
  };

  // The drawing itself, not its holder: the two differ in size.
  const mark = at(".splash-emblem svg") ?? at(".splash-emblem");
  if (mark) {
    // Sized as shown, at the screen's sharpness, so it isn't drawn at a default size and stretched.
    const sharp = pen.getTransform().a || 1;
    const svg = emblem.replace("currentColor", "#ecebe8").replace("<svg ", `<svg width="${mark.w * sharp}" height="${mark.h * sharp}" `);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode().catch(() => undefined);
    if (img.complete) pen.drawImage(img, mark.x, mark.y, mark.w, mark.h);
  }

  for (const sel of [".splash-title", ".splash-tagline", ".splash-label"]) {
    const el = splash.querySelector<HTMLElement>(sel);
    if (el) words(pen, el, box);
  }

  const line = at(".splash-divider");
  if (line) {
    const mid = line.y + line.h / 2;
    const half = (line.w - 31) / 2;
    for (const [from, to] of [
      [line.x, line.x + half],
      [line.x + line.w, line.x + line.w - half],
    ]) {
      const fade = pen.createLinearGradient(from, 0, to, 0);
      fade.addColorStop(0, "rgba(236, 235, 232, 0)");
      fade.addColorStop(1, "rgba(236, 235, 232, 0.45)");
      pen.fillStyle = fade;
      pen.fillRect(Math.min(from, to), mid - 0.5, half, 1);
    }
    pen.save();
    pen.translate(line.x + line.w / 2, mid);
    pen.rotate(Math.PI / 4);
    pen.strokeStyle = "rgba(236, 235, 232, 0.7)";
    pen.lineWidth = 1.5;
    pen.beginPath();
    pen.roundRect(-5.5, -5.5, 11, 11, 3);
    pen.stroke();
    pen.restore();
  }

  const bar = at(".splash-bar");
  const fill = at(".splash-bar b");
  if (bar) {
    pen.fillStyle = "rgba(236, 235, 232, 0.16)";
    pen.beginPath();
    pen.roundRect(bar.x, bar.y, bar.w, bar.h, bar.h / 2);
    pen.fill();
    if (fill) {
      pen.fillStyle = "#e6e4df";
      pen.beginPath();
      pen.roundRect(fill.x, fill.y, fill.w, fill.h, fill.h / 2);
      pen.fill();
    }
  }
}

/**
 * The words, each letter drawn just where the page has put it, so lines that
 * wrap (the tagline on the iPhone) break up as they look, without jumping
 * onto one line first.
 */
function words(pen: CanvasRenderingContext2D, el: HTMLElement, box: DOMRect) {
  const style = getComputedStyle(el);
  pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  pen.fillStyle = style.color;
  pen.textBaseline = "alphabetic";
  pen.textAlign = "start";
  const upper = style.textTransform === "uppercase";
  for (const { ch, x, top } of letters(el)) {
    const shown = upper ? ch.toUpperCase() : ch;
    // A letter's box on the page starts at its font's ascent above the baseline.
    const ascent = pen.measureText(shown).fontBoundingBoxAscent;
    pen.fillText(shown, x - box.left, top + ascent - box.top);
  }
}

/** Each letter of an element's words with where it sits on the page: its left edge and its box's top. */
export function letters(el: HTMLElement): { ch: string; x: number; top: number }[] {
  const out: { ch: string; x: number; top: number }[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s/.test(ch)) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      out.push({ ch, x: r.left, top: r.top });
    }
  }
  return out;
}
