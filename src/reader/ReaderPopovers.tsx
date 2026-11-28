import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HighlightColor, WordDefinition, WordSense } from "../api/types";
import { Icon } from "../components/Icon";
import { isAndroid, isApp, isIOS } from "../api";

/** iPhones and iPads (and Android, and the web version on a touch screen): only they have the scroll-into-focus switch. */
const onTouchDevice = isIOS || isAndroid || (!isApp && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
import {
  FONTS,
  FADE_RANGE,
  fadeShown,
  HIGHLIGHT_COLORS,
  LINE_HEIGHT_NOTCHES,
  LINE_HEIGHT_RANGE,
  PAGE_COLORS,
  SIZE_RANGE,
  zoomStep,
  ZOOM_RANGE,
  type PageSpread,
  type TextSpread,
  type PageZoom,
  type ReaderSettings,
  type ReadingFlow,
  type ReadingTheme,
  type PageFlow,
  type PageCover,
  WIDTH_RANGE,
} from "./settings";
import type { ReadAlong } from "./useReadAlong";
import { liningUp, onLiningUp, type LiningUp } from "../readAlong/lineUp";
import { PauseLiningUpButton, pausedUntilText, usePause } from "../readAlong/PauseLiningUp";
import { useShortcuts } from "../lib/shortcuts";
import type { ReadingDirection } from "./useReaderEngine";

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

export const PAGE_THEME_OPTIONS: { value: ReadingTheme; label: string; style?: React.CSSProperties }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light", style: { background: PAGE_COLORS.light.background, color: PAGE_COLORS.light.text } },
  { value: "paper", label: "Paper", style: { background: PAGE_COLORS.paper.background, color: PAGE_COLORS.paper.text } },
  { value: "dark", label: "Dark", style: { background: PAGE_COLORS.dark.background, color: PAGE_COLORS.dark.text } },
  { value: "vesper", label: "Vesper", style: { background: PAGE_COLORS.vesper.background, color: PAGE_COLORS.vesper.text } },
];

function ScrollSpeeds({ settings, onChange }: { settings: ReaderSettings; onChange: (change: Partial<ReaderSettings>) => void }) {
  const keys = useShortcuts();
  return (
    <div>
      <label className="field">
        <span>Manual scroll speed</span>
        <input type="range" min={120} max={1200} step={60} value={settings.keyboardScrollSpeed}
          onChange={(event) => onChange({ keyboardScrollSpeed: Number(event.target.value) })} />
      </label>
      <label className="field">
        <span>Auto-scroll speed <output>{settings.autoScrollSpeed}%</output></span>
        <input type="range" aria-label="Auto-scroll speed" min={1} max={100} value={settings.autoScrollSpeed}
          onChange={(event) => onChange({ autoScrollSpeed: Number(event.target.value) })} />
      </label>
      <p className="settings-row-hint">{keys ? "Press Ctrl+Space to start or stop auto-scroll." : "Tap the page three times to start or stop auto-scroll."}</p>
    </div>
  );
}

/** This book's reading direction: what it is now, and what the book itself says. */
export interface DirectionControl {
  value: ReadingDirection;
  own: ReadingDirection;
  onChange: (direction: ReadingDirection) => void;
}

const DIRECTION_NAMES: Record<ReadingDirection, string> = { ltr: "Left to right", rtl: "Right to left" };

/** Which way this book's pages turn. Saved for this book only. */
function DirectionChoice({ direction }: { direction: DirectionControl }) {
  return (
    <>
      <Choice<ReadingDirection>
        label="Reading direction (this book)"
        value={direction.value}
        options={[
          { value: "ltr", label: DIRECTION_NAMES.ltr },
          { value: "rtl", label: DIRECTION_NAMES.rtl },
        ]}
        onChange={direction.onChange}
      />
      {direction.value !== direction.own && (
        <p className="settings-hint">The book itself says {DIRECTION_NAMES[direction.own].toLowerCase()}.</p>
      )}
    </>
  );
}

