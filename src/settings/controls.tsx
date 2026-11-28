// The building blocks of every Settings page: sections, labelled rows,
// switches and choices. On a computer the sections are cards, always open,
// in two columns (see Columns); on a phone they fold, one under another.

import { createContext, useContext, useEffect, useId, useState } from "react";
import { Icon } from "../components/Icon";
import { useNarrow } from "../lib/useNarrow";
import { AtRow, AtSection, AtSwitch, AttuneFrame, PhoneChoice, usePhone } from "./attune";

const OPENED_KEY = "tbv.settings.opened";

/** Sections opened, remembered on this device. The rest start folded. */
function readOpened(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveOpened(id: string, opened: boolean) {
  const all = readOpened();
  if (opened) all.add(id);
  else all.delete(id);
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify([...all]));
  } catch {
    // Not remembered; it still opens.
  }
}

/** Which group holds each section that's part of one. */
const GROUP_OF = new Map<string, string>();

/** Opens a folded section, e.g. one found by searching settings, and the group holding it. */
export function unfoldSection(id: string) {
  const group = GROUP_OF.get(id);
  if (group) unfoldSection(group);
  saveOpened(id, true);
  window.dispatchEvent(new CustomEvent("tbv:unfold-section", { detail: id }));
}

/**
 * Attune on a computer, trimmed (embre, 21 November): section ledes are left out unless they
 * say how things stand (`status`), and a switch's explanation shows when the pointer rests on it.
 * Phones keep everything as it was.
 */
export const PrefsDesk = createContext(false);
export const useDeskPrefs = () => useContext(PrefsDesk);

/** Set where a section's settings sit inside another card: no card or heading of its own. */
export const BareSections = createContext(false);

/** Set inside a group: its sections are parts of one card, not cards. */
const InGroup = createContext(false);

/**
 * A page's cards in two columns on a computer: the main one, wider, for the
 * bigger settings, and `side` for small cards (previews, single switches).
 * On a phone, or a narrow window, the side cards follow the main ones.
 */
export function Columns({ side, children }: { side?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`prefs-columns${side ? "" : " is-single"}`}>
      <div className="prefs-col prefs-col-main">{children}</div>
      {side && <div className="prefs-col prefs-col-side">{side}</div>}
    </div>
  );
}

/**
 * Several sections as one: a single card that folds, with each section
 * inside it as a part under its own small heading. `holds` names them, so
 * searching for one of them opens the card.
 */
export function SectionGroup({ id, title, lede, holds, collapsible, children }: { id: string; title: string; lede?: string; holds: string[]; collapsible?: boolean; children: React.ReactNode }) {
  for (const part of holds) GROUP_OF.set(part, id);
  return (
    <Section id={id} title={title} lede={lede} collapsible={collapsible}>
      <InGroup.Provider value={true}>
        <div className="settings-parts">{children}</div>
      </InGroup.Provider>
    </Section>
  );
}

/** A settings section: a card, folded on a phone until its heading is tapped. */
export function Section({
  id,
  title,
  lede,
  aside,
  collapsible = false,
  status = false,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  /** The lede says how things stand (a version, a plan), so it stays on a computer too. */
  status?: boolean;
  /** A second column, e.g. a preview. */
  aside?: React.ReactNode;
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  const desk = useContext(PrefsDesk);
  const framed = useContext(AttuneFrame);
  const grouped = useContext(InGroup);
  const bare = useContext(BareSections);
  if (desk && !status) lede = undefined;
  if (bare) return <div id={`settings-${id}`}>{children}</div>;
  // On the rebuilt computer pages a section is a folding card with no intro lines (embre, 27 November).
  if (framed && !grouped)
    return (
      <AtSection id={id} title={title} startFolded={collapsible}>
        {children}
      </AtSection>
    );
  return grouped ? (
    <SectionPart id={id} title={title} lede={lede} aside={aside}>
      {children}
    </SectionPart>
  ) : (
    <FoldingSection id={id} title={title} lede={lede} aside={aside} collapsible={collapsible}>
      {children}
    </FoldingSection>
  );
}

/** A section inside a group: a heading and its settings, always open. */
function SectionPart({ id, title, lede, aside, children }: { id: string; title: string; lede?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`settings-part${aside ? " has-aside" : ""}`} id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
      <div className="settings-part-main">
        <h3 id={`settings-${id}-title`}>{title}</h3>
        {lede && <p className="muted">{lede}</p>}
        {children}
      </div>
      {aside && <div className="settings-section-aside">{aside}</div>}
    </section>
  );
}

