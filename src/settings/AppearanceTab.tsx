import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import type { Layout } from "../library/libraryView";
import { FONTS, HIGHLIGHT_COLORS, parseSettings, SETTINGS_KEY, SIZE_RANGE, type ReaderSettings, type ReadingFont } from "../reader/settings";
import {
  isDark,
  PRIVACY_SHORTCUT,
  useAppSettings,
  useSystemDark,
  type AdaptiveBase,
  type InterfaceFont,
  type InterfaceScale,
  type PrivacyStyle,
  type SurfaceStyle,
  type ThemeChoice,
} from "./appSettings";
import { Row, Section, Segmented, Select, Toggle } from "./controls";
import { ProfileSection } from "./ProfileSection";

/** The reader's own settings, shared with the Aa panel in the reader. */
export function useReaderSettings(): [ReaderSettings | null, (change: Partial<ReaderSettings>) => void] {
  const [settings, setSettings] = useState<ReaderSettings | null>(null);
  useEffect(() => {
    api.getSetting(SETTINGS_KEY).then(
      (json) => setSettings(parseSettings(json)),
      () => setSettings(parseSettings(null)),
    );
  }, []);
  const change = (c: Partial<ReaderSettings>) =>
    setSettings((s) => {
      if (!s) return s;
      const next = { ...s, ...c };
      void api.setSetting(SETTINGS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  return [settings, change];
}

/** The theme cards. Adaptive has one for each of light and dark. */
type ThemeCard = "light" | "dark" | "system" | "adaptive-light" | "adaptive-dark";
const THEMES: { value: ThemeCard; label: string; theme: ThemeChoice; base?: AdaptiveBase }[] = [
  { value: "light", label: "Light", theme: "light" },
  { value: "dark", label: "Dark", theme: "dark" },
  { value: "system", label: "System", theme: "system" },
  { value: "adaptive-light", label: "Adaptive light", theme: "adaptive", base: "light" },
  { value: "adaptive-dark", label: "Adaptive dark", theme: "adaptive", base: "dark" },
];

export function AppearanceTab({
  layout,
  onLayout,
  sidebarShown,
  onSidebarShown,
}: {
  layout: Layout;
  onLayout: (layout: Layout) => void;
  sidebarShown: boolean;
  onSidebarShown: (shown: boolean) => void;
}) {
  const { settings, change, adaptive, adaptiveBook, refreshAdaptive, togglePrivacy } = useAppSettings();
  const [reader, changeReader] = useReaderSettings();
  const adaptiveOn = settings.theme === "adaptive";
  const systemDark = useSystemDark();
  const card: ThemeCard = adaptiveOn ? (isDark(settings, systemDark) ? "adaptive-dark" : "adaptive-light") : (settings.theme as ThemeCard);

  return (
    <>
      <Section
        id="theme"
        title="Application theme"
        lede="Choose the base theme for the whole app."
        aside={
          <div className="theme-preview">
            <h3>Theme preview</h3>
            <div className="theme-preview-art">
              {adaptiveOn && adaptiveBook ? (
                <BookCover book={adaptiveBook} />
              ) : (
                <div className="theme-preview-sample" aria-hidden>
                  <span className="tp-sidebar" />
                  <span className="tp-main">
                    <span className="tp-title" />
                    <span className="tp-line" />
                    <span className="tp-line short" />
                    <span className="tp-button" />
                  </span>
                </div>
              )}
            </div>
            <ul className="swatches">
              <li>
                <span className="swatch-chip" style={{ background: "var(--bg)" }} />
                Page
              </li>
              <li>
                <span className="swatch-chip" style={{ background: "var(--surface)" }} />
                Surface
              </li>
              <li>
                <span className="swatch-chip" style={{ background: "var(--accent)" }} />
                Accent
              </li>
              <li>
                <span
                  className="swatch-chip"
                  style={{
                    background: adaptive?.highlight ?? HIGHLIGHT_COLORS[3].hex,
                  }}
                />
                Highlight
              </li>
            </ul>
          </div>
        }
      >
        <div className="theme-cards" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <label key={t.value} className={`theme-card${card === t.value ? " is-active" : ""}`}>
              <span className={`theme-swatch theme-swatch-${t.value}`} aria-hidden />
              <span className="theme-card-label">
                <input
                  type="radio"
                  name="tbv-theme"
                  checked={card === t.value}
                  onChange={() => change(t.base ? { theme: t.theme, adaptiveBase: t.base } : { theme: t.theme })}
                />
                {t.label}
              </span>
            </label>
          ))}
        </div>
        {adaptiveOn && (
          <div className="settings-subpanel">
            <h3>Adaptive theme</h3>
            <p className="settings-row-hint">
              The accent colour comes from the cover of the book you read most recently
              {adaptiveBook ? (
                <>
                  , now <em>{adaptiveBook.title}</em>
                </>
              ) : null}
              .{!adaptive && " That book has no cover with a colour to use yet, so the usual accent stays."}
            </p>
            <Toggle
              label="Switch with the system"
              hint="Use Adaptive light or Adaptive dark to match Windows' light or dark mode."
              checked={settings.adaptiveBase === "system"}
              onChange={(on) => change({ adaptiveBase: on ? "system" : systemDark ? "dark" : "light" })}
            />
            <Row label="Accent strength" hint="How strongly the cover's colour is used.">
              <div className="range-row">
                <span className="settings-row-hint">Subtle</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.adaptiveStrength}
                  aria-label="Accent strength"
                  onChange={(e) => change({ adaptiveStrength: Number(e.target.value) })}
                />
                <span className="settings-row-hint">Strong</span>
              </div>
            </Row>
            <button type="button" className="btn btn-quiet" onClick={refreshAdaptive}>
              <Icon name="sync" size={16} /> Take the colour again
            </button>
          </div>
        )}
      </Section>

      <ProfileSection />

      <Section id="layout" title="Interface layout" lede="The size of things, and how the library shows your books.">
        <Row label="Interface scale" hint="Makes all text and controls smaller or larger.">
          <Segmented<InterfaceScale>
            label="Interface scale"
            value={settings.scale}
            options={[
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
            onChange={(scale) => change({ scale })}
          />
        </Row>
        <Row label="Sidebar" hint="The ••• button at the top left does the same.">
          <Toggle label="Show the full sidebar" checked={sidebarShown} onChange={onSidebarShown} />
          <Toggle
            label="Full-screen menu on a phone"
            hint="When the phone is upright, the menu of pages fills the screen."
            checked={settings.fullMenu}
            onChange={(fullMenu) => change({ fullMenu })}
          />
        </Row>
        <Row label="Archive pages" hint="On a phone the Archive always scrolls on without pages.">
          <Toggle
            label="Scroll on without page numbers"
            hint="More books load as you reach the end."
            checked={settings.scrollLibrary}
            onChange={(scrollLibrary) => change({ scrollLibrary })}
          />
        </Row>
        <Row label="Cover display" hint="How the Archive shows your books.">
          <div className="cover-styles" role="radiogroup" aria-label="Cover display">
            {(
              [
                ["grid", "Covers"],
                ["list", "List"],
                ["compact", "Compact"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={layout === value}
                className={`cover-style${layout === value ? " is-active" : ""}`}
                onClick={() => onLayout(value)}
              >
                <span className={`cover-style-art cover-style-${value}`} aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                {label}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section id="typography" title="Typography" lede="Fonts for the interface and for reading.">
        <Row label="Interface font" hint="Used for menus, buttons and labels.">
          <Segmented<InterfaceFont>
            label="Interface font"
            value={settings.interfaceFont}
            options={[
              { value: "system", label: "Segoe UI (Default)" },
              { value: "serif", label: "Georgia" },
              { value: "echolume", label: "Echolume" },
            ]}
            onChange={(interfaceFont) => change({ interfaceFont })}
          />
        </Row>
        {reader && (
          <Row label="Reading font" hint="Used in the reader. More text options are under Reading.">
            <div className="font-row">
              <Select<ReadingFont>
                label="Reading font"
                value={reader.font}
                options={FONTS.map((f) => ({
                  value: f.value,
                  label: f.value === "lora" ? "Lora (Default)" : f.label,
                }))}
                onChange={(font) => changeReader({ font })}
              />
              <Select<string>
                label="Reading text size"
                value={String(reader.size)}
                options={Array.from({ length: SIZE_RANGE.max - SIZE_RANGE.min + 1 }, (_, i) => {
                  const n = String(SIZE_RANGE.min + i);
                  return { value: n, label: n };
                })}
                onChange={(size) => changeReader({ size: Number(size) })}
              />
            </div>
          </Row>
        )}
      </Section>

      <Section
        id="privacy"
        title="Privacy mode"
        lede={`Hides every book cover at once, and brings them back just as fast. Press ${PRIVACY_SHORTCUT} anywhere, or use the menu under your sync circle.`}
      >
        <div className="toggle-list">
          <Toggle
            label="Hide covers now"
            hint="Stays on until you turn it off, even if you close TBV."
            checked={settings.privacy.on}
            onChange={() => togglePrivacy()}
          />
        </div>
        <Row label="Hidden covers show" hint="What appears in place of each cover.">
          <Segmented<PrivacyStyle>
            label="Hidden covers show"
            value={settings.privacy.style}
            options={[
              { value: "titles", label: "The title" },
              { value: "blank", label: "Nothing" },
            ]}
            onChange={(style) => change({ privacy: { ...settings.privacy, style } })}
          />
        </Row>
        <div className="toggle-list">
          <Toggle
            label="Hide my profile picture too"
            hint="Collection pictures made from covers or your own images are always hidden. TBV's gallery paintings stay."
            checked={settings.privacy.avatar}
            onChange={(avatar) => change({ privacy: { ...settings.privacy, avatar } })}
          />
        </div>
      </Section>

      <Section id="colour" title="Colour & surface" lede="Finishing touches for comfort and taste.">
        <Row label="Surface style" hint="A subtle tint behind pages and cards.">
          <Segmented<SurfaceStyle>
            label="Surface style"
            value={settings.surface}
            options={[
              { value: "clean", label: "Clean" },
              { value: "matte", label: "Matte" },
              { value: "paper", label: "Paper" },
            ]}
            onChange={(surface) => change({ surface })}
          />
        </Row>
        <div className="toggle-list">
          <Toggle
            label="Show progress bars on books"
            hint="In the Archive and Compendium. Sanctum always shows what you're reading."
            checked={settings.showProgress}
            onChange={(showProgress) => change({ showProgress })}
          />
          <Toggle
            label="Use high contrast"
            hint="Darker text and clearer edges."
            checked={settings.highContrast}
            onChange={(highContrast) => change({ highContrast })}
          />
          <Toggle
            label="Reduce motion"
            hint="Turns off animations and sliding."
            checked={settings.reduceMotion}
            onChange={(reduceMotion) => change({ reduceMotion })}
          />
        </div>
      </Section>
    </>
  );
}
