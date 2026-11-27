// Eidolon's player: one video element for the whole app, so what's playing
// can go on playing after leaving Nexus or with TBV out of sight (embre, 19
// November: background sound on every device). Eidolon shows it while it's
// open; otherwise it waits, still playing, in a hidden corner of the page
// (a media element taken out of the page stops). The video comes through TBV
// (tbvvideo:), which fetches it from the site a part at a time, as the page's
// own player would; nothing is saved. Streams (HLS) play through hls.js
// where the system has what it needs, otherwise through the system's own player.

import type { PageVideo } from "../api/types";

export type EidolonMode = "video" | "audio";
export type Loop = "off" | "one" | "all";

export interface EidolonState {
  queue: PageVideo[];
  at: number;
  mode: EidolonMode;
  loop: Loop;
  rate: number;
  fill: boolean;
  trouble: string | null;
}

let state: EidolonState | null = null;
let media: HTMLVideoElement | null = null;
let stopStream: () => void = () => undefined;
/** The last load's "start once it's ready", taken off when another video replaces it. */
let pendingStart: (() => void) | null = null;
const listeners = new Set<() => void>();

const tell = () => listeners.forEach((listener) => listener());
const set = (change: Partial<EidolonState>) => {
  if (!state) return;
  state = { ...state, ...change };
  tell();
};

export function onEidolon(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What Eidolon is playing, if anything (kept while TBV is open). */
export const eidolonNow = () => state;

/** The one player, made the first time. */
export function eidolonMedia(): HTMLVideoElement {
  if (media) return media;
  const el = document.createElement("video");
  el.className = "eidolon-media";
  el.controls = true;
  el.playsInline = true;
  el.setAttribute("playsinline", "");
  el.addEventListener("error", () => set({ trouble: "This video wouldn't play here. The site may not allow it outside its own page." }));
  el.addEventListener("ended", () => {
    if (!state) return;
    if (state.loop === "one") {
      el.currentTime = 0;
      void el.play().catch(() => undefined);
    } else if (state.at < state.queue.length - 1) {
      go(state.at + 1);
    } else if (state.loop === "all" && state.queue.length > 0) {
      go(0);
    }
  });
  el.addEventListener("play", () => setSession("playing"));
  el.addEventListener("pause", () => setSession("paused"));
  media = el;
  return el;
}

/** A hidden place on the page where the player waits while Eidolon is closed. */
function waitingRoom(): HTMLElement {
  let room = document.getElementById("eidolon-waiting");
  if (!room) {
    room = document.createElement("div");
    room.id = "eidolon-waiting";
    room.className = "eidolon-waiting";
    room.setAttribute("aria-hidden", "true");
    document.body.append(room);
  }
  return room;
}

function dropPendingStart() {
  if (media && pendingStart) media.removeEventListener("loadedmetadata", pendingStart);
  pendingStart = null;
}

/** Stops what's loaded, so nothing goes on playing under a video that can't play. */
function unload() {
  dropPendingStart();
  stopStream();
  stopStream = () => undefined;
  if (media) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
}

function load(video: PageVideo, from: number) {
  const el = eidolonMedia();
  dropPendingStart();
  stopStream();
  stopStream = () => undefined;
  set({ trouble: null });
  const start = () => {
    pendingStart = null;
    if (from > 2) el.currentTime = from;
    el.playbackRate = state?.rate ?? 1;
    void el.play().catch(() => undefined);
  };
  pendingStart = start;
  el.addEventListener("loadedmetadata", start, { once: true });
  if (video.kind === "hls") {
    let gone = false;
    stopStream = () => { gone = true; };
    void import("hls.js").then(({ default: Hls }) => {
      if (gone) return;
      if (!Hls.isSupported()) {
        el.src = video.src;
        return;
      }
      const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) set({ trouble: "This video wouldn't play here. The site may not allow it outside its own page." });
      });
      hls.loadSource(video.src);
      hls.attachMedia(el);
      stopStream = () => hls.destroy();
    }, () => set({ trouble: "This video wouldn't play here." }));
  } else {
    el.src = video.src;
  }
  setSession(null);
}

/** Starts Eidolon on a page's video (and its other videos, for Previous and Next). */
export function startEidolon(found: PageVideo, mode: EidolonMode) {
  const queue = found.queue?.length ? found.queue : [found];
  const at = Math.min(Math.max(0, found.at ?? 0), queue.length - 1);
  state = { queue, at, mode, loop: state?.loop ?? "off", rate: state?.rate ?? 1, fill: state?.fill ?? false, trouble: null };
  load(queue[at], found.time);
  tell();
}

/** Goes to another of the page's videos. */
export function go(at: number) {
  if (!state || at < 0 || at >= state.queue.length) return;
  const video = state.queue[at];
  set({ at });
  if (!video.src) {
    set({ trouble: video.kind === "dash" ? "This site's video comes in a form TBV can't play on its own yet." : "TBV can't tell where this video comes from, so it can't play it on its own." });
    eidolonMedia();
    unload();
    setSession(null);
    return;
  }
  load(video, 0);
}

export function setMode(mode: EidolonMode) {
  set({ mode });
}

export function setLoop(loop: Loop) {
  set({ loop });
}

export function setRate(rate: number) {
  eidolonMedia().playbackRate = rate;
  set({ rate });
}

export function setFill(fill: boolean) {
  set({ fill });
}

/** Puts the player where Eidolon shows it. */
export function showIn(place: HTMLElement) {
  place.append(eidolonMedia());
}

/** Eidolon closes: the player goes on playing out of sight when wanted, else stops. */
export function leave(keepPlaying: boolean) {
  const el = media;
  if (!el) return;
  if (keepPlaying && state && !el.paused) {
    waitingRoom().append(el);
    return;
  }
  endEidolon();
}

/** Stops it altogether. */
export function endEidolon() {
  unload();
  media?.remove();
  state = null;
  setSession(null);
  tell();
}

// The system's own controls (lock screen, Windows' media flyout, headphones).
function setSession(playing: "playing" | "paused" | null) {
  const session = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!session) return;
  try {
    const video = state?.queue[state.at];
    if (!video) {
      session.metadata = null;
      session.playbackState = "none";
      return;
    }
    if (typeof MediaMetadata !== "undefined") {
      let site = "";
      try { site = new URL(video.page).hostname.replace(/^www\./, ""); } catch { /* none */ }
      session.metadata = new MediaMetadata({ title: video.title || "Video", artist: site, album: "Eidolon" });
    }
    if (playing) session.playbackState = playing;
    session.setActionHandler("play", () => void eidolonMedia().play().catch(() => undefined));
    session.setActionHandler("pause", () => eidolonMedia().pause());
    session.setActionHandler("previoustrack", state && state.queue.length > 1 ? () => state && go(state.at > 0 ? state.at - 1 : state.queue.length - 1) : null);
    session.setActionHandler("nexttrack", state && state.queue.length > 1 ? () => state && go((state.at + 1) % state.queue.length) : null);
  } catch {
    // Not every system has every control.
  }
}
