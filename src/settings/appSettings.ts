// How the app looks and behaves, chosen in Settings. Saved on this device
// (in the library's device settings) and applied to the whole window through
// attributes and colour variables on the root element.

import { createContext, useContext, useEffect, useState } from "react";
import type { BookPreview, CustomTheme } from "../api/types";

export type ThemeChoice = "light" | "dark" | "system" | "adaptive" | "custom";
export type AdaptiveBase = "system" | "light" | "dark";
export type InterfaceScale = "small" | "medium" | "large";
/** How much room there is between things everywhere. */
export type InterfaceDensity = "compact" | "default" | "spacious";
export type InterfaceFont = "system" | "serif" | "echolume";
export type SurfaceStyle = "clean" | "matte" | "paper" | "linen" | "vellum";
export type SyncFrequency = "automatic" | "15min" | "hourly" | "manual";
export type ConflictRule = "recent" | "ask" | "local" | "cloud";
export type PrivacyStyle = "titles" | "blank";

/** Privacy mode: covers (and pictures that could give a book away) hidden at once. */
export interface PrivacySettings {
  on: boolean;
  /** Plain tiles that keep the title, or blank ones. */
  style: PrivacyStyle;
  /** Hides the profile picture too. */
  avatar: boolean;
}

/** The shortcut that turns privacy mode on and off. */
export const PRIVACY_SHORTCUT = "Ctrl+Shift+H";
/** Kept in the browser as well, so covers never flash before settings load. */
export const PRIVACY_STORE = "tbv.privacy";

export interface SyncSettings {
  progress: boolean;
  notes: boolean;
  collections: boolean;
  metadata: boolean;
  bookFiles: boolean;
  /** Audiobook files are large, so they have a switch of their own. */
  audioFiles: boolean;
  /** What the second place is sent (see Preferences › Sync › Second sync). */
  alsoBookFiles: boolean;
  alsoAudioFiles: boolean;
  /** Supabase (the phone's place) gets only the books chosen for the phone. */
  phoneChosenOnly: boolean;
  /** Discover's history (pages visited and searches). */
  browserHistory: boolean;
  /** Audiobooks that aren't on this device play straight from the cloud instead of downloading first. */
  streamAudio: boolean;
  frequency: SyncFrequency;
  onStartup: boolean;
  onClose: boolean;
  conflicts: ConflictRule;
}

export interface AppSettings {
  theme: ThemeChoice;
  /** Whether Adaptive builds on the light or dark theme. */
  adaptiveBase: AdaptiveBase;
  /** How strongly the cover's colour tints the accent, 0 to 1. */
  adaptiveStrength: number;
  /** Adaptive takes the colour again whenever a different book is opened; off, it stays until reset. */
  adaptiveAuto: boolean;
  /** The book the Adaptive colour stays on while adaptiveAuto is off. */
  adaptivePinned: string | null;
  /** The custom theme shown when `theme` is "custom": a copy of the synced one, so it shows before the library opens. */
  customTheme: CustomTheme | null;
  scale: InterfaceScale;
  density: InterfaceDensity;
  interfaceFont: InterfaceFont;
  surface: SurfaceStyle;
  highContrast: boolean;
  reduceMotion: boolean;
  /** Always draws a focus ring, not only when moving with the keyboard. */
  strongFocus: boolean;
  underlineLinks: boolean;
  showProgress: boolean;
  /** The Library scrolls on without pages on a computer too (a phone always does). */
  scrollLibrary: boolean;
  /** On a phone held upright, the menu of pages fills the whole screen. */
  fullMenu: boolean;
  showSmartCollections: boolean;
  showSeries: boolean;
  /** Sanctum's Suggested reading also looks online: Krowsingre Publishing's list, and Open Library for authors you read. */
  suggestOnline: boolean;
  /** Imports leave out books that were deleted before, instead of bringing them back. */
  skipDeletedImports: boolean;
  /** Looks for a newer version of TBV each time it opens (on a computer). */
  checkUpdates: boolean;
  /** Installs a newer version found when TBV opens, then starts again. */
  autoInstallUpdates: boolean;
  privacy: PrivacySettings;
  sync: SyncSettings;
}

export const APP_SETTINGS_KEY = "app.settings";

