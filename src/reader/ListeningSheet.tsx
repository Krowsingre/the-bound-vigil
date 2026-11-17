// Listening, from the reader's audio button: Narration (TBV reading the
// book aloud) and Immersion (the paired audiobook, with the text following
// the narrator) share one sheet, with a switch at the top. Closed while
// something plays, it folds into a slim bar at the bottom.

import { useEffect, useRef } from "react";
import { chapterAt, chapterLength, clock, SPEEDS, usePlayer } from "../audio/player";
import { Icon } from "../components/Icon";
import { LiningUpStatus } from "./ReaderPopovers";
import { formatRate, groupVoices, primaryLang, RATE_RANGE } from "./readAloud";
import type { ReaderSettings } from "./settings";
import type { ReadAloud } from "./useReadAloud";
import type { ReadAlong } from "./useReadAlong";

export type ListenMode = "narration" | "immersion";

/** Sleep timer: off, a number of minutes, or the end of the chapter. */
export type ListenTimer = { kind: "off" } | { kind: "minutes"; minutes: number; until: number } | { kind: "chapter" };
export const TIMER_MINUTES = [5, 10, 15, 30, 45, 60];

/** Narration has no clock of its own: its times are worked out from pages and speed. */
export interface NarrationPlace {
  chapters: { label: string; href: string; page: number | null }[];
  /** Index into `chapters` of the one being read. */
  current: number;
  /** Where in the chapter, and how long it is, in estimated milliseconds. */
  elapsedMs: number;
  totalMs: number;
  /** Goes to a place in the chapter (0–1). */
  seek: (fraction: number) => void;
  goChapter: (href: string) => void;
}

/** About how long TBV takes to read one page aloud at normal speed: a page is 1,500 bytes, about 180 words, at about 165 words a minute. */
export const MS_PER_PAGE = (180 / 165) * 60_000;

const remaining = (ms: number) => "−" + clock(Math.max(0, ms));

function Rate({ value, label, onLess, onMore, lessOff, moreOff }: { value: string; label: string; onLess: () => void; onMore: () => void; lessOff: boolean; moreOff: boolean }) {
  return (
    <span className="listen-rate" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label="Slower" disabled={lessOff} onClick={onLess}><Icon name="minus" size={16} /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" className="icon-btn" aria-label="Faster" disabled={moreOff} onClick={onMore}><Icon name="plus" size={16} /></button>
    </span>
  );
}

function Progress({ label, elapsed, total, onSeek, estimated }: { label: string; elapsed: number; total: number; onSeek: (fraction: number) => void; estimated: boolean }) {
  const fraction = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0;
  return (
    <div className="listen-progress">
      <div className="listen-progress-head">
        <span>{label}</span>
        {estimated && <span className="muted">Times are estimates</span>}
      </div>
      <input type="range" min={0} max={1} step={0.001} value={fraction} aria-label={label}
        aria-valuetext={`${clock(elapsed)} of ${clock(total)}`}
        style={{ ["--fill" as string]: `${fraction * 100}%` }}
        onChange={(e) => onSeek(Number(e.target.value))} />
      <div className="listen-progress-times">
        <span>{clock(elapsed)}</span>
        <span>{remaining(total - elapsed)}</span>
      </div>
    </div>
  );
}

function Controls({ playing, onPlay, onBack, onForward, onPrevChapter, onNextChapter, disabled }: {
  playing: boolean;
  onPlay: () => void;
  onBack: () => void;
  onForward: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="listen-controls" role="group" aria-label="Playback">
      <button type="button" className="listen-ctl" onClick={onPrevChapter} disabled={disabled}>
        <Icon name="skipBack" size={22} /><span>Back chapter</span>
      </button>
      <button type="button" className="listen-ctl" onClick={onBack} disabled={disabled}>
        <Icon name="undo" size={22} /><span>−30s</span>
      </button>
      <button type="button" className="listen-play" aria-label={playing ? "Pause" : "Play"} onClick={onPlay} disabled={disabled}>
        <Icon name={playing ? "pause" : "play"} size={28} filled={!playing} />
      </button>
      <button type="button" className="listen-ctl" onClick={onForward} disabled={disabled}>
        <Icon name="redo" size={22} /><span>+30s</span>
      </button>
      <button type="button" className="listen-ctl" onClick={onNextChapter} disabled={disabled}>
        <Icon name="skipForward" size={22} /><span>Next chapter</span>
      </button>
    </div>
  );
}

