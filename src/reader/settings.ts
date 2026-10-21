// How the book text looks: font, size, spacing, width, page turns or scrolling,
// and the page colour, plus the voice and speed for reading aloud. Saved on
// this device only.

import gelasio400 from "@fontsource/gelasio/files/gelasio-latin-400-normal.woff2?url";
import gelasio400i from "@fontsource/gelasio/files/gelasio-latin-400-italic.woff2?url";
import lora400 from "@fontsource/lora/files/lora-latin-400-normal.woff2?url";
import lora400i from "@fontsource/lora/files/lora-latin-400-italic.woff2?url";
import lora700 from "@fontsource/lora/files/lora-latin-700-normal.woff2?url";
import lora700i from "@fontsource/lora/files/lora-latin-700-italic.woff2?url";
import loraExt400 from "@fontsource/lora/files/lora-latin-ext-400-normal.woff2?url";
import loraExt400i from "@fontsource/lora/files/lora-latin-ext-400-italic.woff2?url";
import loraExt700 from "@fontsource/lora/files/lora-latin-ext-700-normal.woff2?url";
import loraExt700i from "@fontsource/lora/files/lora-latin-ext-700-italic.woff2?url";
import echolume from "../assets/fonts/echolume-variable.woff2?url";
import echolumeItalic from "../assets/fonts/echolume-italic-variable.woff2?url";
import type { HighlightColor } from "../api/types";
import { RATE_RANGE } from "./readAloud";

export type ReadingFont = "lora" | "georgia" | "sans" | "echolume" | "publisher";
export type ReadingFlow = "paginated" | "scrolled";
export type ReadingTheme = "auto" | "light" | "paper" | "dark";
export type ReadingWidth = "narrow" | "medium" | "wide";
/** PDFs and comics: fit to the screen, or a set size (1 = the page's own size). */
export type PageZoom = "fit-page" | "fit-width" | number;
/** PDFs and comics: one page at a time, two side by side, or two when the window is wide. */
export type PageSpread = "one" | "two" | "auto";

export interface ReaderSettings {
  font: ReadingFont;
  /** Text size in CSS pixels. */
  size: number;
  lineHeight: number;
  width: ReadingWidth;
  flow: ReadingFlow;
  theme: ReadingTheme;
  justify: boolean;
  /** Read aloud: the voice chosen for each language ("en" → voiceURI). */
  voices: Record<string, string>;
  /** Read aloud speed, 1 being the voice's normal pace. */
  rate: number;
  /** PDFs, comics and other books made of fixed pages. */
  pageZoom: PageZoom;
  pageSpread: PageSpread;
  pageFlow: ReadingFlow;
}

export const SETTINGS_KEY = "reader.settings";

export const DEFAULT_SETTINGS: ReaderSettings = {
  font: "lora",
  size: 19,
  lineHeight: 1.6,
  width: "medium",
  flow: "paginated",
  theme: "auto",
  justify: false,
  voices: {},
  rate: 1,
  pageZoom: "fit-page",
  pageSpread: "one",
  pageFlow: "paginated",
};

/** Zoom steps for the + and − buttons, as multiples of the page's own size. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;
export const ZOOM_RANGE = { min: ZOOM_STEPS[0], max: ZOOM_STEPS[ZOOM_STEPS.length - 1] } as const;

/** The next zoom step in or out from the scale shown now. */
export function zoomStep(scale: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > scale * 1.01) ?? ZOOM_RANGE.max;
  return [...ZOOM_STEPS].reverse().find((z) => z < scale * 0.99) ?? ZOOM_RANGE.min;
}

export function parseZoom(raw: unknown): PageZoom {
  if (raw === "fit-page" || raw === "fit-width") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return clamp(Math.round(raw * 100) / 100, ZOOM_RANGE.min, ZOOM_RANGE.max);
  return DEFAULT_SETTINGS.pageZoom;
}

export const SIZE_RANGE = { min: 14, max: 30, step: 1 } as const;
export const LINE_HEIGHTS = [1.4, 1.6, 1.8, 2.0] as const;

export const FONTS: { value: ReadingFont; label: string }[] = [
  { value: "lora", label: "Lora" },
  { value: "georgia", label: "Georgia" },
  { value: "sans", label: "Sans serif" },
  { value: "echolume", label: "Echolume" },
  { value: "publisher", label: "Book's own" },
];

export const WIDTHS: Record<ReadingWidth, number> = { narrow: 560, medium: 680, wide: 820 };

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Reads saved settings, falling back to the defaults for anything missing or odd. */
export function parseSettings(json: string | null): ReaderSettings {
  let raw: Partial<Record<keyof ReaderSettings, unknown>> = {};
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    raw = {};
  }
  const d = DEFAULT_SETTINGS;
  return {
    font: oneOf(raw.font, ["lora", "georgia", "sans", "echolume", "publisher"], d.font),
    size: typeof raw.size === "number" ? clamp(Math.round(raw.size), SIZE_RANGE.min, SIZE_RANGE.max) : d.size,
    lineHeight: typeof raw.lineHeight === "number" ? clamp(raw.lineHeight, 1.2, 2.2) : d.lineHeight,
    width: oneOf(raw.width, ["narrow", "medium", "wide"], d.width),
    flow: oneOf(raw.flow, ["paginated", "scrolled"], d.flow),
    theme: oneOf(raw.theme, ["auto", "light", "paper", "dark"], d.theme),
    justify: typeof raw.justify === "boolean" ? raw.justify : d.justify,
    voices: parseVoices(raw.voices),
    rate: typeof raw.rate === "number" && Number.isFinite(raw.rate) ? clamp(Math.round(raw.rate * 100) / 100, RATE_RANGE.min, RATE_RANGE.max) : d.rate,
    pageZoom: parseZoom(raw.pageZoom),
    pageSpread: oneOf(raw.pageSpread, ["one", "two", "auto"], d.pageSpread),
    pageFlow: oneOf(raw.pageFlow, ["paginated", "scrolled"], d.pageFlow),
  };
}

