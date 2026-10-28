// The splash's look, shared by the iPhone's (over the page) and the
// computer's (a card in its own window). Plain DOM, so it shows before
// anything else of TBV has loaded.

import emblem from "../assets/emblem.svg?raw";
import "./splash.css";

/** The square gallery paintings: one is picked each time TBV opens. */
const PAINTINGS = Object.values(
  import.meta.glob<string>("../assets/gallery/*-square.webp", { eager: true, query: "?url", import: "default" }),
);

export const SPLASH_ID = "tbv-splash";

const MARKUP = `
  <div class="splash-art"></div>
  <div class="splash-shade"></div>
  <div class="splash-body">
    <span class="splash-emblem">${emblem}</span>
    <h1 class="splash-title">The Bound Vigil</h1>
    <p class="splash-tagline">Books endure</p>
    <div class="splash-divider"><span></span><i></i><span></span></div>
    <div class="splash-bar" role="progressbar" aria-label="Opening" aria-valuemin="0" aria-valuemax="100"><b></b></div>
    <p class="splash-label">Loading…</p>
  </div>`;

/** The splash, made if the page doesn't have it yet, with a painting chosen. */
export function showSplash(card = false): HTMLElement {
  let el = document.getElementById(SPLASH_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = SPLASH_ID;
    el.className = "splash";
    document.body.prepend(el);
  }
  el.classList.toggle("is-card", card);
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = MARKUP;
  const art = el.querySelector<HTMLElement>(".splash-art")!;
  const url = PAINTINGS[Math.floor(Math.random() * PAINTINGS.length)];
  if (url) {
    const img = new Image();
    img.onload = () => {
      art.style.backgroundImage = `url("${url}")`;
      art.classList.add("is-shown");
    };
    img.src = url;
    paintings.set(el, img);
  }
  return el;
}

/** The painting each splash shows, for drawing it again as it breaks up. */
export const paintings = new WeakMap<HTMLElement, HTMLImageElement>();

/** Moves the bar (0 to 1) and, when given, changes the words under it. */
export function setSplash(el: HTMLElement, progress: number, label?: string) {
  const bar = el.querySelector<HTMLElement>(".splash-bar b");
  const pct = Math.round(Math.max(0.04, Math.min(1, progress)) * 100);
  if (bar) bar.style.width = `${pct}%`;
  el.querySelector(".splash-bar")?.setAttribute("aria-valuenow", String(pct));
  if (label) {
    const words = el.querySelector(".splash-label");
    if (words) words.textContent = label;
  }
}
