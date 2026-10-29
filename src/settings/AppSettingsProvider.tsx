import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { api } from "../api";
import { startupStep } from "../splash/startup";
import {
  adaptiveColors,
  APP_SETTINGS_KEY,
  applyPrivacy,
  AppSettingsCtx,
  BOOK_OPENED,
  applyAppSettings,
  DEFAULT_APP_SETTINGS,
  isDark,
  parseAppSettings,
  storedPrivacy,
  useSystemDark,
  type AppSettings,
  type AppSettingsContext,
  type SyncSettings,
} from "./appSettings";

type AdaptiveBook = AppSettingsContext["adaptiveBook"];

/** A copy of the settings kept on this device, so TBV opens looking right
 * straight away instead of switching once the saved ones arrive. */
const LOOK_KEY = "tbv.look";
/** And the Adaptive theme's last colour. */
const ACCENT_KEY = "tbv.look.accent";

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Only a head start; the library has the real settings.
  }
}

/** Loads the app's settings, keeps them applied to the window, and saves changes. */
export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  // Privacy mode starts as it was left, so covers never show while settings load.
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = remembered(LOOK_KEY);
    return { ...(saved ? parseAppSettings(saved) : DEFAULT_APP_SETTINGS), privacy: storedPrivacy() };
  });
  const [book, setBook] = useState<AdaptiveBook>(null);
  const [coverHex, setCoverHex] = useState<string | null>(() => remembered(ACCENT_KEY));
  const [loaded, setLoaded] = useState(false);
  const [adaptiveTick, setAdaptiveTick] = useState(0);
  const systemDark = useSystemDark();

  useEffect(() => {
    api.getSetting(APP_SETTINGS_KEY).then(
      (json) => {
        const loaded = parseAppSettings(json);
        // Saved before privacy mode existed: keep what this window started with.
        const hasPrivacy = !!json && json.includes('"privacy"');
        const next = hasPrivacy ? loaded : { ...loaded, privacy: storedPrivacy() };
        remember(LOOK_KEY, JSON.stringify(next));
        setSettings(next);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, []);

  const save = useCallback((next: AppSettings) => {
    const json = JSON.stringify(next);
    remember(LOOK_KEY, json);
    void api.setSetting(APP_SETTINGS_KEY, json).catch(() => undefined);
    return next;
  }, []);
  const change = useCallback((c: Partial<AppSettings>) => setSettings((s) => save({ ...s, ...c })), [save]);
  const changeSync = useCallback((c: Partial<SyncSettings>) => setSettings((s) => save({ ...s, sync: { ...s.sync, ...c } })), [save]);
  const reset = useCallback(() => setSettings(save(DEFAULT_APP_SETTINGS)), [save]);
  const togglePrivacy = useCallback(
    () =>
      setSettings((s) => {
        const next = { ...s, privacy: { ...s.privacy, on: !s.privacy.on } };
        // Straight away, not after the next draw.
        applyPrivacy(next.privacy);
        return save(next);
      }),
    [save],
  );

  // Adaptive takes its colour from the book read most recently: again each
  // time a book is opened, or (with Auto-apply off) from the book it was
  // last set on, until it's reset.
  const adaptiveOn = settings.theme === "adaptive";
  const pinned = settings.adaptiveAuto ? null : settings.adaptivePinned;
  useEffect(() => {
    if (!adaptiveOn || !settings.adaptiveAuto) return;
    const again = () => setAdaptiveTick((n) => n + 1);
    window.addEventListener(BOOK_OPENED, again);
    return () => window.removeEventListener(BOOK_OPENED, again);
  }, [adaptiveOn, settings.adaptiveAuto]);
  useEffect(() => {
    if (!adaptiveOn) return;
    let current = true;
    (async () => {
      const kept = pinned ? await api.bookDetails(pinned).then((d) => d.book).catch(() => null) : null;
      const page = kept
        ? null
        : await api.getLibrary({
            shelf: "all",
            sort: "recently_opened",
            search: null,
            formats: [],
            location: null,
            page: 0,
            pageSize: 1,
          });
      const recent = kept ?? page?.books.find((b) => b.lastOpenedAt) ?? page?.books[0] ?? null;
      // Auto-apply off: this is the book it stays on.
      if (current && !settings.adaptiveAuto && !pinned && recent) change({ adaptivePinned: recent.id });
      const hex = recent ? await api.coverAccent(recent.id) : null;
      if (!current) return;
      setBook(
        recent && {
          id: recent.id,
          title: recent.title,
          authors: recent.authors,
          coverPath: recent.coverPath,
        },
      );
      setCoverHex(hex);
      remember(ACCENT_KEY, hex);
    })().catch(() => current && setCoverHex(null));
    return () => {
      current = false;
    };
  }, [adaptiveOn, adaptiveTick, pinned, settings.adaptiveAuto, change]);

  const dark = isDark(settings, systemDark);
  const adaptive = useMemo(
    () => (adaptiveOn && coverHex ? adaptiveColors(coverHex, dark, settings.adaptiveStrength) : null),
    [adaptiveOn, coverHex, dark, settings.adaptiveStrength],
  );

  useLayoutEffect(() => applyAppSettings(settings, dark, adaptive), [settings, dark, adaptive]);
  // The saved look is on, so the splash may go once the rest is ready.
  useEffect(() => {
    if (loaded) startupStep("look");
  }, [loaded]);

  const value = useMemo<AppSettingsContext>(
    () => ({
      settings,
      change,
      changeSync,
      reset,
      adaptive,
      adaptiveBook: adaptiveOn ? book : null,
      // Reset: the colour comes from the book read most recently, and (with Auto-apply off) stays on it.
      refreshAdaptive: () => (settings.adaptiveAuto || !settings.adaptivePinned ? setAdaptiveTick((n) => n + 1) : change({ adaptivePinned: null })),
      togglePrivacy,
    }),
    [settings, change, changeSync, reset, adaptive, adaptiveOn, book, togglePrivacy],
  );
  return <AppSettingsCtx.Provider value={value}>{children}</AppSettingsCtx.Provider>;
}
