// The computer's splash going (embre, 20 November): the card turns into the
// side bar's emblem, name and tagline. The card is its own window, so the
// main window first draws a copy of it at the very same spot (splash.rs says
// where, and which painting), the card's window goes, and then the copy's
// emblem, name and tagline glide and shrink into the side bar's while the
// painting and the dark fade to show TBV. Where the side bar has no name
// (folded) or isn't showing, those parts fade where they are.

import { setSplash, showSplash } from "./splashView";

/** Where the card sits in the main window, and its painting. */
export type GlideFrom = { left: number; top: number; width: number; height: number; painting: string | null };

/** How long the glide takes (ms). */
export const GLIDE = 1_200;
/** How far through the glide the side bar's own parts start taking over (they're almost there by then). */
const LAND = 0.85;
/** On the html element while the computer's splash is up: the side bar's emblem, name and tagline wait unseen for the glide. */
export const GLIDE_AHEAD = "splash-glide-ahead";

/** Each part of the card and the side bar's part it becomes; `size` is how the shrink is measured. */
const PARTS = [
  { from: ".splash-emblem", to: ".sidebar .brand-emblem", size: "width" },
  { from: ".splash-title", to: ".sidebar .brand-name", size: "height" },
  { from: ".splash-tagline", to: ".sidebar .brand-tagline", size: "font" },
] as const;

type Box = { left: number; top: number; width: number; height: number };

/** The move from one box's middle to another's, and the shrink. */
export function flip(from: Box, to: Box, scale: number): { dx: number; dy: number; scale: number } {
  return {
    dx: to.left + to.width / 2 - (from.left + from.width / 2),
    dy: to.top + to.height / 2 - (from.top + from.height / 2),
    scale,
  };
}

const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const frame = () => new Promise<void>((ok) => requestAnimationFrame(() => ok()));

/** Whether a part of the side bar is on screen to glide into. */
function onScreen(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
}

export async function glide(from: GlideFrom, label: string, handOver: () => Promise<void>): Promise<void> {
  const copy = showSplash(true, from.painting ?? undefined);
  copy.classList.add("is-copy");
  copy.style.left = `${from.left}px`;
  copy.style.top = `${from.top}px`;
  copy.style.width = `${from.width}px`;
  copy.style.height = `${from.height}px`;
  setSplash(copy, 1, label);
  // The painting and the name's font ready, so the copy looks just like the card.
  const art = copy.querySelector<HTMLElement>(".splash-art");
  if (from.painting && art) {
    const img = new Image();
    img.src = from.painting;
    await Promise.race([img.decode().catch(() => undefined), wait(400)]);
    art.style.backgroundImage = `url("${from.painting}")`;
    art.classList.add("is-shown");
  }
  await Promise.race([document.fonts?.load('400 32px Gelasio').catch(() => undefined), wait(300)]);
  await frame();
  await frame();
  await handOver();
  await wait(60);

  const layer = document.createElement("div");
  layer.className = "splash-glide";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);
  const shown: HTMLElement[] = [];
  const canAnimate = typeof layer.animate === "function";
  for (const part of PARTS) {
    const el = copy.querySelector<HTMLElement>(part.from);
    if (!el) continue;
    const r0 = el.getBoundingClientRect();
    // Lifted out of the card, which clips, into a layer of its own at the same spot.
    const twin = el.cloneNode(true) as HTMLElement;
    // A point wider, so rounding never wraps its words onto another line.
    twin.style.left = `${r0.left - 0.5}px`;
    twin.style.top = `${r0.top}px`;
    twin.style.width = `${r0.width + 1}px`;
    twin.style.height = `${r0.height}px`;
    layer.appendChild(twin);
    el.style.visibility = "hidden";
    if (!canAnimate) continue;
    const target = document.querySelector(part.to);
    const ease = "cubic-bezier(0.65, 0, 0.35, 1)";
    if (!onScreen(target)) {
      twin.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "translateY(-14px)" },
        ],
        { duration: GLIDE / 2, easing: "ease-out", fill: "forwards" },
      );
      continue;
    }
    const r1 = target.getBoundingClientRect();
    const scale =
      part.size === "width"
        ? r1.width / r0.width
        : part.size === "height"
          ? r1.height / r0.height
          : parseFloat(getComputedStyle(target).fontSize) / parseFloat(getComputedStyle(el).fontSize);
    const move = flip(r0, r1, scale || 1);
    const colour = getComputedStyle(target).color;
    twin.animate(
      [
        { transform: "none", color: getComputedStyle(el).color, opacity: 1 },
        { opacity: 1, offset: LAND },
        { transform: `translate(${move.dx}px, ${move.dy}px) scale(${move.scale})`, color: colour, opacity: 0 },
      ],
      { duration: GLIDE, easing: ease, fill: "forwards" },
    );
    // The side bar's own part takes over as the glide lands.
    target.style.opacity = "0";
    shown.push(target);
    target.animate([{ opacity: 0 }, { opacity: 0, offset: LAND }, { opacity: 1 }], { duration: GLIDE, easing: ease });
  }
  document.documentElement.classList.remove(GLIDE_AHEAD);
  copy.classList.add("is-gliding");
  await wait(GLIDE + 40);
  for (const el of shown) el.style.opacity = "";
  layer.remove();
  copy.remove();
}
