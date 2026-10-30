import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HighlightColor } from "../api/types";
import { Icon } from "../components/Icon";
import { isApp, isIOS } from "../api";
import { formatRate, groupVoices, primaryLang, RATE_RANGE } from "./readAloud";
import {
  FONTS,
  HIGHLIGHT_COLORS,
  LINE_HEIGHTS,
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
  type ReadingWidth,
} from "./settings";
import type { ReadAloud } from "./useReadAloud";
import type { ReadAlong } from "./useReadAlong";
import { liningUp, onLiningUp, type LiningUp } from "../readAlong/lineUp";
import { PauseLiningUpButton, pausedUntilText, usePause } from "../readAlong/PauseLiningUp";

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
      <Choice<ReadingTheme> label="Page colour" value={settings.theme} options={THEME_OPTIONS} onChange={(theme) => onChange({ theme })} />
      <label className="check-row">
        <input type="checkbox" checked={settings.justify} onChange={(e) => onChange({ justify: e.target.checked })} />
        Justify text (even right edge)
      </label>
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
  const label = zoom === "fit-page" ? "Fit page" : zoom === "fit-width" ? "Fit width" : `${Math.round(scale * 100)}%`;
  const next = zoom === "fit-page" ? "fit-width" : "fit-page";
  return (
    <span className={`zoom-controls${compact ? " is-compact" : ""}`} role="group" aria-label="Zoom">
      <button
        type="button"
        className="icon-btn"
        aria-label="Zoom out (Ctrl −)"
        title="Zoom out (Ctrl −)"
        disabled={scale <= ZOOM_RANGE.min + 0.001}
        onClick={() => onChange(zoomStep(scale, -1))}
      >
        <Icon name="minus" size={18} />
      </button>
      <button
        type="button"
        className="zoom-value"
        title={next === "fit-width" ? "Fit the page's width to the screen" : "Fit the whole page on screen (Ctrl 0)"}
        aria-label={`${label}. ${next === "fit-width" ? "Switch to fit width" : "Switch to fit page"}`}
        onClick={() => onChange(next)}
      >
        {label}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Zoom in (Ctrl +)"
        title="Zoom in (Ctrl +)"
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
}: {
  settings: ReaderSettings;
  scale: number;
  onChange: (s: Partial<ReaderSettings>) => void;
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
        <p className="settings-hint">The first page (the cover) shows on its own.</p>
      )}
      {settings.pageSpread !== "one" && settings.pageFlow === "scrolled" && (
        <p className="settings-hint">Scrolling shows one page under another.</p>
      )}
      <Choice<ReadingFlow>
        label="Moving through the book"
        value={settings.pageFlow}
        options={[
          { value: "paginated", label: "Turn pages" },
          { value: "scrolled", label: "Scroll" },
        ]}
        onChange={(pageFlow) => onChange({ pageFlow })}
      />
      <Choice<ReadingTheme> label="Colour around the pages" value={settings.theme} options={THEME_OPTIONS} onChange={(theme) => onChange({ theme })} />
    </div>
  );
}

