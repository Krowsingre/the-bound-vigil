// The Attunement design framework on a computer (embre, 27 November): every section is a
// card that folds from the arrow in its header, one under another at full width, with no
// page title and no intro lines. Short sections can share a row (Pair), and then come out
// the same height. Settings sit in rows: the name on the left, the control on the right.
// Spacing comes from the shared .attune tokens in settings.css.

import { createContext, useContext, useEffect, useId, useState } from "react";
import { Icon } from "../components/Icon";

const FOLDED_KEY = "tbv.attune.folded";
const OPENED_KEY = "tbv.attune.opened";

function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveIn(key: string, id: string, on: boolean) {
  const all = readSet(key);
  if (on) all.add(id);
  else all.delete(id);
  try {
    localStorage.setItem(key, JSON.stringify([...all]));
  } catch {
    // Not remembered; it still folds.
  }
}

/** Whether a section starts folded: as it was left, or `startFolded` the first time. */
function wasFolded(id: string, startFolded: boolean) {
  return startFolded ? !readSet(OPENED_KEY).has(id) : readSet(FOLDED_KEY).has(id);
}

/** Set inside a pair, where choice bars and sliders sit under their name. */
const InPair = createContext(false);
/** Set on the computer's rebuilt pages: older sections drawn there take the new look. */
export const AttuneFrame = createContext(false);
export const useAttuneFrame = () => useContext(AttuneFrame);

/** A page of the framework: its sections one under another. */
export function AtPage({ children }: { children: React.ReactNode }) {
  return (
    <AttuneFrame.Provider value={true}>
      <div className="at-page">{children}</div>
    </AttuneFrame.Provider>
  );
}

/** Two short sections side by side, the same height, one above the other when narrow. */
export function AtPair({ children }: { children: React.ReactNode }) {
  return (
    <div className="at-pair">
      <InPair.Provider value={true}>{children}</InPair.Provider>
    </div>
  );
}

/**
 * A section: a card with its name and a fold arrow. `also` names other sections it holds,
 * so searching for one of them opens this one. `startFolded` keeps it shut until opened.
 */
export function AtSection({
  id,
  title,
  also = [],
  startFolded = false,
  foldable = true,
  className = "",
  children,
}: {
  id: string;
  title?: string;
  also?: string[];
  startFolded?: boolean;
  /** The reading sample has no header to fold from. */
  foldable?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [folded, setFolded] = useState(() => foldable && wasFolded(id, startFolded));
  const head = useId();
  useEffect(() => {
    const open = (e: Event) => {
      const wanted = (e as CustomEvent<string>).detail;
      if (wanted === id || also.includes(wanted)) {
        setFolded(false);
        saveIn(FOLDED_KEY, id, false);
        saveIn(OPENED_KEY, id, true);
      }
    };
    window.addEventListener("tbv:unfold-section", open);
    return () => window.removeEventListener("tbv:unfold-section", open);
  }, [id, also.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    saveIn(FOLDED_KEY, id, next);
    saveIn(OPENED_KEY, id, !next);
  };
  return (
    <section className={`at-section${folded ? " is-folded" : ""} ${className}`.trim()} id={`settings-${id}`} aria-labelledby={title ? head : undefined}>
      {also.map((a) => (
        <span key={a} id={`settings-${a}`} className="at-anchor" aria-hidden />
      ))}
      {title && (
        <header className="at-head">
          <h2 id={head}>{title}</h2>
          {foldable && (
            <button type="button" className="at-fold" aria-expanded={!folded} aria-label={folded ? `Open ${title}` : `Fold ${title}`} onClick={toggle}>
              <Icon name="chevronDown" size={16} />
            </button>
          )}
        </header>
      )}
      {!folded && children}
    </section>
  );
}

/** The rows of a section, split by thin lines. */
export function AtRows({ children }: { children: React.ReactNode }) {
  return <div className="at-rows">{children}</div>;
}

/** One setting: its name (and a line under it) on the left, the control on the right. */
export function AtRow({ label, hint, children, wide }: { label: string; hint?: React.ReactNode; children?: React.ReactNode; /** Choice bars and sliders: under the name inside a pair. */ wide?: boolean }) {
  const paired = useContext(InPair);
  return (
    <div className={`at-row${wide && paired ? " is-stacked" : ""}${wide ? " is-wide" : ""}`}>
      <div className="at-row-text">
        <span className="at-row-label">{label}</span>
        {hint && <span className="at-row-hint">{hint}</span>}
      </div>
      <div className="at-row-control">{children}</div>
    </div>
  );
}

/** A switch on the right of its name. */
export function AtSwitch({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <AtRow label={label} hint={hint}>
      <button type="button" role="switch" className="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
        <span className="switch-knob" aria-hidden />
      </button>
    </AtRow>
  );
}

/** A bar of choices, each the same width, filling the control's column. */
export function AtChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; style?: React.CSSProperties }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`segmented at-choice ${className}`.trim()} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} style={o.style} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A slider with its value on the right and the two ends named under it. */
export function AtSlider({
  label,
  value,
  min,
  max,
  step = 1,
  shown,
  low,
  high,
  list,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** The value as words, shown on the right; left out where a number means nothing. */
  shown?: string;
  low: string;
  high: string;
  list?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="at-slider">
      <input type="range" min={min} max={max} step={step} value={value} list={list} aria-label={label} aria-valuetext={shown} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="at-slider-value">{shown}</span>
      <span className="at-slider-ends" aria-hidden>
        <span>{low}</span>
        <span>{high}</span>
      </span>
    </div>
  );
}

/** A row that opens to show more under it, like "How TBV treats your files". */
export function AtMore({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const key = `more:${id}`;
  const [open, setOpen] = useState(() => readSet(OPENED_KEY).has(key));
  return (
    <div className={`at-more${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="at-more-head"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          saveIn(OPENED_KEY, key, !open);
        }}
      >
        {label}
        <Icon name="chevronDown" size={16} />
      </button>
      {open && <div className="at-more-body">{children}</div>}
    </div>
  );
}
