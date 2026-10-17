// How the app looks and behaves, chosen in Settings. Saved on this device
// (in the library's device settings) and applied to the whole window through
// attributes and colour variables on the root element.

import { createContext, useContext, useEffect, useState } from "react";
import type { BookPreview } from "../api/types";

export type ThemeChoice = "light" | "dark" | "system" | "adaptive";
export type AdaptiveBase = "system" | "light" | "dark";
export type InterfaceScale = "small" | "medium" | "large";
export type InterfaceFont = "system" | "serif" | "echolume";
export type SurfaceStyle = "clean" | "matte" | "paper";
export type SyncFrequency = "automatic" | "15min" | "hourly" | "manual";
export type ConflictRule = "recent" | "ask" | "local" | "cloud";

export interface SyncSettings {
  progress: boolean;
  notes: boolean;
  collections: boolean;
  metadata: boolean;
  bookFiles: boolean;
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
  scale: InterfaceScale;
  interfaceFont: InterfaceFont;
  surface: SurfaceStyle;
  highContrast: boolean;
  reduceMotion: boolean;
  /** Always draws a focus ring, not only when moving with the keyboard. */
  strongFocus: boolean;
  underlineLinks: boolean;
  showProgress: boolean;
  showSmartCollections: boolean;
  showSeries: boolean;
  sync: SyncSettings;
}

export const APP_SETTINGS_KEY = "app.settings";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  adaptiveBase: "system",
  adaptiveStrength: 0.7,
  scale: "medium",
  interfaceFont: "system",
  surface: "clean",
  highContrast: false,
  reduceMotion: false,
  strongFocus: false,
  underlineLinks: false,
  showProgress: true,
  showSmartCollections: true,
  showSeries: true,
  sync: {
    progress: true,
    notes: true,
    collections: true,
    metadata: true,
    bookFiles: false,
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
  return {
    theme: oneOf(raw.theme, ["light", "dark", "system", "adaptive"], d.theme),
    adaptiveBase: oneOf(raw.adaptiveBase, ["system", "light", "dark"], d.adaptiveBase),
    adaptiveStrength: typeof raw.adaptiveStrength === "number" ? Math.min(1, Math.max(0, raw.adaptiveStrength)) : d.adaptiveStrength,
    scale: oneOf(raw.scale, ["small", "medium", "large"], d.scale),
    interfaceFont: oneOf(raw.interfaceFont, ["system", "serif", "echolume"], d.interfaceFont),
    surface: oneOf(raw.surface, ["clean", "matte", "paper"], d.surface),
    highContrast: flag(raw.highContrast, d.highContrast),
    reduceMotion: flag(raw.reduceMotion, d.reduceMotion),
    strongFocus: flag(raw.strongFocus, d.strongFocus),
    underlineLinks: flag(raw.underlineLinks, d.underlineLinks),
    showProgress: flag(raw.showProgress, d.showProgress),
    showSmartCollections: flag(raw.showSmartCollections, d.showSmartCollections),
    showSeries: flag(raw.showSeries, d.showSeries),
    sync: {
      progress: flag(s.progress, d.sync.progress),
      notes: flag(s.notes, d.sync.notes),
      collections: flag(s.collections, d.sync.collections),
      metadata: flag(s.metadata, d.sync.metadata),
      bookFiles: flag(s.bookFiles, d.sync.bookFiles),
      frequency: oneOf(s.frequency, ["automatic", "15min", "hourly", "manual"], d.sync.frequency),
      onStartup: flag(s.onStartup, d.sync.onStartup),
      onClose: flag(s.onClose, d.sync.onClose),
      conflicts: oneOf(s.conflicts, ["recent", "ask", "local", "cloud"], d.sync.conflicts),
    },
  };
}

/** Whether the window should be dark, given the choice and the system's own setting. */
export function isDark(settings: Pick<AppSettings, "theme" | "adaptiveBase">, systemDark: boolean): boolean {
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
  root.toggleAttribute("data-high-contrast", settings.highContrast);
  root.toggleAttribute("data-reduce-motion", settings.reduceMotion);
  root.toggleAttribute("data-strong-focus", settings.strongFocus);
  root.toggleAttribute("data-underline-links", settings.underlineLinks);
  root.toggleAttribute("data-hide-progress", !settings.showProgress);
  root.style.setProperty("zoom", String(SCALES[settings.scale]));
  for (const [name, value] of [
    ["--accent", adaptive?.accent],
    ["--accent-text", adaptive?.accentText],
  ] as const) {
    if (settings.theme === "adaptive" && value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
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
}

export const AppSettingsCtx = createContext<AppSettingsContext>({
  settings: DEFAULT_APP_SETTINGS,
  change: () => undefined,
  changeSync: () => undefined,
  reset: () => undefined,
  adaptive: null,
  adaptiveBook: null,
  refreshAdaptive: () => undefined,
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
