// Read aloud with the voices the device already has (Windows' own voices in
// the app, the phone's in the web version), through the browser's speech
// synthesis. The page engine splits the section on screen into paragraphs and
// sentences; each sentence is spoken as its own utterance, highlighted while
// it's read, and the pages turn to follow it.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Draw } from "../vendor/foliate-js/overlayer.js";
import type { TTS, View } from "../vendor/foliate-js/view.js";
import { pickVoice, sentencesOf, ssmlToText, type Sentence } from "./readAloud";

export type ReadAloudStatus = "stopped" | "playing" | "paused";

export interface ReadAloud {
  /** Why this book can't be read aloud here, or null when it can. */
  unavailable: string | null;
  status: ReadAloudStatus;
  voices: SpeechSynthesisVoice[];
  /** The voice in use: the one chosen for the book's language, or the best match. */
  voice: SpeechSynthesisVoice | null;
  error: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  prevSentence: () => void;
  nextSentence: () => void;
}

const synth: SpeechSynthesis | null = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

/** The overlay key of the sentence being read. */
const MARK_KEY = "tbv-read-aloud";
// Drawn at the engine's 30% strength, so the text stays readable on every page colour.
const MARK_LIGHT = "#5f84ad";
const MARK_DARK = "#8fa3b5";
/** A page turned by hand settles for this long before reading restarts there. */
const SETTLE_MS = 350;

export const NO_SPEECH = "Reading aloud isn't available in this browser.";
export const FIXED_PAGES = "Comics and other books made only of pictures can't be read aloud.";

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth?.getVoices() ?? []);
  useEffect(() => {
    if (!synth) return;
    // Voices often arrive a moment after the page loads. Some phones never say
    // when they do, so it asks again for a few seconds too.
    const update = () => setVoices((before) => {
      const now = synth.getVoices();
      return now.length === before.length ? before : now;
    });
    update();
    synth.addEventListener("voiceschanged", update);
    let tries = 0;
    const poll = setInterval(() => {
      update();
      if (++tries >= 20 || synth.getVoices().length) clearInterval(poll);
    }, 300);
    return () => {
      synth.removeEventListener("voiceschanged", update);
      clearInterval(poll);
    };
  }, []);
  return voices;
}

/** Whether any of the range is within the visible part of the page. */
function onScreen(range: Range | null, visible: Range | null | undefined): boolean {
  if (!range || !visible) return false;
  try {
    return range.compareBoundaryPoints(Range.END_TO_START, visible) <= 0 && range.compareBoundaryPoints(Range.START_TO_END, visible) >= 0;
  } catch {
    // A range from a section that's no longer on screen.
    return false;
  }
}

/** Whether all of the range is within the visible part of the page. */
function wholeOnScreen(range: Range, visible: Range | null | undefined): boolean {
  if (!visible) return true;
  try {
    return range.compareBoundaryPoints(Range.START_TO_START, visible) >= 0 && range.compareBoundaryPoints(Range.END_TO_END, visible) <= 0;
  } catch {
    return false;
  }
}