function parseVoices(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v));
}

export interface PageColors {
  background: string;
  text: string;
  muted: string;
  link: string;
}

/** Page colours, from the approved palette. Paper is a warmer light page. */
export const PAGE_COLORS: Record<Exclude<ReadingTheme, "auto">, PageColors> = {
  light: { background: "#faf9f6", text: "#1a1c1e", muted: "#5e6368", link: "#2f3a44" },
  paper: { background: "#f1ebdf", text: "#2a2621", muted: "#6b6358", link: "#4a3f33" },
  dark: { background: "#1a1c1e", text: "#d9d5ce", muted: "#9a9ea3", link: "#8fa3b5" },
};

export function resolveTheme(theme: ReadingTheme, prefersDark: boolean): Exclude<ReadingTheme, "auto"> {
  return theme === "auto" ? (prefersDark ? "dark" : "light") : theme;
}

/** The four highlight colours. The page engine draws them at 30% strength. */
export const HIGHLIGHT_COLORS: { value: HighlightColor; label: string; hex: string }[] = [
  { value: "rose", label: "Rose", hex: "#d26a5c" },
  { value: "amber", label: "Amber", hex: "#d9a03f" },
  { value: "sage", label: "Sage", hex: "#6f9a6a" },
  { value: "slate", label: "Slate", hex: "#5f84ad" },
];

export const highlightHex = (color: HighlightColor | null | undefined) =>
  (HIGHLIGHT_COLORS.find((c) => c.value === color) ?? HIGHLIGHT_COLORS[0]).hex;

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

// Book pages load in their own frames, which can't see the app's fonts, so
// the fonts are declared again inside each page with absolute addresses.
function fontFaces(): string {
  const abs = (url: string) => new URL(url, location.href).href;
  const face = (family: string, url: string, weight: number | string, style: string, range?: string) =>
    `@font-face{font-family:"${family}";src:url("${abs(url)}") format("woff2");font-weight:${weight};font-style:${style};font-display:block${range ? `;unicode-range:${range}` : ""}}`;
  return [
    face("TBV Lora", lora400, 400, "normal", LATIN),
    face("TBV Lora", lora400i, 400, "italic", LATIN),
    face("TBV Lora", lora700, 700, "normal", LATIN),
    face("TBV Lora", lora700i, 700, "italic", LATIN),
    face("TBV Lora", loraExt400, 400, "normal", LATIN_EXT),
    face("TBV Lora", loraExt400i, 400, "italic", LATIN_EXT),
    face("TBV Lora", loraExt700, 700, "normal", LATIN_EXT),
    face("TBV Lora", loraExt700i, 700, "italic", LATIN_EXT),
    face("TBV Gelasio", gelasio400, 400, "normal", LATIN),
    face("TBV Gelasio", gelasio400i, 400, "italic", LATIN),
    face("TBV Echolume", echolume, "100 900", "normal"),
    face("TBV Echolume", echolumeItalic, "100 900", "italic"),
  ].join("\n");
}

const FONT_STACKS: Record<Exclude<ReadingFont, "publisher">, string> = {
  lora: `"TBV Lora", Georgia, serif`,
  georgia: `Georgia, "TBV Gelasio", serif`,
  sans: `system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
  echolume: `"TBV Echolume", system-ui, "Segoe UI", sans-serif`,
};

/** The style sheet laid over every page of the book. */
export function readerCss(settings: ReaderSettings, colors: PageColors): string {
  const fontRule =
    settings.font === "publisher"
      ? ""
      : `html, body, p, li, blockquote, dd, div, span, h1, h2, h3, h4, h5, h6 { font-family: ${FONT_STACKS[settings.font]} !important; }`;
  return `
${fontFaces()}
@namespace epub "http://www.idpf.org/2007/ops";
html {
  color-scheme: ${colors.background === PAGE_COLORS.dark.background ? "dark" : "light"};
  background: ${colors.background} !important;
  color: ${colors.text} !important;
  font-size: ${settings.size}px !important;
}
body { background: transparent !important; color: inherit !important; }
${fontRule}
p, li, blockquote, dd {
  line-height: ${settings.lineHeight} !important;
  text-align: ${settings.justify ? "justify" : "start"};
  hyphens: ${settings.justify ? "auto" : "manual"};
  -webkit-hyphens: ${settings.justify ? "auto" : "manual"};
  widows: 2;
  orphans: 2;
}
h1, h2, h3, h4, h5, h6 { color: inherit !important; line-height: 1.25; }
a:link, a:visited { color: ${colors.link} !important; }
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
[align="justify"] { text-align: justify; }
pre { white-space: pre-wrap !important; }
img, svg { max-width: 100%; height: auto; }
::selection { background: rgb(143 163 181 / 0.4); }
aside[epub|type~="endnote"], aside[epub|type~="footnote"],
aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
`;
}
