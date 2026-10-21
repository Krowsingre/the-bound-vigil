// The audiobook player: one for the whole app, so listening carries on while
// you browse or read. It plays an audiobook's files one after another as if
// they were one long recording, and remembers where you are as you listen.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { AudioChapter, Audiobook } from "../api/types";
import { useToast } from "../components/Toast";
import { onBeforeQuit } from "../lib/beforeQuit";
import { useAppSettings } from "../settings/appSettings";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SAVE_EVERY_MS = 15_000;
const PREFS_KEY = "tbv.player";

export interface PlayerState {
  book: Audiobook | null;
  playing: boolean;
  /** Where you are, from the start of the whole book. */
  positionMs: number;
  /** Still finding its place in a file. */
  loading: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  /** When a book ends, another unfinished one starts, chosen at random. */
  shuffle: boolean;
}

export interface Player extends PlayerState {
  chapterIndex: number;
  /** Loads an audiobook at your place in it, and plays it unless told not to. */
  load: (bookId: string, play?: boolean) => Promise<void>;
  toggle: () => void;
  seek: (ms: number) => void;
  skip: (deltaMs: number) => void;
  chapter: (delta: 1 | -1) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setShuffle: (on: boolean) => void;
  close: () => void;
  /** Reloads the book's details, after they change. */
  refresh: () => void;
}

/** The chapter playing at `ms`. */
export function chapterAt(chapters: AudioChapter[], ms: number): number {
  let index = 0;
  chapters.forEach((c, i) => {
    if (c.startMs <= ms) index = i;
  });
  return index;
}

/** How long a chapter runs. */
export function chapterLength(book: Audiobook, index: number): number {
  const next = book.chapters[index + 1]?.startMs ?? book.durationMs;
  return Math.max(0, next - (book.chapters[index]?.startMs ?? 0));
}

/** 1:04:03, or 48:21 under an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function readPrefs(): Pick<PlayerState, "rate" | "volume" | "shuffle"> {
  const prefs = { rate: 1, volume: 1, shuffle: false };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<typeof prefs>;
    if (typeof saved.rate === "number" && SPEEDS.includes(saved.rate)) prefs.rate = saved.rate;
    if (typeof saved.volume === "number" && saved.volume >= 0 && saved.volume <= 1) prefs.volume = saved.volume;
    prefs.shuffle = saved.shuffle === true;
  } catch {
    /* defaults */
  }
  return prefs;
}

// Book menus anywhere can start an audiobook.
let startListening: ((bookId: string) => void) | null = null;
export function playAudiobook(bookId: string) {
  startListening?.(bookId);
}

const PlayerContext = createContext<Player | null>(null);

export function usePlayer(): Player {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("usePlayer needs a PlayerProvider");
  return player;
}

