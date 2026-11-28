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
/**
 * Set on a phone: the same pages drawn as an iPhone's own settings (embre, 28 November):
 * small grey headers over grouped lists, choices that open in place under their row, and
 * sliders across the whole width. Nothing folds, and pairs stack.
 */
export const AttunePhone = createContext(false);
export const usePhone = () => useContext(AttunePhone);
/** A page within a phone's page (a friend on Account): its title and the way back, shown in the nav bar. */
export interface PhoneSub {
  title: string;
  back: string;
  onBack: () => void;
}
export const PhoneSubPage = createContext<(sub: PhoneSub | null) => void>(() => undefined);

/** A page of the framework: its sections one under another. */
export function AtPage({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const phone = usePhone();
  return (
    <AttuneFrame.Provider value={true}>
      <div className={`at-page${phone ? " is-ios" : ""} ${className}`.trim()}>{children}</div>
    </AttuneFrame.Provider>
  );
}

/** Two short sections side by side, the same height, one above the other when narrow. */
export function AtPair({ children }: { children: React.ReactNode }) {
  if (usePhone()) return <>{children}</>;
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
  const phone = usePhone();
  const [folded, setFolded] = useState(() => !phone && foldable && wasFolded(id, startFolded));
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
  if (phone)
    return (
      <section className={`at-section at-ios-section ${className}`.trim()} id={`settings-${id}`} aria-labelledby={title ? head : undefined}>
        {also.map((a) => (
          <span key={a} id={`settings-${a}`} className="at-anchor" aria-hidden />
        ))}
        {title && (
          <h2 id={head} className="at-ios-head">
            {title}
          </h2>
        )}
        <div className="at-ios-card">{children}</div>
      </section>
    );
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
export function AtRow({ label, hint, children, wide }: { label: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode; /** Choice bars and sliders: under the name inside a pair. */ wide?: boolean }) {
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
  const phone = usePhone();
  if (phone && className.includes("is-swatches"))
    return <AtSwatches label={label} value={value} options={options.map((o) => ({ value: o.value, label: o.label, background: String(o.style?.background ?? "") }))} onChange={onChange} />;
  if (phone) return <PhoneChoice label={label} value={value} options={options} onChange={onChange} />;
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
  letters,
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
  /** A small and a big A at the ends, for text sizes. */
  letters?: boolean;
  onChange: (value: number) => void;
}) {
  if (usePhone())
    return (
      <>
        {shown && <span className="at-ios-slider-value">{shown}</span>}
        <span className="at-ios-slider">
          <span className={`at-ios-slider-end${letters ? " is-small-a" : ""}`} aria-hidden>
            {letters ? "A" : low}
          </span>
          <input type="range" min={min} max={max} step={step} value={value} list={list} aria-label={label} aria-valuetext={shown} onChange={(e) => onChange(Number(e.target.value))} />
          <span className={`at-ios-slider-end${letters ? " is-big-a" : ""}`} aria-hidden>
            {letters ? "A" : high}
          </span>
        </span>
      </>
    );
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

/** A row that opens to show more under it, like Files. */
export function AtMore({ id, label, count, children }: { id: string; label: string; /** Shown on the right, as how many things it holds. */ count?: number; children: React.ReactNode }) {
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
        <span className="at-more-label">{label}</span>
        {count !== undefined && <span className="at-more-count">{count}</span>}
        <Icon name="chevronDown" size={16} />
      </button>
      {open && <div className="at-more-body">{children}</div>}
    </div>
  );
}

/**
 * A phone's choice: the row shows what's chosen, and tapping it opens the choices under it,
 * in place, each with a tick for the one chosen (embre, 28 November). Never a new page.
 */
export function PhoneChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; style?: React.CSSProperties }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value)?.label ?? "";
  return (
    <>
      <button type="button" className={`at-ios-value${open ? " is-open" : ""}`} aria-expanded={open} aria-label={`${label}: ${chosen}`} onClick={() => setOpen(!open)}>
        <span>{chosen}</span>
        <Icon name="chevronRight" size={16} />
      </button>
      {open && (
        <span className="at-ios-options" role="radiogroup" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={o.value === value}
              className="at-ios-option"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span style={o.style?.fontFamily ? { fontFamily: o.style.fontFamily } : undefined}>{o.label}</span>
              {o.value === value && <Icon name="check" size={18} />}
            </button>
          ))}
        </span>
      )}
    </>
  );
}

/** Round colour swatches with their names under them, for a phone's Theme and Page colour. */
export function AtSwatches<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; background: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="at-ios-swatches" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="at-ios-swatch" onClick={() => onChange(o.value)}>
          <span className="at-ios-swatch-face" style={{ background: o.background }} aria-hidden />
          <span className="at-ios-swatch-name">{o.label}</span>
        </button>
      ))}
    </span>
  );
}
