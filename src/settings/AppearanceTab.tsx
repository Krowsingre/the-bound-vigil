import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon, type IconName } from "../components/Icon";
import { HIGHLIGHT_COLORS, parseSettings, SETTINGS_KEY, type ReaderSettings } from "../reader/settings";
import {
  isDark,
  PRIVACY_SHORTCUT,
  useAppSettings,
  useSystemDark,
  SCALES,
  type AdaptiveBase,
  type InterfaceDensity,
  type InterfaceFont,
  type InterfaceScale,
  type PrivacyStyle,
  type SurfaceStyle,
  type ThemeChoice,
} from "./appSettings";
import { Columns, Row, Section, Segmented, Toggle } from "./controls";
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
const THEMES: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "computer" },
  { value: "adaptive", label: "Adaptive", icon: "adaptive" },
];

const DENSITIES: { value: InterfaceDensity; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "spacious", label: "Spacious" },
];

const SCALE_STEPS: InterfaceScale[] = ["small", "medium", "large"];

/** A slider with a few set stops, named under it. */
function Stops<T extends string>({
  label,
  value,
  stops,
  names,
  onChange,
}: {
  label: string;
  value: T;
  stops: T[];
  /** Under the slider: left, middle (the value now), right. */
  names: [string, string, string];
  onChange: (value: T) => void;
}) {
  const at = Math.max(0, stops.indexOf(value));
  return (
    <div className="stops">
      <input
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={at}
        aria-label={label}
        aria-valuetext={names[1]}
        onChange={(e) => onChange(stops[Number(e.target.value)])}
      />
      <div className="stops-names settings-row-hint">
        <span>{names[0]}</span>
        <strong>{names[1]}</strong>
        <span>{names[2]}</span>
      </div>
    </div>
  );
}

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

  const preview = (
    <Section id="preview" title="Theme preview" lede="How the interface's colours look together.">
      <div className="theme-preview">
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
            <span className="swatch-chip" style={{ background: adaptive?.highlight ?? HIGHLIGHT_COLORS[3].hex }} />
            Highlight
          </li>
        </ul>
      </div>
    </Section>
  );

  const side = (
    <>
      {preview}
      <Section id="density" title="Interface density" lede="More room between things, or less, everywhere in TBV.">
        <Stops<InterfaceDensity>
          label="Interface density"
          value={settings.density}
          stops={DENSITIES.map((d) => d.value)}
          names={["Compact", DENSITIES.find((d) => d.value === settings.density)?.label ?? "Default", "Spacious"]}
          onChange={(density) => change({ density })}
        />
      </Section>
      <Section id="text" title="Interface text" lede="The font of menus, buttons and labels, and how big everything is. The reading font is under Reading.">
        <Row label="Font" stack>
          <Segmented<InterfaceFont>
            label="Interface font"
            value={settings.interfaceFont}
            options={[
              { value: "system", label: "Segoe UI" },
              { value: "serif", label: "Georgia" },
              { value: "echolume", label: "Echolume" },
            ]}
            onChange={(interfaceFont) => change({ interfaceFont })}
          />
        </Row>
        <Row label="Font scaling" hint="Makes all text and controls smaller or larger." stack>
          <Stops<InterfaceScale>
            label="Font scaling"
            value={settings.scale}
            stops={SCALE_STEPS}
            names={["Smaller", `${Math.round(SCALES[settings.scale] * 100)}%`, "Larger"]}
            onChange={(scale) => change({ scale })}
          />
        </Row>
      </Section>
      <Section id="touches" title="Finishing touches" lede="The texture behind pages and cards, and progress on covers.">
        <Row label="Surface style" stack>
          <Segmented<SurfaceStyle>
            label="Surface style"
            value={settings.surface}
            options={[
              { value: "clean", label: "Clean" },
              { value: "matte", label: "Matte" },
              { value: "paper", label: "Paper" },
              { value: "linen", label: "Linen" },
              { value: "vellum", label: "Vellum" },
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
    </>
  );

  return (
    <Columns side={side}>
      <Section id="theme" title="Application theme" lede="Choose the base theme for the interface.">
        <div className="theme-cards" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <label key={t.value} className={`theme-card${card === t.value ? " is-active" : ""}`}>
              <span
                className={`theme-tile theme-swatch-${t.value === "adaptive" ? (isDark({ theme: "adaptive", adaptiveBase: settings.adaptiveBase }, systemDark) ? "adaptive-dark" : "adaptive-light") : t.value}`}
                aria-hidden
              >
                <Icon name={t.icon} size={30} />
                <span className="theme-tile-name">{t.label}</span>
              </span>
              <input type="radio" name="tbv-theme" aria-label={t.label} checked={card === t.value} onChange={() => change({ theme: t.value })} />
            </label>
          ))}
        </div>
      </Section>

      {adaptiveOn && (
        <Section
          id="adaptive"
          title="Adaptive theme"
          lede="The interface's colours come from the cover of the book you're reading, on a light or dark base."
        >
          <p className="settings-row-hint">
            {adaptiveBook ? (
              <>
                Now from <em>{adaptiveBook.title}</em>.
              </>
            ) : (
              "No book has been opened yet."
            )}
            {!adaptive && adaptiveBook && " That book has no cover with a colour to use, so the usual accent stays."}
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
          <Row label="Accent strength" hint="How strongly the cover's colours are used.">
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
          <div className="toggle-list">
            <Toggle
              label="Auto-apply"
              hint="Takes the colours again each time you open a different book. Off, they stay on this book until you reset them."
              checked={settings.adaptiveAuto}
              onChange={(adaptiveAuto) => change({ adaptiveAuto, adaptivePinned: adaptiveAuto ? null : (adaptiveBook?.id ?? null) })}
            />
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-quiet" onClick={refreshAdaptive}>
              <Icon name="sync" size={16} /> Reset current adaptive theme
            </button>
            <span className="settings-row-hint">Takes the colours again from the book you read most recently.</span>
          </div>
        </Section>
      )}

      <ProfileSection />

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

      <Section id="sanctum" title="Sanctum" lede="Your home page. Suggested reading always includes books you own and haven't started.">
        <div className="toggle-list">
          <Toggle
            label="Suggest books from online"
            hint="Adds free and new books from Krowsingre Publishing, and other books by authors you read, found on Open Library. Only author names are sent."
            checked={settings.suggestOnline}
            onChange={(suggestOnline) => change({ suggestOnline })}
          />
        </div>
      </Section>

      <Section id="sidebar" title="Sidebar" lede="The menu of pages down the left. Clicking the emblem or the title at its top folds it too.">
        <div className="toggle-list">
          <Toggle label="Show the full sidebar" checked={sidebarShown} onChange={onSidebarShown} />
          <Toggle
            label="Full-screen menu on a phone"
            hint="When the phone is upright, the menu of pages fills the screen."
            checked={settings.fullMenu}
            onChange={(fullMenu) => change({ fullMenu })}
          />
        </div>
      </Section>
    </Columns>
  );
}