function TimerPick({ timer, onTimer }: { timer: ListenTimer; onTimer: (timer: ListenTimer) => void }) {
  const value = timer.kind === "off" ? "off" : timer.kind === "chapter" ? "chapter" : String(timer.minutes);
  const left = timer.kind === "minutes" ? Math.max(0, Math.ceil((timer.until - Date.now()) / 60_000)) : 0;
  return (
    <select aria-label="Sleep timer" value={value} onChange={(e) => {
      const v = e.target.value;
      onTimer(v === "off" ? { kind: "off" } : v === "chapter" ? { kind: "chapter" } : { kind: "minutes", minutes: Number(v), until: Date.now() + Number(v) * 60_000 });
    }}>
      <option value="off">Off</option>
      {TIMER_MINUTES.map((m) => <option key={m} value={m}>{timer.kind === "minutes" && timer.minutes === m ? `${m} min (${left} left)` : `${m} min`}</option>)}
      <option value="chapter">End of chapter</option>
    </select>
  );
}

export function ListeningSheet({ docked = false, mode, onMode, onClose, readAloud: ra, readAlong, ebookId, narration, settings, onSettings, lang, timer, onTimer }: {
  /** Computers: a drop-down under its button instead of a sheet from the bottom. */
  docked?: boolean;
  mode: ListenMode;
  onMode: (mode: ListenMode) => void;
  onClose: () => void;
  readAloud: ReadAloud;
  readAlong: ReadAlong;
  ebookId: string;
  narration: NarrationPlace;
  settings: ReaderSettings;
  onSettings: (change: Partial<ReaderSettings>) => void;
  lang: string | null;
  timer: ListenTimer;
  onTimer: (timer: ListenTimer) => void;
}) {
  const player = usePlayer();
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!docked) sheet.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Docked: a click anywhere but the drop-down or its button closes it, like the other drop-downs.
    const away = (e: Event) => {
      const root = sheet.current?.closest(".menu-root");
      if (!root?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", key);
    if (docked) document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", away);
    };
  }, [onClose, docked]);
  const paired = !!readAlong.audiobookId;
  const immersion = mode === "immersion" && paired;
  const audiobook = player.book && player.book.book.id === readAlong.audiobookId ? player.book : null;

  const switcher = (
    <div className="listen-modes" role="tablist" aria-label="Listening">
      <button type="button" role="tab" aria-selected={!immersion} className={!immersion ? "is-active" : undefined} onClick={() => onMode("narration")}>Narration</button>
      <button type="button" role="tab" aria-selected={immersion} className={immersion ? "is-active" : undefined} disabled={!paired}
        title={paired ? undefined : "Pair this book with its audiobook to listen along"} onClick={() => onMode("immersion")}>Immersion</button>
    </div>
  );

  let body: React.ReactNode;
  if (immersion) {
    const chapters = audiobook?.chapters ?? [];
    const index = audiobook ? chapterAt(chapters, player.positionMs) : 0;
    const start = chapters[index]?.startMs ?? 0;
    const length = audiobook ? chapterLength(audiobook, index) : 0;
    const waiting = readAlong.linesUp && !readAlong.lineUp?.done && !readAlong.lineUp?.failed;
    const speedAt = SPEEDS.indexOf(player.rate);
    body = (
      <>
        <p className="listen-title"><span className="muted">Audiobook:</span> {audiobook?.book.title ?? "Paired audiobook"}</p>
        <Controls
          playing={readAlong.playing}
          onPlay={readAlong.playPause}
          onBack={() => (audiobook ? player.skip(-30_000) : readAlong.playPause())}
          onForward={() => (audiobook ? player.skip(30_000) : readAlong.playPause())}
          onPrevChapter={() => audiobook && player.chapter(-1)}
          onNextChapter={() => audiobook && player.chapter(1)}
        />
        <div className="listen-rows">
          <label className="listen-row">
            <span className="listen-row-label"><Icon name="bookOpen" size={18} /> Chapter</span>
            <select value={index} disabled={!audiobook} onChange={(e) => player.seek(chapters[Number(e.target.value)]?.startMs ?? 0)}>
              {chapters.length ? chapters.map((c, i) => <option key={i} value={i}>{c.title || `Chapter ${i + 1}`}</option>) : <option value={0}>Starts when it plays</option>}
            </select>
          </label>
          <label className="listen-row">
            <span className="listen-row-label"><Icon name="clock" size={18} /> Timer</span>
            <TimerPick timer={timer} onTimer={onTimer} />
          </label>
          <div className="listen-row">
            <span className="listen-row-label"><Icon name="sliders" size={18} /> Speed</span>
            <Rate label="Speed" value={`${player.rate}×`}
              lessOff={speedAt <= 0} moreOff={speedAt < 0 || speedAt >= SPEEDS.length - 1}
              onLess={() => player.setRate(SPEEDS[Math.max(0, (speedAt < 0 ? SPEEDS.indexOf(1) : speedAt) - 1)])}
              onMore={() => player.setRate(SPEEDS[Math.min(SPEEDS.length - 1, (speedAt < 0 ? SPEEDS.indexOf(1) : speedAt) + 1)])} />
          </div>
          <div className="listen-row">
            <span className="listen-row-label" id="listen-follow"><Icon name="readingA" size={18} /> Follow text</span>
            <button type="button" role="switch" className="switch" aria-labelledby="listen-follow" aria-checked={readAlong.following}
              disabled={readAlong.manual || waiting} onClick={() => readAlong.follow(!readAlong.following)}>
              <span className="switch-knob" aria-hidden />
            </button>
          </div>
        </div>
        <LiningUpStatus readAlong={readAlong} ebookId={ebookId} />
        <Progress label="Chapter progress" estimated={false} elapsed={audiobook ? player.positionMs - start : 0} total={length}
          onSeek={(f) => audiobook && player.seek(start + f * length)} />
      </>
    );
  } else if (ra.unavailable) {
    body = <p className="listen-note">{ra.unavailable}</p>;
  } else {
    const playing = ra.status === "playing";
    const { matching, other } = groupVoices(ra.voices, lang);
    const key = primaryLang(lang);
    const chosen = settings.voices[key] ?? "";
    const option = (v: SpeechSynthesisVoice) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.lang ? ` (${v.lang})` : ""}</option>;
    const n = narration;
    const step = (dir: 1 | -1) => {
      const to = n.chapters[n.current + dir];
      if (to) n.goChapter(to.href);
    };
    // About 30 seconds is four sentences.
    const jump = (dir: 1 | -1) => (ra.status === "stopped" ? ra.play() : void ra.skipSentences(dir, 4));
    const rateOff = (dir: 1 | -1) => (dir < 0 ? settings.rate <= RATE_RANGE.min : settings.rate >= RATE_RANGE.max);
    const rate = (dir: 1 | -1) => onSettings({ rate: Math.round(Math.min(RATE_RANGE.max, Math.max(RATE_RANGE.min, settings.rate + dir * 0.1)) * 10) / 10 });
    body = (
      <>
        <Progress label="Chapter progress" estimated elapsed={n.elapsedMs / settings.rate} total={n.totalMs / settings.rate} onSeek={n.seek} />
        <Controls playing={playing} onPlay={ra.toggle} onBack={() => jump(-1)} onForward={() => jump(1)} onPrevChapter={() => step(-1)} onNextChapter={() => step(1)} />
        {ra.error && <p className="listen-note" role="status">{ra.error}</p>}
        <div className="listen-rows">
          <label className="listen-row">
            <span className="listen-row-label"><Icon name="bookOpen" size={18} /> Chapter</span>
            <select value={n.current} disabled={!n.chapters.length} onChange={(e) => {
              const to = n.chapters[Number(e.target.value)];
              if (to) n.goChapter(to.href);
            }}>
              {n.chapters.length ? n.chapters.map((c, i) => <option key={i} value={i}>{c.label}</option>) : <option value={0}>This book has no chapters listed</option>}
            </select>
          </label>
          <label className="listen-row">
            <span className="listen-row-label"><Icon name="clock" size={18} /> Timer</span>
            <TimerPick timer={timer} onTimer={onTimer} />
          </label>
          <label className="listen-row">
            <span className="listen-row-label"><Icon name="readAloud" size={18} /> Voice</span>
            <select value={chosen} disabled={!ra.voices.length} onChange={(e) => {
              const voices = { ...settings.voices };
              if (e.target.value) voices[key] = e.target.value;
              else delete voices[key];
              onSettings({ voices });
            }}>
              <option value="">{ra.voice && !chosen ? `Automatic: ${ra.voice.name}` : "Automatic"}</option>
              {matching.length > 0 && <optgroup label="For this book's language">{matching.map(option)}</optgroup>}
              {other.length > 0 && (matching.length > 0 ? <optgroup label="Other languages">{other.map(option)}</optgroup> : other.map(option))}
            </select>
          </label>
          <div className="listen-row">
            <span className="listen-row-label"><Icon name="sliders" size={18} /> Speed</span>
            <Rate label="Speed" value={formatRate(settings.rate)} lessOff={rateOff(-1)} moreOff={rateOff(1)} onLess={() => rate(-1)} onMore={() => rate(1)} />
          </div>
        </div>
      </>
    );
  }

  if (docked) {
    return (
      <div ref={sheet} className="menu menu-end popover listen-popover" role="dialog" aria-label="Listening">
        {switcher}
        {body}
      </div>
    );
  }

  return (
    <div className="look-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={sheet} className="look-sheet listen-sheet" role="dialog" aria-label="Listening" tabIndex={-1}>
        <span className="look-handle" aria-hidden />
        <header className="look-head">
          <h2>{immersion ? "Immersion" : "Narration"}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>
        {switcher}
        {body}
      </div>
    </div>
  );
}