/** The Aa panel: how the book text looks. */
export function TextSettings({ settings, onChange, direction }: { settings: ReaderSettings; onChange: (s: Partial<ReaderSettings>) => void; /** In the reader, for the open book; not in Attune. */ direction?: DirectionControl }) {
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
      <fieldset className="choice">
        <legend>Line spacing</legend>
        <div className="size-row line-row">
          <input
            type="range"
            min={LINE_HEIGHT_RANGE.min}
            max={LINE_HEIGHT_RANGE.max}
            step={LINE_HEIGHT_RANGE.step}
            value={settings.lineHeight}
            list="reader-line-notches"
            aria-label="Line spacing"
            onChange={(e) => onChange({ lineHeight: Math.round(Number(e.target.value) * 10) / 10 })}
          />
          <datalist id="reader-line-notches">
            {LINE_HEIGHT_NOTCHES.map((n) => (
              <option key={n} value={n} label={n.toFixed(1)} />
            ))}
          </datalist>
          <span className="size-value">{settings.lineHeight.toFixed(1)}</span>
        </div>
      </fieldset>
      <fieldset className="choice">
        <legend>Page width</legend>
        <div className="size-row line-row">
          <input
            type="range"
            min={WIDTH_RANGE.min}
            max={WIDTH_RANGE.max}
            step={WIDTH_RANGE.step}
            value={settings.width}
            aria-label="Page width"
            aria-valuetext={widthShown(settings.width)}
            onChange={(e) => onChange({ width: Number(e.target.value) })}
          />
          <span className="size-value">{widthShown(settings.width)}</span>
        </div>
      </fieldset>
      <Choice<ReadingFlow>
        label="Moving through the book"
        value={settings.flow}
        options={[
          { value: "paginated", label: "Turn pages" },
          { value: "scrolled", label: "Scroll" },
        ]}
        onChange={(flow) => onChange({ flow })}
      />
      {direction && <DirectionChoice direction={direction} />}
      <ScrollSpeeds settings={settings} onChange={onChange} />
      {settings.flow === "paginated" && (
        <Choice<TextSpread>
          label="Pages at a time"
          value={settings.textSpread}
          options={[
            { value: "one", label: "One" },
            { value: "auto", label: "Two when there's room" },
          ]}
          onChange={(textSpread) => onChange({ textSpread })}
        />
      )}
      <Choice<ReadingTheme> label="Page colour" value={settings.theme} options={PAGE_THEME_OPTIONS} onChange={(theme) => onChange({ theme })} />
      <label className="check-row">
        <input type="checkbox" checked={settings.justify} onChange={(e) => onChange({ justify: e.target.checked })} />
        Justify text (even right edge)
      </label>
      {onTouchDevice && (
        <label className="check-row">
          <input type="checkbox" checked={settings.scrollFocus} onChange={(e) => onChange({ scrollFocus: e.target.checked })} />
          Scrolling turns on focus mode
        </label>
      )}
      <fieldset className="choice">
        <legend>Fade strength</legend>
        <div className="size-row">
          <span className="fade-end" aria-hidden>Off</span>
          <input type="range" min={FADE_RANGE.min} max={FADE_RANGE.max} step={FADE_RANGE.step} value={settings.fadeStrength}
            aria-label="Fade strength" aria-valuetext={fadeShown(settings.fadeStrength)}
            onChange={(e) => onChange({ fadeStrength: Number(e.target.value), edgeFade: Number(e.target.value) > 0 })} />
          <span className="fade-end" aria-hidden>Deep</span>
        </div>
      </fieldset>
    </div>
  );
}

const FONT_FACE: Record<string, string | undefined> = {
  lora: '"Lora", serif',
  georgia: "var(--font-serif)",
  sans: "var(--font-sans)",
  echolume: '"Echolume", sans-serif',
};