/** The read aloud player: play and pause, sentence by sentence, voice and speed. */
export function ReadAloudPlayer({
  readAloud: ra,
  lang,
  settings,
  onChange,
}: {
  readAloud: ReadAloud;
  /** The book's language, whose voices are listed first. */
  lang: string | null;
  settings: ReaderSettings;
  onChange: (s: Partial<ReaderSettings>) => void;
}) {
  if (ra.unavailable) return <p className="read-aloud-note">{ra.unavailable}</p>;
  const playing = ra.status === "playing";
  const stopped = ra.status === "stopped";
  const noVoices = ra.voices.length === 0;
  const { matching, other } = groupVoices(ra.voices, lang);
  const key = primaryLang(lang);
  const chosen = settings.voices[key] ?? "";
  const option = (v: SpeechSynthesisVoice) => (
    <option key={v.voiceURI} value={v.voiceURI}>
      {v.name}
      {v.lang ? ` (${v.lang})` : ""}
    </option>
  );
  return (
    <div className="read-aloud">
      <div className="read-aloud-controls" role="group" aria-label="Read aloud">
        <button type="button" className="icon-btn" aria-label="Previous sentence" title="Previous sentence" disabled={stopped} onClick={ra.prevSentence}>
          <Icon name="skipBack" size={20} />
        </button>
        <button
          type="button"
          className="read-aloud-play"
          aria-label={playing ? "Pause (R)" : "Read aloud (R)"}
          title={playing ? "Pause (R)" : "Read aloud (R)"}
          onClick={ra.toggle}
        >
          <Icon name={playing ? "pause" : "play"} size={22} filled={!playing} />
        </button>
        <button type="button" className="icon-btn" aria-label="Next sentence" title="Next sentence" disabled={stopped} onClick={ra.nextSentence}>
          <Icon name="skipForward" size={20} />
        </button>
        <button type="button" className="icon-btn" aria-label="Stop" title="Stop" disabled={stopped} onClick={ra.stop}>
          <Icon name="stop" size={18} />
        </button>
      </div>
      <p className="read-aloud-note" role="status">
        {ra.error ??
          (noVoices && stopped
            ? isApp
              ? "No voices were listed yet. If nothing is heard, add voices in Windows Settings › Time & language › Speech."
              : "Uses this device's own voice. Others can be chosen here once the device lists them."
            : playing
              ? "Reading. The pages turn as it goes."
              : ra.status === "paused"
                ? "Paused."
                : "Starts from the first sentence on this page.")}
      </p>
      <fieldset className="choice">
        <legend>Voice</legend>
        <select
          className="settings-select read-aloud-voice"
          aria-label="Voice"
          value={chosen}
          disabled={noVoices}
          onChange={(e) => {
            const voices = { ...settings.voices };
            if (e.target.value) voices[key] = e.target.value;
            else delete voices[key];
            onChange({ voices });
          }}
        >
          <option value="">{ra.voice && !chosen ? `Automatic: ${ra.voice.name}` : "Automatic"}</option>
          {matching.length > 0 && <optgroup label="For this book's language">{matching.map(option)}</optgroup>}
          {other.length > 0 && (matching.length > 0 ? <optgroup label="Other languages">{other.map(option)}</optgroup> : other.map(option))}
        </select>
      </fieldset>
      <fieldset className="choice">
        <legend>Speed</legend>
        <div className="size-row">
          <input
            type="range"
            min={RATE_RANGE.min}
            max={RATE_RANGE.max}
            step={RATE_RANGE.step}
            value={settings.rate}
            aria-label="Speed"
            aria-valuetext={formatRate(settings.rate)}
            onChange={(e) => onChange({ rate: Math.round(Number(e.target.value) * 10) / 10 })}
          />
          <button type="button" className="read-aloud-rate" title="Back to normal speed" onClick={() => onChange({ rate: 1 })}>
            {formatRate(settings.rate)}
          </button>
        </div>
      </fieldset>
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

/** Listening along with the linked audiobook, and how far the pair is lined up. */
export function ListenAlongPanel({ readAlong, ebookId }: { readAlong: ReadAlong; ebookId: string }) {
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
      <div className="read-aloud listen-along">
        <button type="button" className="btn btn-primary" onClick={readAlong.toggle}>
          <Icon name={readAlong.playing ? "pause" : "play"} size={16} /> {readAlong.playing ? "Pause the audiobook" : "Play the audiobook"}
        </button>
        <p className="read-aloud-note" role="status">
          This is a document, so TBV can't follow the narrator through it. Turn the pages yourself as it plays.
        </p>
      </div>
    );
  return (
    <div className="read-aloud listen-along">
      <button type="button" className="btn btn-primary" disabled={waiting} onClick={readAlong.toggle}>
        <Icon name={readAlong.following ? "pause" : "headphones"} size={16} /> {readAlong.following ? "Stop following" : "Play and follow"}
      </button>
      {!waiting ? (
        <p className="read-aloud-note" role="status">
          {lineUp?.failed
            ? `TBV couldn't line this book up with the audiobook word by word (${lineUp.failed}), so it follows by chapter. The highlight can be a sentence or two out.`
            : lineUp?.done
              ? "Follows the narrator word by word."
              : "Follows by chapter, so the highlight can be a sentence or two out."}
        </p>
      ) : (
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
                  ? "TBV lines up every word in the background on a computer with TBV open, or on this phone if you turn it on in Preferences › Reading › Read-along."
                  : "TBV lines up every word in the background, one pair at a time, on each device that has both the book and the audiobook downloaded."
                  : "TBV lines up every word in the app on your computer or phone."}{" "}
            Until it's done you can read the book or listen to the audiobook, but not both together.
          </p>
          {isApp && <PauseLiningUpButton pauseLabel="Pause Confluence" resumeLabel="Carry on with Confluence" />}
        </div>
      )}
    </div>
  );
}
