import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { HIGHLIGHT_COLORS, parseSettings, SETTINGS_KEY, type ReaderSettings } from "../reader/settings";
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
import { Row, Section, Segmented, Toggle } from "./controls";
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

/** The theme cards. Adaptive is one card; its light or dark is chosen under it. */
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
  { value: "adaptive", label: "Adaptive" },
];

export function AppearanceTab({
  sidebarShown,
  onSidebarShown,
}: {
  sidebarShown: boolean;
  onSidebarShown: (shown: boolean) => void;
}) {
  const { settings, change, adaptive, adaptiveBook, refreshAdaptive, togglePrivacy } = useAppSettings();
  const adaptiveOn = settings.theme === "adaptive";
  const systemDark = useSystemDark();
  const card = settings.theme;

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
              <span
                className={`theme-swatch theme-swatch-${t.value === "adaptive" ? (isDark({ theme: "adaptive", adaptiveBase: settings.adaptiveBase }, systemDark) ? "adaptive-dark" : "adaptive-light") : t.value}`}
                aria-hidden
              />
              <span className="theme-card-label">
                <input
                  type="radio"
                  name="tbv-theme"
                  checked={card === t.value}
                  onChange={() => change({ theme: t.value })}
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
            <Row label="Light or dark" hint="Auto follows your device's light or dark mode.">
              <Segmented<AdaptiveBase>
                label="Adaptive light or dark"
                value={settings.adaptiveBase}
                options={[
                  { value: "light", label: "Light" },
                  { value: "system", label: "Auto" },
                  { value: "dark", label: "Dark" },
                ]}
                onChange={(adaptiveBase) => change({ adaptiveBase })}
              />
            </Row>
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
        </div>
      </Section>

      <ProfileSection />

      <Section id="layout" title="Interface layout" lede="The size of things, the interface's font, and the sidebar.">
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
        <Row label="Interface font" hint="Used for menus, buttons and labels. The reading font is under Reading.">
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
        <Row label="Sidebar" hint="The ••• button at the top left does the same.">
          <Toggle label="Show the full sidebar" checked={sidebarShown} onChange={onSidebarShown} />
          <Toggle
            label="Full-screen menu on a phone"
            hint="When the phone is upright, the menu of pages fills the screen."
            checked={settings.fullMenu}
            onChange={(fullMenu) => change({ fullMenu })}
          />
        </Row>
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
    </>
  );
}