export function PlayerProvider({ children, onChanged }: { children: React.ReactNode; onChanged?: () => void }) {
  const toast = useToast();
  const audio = useMemo(() => (typeof Audio === "undefined" ? null : new Audio()), []);
  const [state, setState] = useState<PlayerState>(() => ({
    book: null,
    playing: false,
    positionMs: 0,
    loading: false,
    muted: false,
    ...readPrefs(),
  }));
  // The live values, for event handlers that outlive a render.
  const now = useRef(state);
  now.current = state;
  const part = useRef(-1);
  /** Links to play the book's parts from the cloud, when it's streamed that way. */
  const streaming = useRef<string[] | null>(null);
  const streamAudio = useRef(true);
  streamAudio.current = useAppSettings().settings.sync.streamAudio;
  const lastSaved = useRef(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const update = useCallback((change: Partial<PlayerState>) => setState((s) => ({ ...s, ...change })), []);

  const save = useCallback(async () => {
    const { book, positionMs } = now.current;
    if (!book) return;
    lastSaved.current = Date.now();
    const chapter = book.chapters[chapterAt(book.chapters, positionMs)]?.title ?? null;
    await api.saveListening(book.book.id, Math.round(positionMs), chapter).catch(() => undefined);
  }, []);

  useEffect(() => onBeforeQuit(save), [save]);

  /** Moves to `ms`: the right file, then the right moment in it. */
  const goTo = useCallback(
    (ms: number, play: boolean) => {
      const { book } = now.current;
      if (!book || !audio) return;
      const clamped = Math.min(Math.max(0, ms), Math.max(0, book.durationMs - 250));
      let index = book.parts.findIndex((p) => clamped >= p.startMs && clamped < p.startMs + p.durationMs);
      if (index < 0) index = Math.max(0, book.parts.length - 1);
      const within = (clamped - (book.parts[index]?.startMs ?? 0)) / 1000;
      update({ positionMs: clamped });
      const start = () => {
        audio.currentTime = within;
        if (play) void audio.play().catch(() => update({ playing: false }));
      };
      if (index !== part.current || !audio.src) {
        const url = streaming.current?.[index] ?? api.audioUrl(book.book.id, index);
        if (!url) {
          if (play) toast("Audiobooks play in the desktop app for now. Your place is kept here.");
          return;
        }
        part.current = index;
        update({ loading: true });
        audio.src = url;
        audio.addEventListener("loadedmetadata", start, { once: true });
        audio.load();
      } else start();
    },
    [audio, toast, update],
  );

  const load = useCallback(
    async (bookId: string, play = true) => {
      const current = now.current.book;
      if (current?.book.id === bookId) {
        if (play && audio?.paused) goTo(now.current.positionMs, true);
        return;
      }
      if (current) await save();
      let book: Audiobook;
      let links: string[] | null = null;
      try {
        book = await api.audiobook(bookId);
        let stream = book.book.availability === "cloud" && (streamAudio.current || !api.audioUrl(bookId, 0));
        if (stream) {
          // Straight from the cloud: nothing is downloaded.
          try {
            links = await api.prepareStream(bookId);
          } catch (e) {
            stream = false;
            if (!api.audioUrl(bookId, 0)) throw e;
          }
        }
        // Otherwise a cloud-only audiobook comes down first, where this device can play it.
        if (play && !stream && book.book.availability === "cloud" && api.audioUrl(bookId, 0)) {
          toast(`Downloading “${book.book.title}” to play it…`);
          await api.downloadBook(bookId);
          book = await api.audiobook(bookId);
          changed.current?.();
        }
      } catch (e) {
        toast(`This audiobook couldn't be opened: ${String(e)}`);
        return;
      }
      audio?.pause();
      audio?.removeAttribute("src");
      part.current = -1;
      streaming.current = links;
      // A finished book starts again from the beginning.
      const at = book.positionMs >= book.durationMs - 1000 ? 0 : book.positionMs;
      setState((s) => ({ ...s, book, positionMs: at, playing: false }));
      now.current = { ...now.current, book, positionMs: at };
      if (book.parts.length === 0) return toast("This audiobook has no sound files on this device yet.");
      goTo(at, play);
    },
    [audio, goTo, save, toast],
  );

  useEffect(() => {
    startListening = (id) => void load(id, true);
    return () => {
      startListening = null;
    };
  }, [load]);

  // Follow the audio element.
  useEffect(() => {
    if (!audio) return;
    const time = () => {
      const { book } = now.current;
      const p = book?.parts[part.current];
      if (!book || !p || audio.seeking) return;
      update({ positionMs: p.startMs + audio.currentTime * 1000, loading: false });
      if (!audio.paused && Date.now() - lastSaved.current > SAVE_EVERY_MS) void save();
    };
    const playing = () => update({ playing: true, loading: false });
    const paused = () => {
      update({ playing: false });
      void save().then(() => changed.current?.());
    };
    const waiting = () => update({ loading: true });
    const ended = () => {
      const { book } = now.current;
      if (!book) return;
      if (part.current < book.parts.length - 1) return goTo(book.parts[part.current + 1].startMs, true);
      // The end of the book.
      update({ playing: false, positionMs: book.durationMs });
      now.current = { ...now.current, positionMs: book.durationMs };
      void save()
        .then(() => api.setBookStatus(book.book.id, "read"))
        .then(() => changed.current?.())
        .catch(() => undefined);
      toast(`You've finished “${book.book.title}”.`);
      if (now.current.shuffle) void playAnother(book.book.id);
    };
    const failed = () => {
      update({ playing: false, loading: false });
      if (audio.src) toast("This part of the audiobook couldn't be played. Is its file still on this device?");
    };
    const playAnother = async (finished: string) => {
      const page = await api
        .getLibrary({
          kind: "audiobooks",
          shelf: "all",
          sort: "title",
          search: null,
          formats: [],
          location: null,
          page: 0,
          pageSize: 200,
        })
        .catch(() => null);
      const left = (page?.books ?? []).filter((b) => b.id !== finished && b.status !== "read");
      if (left.length) void load(left[Math.floor(Math.random() * left.length)].id, true);
    };
    audio.addEventListener("timeupdate", time);
    audio.addEventListener("playing", playing);
    audio.addEventListener("pause", paused);
    audio.addEventListener("waiting", waiting);
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", failed);
    return () => {
      audio.removeEventListener("timeupdate", time);
      audio.removeEventListener("playing", playing);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("waiting", waiting);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
    };
  }, [audio, goTo, load, save, toast, update]);

  useEffect(() => {
    if (!audio) return;
    audio.playbackRate = state.rate;
    audio.volume = state.volume;
    audio.muted = state.muted;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ rate: state.rate, volume: state.volume, shuffle: state.shuffle }));
    } catch {
      /* the choice just won't be remembered */
    }
  }, [audio, state.rate, state.volume, state.muted, state.shuffle]);

  const toggle = useCallback(() => {
    if (!audio || !now.current.book) return;
    if (audio.paused) goTo(now.current.positionMs, true);
    else audio.pause();
  }, [audio, goTo]);

  const seek = useCallback(
    (ms: number) => {
      goTo(ms, !!audio && !audio.paused);
      void save();
    },
    [audio, goTo, save],
  );
  const skip = useCallback((delta: number) => seek(now.current.positionMs + delta), [seek]);
  const chapter = useCallback(
    (delta: 1 | -1) => {
      const { book, positionMs } = now.current;
      if (!book?.chapters.length) return skip(delta * 30_000);
      const index = chapterAt(book.chapters, positionMs);
      // Back goes to the start of this chapter first, unless that's just where you are.
      const target = delta < 0 && positionMs - book.chapters[index].startMs > 3000 ? index : index + delta;
      if (target >= book.chapters.length) return seek(book.durationMs);
      seek(book.chapters[Math.max(0, target)].startMs);
    },
    [seek, skip],
  );

  const close = useCallback(() => {
    void save().then(() => changed.current?.());
    audio?.pause();
    audio?.removeAttribute("src");
    part.current = -1;
    update({ book: null, playing: false, loading: false });
  }, [audio, save, update]);

  const refresh = useCallback(() => {
    const id = now.current.book?.book.id;
    if (!id) return;
    api.audiobook(id).then(
      (book) => now.current.book?.book.id === id && update({ book }),
      () => undefined,
    );
  }, [update]);

  // Media keys and the system's now-playing controls.
  useEffect(() => {
    const session = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!session || !state.book) return;
    const b = state.book.book;
    try {
      session.metadata = new MediaMetadata({
        title: b.title,
        artist: b.authors.join(", "),
        album: state.book.narrators.join(", "),
      });
      session.setActionHandler("play", toggle);
      session.setActionHandler("pause", toggle);
      session.setActionHandler("seekbackward", () => skip(-30_000));
      session.setActionHandler("seekforward", () => skip(30_000));
      session.setActionHandler("previoustrack", () => chapter(-1));
      session.setActionHandler("nexttrack", () => chapter(1));
    } catch {
      /* not every webview offers these */
    }
  }, [state.book, toggle, skip, chapter]);

  const player: Player = {
    ...state,
    chapterIndex: state.book ? chapterAt(state.book.chapters, state.positionMs) : 0,
    load,
    toggle,
    seek,
    skip,
    chapter,
    setRate: (rate) => update({ rate }),
    setVolume: (volume) => update({ volume, muted: false }),
    setMuted: (muted) => update({ muted }),
    setShuffle: (shuffle) => update({ shuffle }),
    close,
    refresh,
  };
  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>;
}
