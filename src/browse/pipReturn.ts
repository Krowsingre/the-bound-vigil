// Picture in picture, back to the page: when a video popped out of a Nexus
// tab is brought back to full size (the button on the floating video), TBV
// goes to Discover › Nexus and that tab, as chosen in Attune › Discover.
// Sites can't tell TBV anything, so TBV asks: Nexus notes which tabs have a
// popped-out video, and those are watched until the video comes back.
// Brought back, the video goes on playing; closed, it stops. That's how the
// two are told apart.

import { api } from "../api";
import { readBrowserPrefs } from "./browserPrefs";

/** Whether the page (or a frame in it) has a popped-out video, and whether any video plays. */
export const PIP_STATE = `(() => {
  const videos = Array.from(document.querySelectorAll('video'));
  const out = document.pictureInPictureElement || videos.find((v) => v.webkitPresentationMode === 'picture-in-picture');
  // Videos in frames (an embedded player), as the frames last told this page.
  const frames = window.__tbvPipFrames ? window.__tbvPipFrames() : { out: false, playing: false };
  return JSON.stringify({ out: !!out || frames.out, playing: videos.some((v) => !v.paused && !v.ended) || frames.playing });
})()`;

interface PipState {
  out: boolean;
  playing: boolean;
}

/** Asked for when a popped-out video comes back: Nexus, at this tab. */
export const PIP_RETURN = "tbv:pip-return";

const watched = new Set<string>();
let timer = 0;
let stillOpen: (tab: string) => boolean = () => true;

/** Nexus says which tabs are still open (a closed tab's page can outlive it while its video is popped out). */
export function whenStillOpen(check: (tab: string) => boolean) {
  stillOpen = check;
}

async function stateOf(tab: string): Promise<PipState | null> {
  try {
    const state = (await api.browserRead(tab, PIP_STATE)) as Partial<PipState> | null;
    return state && typeof state === "object" ? { out: state.out === true, playing: state.playing === true } : null;
  } catch {
    return null;
  }
}

const pause = (ms: number) => new Promise((done) => window.setTimeout(done, ms));

let looking = false;

async function look() {
  if (looking) return;
  looking = true;
  try {
    await lookNow();
  } finally {
    looking = false;
  }
}

async function lookNow() {
  for (const tab of [...watched]) {
    const now = await stateOf(tab);
    if (now?.out) continue;
    watched.delete(tab);
    if (!now) continue;
    // A closed video stops a moment after leaving; a brought-back one plays on.
    await pause(500);
    const after = await stateOf(tab);
    if (after && !after.out && after.playing && readBrowserPrefs().pipReturn && stillOpen(tab)) {
      window.dispatchEvent(new CustomEvent<string>(PIP_RETURN, { detail: tab }));
    }
  }
  if (!watched.size) {
    window.clearInterval(timer);
    timer = 0;
  }
}

/** A tab whose video popped out: watched until it comes back. */
export function notePopped(tab: string) {
  watched.add(tab);
  if (!timer) timer = window.setInterval(() => void look(), 1000);
}

/** Looks at a tab and watches it if its video is popped out. */
export async function checkForPip(tab: string) {
  if (watched.has(tab)) return;
  if ((await stateOf(tab))?.out) notePopped(tab);
}

/** For tests. */
export function watchedTabs(): string[] {
  return [...watched];
}