/** The slim bar while listening with the sheet closed: play/pause, back 30 seconds, what's playing, and its speed. */
export function ListeningBar({ mode, title, left, playing, rate, onPlay, onBack, onOpen, raised }: {
  raised?: boolean;
  mode: ListenMode;
  title: string;
  /** How long is left, already worded. */
  left: string;
  playing: boolean;
  rate: string;
  onPlay: () => void;
  onBack: () => void;
  onOpen: () => void;
}) {
  return (
    <div className={`listen-bar${raised ? " is-raised" : ""}`} role="region" aria-label="Listening">
      <button type="button" className="listen-play listen-play-small" aria-label={playing ? "Pause" : "Play"} onClick={onPlay}>
        <Icon name={playing ? "pause" : "play"} size={20} filled={!playing} />
      </button>
      <button type="button" className="icon-btn" aria-label="Back 30 seconds" onClick={onBack}>
        <Icon name="undo" size={20} />
      </button>
      <span className="listen-bar-rule" aria-hidden />
      <button type="button" className="listen-bar-what" onClick={onOpen} aria-label={`Open ${mode === "immersion" ? "Immersion" : "Narration"}`}>
        <strong>{title}</strong>
        <span className="muted"><Icon name={mode === "immersion" ? "headphones" : "readAloud"} size={14} /> {mode === "immersion" ? "Immersion" : "Narration"} · {left}</span>
      </button>
      <button type="button" className="listen-bar-rate" onClick={onOpen} aria-label={`Speed ${rate}`}>{rate}</button>
    </div>
  );
}