export function useReadAloud({
  getView,
  ready,
  lang,
  voices: chosen,
  rate,
  dark,
}: {
  getView: () => View | null;
  ready: boolean;
  /** The book's language, to choose a voice that speaks it. */
  lang: string | null;
  voices: Record<string, string>;
  rate: number;
  dark: boolean;
}): ReadAloud {
  const voices = useVoices();
  const voice = pickVoice(voices, chosen, lang);
  const [status, setStatusState] = useState<ReadAloudStatus>("stopped");
  const [error, setError] = useState<string | null>(null);

  const view = ready ? getView() : null;
  // Fixed pages with words on them (PDFs, fixed-layout EPUBs) can be read;
  // comics, made of pictures alone, can't.
  const pictures = !!view?.isFixedLayout && !view.book.sections.some((x) => x.createDocument);
  const unavailable = !synth ? NO_SPEECH : pictures ? FIXED_PAGES : null;

  // Everything below runs from speech and engine events, so it reads refs.
  const s = useRef({
    status: "stopped" as ReadAloudStatus,
    /** Bumped whenever speech starts over or stops; older callbacks see it and do nothing. */
    run: 0,
    tts: null as TTS | null,
    sentences: [] as Sentence[],
    lang: null as string | null,
    at: 0,
    /** The sentence being read, in the page's document. */
    current: null as Range | null,
    /** Set while asking the engine where a sentence is, without showing it. */
    probing: false,
    probed: null as Range | null,
    /** Page moves made here, so they aren't taken for the reader's own. */
    moving: 0,
    /** Set while a page turned by hand settles, so the highlight doesn't pull it back. */
    held: false,
    draw: null as Draw | null,
    /** The silent sound that claims speech from a tap is still queued. */
    unlocking: false,
    /** Utterances still queued: phones drop the events of ones nothing holds on to. */
    queue: [] as SpeechSynthesisUtterance[],
  }).current;
  const opts = useRef({ getView, voice, rate, dark, lang });
  opts.current = { getView, voice, rate, dark, lang };

  const setStatus = (next: ReadAloudStatus) => {
    s.status = next;
    setStatusState(next);
  };

  const clearMark = () => {
    try {
      opts.current.getView()?.renderer.getContents()[0]?.overlayer?.remove(MARK_KEY);
    } catch {
      /* the book has closed */
    }
  };

  // The engine reports the move as it makes it, so the count goes up first.
  const move = async (work: () => Promise<unknown> | undefined) => {
    s.moving++;
    try {
      await work();
    } finally {
      s.moving--;
    }
  };

  // The engine calls this for each sentence that is marked.
  const highlight = (range: Range) => {
    if (s.probing) {
      s.probed = range;
      return;
    }
    s.current = range;
    const v = opts.current.getView();
    if (!v || !s.draw) return;
    try {
      v.renderer.getContents()[0]?.overlayer?.add(MARK_KEY, range, s.draw, { color: opts.current.dark ? MARK_DARK : MARK_LIGHT });
    } catch {
      /* drawn again with the next sentence */
    }
    // A sentence running onto the next page is read from this one, so the page
    // turns when the next sentence starts there.
    if (!s.held && (v.isFixedLayout || !wholeOnScreen(range, v.lastLocation?.range))) void move(() => v.renderer.scrollToAnchor?.(range));
  };

  /** Where a sentence is, asked of the engine without highlighting it. */
  const probe = (mark: string): Range | null => {
    s.probing = true;
    s.probed = null;
    try {
      s.tts?.setMark(mark);
    } finally {
      s.probing = false;
    }
    return s.probed;
  };

  /** Makes sure the engine's reader is for the section on screen. */
  const prepare = async (v: View) => {
    if (!s.draw) s.draw = (await import("../vendor/foliate-js/overlayer.js")).Overlayer.highlight;
    await v.initTTS("sentence", highlight);
    s.tts = v.tts ?? null;
  };

  /** Takes in a paragraph; false when it has nothing to say. */
  const take = (ssml: string | undefined) => {
    if (ssml === undefined) return false;
    const block = ssmlToText(ssml);
    const sentences = sentencesOf(block);
    if (!sentences.length) return false;
    s.sentences = sentences;
    s.lang = block.lang;
    s.at = 0;
    return true;
  };

  /** Moves on to the next section; false at the end of the book or if stopped meanwhile. */
  const nextSection = async (run: number) => {
    const v = opts.current.getView();
    if (!v?.renderer.nextSection) return false;
    const before = v.renderer.getContents()[0]?.index;
    await move(() => v.renderer.nextSection?.());
    if (run !== s.run) return false;
    const after = v.renderer.getContents()[0]?.index;
    if (after === undefined || after === before) return false;
    await prepare(v);
    return run === s.run;
  };

  /** Takes in `first`, or the paragraphs after it, until one has something to say. */
  const advance = async (run: number, first?: string): Promise<boolean> => {
    let ssml = first;
    // Scanned PDFs are pictures of pages, with no words to read: give up
    // after a few empty pages rather than turning through the whole book.
    let empty = 0;
    while (run === s.run) {
      if (take(ssml)) return true;
      ssml = s.tts?.next();
      if (ssml === undefined) {
        if (opts.current.getView()?.isFixedLayout && ++empty > 3) {
          setError("There are no words to read on these pages. A scanned PDF is pictures of pages, which can't be read aloud.");
          return false;
        }
        if (!(await nextSection(run))) return false;
        ssml = s.tts?.start();
      }
    }
    return false;
  };

  const finish = () => {
    s.run++;
    synth?.cancel();
    clearMark();
    s.current = null;
    s.sentences = [];
    s.tts = null;
    setStatus("stopped");
  };

  /** Speaks the paragraph from sentence `from`, queued so there's no pause between sentences. */
  const speakFrom = (from: number) => {
    if (!synth) return;
    const run = ++s.run;
    if (s.unlocking) {
      // Queued behind the silent sound from the tap, which must not be cancelled
      // or a phone may refuse what comes next.
      s.unlocking = false;
      queueFrom(run, from);
    } else if (synth.speaking || synth.pending) {
      synth.cancel();
      // Some phones ignore speech queued straight after a cancel.
      setTimeout(() => run === s.run && queueFrom(run, from), 80);
    } else {
      queueFrom(run, from);
    }
  };

  const queueFrom = (run: number, from: number) => {
    if (!synth) return;
    synth.resume();
    const list = s.sentences;
    if (from >= list.length) {
      void nextBlock(run);
      return;
    }
    s.at = from;
    s.tts?.setMark(list[from].mark);
    const { voice, rate, lang } = opts.current;
    s.queue = [];
    for (let i = from; i < list.length; i++) {
      const u = new SpeechSynthesisUtterance(list[i].text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? s.lang ?? lang ?? "";
      u.rate = rate;
      u.volume = 1;
      const show = (k: number) => {
        if (run !== s.run || k >= list.length || s.at === k) return;
        s.at = k;
        s.tts?.setMark(list[k].mark);
      };
      u.onstart = () => show(i);
      u.onend = () => {
        if (run !== s.run) return;
        if (i === list.length - 1) void nextBlock(run);
        // Some voices never say when they start, so the next sentence is shown here too.
        else show(i + 1);
      };
      u.onerror = (e) => {
        if (run !== s.run || e.error === "interrupted" || e.error === "canceled") return;
        finish();
        setError(e.error === "not-allowed" ? "Tap play again to start reading." : "The voice stopped unexpectedly. Try another voice.");
      };
      s.queue.push(u);
      synth.speak(u);
    }
  };

  const nextBlock = async (run: number) => {
    if (await advance(run)) speakFrom(0);
    else if (run === s.run) finish();
  };

  /** Reads from the first sentence on the page. */
  const startFromPage = async () => {
    const v = opts.current.getView();
    if (!v || !synth) return;
    const run = ++s.run;
    // Not when starting from a tap: the silent utterance in play() must stay queued.
    if (s.status === "playing" && !s.unlocking) synth.cancel();
    setStatus("playing");
    setError(null);
    await prepare(v);
    if (run !== s.run || !s.tts) return;
    const visible = v.lastLocation?.range;
    let first: string | undefined;
    try {
      first = visible ? s.tts.from(visible) : s.tts.start();
    } catch {
      first = s.tts.start();
    }
    if (!(await advance(run, first))) {
      if (run === s.run) finish();
      return;
    }
    // A paragraph that began on an earlier page: start at the sentence the page opens with.
    let from = 0;
    if (visible) {
      const i = s.sentences.findIndex((x) => {
        const r = probe(x.mark);
        try {
          return !r || r.compareBoundaryPoints(Range.START_TO_END, visible) > 0;
        } catch {
          return true;
        }
      });
      from = i < 0 ? s.sentences.length : i;
    }
    speakFrom(from);
  };

  const play = useCallback(() => {
    if (!synth || unavailable) return;
    if (s.status === "playing") return;
    // Phones only allow speech that starts from a tap; this claims it before the
    // wait below. A space, which says nothing, as some phones skip an empty one
    // entirely. Not at volume 0: iPhones keep that volume for what comes next.
    const unlock = new SpeechSynthesisUtterance(" ");
    unlock.volume = 1;
    if (opts.current.voice) unlock.voice = opts.current.voice;
    unlock.onend = unlock.onerror = () => {
      s.unlocking = false;
    };
    s.unlocking = true;
    synth.resume();
    synth.speak(unlock);
    const v = opts.current.getView();
    if (s.status === "paused" && s.sentences.length && onScreen(s.current, v?.lastLocation?.range)) {
      setStatus("playing");
      setError(null);
      speakFrom(s.at);
    } else void startFromPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unavailable]);

  const pause = useCallback(() => {
    if (s.status !== "playing") return;
    // Pausing is stopping and starting the sentence again: pause() is unreliable on phones.
    s.run++;
    synth?.cancel();
    setStatus("paused");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = useCallback(async (dir: 1 | -1) => {
    if (s.status === "stopped" || !s.sentences.length) return;
    const playing = s.status === "playing";
    let target = s.at + dir;
    if (target < 0) {
      // The paragraph before, from its last sentence; at a section's start, this sentence again.
      let found = false;
      for (let ssml = s.tts?.prev(); ssml !== undefined; ssml = s.tts?.prev()) if ((found = take(ssml))) break;
      if (found) target = s.sentences.length - 1;
      else {
        // Back where it was: the engine has stepped past this paragraph.
        try {
          if (s.current) take(s.tts?.from(s.current));
        } catch {
          /* stays as it was */
        }
        target = 0;
      }
    } else if (target >= s.sentences.length) {
      const run = ++s.run;
      synth?.cancel();
      if (!(await advance(run))) {
        if (run === s.run) finish();
        return;
      }
      target = 0;
    }
    if (playing) speakFrom(target);
    else {
      s.run++;
      s.at = target;
      s.tts?.setMark(s.sentences[target].mark);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new voice or speed starts the sentence again with it, once the speed
  // slider has stopped moving.
  const voiceURI = voice?.voiceURI;
  useEffect(() => {
    if (s.status !== "playing") return;
    const timer = setTimeout(() => s.status === "playing" && speakFrom(s.at), SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceURI, rate]);

  // Pages turned by hand: keep reading if the sentence is still in view,
  // otherwise read from the new page.
  useEffect(() => {
    const v = ready ? getView() : null;
    if (!v) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onRelocate = () => {
      if (s.moving > 0 || s.status === "stopped") return;
      s.held = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        s.held = false;
        if (onScreen(s.current, v.lastLocation?.range)) return;
        if (s.status === "playing") void startFromPage();
      }, SETTLE_MS);
    };
    v.addEventListener("relocate", onRelocate);
    return () => {
      clearTimeout(timer);
      s.held = false;
      v.removeEventListener("relocate", onRelocate);
      // Another book, or the reader closing.
      finish();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, getView]);

  useEffect(() => () => synth?.cancel(), []);

  return {
    unavailable,
    status,
    voices,
    voice,
    error,
    play,
    pause,
    toggle: useCallback(() => (s.status === "playing" ? pause() : play()), [pause, play, s]),
    stop: useCallback(finish, []), // eslint-disable-line react-hooks/exhaustive-deps
    prevSentence: useCallback(() => void step(-1), [step]),
    nextSentence: useCallback(() => void step(1), [step]),
  };
}