/** One row of choices drawn as cards (typeface, page width) or a two-way switch (reading mode). */
function Cards<T extends string>({ label, value, options, onChange, className = "" }: {
  label: string;
  value: T;
  options: { value: T; label: string; face?: React.ReactNode; style?: React.CSSProperties }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset className="look-section">
      <legend>{label}</legend>
      <div className={`look-cards ${className}`} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "is-active" : undefined} onClick={() => onChange(o.value)}>
            {o.face && <span className="look-face" style={o.style} aria-hidden>{o.face}</span>}
            <span className="look-card-label">{o.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Slider({ label, value, min, max, step, shown, low, high, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  shown: string;
  low: React.ReactNode;
  high: React.ReactNode;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <fieldset className="look-section">
      <legend>{label}</legend>
      <div className="look-slider">
        <span className="look-end" aria-hidden>{low}</span>
        <span className="look-track">
          <output className="look-value" style={{ left: `${fill}%` }}>{shown}</output>
          <input type="range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={shown}
            style={{ ["--fill" as string]: `${fill}%` }} onChange={(e) => onChange(Number(e.target.value))} />
        </span>
        <span className="look-end" aria-hidden>{high}</span>
      </div>
    </fieldset>
  );
}

/** The page width as a share of the usual width (680 pixels), which reads as "100%". */
export const widthShown = (width: number) => `${Math.round((width / 680) * 100)}%`;

const widthLines = (n: number) => <span className={`look-lines look-lines-${n}`}><i /><i /><i /><i /></span>;

/**
 * Aa: Reading Appearance, a sheet from the bottom. Typeface, text size,
 * line spacing, page width, swipe or scroll, page colour and justified text.
 */
export function ReadingAppearance({ settings, onChange, onClose, direction }: { settings: ReaderSettings; onChange: (s: Partial<ReaderSettings>) => void; onClose: () => void; direction: DirectionControl }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="look-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={sheet} className="look-sheet" role="dialog" aria-label="Reading appearance" tabIndex={-1}>
        <span className="look-handle" aria-hidden />
        <header className="look-head">
          <span className="look-head-aa" aria-hidden>Aa</span>
          <h2>Reading Appearance</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <Cards
          label="Typeface"
          className="look-fonts"
          value={settings.font}
          options={FONTS.map((f) => ({ ...f, face: "Aa", style: { fontFamily: FONT_FACE[f.value] } }))}
          onChange={(font) => onChange({ font })}
        />
        <Slider label="Text size" value={settings.size} min={SIZE_RANGE.min} max={SIZE_RANGE.max} step={SIZE_RANGE.step} shown={String(settings.size)}
          low={<span className="size-a size-a-small">A</span>} high={<span className="size-a size-a-large">A</span>} onChange={(size) => onChange({ size })} />
        <Slider label="Line spacing" value={settings.lineHeight} min={LINE_HEIGHT_RANGE.min} max={LINE_HEIGHT_RANGE.max} step={LINE_HEIGHT_RANGE.step}
          shown={settings.lineHeight.toFixed(1)} low={<Icon name="menu" size={18} />} high={<Icon name="menu" size={24} />}
          onChange={(v) => onChange({ lineHeight: Math.round(v * 10) / 10 })} />
        <Slider label="Page width" value={settings.width} min={WIDTH_RANGE.min} max={WIDTH_RANGE.max} step={WIDTH_RANGE.step}
          shown={widthShown(settings.width)} low={widthLines(1)} high={widthLines(3)} onChange={(width) => onChange({ width })} />
        <Cards<ReadingFlow>
          label="Reading mode"
          className="look-mode"
          value={settings.flow}
          options={[
            { value: "paginated", label: "Swipe", face: <Icon name="bookOpen" size={20} /> },
            { value: "scrolled", label: "Scroll", face: <Icon name="file" size={20} /> },
          ]}
          onChange={(flow) => onChange({ flow })}
        />
        {settings.flow === "paginated" ? (
          <Choice<TextSpread>
            label="Pages at a time"
            value={settings.textSpread}
            options={[
              { value: "one", label: "One" },
              { value: "auto", label: "Two when there's room" },
            ]}
            onChange={(textSpread) => onChange({ textSpread })}
          />
        ) : <ScrollSpeeds settings={settings} onChange={onChange} />}
        <Cards<ReadingDirection>
          label="Reading direction (this book)"
          className="look-mode"
          value={direction.value}
          options={[
            { value: "ltr", label: DIRECTION_NAMES.ltr, face: <Icon name="arrowRight" size={20} /> },
            { value: "rtl", label: DIRECTION_NAMES.rtl, face: <Icon name="arrowLeft" size={20} /> },
          ]}
          onChange={direction.onChange}
        />
        {direction.value !== direction.own && <p className="settings-hint">The book itself says {DIRECTION_NAMES[direction.own].toLowerCase()}.</p>}
        <fieldset className="look-section">
          <legend>Page colour</legend>
          <div className="look-colours" role="radiogroup" aria-label="Page colour">
            {PAGE_THEME_OPTIONS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={settings.theme === o.value} className={settings.theme === o.value ? "is-active" : undefined}
                onClick={() => onChange({ theme: o.value })}>
                <span className={`look-swatch look-swatch-${o.value}`} style={o.value === "auto" ? undefined : { background: o.style?.background }} aria-hidden />
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="look-section look-justify">
          <span id="look-justify">Justify text</span>
          <button type="button" role="switch" className="switch" aria-labelledby="look-justify" aria-checked={settings.justify} onClick={() => onChange({ justify: !settings.justify })}>
            <span className="switch-knob" aria-hidden />
          </button>
        </div>
        {onTouchDevice && (
          <div className="look-section look-justify">
            <span id="look-scroll-focus">Scrolling turns on focus mode</span>
            <button type="button" role="switch" className="switch" aria-labelledby="look-scroll-focus" aria-checked={settings.scrollFocus} onClick={() => onChange({ scrollFocus: !settings.scrollFocus })}>
              <span className="switch-knob" aria-hidden />
            </button>
          </div>
        )}
        <Slider label="Fade strength" value={settings.fadeStrength} min={FADE_RANGE.min} max={FADE_RANGE.max} step={FADE_RANGE.step}
          shown={fadeShown(settings.fadeStrength)} low={<span className="fade-end">Off</span>} high={<span className="fade-end">Deep</span>}
          onChange={(fadeStrength) => onChange({ fadeStrength, edgeFade: fadeStrength > 0 })} />
      </div>
    </div>
  );
}

/** The zoom buttons: smaller, the size shown now (or how it fits), larger. */
export function ZoomControls({
  zoom,
  scale,
  onChange,
  compact = false,
}: {
  zoom: PageZoom;
  /** The scale shown now, 1 being the page's own size. */
  scale: number;
  onChange: (zoom: PageZoom) => void;
  compact?: boolean;
}) {
  const keys = useShortcuts();
  const label = zoom === "fit-page" ? "Fit page" : zoom === "fit-width" ? "Fit width" : `${Math.round(scale * 100)}%`;
  const next = zoom === "fit-page" ? "fit-width" : "fit-page";
  return (
    <span className={`zoom-controls${compact ? " is-compact" : ""}`} role="group" aria-label="Zoom">
      <button
        type="button"
        className="icon-btn"
        aria-label={keys ? "Zoom out (Ctrl −)" : "Zoom out"}
        title={keys ? "Zoom out (Ctrl −)" : "Zoom out"}
        disabled={scale <= ZOOM_RANGE.min + 0.001}
        onClick={() => onChange(zoomStep(scale, -1))}
      >
        <Icon name="minus" size={18} />
      </button>
      <button
        type="button"
        className="zoom-value"
        title={next === "fit-width" ? "Fit the page's width to the screen" : `Fit the whole page on screen${keys ? " (Ctrl 0)" : ""}`}
        aria-label={`${label}. ${next === "fit-width" ? "Switch to fit width" : "Switch to fit page"}`}
        onClick={() => onChange(next)}
      >
        {label}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={keys ? "Zoom in (Ctrl +)" : "Zoom in"}
        title={keys ? "Zoom in (Ctrl +)" : "Zoom in"}
        disabled={scale >= ZOOM_RANGE.max - 0.001}
        onClick={() => onChange(zoomStep(scale, 1))}
      >
        <Icon name="plus" size={18} />
      </button>
    </span>
  );
}

/** The page panel for PDFs and comics: size, one or two pages, turning or scrolling. */
export function PageSettings({
  settings,
  scale,
  onChange,
  direction,
}: {
  settings: ReaderSettings;
  scale: number;
  onChange: (s: Partial<ReaderSettings>) => void;
  direction: DirectionControl;
}) {
  return (
    <div className="text-settings">
      <fieldset className="choice">
        <legend>Size</legend>
        <ZoomControls zoom={settings.pageZoom} scale={scale} onChange={(pageZoom) => onChange({ pageZoom })} />
      </fieldset>
      <Choice<"fit-page" | "fit-width" | "set">
        label="Fit"
        value={typeof settings.pageZoom === "number" ? "set" : settings.pageZoom}
        options={[
          { value: "fit-page", label: "Whole page" },
          { value: "fit-width", label: "Page width" },
          { value: "set", label: "Set size" },
        ]}
        onChange={(fit) => onChange({ pageZoom: fit === "set" ? Math.round(scale * 100) / 100 : fit })}
      />
      <Choice<PageSpread>
        label="Pages at a time"
        value={settings.pageSpread}
        options={[
          { value: "one", label: "One" },
          { value: "two", label: "Two" },
          { value: "auto", label: "Two when wide" },
        ]}
        onChange={(pageSpread) => onChange({ pageSpread })}
      />
      {settings.pageSpread !== "one" && settings.pageFlow === "paginated" && (
        <Choice<PageCover>
          label="The cover"
          value={settings.pageCover}
          options={[
            { value: "alone", label: "On its own" },
            { value: "paired", label: "Paired with page 2" },
          ]}
          onChange={(pageCover) => onChange({ pageCover })}
        />
      )}
      {settings.pageSpread !== "one" && settings.pageFlow !== "paginated" && (
        <p className="settings-hint">Scrolling shows one page under another.</p>
      )}
      <Choice<PageFlow>
        label="Moving through the book"
        value={settings.pageFlow}
        options={[
          { value: "paginated", label: "Swipe" },
          { value: "scrolled", label: "Scroll" },
          { value: "strip", label: "Vertical strip" },
        ]}
        onChange={(pageFlow) => onChange({ pageFlow })}
      />
      {settings.pageFlow === "strip" && <p className="settings-hint">One unbroken column with no room between pages, for webtoons.</p>}
      {direction && <DirectionChoice direction={direction} />}
      <ScrollSpeeds settings={settings} onChange={onChange} />
      <Choice<ReadingTheme> label="Colour around the pages" value={settings.theme} options={PAGE_THEME_OPTIONS} onChange={(theme) => onChange({ theme })} />
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

/**
 * Shown over selected words: four colours, a note, copy, and looking the words up.
 * `docked` (the iPhone): a bar at the foot of the screen with only the colours,
 * the note and removing, so it never covers iOS's own menu by the words, which
 * already has Copy, Look Up and Translate (embre, 19 November).
 */
export function SelectionToolbar({
  rect,
  docked = false,
  activeColor,
  hasNote,
  onColor,
  onNote,
  onCopy,
  onDelete,
  onDefine,
  onSearch,
  onTranslate,
}: {
  rect: DOMRect;
  docked?: boolean;
  /** Set when the toolbar is for an existing highlight. */
  activeColor?: HighlightColor | null;
  hasNote?: boolean;
  onColor: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onDelete?: () => void;
  onDefine?: () => void;
  onSearch?: () => void;
  onTranslate?: () => void;
}) {
  const { ref, style } = useFloating(rect);
  return (
    <div
      ref={ref}
      className={`selection-toolbar${docked ? " is-docked" : ""}`}
      style={docked ? undefined : style}
      role="toolbar"
      aria-label="Highlight"
      onPointerDown={(e) => e.preventDefault()}
    >
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
        <Icon name="note" size={16} /> <span className="selection-label">{hasNote ? "Edit note" : "Add a note"}</span>
      </button>
      {!docked && (
        <button type="button" className="icon-btn icon-btn-s" aria-label="Copy" title="Copy" onClick={onCopy}>
          <Icon name="copy" size={16} />
        </button>
      )}
      {!docked && onDefine && (
        <button type="button" className="icon-btn icon-btn-s" aria-label="Define" title="Define" onClick={onDefine}>
          <Icon name="bookOpen" size={16} />
        </button>
      )}
      {!docked && onSearch && (
        <button type="button" className="icon-btn icon-btn-s" aria-label="Search the web" title="Search the web" onClick={onSearch}>
          <Icon name="search" size={16} />
        </button>
      )}
      {!docked && onTranslate && (
        <button type="button" className="icon-btn icon-btn-s" aria-label="Translate" title="Translate" onClick={onTranslate}>
          <Icon name="translate" size={16} />
        </button>
      )}
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

/** How far the book and its audiobook are lined up, word by word, for following the narrator. */
export function LiningUpStatus({ readAlong, ebookId }: { readAlong: ReadAlong; ebookId: string }) {
  const [work, setWork] = useState<LiningUp | null>(liningUp());
  const { paused, until } = usePause();
  useEffect(() => onLiningUp(setWork), []);
  const audiobookId = readAlong.audiobookId;
  const ours = work && work.ebookId === ebookId && work.audiobookId === audiobookId ? work : null;
  const lineUp = readAlong.lineUp;
  const waiting = readAlong.linesUp && !lineUp?.done && !lineUp?.failed;
  const percent = Math.floor((ours && ours.stage === "listening" ? ours.fraction : (lineUp?.fraction ?? 0)) * 100);
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
  if (readAlong.manual)
    return (
      <p className="read-aloud-note" role="status">
        This is a document, so TBV can't follow the narrator through it. Turn the pages yourself as it plays.
      </p>
    );
  if (!waiting)
    return (
      <p className="read-aloud-note" role="status">
        {lineUp?.failed
          ? `TBV couldn't line this book up with the audiobook word by word (${lineUp.failed}), so it follows by chapter. The highlight can be a sentence or two out.`
          : lineUp?.done
            ? "Follows the narrator word by word."
            : "Follows by chapter, so the highlight can be a sentence or two out."}
      </p>
    );
  return (
    <div className="listen-along-timing" role="status">
      <p className="read-aloud-note">
        <strong>Converging… {percent}%</strong>
        {ours?.stage === "model" && ours.modelTotal ? ` Getting the speech model: ${mb(ours.modelLoaded)} of ${mb(ours.modelTotal)}.` : ""}
      </p>
      <p className="read-aloud-note">
        {paused
          ? `Confluence is paused on this device ${pausedUntilText(until)}.`
          : ours?.stage === "cooling"
            ? "Confluence is paused while the phone cools down. It carries on by itself."
            : ours
            ? "TBV is listening through the audiobook and matching every word to the book, in the background."
            : isApp
              ? isIOS
              ? "TBV lines up every word in the background on a computer with TBV open, or on this phone if you turn it on in Attunement › Reading › Read-along."
              : "TBV lines up every word in the background, one pair at a time, on each device that has both the book and the audiobook downloaded."
              : "TBV lines up every word in the app on your computer or phone."}{" "}
        Until it's done you can read the book or listen to the audiobook, but not both together.
      </p>
      {isApp && <PauseLiningUpButton pauseLabel="Pause Confluence" resumeLabel="Carry on with Confluence" />}
    </div>
  );
}

const PART_LABEL: Record<WordSense["part"], string> = { noun: "noun", verb: "verb", adjective: "adjective", adverb: "adverb" };

/** What the selected word means, from the offline dictionary (Windows and Android). */
export function DefineCard({
  rect,
  text,
  definitions,
  onSearch,
  onClose,
}: {
  rect: DOMRect;
  text: string;
  definitions: WordDefinition[];
  onSearch: () => void;
  onClose: () => void;
}) {
  const { ref, style } = useFloating(rect);
  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [ref, onClose]);
  return (
    <div ref={ref} className="define-card" style={style} role="dialog" aria-label={`Meaning of ${text}`}>
      {definitions.length === 0 ? (
        <p className="define-none">
          No meaning found for <strong>{text}</strong>.
        </p>
      ) : (
        <div className="define-entries">
          {definitions.map((d) => {
            const parts = [...new Set(d.senses.map((s) => s.part))];
            return (
              <section key={d.word} className="define-entry">
                <h3 className="define-word">{d.word}</h3>
                {parts.map((part) => (
                  <div key={part} className="define-part">
                    <p className="define-part-name">{PART_LABEL[part]}</p>
                    <ol>
                      {d.senses
                        .filter((s) => s.part === part)
                        .map((s, i) => (
                          <li key={i}>
                            {s.definition}
                            {s.example && <span className="define-example"> “{s.example}”</span>}
                          </li>
                        ))}
                    </ol>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      <div className="define-foot">
        <span className="define-source">WordNet 3.1, Princeton University</span>
        <button type="button" className="selection-btn" onClick={onSearch}>
          <Icon name="search" size={14} /> Search the web
        </button>
      </div>
    </div>
  );
}