/** Sent when a book is opened in the reader, for Adaptive's Auto-apply. */
export const BOOK_OPENED = "tbv:book-opened";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  adaptiveBase: "system",
  adaptiveStrength: 0.7,
  adaptiveAuto: true,
  adaptivePinned: null,
  customTheme: null,
  suggestOnline: true,
  scale: "medium",
  density: "default",
  interfaceFont: "system",
  surface: "clean",
  highContrast: false,
  reduceMotion: false,
  strongFocus: false,
  underlineLinks: false,
  showProgress: true,
  scrollLibrary: false,
  fullMenu: false,
  showSmartCollections: true,
  showSeries: true,
  skipDeletedImports: false,
  checkUpdates: true,
  autoInstallUpdates: false,
  privacy: { on: false, style: "titles", avatar: true },
  sync: {
    progress: true,
    notes: true,
    collections: true,
    metadata: true,
    bookFiles: false,
    audioFiles: false,
    alsoBookFiles: true,
    alsoAudioFiles: false,
    phoneChosenOnly: false,
    browserHistory: false,
    streamAudio: true,
    frequency: "automatic",
    onStartup: true,
    onClose: true,
    conflicts: "recent",
  },
};

export const SCALES: Record<InterfaceScale, number> = {
  small: 0.9,
  medium: 1,
  large: 1.12,
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** Reads saved settings, falling back to the defaults for anything missing or odd. */
export function parseAppSettings(json: string | null): AppSettings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = json ? JSON.parse(json) : {};
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const d = DEFAULT_APP_SETTINGS;
  const s = (raw.sync && typeof raw.sync === "object" ? raw.sync : {}) as Record<string, unknown>;
  const p = (raw.privacy && typeof raw.privacy === "object" ? raw.privacy : {}) as Record<string, unknown>;
  return {
    theme: oneOf(raw.theme, ["light", "dark", "system", "adaptive", "custom"], d.theme),
    adaptiveBase: oneOf(raw.adaptiveBase, ["system", "light", "dark"], d.adaptiveBase),
    adaptiveStrength: typeof raw.adaptiveStrength === "number" ? Math.min(1, Math.max(0, raw.adaptiveStrength)) : d.adaptiveStrength,
    adaptiveAuto: flag(raw.adaptiveAuto, d.adaptiveAuto),
    adaptivePinned: typeof raw.adaptivePinned === "string" ? raw.adaptivePinned : d.adaptivePinned,
    customTheme: readCustomTheme(raw.customTheme),
    suggestOnline: flag(raw.suggestOnline, d.suggestOnline),
    scale: oneOf(raw.scale, ["small", "medium", "large"], d.scale),
    density: oneOf(raw.density, ["compact", "default", "spacious"], d.density),
    interfaceFont: oneOf(raw.interfaceFont, ["system", "serif", "echolume"], d.interfaceFont),
    surface: oneOf(raw.surface, ["clean", "matte", "paper", "linen", "vellum"], d.surface),
    highContrast: flag(raw.highContrast, d.highContrast),
    reduceMotion: flag(raw.reduceMotion, d.reduceMotion),
    strongFocus: flag(raw.strongFocus, d.strongFocus),
    underlineLinks: flag(raw.underlineLinks, d.underlineLinks),
    showProgress: flag(raw.showProgress, d.showProgress),
    showSmartCollections: flag(raw.showSmartCollections, d.showSmartCollections),
    showSeries: flag(raw.showSeries, d.showSeries),
    scrollLibrary: flag(raw.scrollLibrary, d.scrollLibrary),
    fullMenu: flag(raw.fullMenu, d.fullMenu),
    skipDeletedImports: flag(raw.skipDeletedImports, d.skipDeletedImports),
    checkUpdates: flag(raw.checkUpdates, d.checkUpdates),
    autoInstallUpdates: flag(raw.autoInstallUpdates, d.autoInstallUpdates),
    privacy: {
      on: flag(p.on, d.privacy.on),
      style: oneOf(p.style, ["titles", "blank"], d.privacy.style),
      avatar: flag(p.avatar, d.privacy.avatar),
    },
    sync: {
      progress: flag(s.progress, d.sync.progress),
      notes: flag(s.notes, d.sync.notes),
      collections: flag(s.collections, d.sync.collections),
      metadata: flag(s.metadata, d.sync.metadata),
      bookFiles: flag(s.bookFiles, d.sync.bookFiles),
      audioFiles: flag(s.audioFiles, d.sync.audioFiles),
      alsoBookFiles: flag(s.alsoBookFiles, d.sync.alsoBookFiles),
      alsoAudioFiles: flag(s.alsoAudioFiles, d.sync.alsoAudioFiles),
      phoneChosenOnly: flag(s.phoneChosenOnly, d.sync.phoneChosenOnly),
      browserHistory: flag(s.browserHistory, d.sync.browserHistory),
      streamAudio: flag(s.streamAudio, d.sync.streamAudio),
      frequency: oneOf(s.frequency, ["automatic", "15min", "hourly", "manual"], d.sync.frequency),
      onStartup: flag(s.onStartup, d.sync.onStartup),
      onClose: flag(s.onClose, d.sync.onClose),
      conflicts: oneOf(s.conflicts, ["recent", "ask", "local", "cloud"], d.sync.conflicts),
    },
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

function readCustomTheme(raw: unknown): CustomTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const colours = [t.page, t.surface, t.accent, t.highlight];
  if (!colours.every((c) => typeof c === "string" && HEX.test(c))) return null;
  return {
    id: typeof t.id === "string" ? t.id : "",
    name: typeof t.name === "string" ? t.name : "Custom",
    page: t.page as string,
    surface: t.surface as string,
    accent: t.accent as string,
    highlight: t.highlight as string,
  };
}

/** How bright a colour looks, 0 (black) to 1 (white), as WCAG measures it. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How far apart two colours are for reading, 1 to 21. Text wants 4.5 or more. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Mixes two colours, `amount` of the second. */
export function mix(a: string, b: string, amount: number): string {
  const parts = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [p, q] = [parts(a), parts(b)];
  return `#${p.map((v, i) => Math.round(v + (q[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** Everything else a custom theme needs, worked out from its four colours so text always reads. */
export function customColors(theme: CustomTheme): Record<string, string> {
  const dark = luminance(theme.page) < 0.25;
  const text = dark ? "#ece9e4" : "#1a1c1e";
  return {
    "--bg": theme.page,
    "--surface": theme.surface,
    "--surface-sunk": mix(theme.page, "#000000", dark ? 0.25 : 0.06),
    "--text": text,
    "--text-muted": mix(text, theme.surface, 0.38),
    "--border": mix(theme.surface, text, 0.16),
    "--accent": theme.accent,
    "--accent-text": contrast(theme.accent, "#ffffff") >= contrast(theme.accent, "#121416") ? "#ffffff" : "#121416",
    "--accent-soft": theme.highlight,
    "--highlight": theme.highlight,
  };
}

/** The colour variables a custom theme sets, so they can be taken off again. */
const CUSTOM_VARS = ["--bg", "--surface", "--surface-sunk", "--text", "--text-muted", "--border", "--accent-soft", "--highlight"];

/** Whether the window should be dark, given the choice and the system's own setting. */
export function isDark(settings: Pick<AppSettings, "theme" | "adaptiveBase"> & { customTheme?: CustomTheme | null }, systemDark: boolean): boolean {
  if (settings.theme === "custom" && settings.customTheme) return luminance(settings.customTheme.page) < 0.25;
  if (settings.theme === "light" || settings.theme === "dark") return settings.theme === "dark";
  if (settings.theme === "adaptive" && settings.adaptiveBase !== "system") return settings.adaptiveBase === "dark";
  return systemDark;
}

// Colour arithmetic for Adaptive: keep the cover's hue, set the lightness so
// the accent reads well on the chosen theme.
function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export interface AdaptiveColors {
  accent: string;
  accentText: string;
  /** A softer tint of the accent, shown as "Highlight" in the preview. */
  highlight: string;
}

/** Turns a cover's colour into an accent for the light or dark theme. */
export function adaptiveColors(coverHex: string, dark: boolean, strength: number): AdaptiveColors | null {
  const hsl = hexToHsl(coverHex);
  if (!hsl) return null;
  const [h, s] = hsl;
  const sat = Math.min(0.55, s) * (0.25 + 0.75 * strength);
  return dark
    ? {
        accent: hslToHex(h, sat, 0.72),
        accentText: "#121416",
        highlight: hslToHex(h, sat * 0.8, 0.42),
      }
    : {
        accent: hslToHex(h, sat, 0.3),
        accentText: "#f1efeb",
        highlight: hslToHex(h, sat * 0.8, 0.62),
      };
}

/** Puts the settings on the root element, where the style sheets read them. */
export function applyAppSettings(settings: AppSettings, dark: boolean, adaptive: AdaptiveColors | null) {
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.surface = settings.surface;
  root.dataset.uiFont = settings.interfaceFont;
  root.dataset.density = settings.density;
  root.toggleAttribute("data-high-contrast", settings.highContrast);
  root.toggleAttribute("data-reduce-motion", settings.reduceMotion);
  root.toggleAttribute("data-strong-focus", settings.strongFocus);
  root.toggleAttribute("data-underline-links", settings.underlineLinks);
  root.toggleAttribute("data-hide-progress", !settings.showProgress);
  root.toggleAttribute("data-full-menu", settings.fullMenu);
  root.style.setProperty("zoom", String(SCALES[settings.scale]));
  applyPrivacy(settings.privacy);
  for (const [name, value] of [
    ["--accent", adaptive?.accent],
    ["--accent-text", adaptive?.accentText],
  ] as const) {
    // A cover's colour can give the book away, so privacy mode leaves it out.
    if (settings.theme === "adaptive" && !settings.privacy.on && value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  for (const name of CUSTOM_VARS) root.style.removeProperty(name);
  if (settings.theme === "adaptive" && adaptive && !settings.privacy.on) root.style.setProperty("--highlight", adaptive.highlight);
  if (settings.theme === "custom" && settings.customTheme) for (const [name, value] of Object.entries(customColors(settings.customTheme))) root.style.setProperty(name, value);
  // Selected words take the theme's highlight colour.
  root.toggleAttribute("data-highlight", !!root.style.getPropertyValue("--highlight"));
}

/** Shows or hides covers on the whole window, at once. */
export function applyPrivacy(privacy: PrivacySettings) {
  const root = document.documentElement;
  if (privacy.on) root.dataset.privacy = privacy.style;
  else delete root.dataset.privacy;
  root.toggleAttribute("data-privacy-avatar", privacy.on && privacy.avatar);
  try {
    localStorage.setItem(PRIVACY_STORE, JSON.stringify(privacy));
  } catch {
    /* private browsing, say: settings still apply once loaded */
  }
}

/** The privacy mode last used here, read before the saved settings load. */
export function storedPrivacy(): PrivacySettings {
  try {
    const saved = localStorage.getItem(PRIVACY_STORE);
    if (saved) return parseAppSettings(JSON.stringify({ privacy: JSON.parse(saved) })).privacy;
  } catch {
    /* nothing saved */
  }
  return DEFAULT_APP_SETTINGS.privacy;
}

/** Applies the privacy mode last used here before anything is drawn. */
export function restorePrivacy() {
  applyPrivacy(storedPrivacy());
}

export interface AppSettingsContext {
  settings: AppSettings;
  change: (change: Partial<AppSettings>) => void;
  changeSync: (change: Partial<SyncSettings>) => void;
  reset: () => void;
  /** The colours Adaptive is using now, if any. */
  adaptive: AdaptiveColors | null;
  /** The book Adaptive takes its colour from. */
  adaptiveBook: Pick<BookPreview, "id" | "title" | "authors" | "coverPath"> | null;
  refreshAdaptive: () => void;
  /** Turns privacy mode on or off. */
  togglePrivacy: () => void;
}

export const AppSettingsCtx = createContext<AppSettingsContext>({
  settings: DEFAULT_APP_SETTINGS,
  change: () => undefined,
  changeSync: () => undefined,
  reset: () => undefined,
  adaptive: null,
  adaptiveBook: null,
  refreshAdaptive: () => undefined,
  togglePrivacy: () => undefined,
});

export const useAppSettings = () => useContext(AppSettingsCtx);

/** Follows the system's light or dark setting. */
export function useSystemDark(): boolean {
  const query = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const [dark, setDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setDark(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query]);
  return dark;
}

/** Whether the app is showing its dark theme right now, whatever chose it. */
export function useAppDark(): boolean {
  const read = () => document.documentElement.dataset.theme === "dark";
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Reads a page's own remembered choices (layout, sort) kept on this device. */
export function readLocal(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function writeLocal(key: string, change: Record<string, unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...readLocal(key), ...change }));
  } catch {
    /* just not remembered */
  }
}