/** "29h 37m left", or "12 min left". */
export function timeLeft(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m left` : `${minutes} min left`;
}

/**
 * Runs the sleep timer, and shows the slim bar while something is playing
 * or paused with the sheet closed. Kept apart from the reader so the
 * audiobook's clock ticking doesn't redraw the whole page.
 */
export function ListeningDock({ sheetOpen, onOpen, title, readAloud: ra, readAlong, narration, bookLeftMs, settings, timer, onTimer, raised }: {
  sheetOpen: boolean;
  /** Phones: the reader's bottom bar is showing, so the bar sits above it. */
  raised: boolean;
  onOpen: () => void;
  title: string;
  readAloud: ReadAloud;
  readAlong: ReadAlong;
  narration: NarrationPlace;
  /** Narration: about how long the rest of the book takes at normal speed. */
  bookLeftMs: number;
  settings: ReaderSettings;
  timer: ListenTimer;
  onTimer: (timer: ListenTimer) => void;
}) {
  const player = usePlayer();
  const audiobook = player.book && player.book.book.id === readAlong.audiobookId ? player.book : null;
  const narrating = ra.status !== "stopped";
  const active: ListenMode | null = readAlong.playing ? "immersion" : narrating ? "narration" : audiobook ? "immersion" : null;

  const stop = () => {
    if (ra.status === "playing") ra.pause();
    if (readAlong.playing) readAlong.playPause();
  };
  const latest = useRef({ stop, onTimer });
  latest.current = { stop, onTimer };

  // Minutes: stops when the time is up.
  useEffect(() => {
    if (timer.kind !== "minutes") return;
    const t = setTimeout(() => {
      latest.current.stop();
      latest.current.onTimer({ kind: "off" });
    }, Math.max(0, timer.until - Date.now()));
    return () => clearTimeout(t);
  }, [timer]);

  // End of chapter: stops when the chapter being listened to changes.
  const chapterKey = active === "immersion" ? `a${player.chapterIndex}` : `n${narration.current}`;
  const startKey = useRef<string | null>(null);
  useEffect(() => {
    startKey.current = timer.kind === "chapter" ? chapterKey : null;
    // Only when the timer is set, not as the chapter moves on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer]);
  useEffect(() => {
    if (startKey.current === null || startKey.current === chapterKey) return;
    startKey.current = null;
    latest.current.stop();
    latest.current.onTimer({ kind: "off" });
  }, [chapterKey]);

  if (sheetOpen || !active) return null;
  if (active === "immersion") {
    const left = audiobook ? ((audiobook.book.durationMs ?? 0) - player.positionMs) / (player.rate || 1) : 0;
    return (
      <ListeningBar mode="immersion" title={audiobook?.book.title ?? title} left={audiobook?.book.durationMs ? timeLeft(left) : readAlong.playing ? "Playing" : "Paused"}
        playing={readAlong.playing} rate={`${player.rate}×`} onPlay={readAlong.playPause}
        onBack={() => (audiobook ? player.skip(-30_000) : readAlong.playPause())} onOpen={onOpen} raised={raised} />
    );
  }
  return (
    <ListeningBar mode="narration" title={title} left={`~${timeLeft(bookLeftMs / settings.rate)}`}
      playing={ra.status === "playing"} rate={formatRate(settings.rate)} onPlay={ra.toggle}
      onBack={() => void ra.skipSentences(-1, 4)} onOpen={onOpen} raised={raised} />
  );
}
