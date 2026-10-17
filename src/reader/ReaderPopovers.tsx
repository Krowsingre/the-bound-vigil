import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HighlightColor } from "../api/types";
import { Icon } from "../components/Icon";
import {
  FONTS,
  HIGHLIGHT_COLORS,
  LINE_HEIGHTS,
  PAGE_COLORS,
  SIZE_RANGE,
  type ReaderSettings,
  type ReadingFlow,
  type ReadingTheme,
  type ReadingWidth,
} from "./settings";

function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
  wrap = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; style?: React.CSSProperties }[];
  onChange: (value: T) => void;
  /** Lets buttons keep their natural width and flow onto a second line. */
  wrap?: boolean;
}) {
  return (
    <fieldset className="choice">
      <legend>{label}</legend>
      <div className={`choice-row${wrap ? " is-wrapping" : ""}`} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? "is-active" : undefined}
            style={o.style}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const THEME_OPTIONS: { value: ReadingTheme; label: string; style?: React.CSSProperties }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light", style: { background: PAGE_COLORS.light.background, color: PAGE_COLORS.light.text } },
  { value: "paper", label: "Paper", style: { background: PAGE_COLORS.paper.background, color: PAGE_COLORS.paper.text } },
  { value: "dark", label: "Dark", style: { background: PAGE_COLORS.dark.background, color: PAGE_COLORS.dark.text } },
];

/** The Aa panel: how the book text looks. */
export function TextSettings({ settings, onChange }: { settings: ReaderSettings; onChange: (s: Partial<ReaderSettings>) => void }) {
  return (
    <div className="text-settings">
      <Choice
        label="Font"
        wrap
        value={settings.font}
        options={FONTS.map((f) => ({
          ...f,
          style: { fontFamily: f.value === "lora" ? '"Lora", serif' : f.value === "georgia" ? "var(--font-serif)" : f.value === "sans" ? "var(--font-sans)" : f.value === "echolume" ? '"Echolume", sans-serif' : undefined },
        }))}
        onChange={(font) => onChange({ font })}
      />
      <fieldset className="choice">
        <legend>Text size</legend>
        <div className="size-row">
          <button
            type="button"
            className="icon-btn"
            aria-label="Smaller text"
            disabled={settings.size <= SIZE_RANGE.min}
            onClick={() => onChange({ size: settings.size - SIZE_RANGE.step })}
          >
            <span className="size-a size-a-small">A</span>
          </button>
          <input
            type="range"
            min={SIZE_RANGE.min}
            max={SIZE_RANGE.max}
            step={SIZE_RANGE.step}
            value={settings.size}
            aria-label="Text size"
            onChange={(e) => onChange({ size: Number(e.target.value) })}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Larger text"
            disabled={settings.size >= SIZE_RANGE.max}
            onClick={() => onChange({ size: settings.size + SIZE_RANGE.step })}
          >
            <span className="size-a size-a-large">A</span>
          </button>
          <span className="size-value">{settings.size}</span>
        </div>
      </fieldset>
      <Choice
        label="Line spacing"
        value={settings.lineHeight}
        options={LINE_HEIGHTS.map((h) => ({ value: h, label: h.toFixed(1) }))}
        onChange={(lineHeight) => onChange({ lineHeight })}
      />
      <Choice<ReadingWidth>
        label="Page width"
        value={settings.width}
        options={[
          { value: "narrow", label: "Narrow" },
          { value: "medium", label: "Medium" },
          { value: "wide", label: "Wide" },
        ]}
        onChange={(width) => onChange({ width })}
      />
      <Choice<ReadingFlow>
        label="Moving through the book"
        value={settings.flow}
        options={[
          { value: "paginated", label: "Turn pages" },
          { value: "scrolled", label: "Scroll" },
        ]}
        onChange={(flow) => onChange({ flow })}
      />
      <Choice<ReadingTheme> label="Page colour" value={settings.theme} options={THEME_OPTIONS} onChange={(theme) => onChange({ theme })} />
      <label className="check-row">
        <input type="checkbox" checked={settings.justify} onChange={(e) => onChange({ justify: e.target.checked })} />
        Justify text (even right edge)
      </label>
    </div>
  );
}

/** Keeps a floating toolbar inside the window, above (or below) a rectangle. */
function useFloating(rect: DOMRect) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, rect.left + rect.width / 2 - w / 2));
    const above = rect.top - h - 10;
    const top = above > 60 ? above : Math.min(window.innerHeight - h - 8, rect.bottom + 10);
    setPos({ left, top });
  }, [rect]);
  return { ref, style: pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" as const } };
}

/** Shown over selected words: four colours, a note, copy. */
export function SelectionToolbar({
  rect,
  activeColor,
  hasNote,
  onColor,
  onNote,
  onCopy,
  onDelete,
}: {
  rect: DOMRect;
  /** Set when the toolbar is for an existing highlight. */
  activeColor?: HighlightColor | null;
  hasNote?: boolean;
  onColor: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onDelete?: () => void;
}) {
  const { ref, style } = useFloating(rect);
  return (
    <div ref={ref} className="selection-toolbar" style={style} role="toolbar" aria-label="Highlight" onPointerDown={(e) => e.preventDefault()}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`swatch${activeColor === c.value ? " is-active" : ""}`}
          style={{ ["--swatch" as string]: c.hex }}
          aria-label={`Highlight ${c.label}`}
          title={`Highlight ${c.label}`}
          onClick={() => onColor(c.value)}
        />
      ))}
      <span className="selection-rule" aria-hidden />
      <button type="button" className="selection-btn" onClick={onNote}>
        <Icon name="note" size={16} /> {hasNote ? "Edit note" : "Add a note"}
      </button>
      <button type="button" className="icon-btn icon-btn-s" aria-label="Copy" title="Copy" onClick={onCopy}>
        <Icon name="copy" size={16} />
      </button>
      {onDelete && (
        <button type="button" className="icon-btn icon-btn-s" aria-label="Remove highlight" title="Remove highlight" onClick={onDelete}>
          <Icon name="trash" size={16} />
        </button>
      )}
    </div>
  );
}

/** Writing or editing the note attached to a highlight. */
export function NoteDialog({
  excerpt,
  initial,
  onSave,
  onCancel,
}: {
  excerpt: string;
  initial: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
    area.current?.setSelectionRange(text.length, text.length);
    // Focus once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dialog note-dialog"
        role="dialog"
        aria-label={initial ? "Edit note" : "Add a note"}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSave(text);
        }}
      >
        <h2>{initial ? "Edit note" : "Add a note"}</h2>
        <blockquote>{excerpt}</blockquote>
        <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Your thoughts…" />
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save note
          </button>
        </div>
      </form>
    </div>
  );
}
