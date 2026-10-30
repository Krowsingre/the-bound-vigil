// Custom themes: four colours of your own (page, surface, accent and
// highlight), named, edited later, and synced to your other devices. TBV
// works out the text and borders so words always read.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { CustomTheme } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { contrast, customColors, useAppSettings } from "./appSettings";
import { Section } from "./controls";

const COLOURS: { key: "page" | "surface" | "accent" | "highlight"; label: string }[] = [
  { key: "page", label: "Page" },
  { key: "surface", label: "Surface" },
  { key: "accent", label: "Accent" },
  { key: "highlight", label: "Highlight" },
];

/** A colour the window shows now, as #rrggbb (whatever form the style sheet gave it). */
export function shownColour(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !value) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = value;
  const out = String(ctx.fillStyle);
  if (/^#[0-9a-f]{6}$/i.test(out)) return out.toLowerCase();
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(out);
  return rgb ? `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : fallback;
}

/** The colours showing now, as a theme to start from. */
export function themeFromWindow(name: string, highlight?: string): CustomTheme {
  return {
    id: "",
    name,
    page: shownColour("--bg", "#f1efeb"),
    surface: shownColour("--surface", "#faf9f6"),
    accent: shownColour("--accent", "#2f3a44"),
    highlight: highlight ?? shownColour("--highlight", "#c9d6e3"),
  };
}

export function useCustomThemes(): [CustomTheme[], () => void] {
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let current = true;
    api.customThemes().then(
      (list) => current && setThemes(list),
      () => current && setThemes([]),
    );
    return () => {
      current = false;
    };
  }, [tick]);
  return [themes, () => setTick((n) => n + 1)];
}

const same = (a: CustomTheme, b: CustomTheme) => a.name === b.name && COLOURS.every(({ key }) => a[key].toLowerCase() === b[key].toLowerCase());

export function CustomThemeSection() {
  const { settings, change } = useAppSettings();
  const [themes, reload] = useCustomThemes();
  const [deleting, setDeleting] = useState<CustomTheme | null>(null);
  const toast = useToast();
  const theme = settings.customTheme;

  // Picking Custom with nothing made yet starts from the colours showing now.
  useEffect(() => {
    if (!theme) change({ customTheme: themeFromWindow("My theme") });
  }, [theme, change]);
  if (!theme) return null;

  const saved = themes.find((t) => t.id === theme.id);
  const edit = (c: Partial<CustomTheme>) => change({ customTheme: { ...theme, ...c } });
  const store = async (asNew: boolean) => {
    try {
      const made = await api.saveCustomTheme(asNew ? { ...theme, id: "", name: saved && theme.name === saved.name ? `${theme.name} (copy)` : theme.name } : theme);
      change({ customTheme: made });
      reload();
      toast(asNew || !saved ? `${made.name} saved. It's on your other devices too.` : `${made.name} updated.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  const colours = customColors(theme);
  const problems = [
    contrast(theme.accent, theme.page) < 3 && "The accent is hard to see on the page colour.",
    contrast(theme.accent, theme.surface) < 3 && "The accent is hard to see on the surface colour.",
    contrast(colours["--text"], theme.highlight) < 4.5 && "Words are hard to read on the highlight colour.",
    contrast(colours["--text"], theme.surface) < 4.5 && "Text is hard to read on the surface colour. Try a lighter or darker surface.",
  ].filter(Boolean) as string[];

  return (
    <Section id="custom-theme" title="Custom theme" lede="Choose four colours. TBV picks the text and border colours so words stay easy to read.">
      {themes.length > 0 && (
        <ul className="custom-themes" aria-label="Your themes">
          {themes.map((t) => (
            <li key={t.id}>
              <button type="button" className={`custom-theme-chip${t.id === theme.id ? " is-active" : ""}`} onClick={() => change({ customTheme: t })}>
                <span className="custom-theme-dots" aria-hidden>
                  {COLOURS.map(({ key }) => (
                    <span key={key} style={{ background: t[key] }} />
                  ))}
                </span>
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="field">
        <span>Name</span>
        <input value={theme.name} maxLength={40} onChange={(e) => edit({ name: e.target.value })} />
      </label>
      <div className="custom-theme-colours">
        {COLOURS.map(({ key, label }) => (
          <label key={key}>
            <input type="color" value={theme[key]} onChange={(e) => edit({ [key]: e.target.value })} />
            <span>{label}</span>
            <code>{theme[key]}</code>
          </label>
        ))}
      </div>
      {problems.map((p) => (
        <p key={p} className="settings-row-hint is-warning" role="status">
          <Icon name="warning" size={14} /> {p}
        </p>
      ))}
      <div className="settings-actions">
        <button type="button" className="btn btn-primary" disabled={!theme.name.trim() || (!!saved && same(saved, theme))} onClick={() => void store(false)}>
          {saved ? "Save changes" : "Save theme"}
        </button>
        {saved && (
          <button type="button" className="btn btn-quiet" onClick={() => void store(true)}>
            Save as a new theme
          </button>
        )}
        {saved && !same(saved, theme) && (
          <button type="button" className="btn btn-quiet" onClick={() => change({ customTheme: saved })}>
            Undo changes
          </button>
        )}
        {saved && (
          <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => setDeleting(saved)}>
            <Icon name="trash" size={15} /> Delete
          </button>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="It goes from all your devices. Any device showing it keeps its colours until you choose another theme."
          confirm="Delete theme"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const gone = deleting;
            setDeleting(null);
            void api.removeCustomTheme(gone.id).then(
              () => {
                const next = themes.find((t) => t.id !== gone.id);
                change({ customTheme: next ?? { ...gone, id: "" } });
                reload();
              },
              (e) => toast(String(e)),
            );
          }}
        />
      )}
    </Section>
  );
}
