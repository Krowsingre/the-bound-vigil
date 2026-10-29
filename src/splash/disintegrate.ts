// The splash breaking up: a line sweeps across it on a slant, and behind
// the line the picture turns to specks that drift off and fade, showing TBV
// underneath. The splash is drawn onto a canvas first (from where its parts
// sit on the page), then the canvas is broken up. On the iPhone it fills the
// screen; on a computer it's the card, whose window has room round it for
// the specks to drift into.

import emblem from "../assets/emblem.svg?raw";
import { paintings } from "./splashView";

/** How long the line takes to cross, and each speck to fade (ms). */
const SWEEP = 520;
const LIFE = 460;
/** Speck size, in points. */
const SPECK = 7;

export async function disintegrate(splash: HTMLElement): Promise<void> {
  const box = splash.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const picture = document.createElement("canvas");
  picture.width = Math.round(box.width * dpr);
  picture.height = Math.round(box.height * dpr);
  const pen = picture.getContext("2d");
  if (!pen) return;
  pen.scale(dpr, dpr);
  await draw(pen, splash, box);

  // The specks fly over the whole window, from where the splash sits in it.
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
  if (!out) return;
  document.body.appendChild(dust);
  out.drawImage(picture, ox, oy);
  splash.remove();

  const cols = Math.ceil(box.width / SPECK);
  const rows = Math.ceil(box.height / SPECK);
  const specks: { x: number; y: number; start: number; vx: number; vy: number; spin: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Top left first, bottom right last: the slant of the line.
      const along = (c / cols + r / rows) / 2;
      specks.push({
        x: c * SPECK,
        y: r * SPECK,
        start: along * SWEEP + Math.random() * 70,
        vx: 40 + Math.random() * 90,
        vy: -(30 + Math.random() * 80),
        spin: (Math.random() - 0.5) * 1.2,
      });
    }
  }
  const s = SPECK * dpr;
  await new Promise<void>((done) => {
    const began = performance.now();
    const frame = (now: number) => {
      const t = now - began;
      out.setTransform(1, 0, 0, 1, 0, 0);
      out.clearRect(0, 0, dust.width, dust.height);
      let left = 0;
      for (const p of specks) {
        const age = (t - p.start) / LIFE;
        if (age >= 1) continue;
        left++;
        if (age <= 0) {
          out.globalAlpha = 1;
          out.setTransform(1, 0, 0, 1, 0, 0);
          out.drawImage(picture, p.x * dpr, p.y * dpr, s, s, ox + p.x * dpr, oy + p.y * dpr, s, s);
          continue;
        }
        const ease = age * age;
        const x = ox + (p.x + p.vx * ease) * dpr;
        const y = oy + (p.y + p.vy * ease) * dpr;
        const size = 1 - age * 0.55;
        out.globalAlpha = 1 - age;
        out.setTransform(size, 0, 0, size, x + s / 2, y + s / 2);
        out.rotate(p.spin * age);
        out.drawImage(picture, p.x * dpr, p.y * dpr, s, s, -s / 2, -s / 2, s, s);
      }
      if (left > 0 && t < SWEEP + LIFE + 200) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
  dust.remove();
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
  if (art?.complete && art.naturalWidth) {
    // As background-size: cover, centred.
    const scale = Math.max(box.width / art.naturalWidth, box.height / art.naturalHeight);
    const w = art.naturalWidth * scale;
    const h = art.naturalHeight * scale;
    pen.drawImage(art, (box.width - w) / 2, (box.height - h) / 2, w, h);
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

  const mark = at(".splash-emblem");
  if (mark) {
    const svg = emblem.replace("currentColor", "#ecebe8");
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode().catch(() => undefined);
    if (img.complete) pen.drawImage(img, mark.x, mark.y, mark.w, mark.h);
  }

  for (const sel of [".splash-title", ".splash-tagline", ".splash-label"]) {
    const part = at(sel);
    if (part) words(pen, part.el, part.x, part.y, part.w, part.h);
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

/** One line of words, spaced and coloured as the page has them. */
function words(pen: CanvasRenderingContext2D, el: HTMLElement, x: number, y: number, w: number, h: number) {
  const style = getComputedStyle(el);
  const text = style.textTransform === "uppercase" ? (el.textContent ?? "").toUpperCase() : (el.textContent ?? "");
  pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  pen.fillStyle = style.color;
  pen.textBaseline = "middle";
  const spacing = parseFloat(style.letterSpacing) || 0;
  if (spacing < 1) {
    pen.textAlign = "center";
    pen.fillText(text, x + w / 2, y + h / 2);
    pen.textAlign = "start";
    return;
  }
  const widths = [...text].map((ch) => pen.measureText(ch).width + spacing);
  // Letter spacing adds a gap after the last letter too, as the page does.
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = x + (w - total) / 2;
  const cy = y + h / 2;
  [...text].forEach((ch, i) => {
    pen.fillText(ch, cx, cy);
    cx += widths[i];
  });
}