function FoldingSection({ id, title, lede, aside, collapsible, children }: { id: string; title: string; lede?: string; aside?: React.ReactNode; collapsible: boolean; children: React.ReactNode }) {
  const narrow = useNarrow();
  const [shut, setFolded] = useState(() => !readOpened().has(id));
  const canFold = narrow || collapsible;
  const folded = canFold && shut;
  useEffect(() => {
    const open = (e: Event) => (e as CustomEvent<string>).detail === id && setFolded(false);
    window.addEventListener("tbv:unfold-section", open);
    return () => window.removeEventListener("tbv:unfold-section", open);
  }, [id]);
  const toggle = () => {
    saveOpened(id, folded);
    setFolded(!folded);
  };
  const heading = canFold ? (
    <button type="button" className="settings-section-toggle" aria-expanded={!folded} onClick={toggle}>
      {title}
      <Icon name="chevronDown" size={18} />
    </button>
  ) : (
    title
  );
  return (
    <section
      className={`settings-section${aside && !folded ? " has-aside" : ""}${folded ? " is-folded" : ""}`}
      id={`settings-${id}`}
      aria-labelledby={`settings-${id}-title`}
    >
      <div className="settings-section-main">
        <header className="settings-section-head">
          <h2 id={`settings-${id}-title`}>{heading}</h2>
          {lede && <p className="muted">{lede}</p>}
        </header>
        {!folded && children}
      </div>
      {aside && !folded && <div className="settings-section-aside">{aside}</div>}
    </section>
  );
}

/** One setting: its name and a line of explanation on the left, the control on the right. */
export function Row({ label, hint, children, stack }: { label: string; hint?: string; children: React.ReactNode; stack?: boolean }) {
  if (useContext(AttuneFrame))
    return (
      <AtRow label={label} hint={hint} wide={stack}>
        {children}
      </AtRow>
    );
  return (
    <div className={`settings-row${stack ? " is-stacked" : ""}`}>
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const desk = useContext(PrefsDesk);
  if (useContext(AttuneFrame)) return <AtSwitch label={label} hint={hint} checked={checked} disabled={disabled} onChange={onChange} />;
  return (
    <div className={`settings-toggle${disabled ? " is-disabled" : ""}`} title={desk ? hint : undefined}>
      <button type="button" role="switch" id={id} className="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
        <span className="switch-knob" aria-hidden />
      </button>
      <label htmlFor={id} className="settings-toggle-text">
        <span className="settings-row-label">{label}</span>
        {hint && !desk && <span className="settings-row-hint">{hint}</span>}
      </label>
    </div>
  );
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented settings-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Choices with a line of explanation each, as radio buttons. */
export function RadioList<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <div className="radio-list" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={`radio-item${o.disabled ? " is-disabled" : ""}`}>
          <input type="radio" name={name} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          <span>
            <span className="settings-row-label">{o.label}</span>
            {o.hint && <span className="settings-row-hint">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  // A phone's Attunement opens the choices in place under the row (embre, 28 November).
  if (usePhone()) return <PhoneChoice label={label} value={value} options={options} onChange={onChange} />;
  return (
    <select className="settings-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A big button with an icon, a name and a line of explanation. */
export function ActionTile({
  icon,
  title,
  hint,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="action-tile" onClick={onClick} disabled={disabled}>
      <span className="action-tile-icon">{icon}</span>
      <span className="action-tile-text">
        <span className="settings-row-label">{title}</span>
        <span className="settings-row-hint">{hint}</span>
      </span>
    </button>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[unit]}`;
}
