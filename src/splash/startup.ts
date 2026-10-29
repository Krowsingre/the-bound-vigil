// Opening TBV in one go: the splash stays up while the first screen gets
// ready, its bar filling as each step finishes, then gives way to a
// finished page. On a computer the splash is a card in its own window and
// the main window stays hidden until now; on the iPhone it covers the page
// and breaks up to show it.

import { api, isApp, isIOS } from "../api";
import { disintegrate } from "./disintegrate";
import { setSplash, showSplash } from "./splashView";

/** What has to be ready before the splash goes. */
export type StartupStep = "look" | "library" | "sanctum" | "covers" | "fonts";
const STEPS: StartupStep[] = ["look", "library", "sanctum", "covers", "fonts"];

/** The splash goes after this long even if a step never finishes. */
const AT_MOST = 12_000;
/** The splash stays at least this long, so it never just flickers past. */
const AT_LEAST = 1_100;
/** How long covers on the first screen are waited for. */
const COVERS_WAIT = 2_500;

const onComputer = isApp && !isIOS;
const openedAt = performance.now();
const done = new Set<StartupStep>();
let holds = 0;
let label: string | undefined;
let finished = false;
/** The wait is over; only something holding the splash up keeps it. */
let overdue = false;

/** Over the page on the iPhone (and in the preview), nowhere on the web. */
const overlay = !onComputer && (isIOS || api.kind === "preview") ? showSplash() : null;
if (!onComputer && !overlay) document.documentElement.classList.remove("is-starting");
const giveUp = setTimeout(() => {
  overdue = true;
  if (holds === 0) void finish();
}, AT_MOST);

function progress() {
  const share = done.size / STEPS.length;
  if (overlay) setSplash(overlay, share, label ?? "Loading…");
  if (onComputer) void import("@tauri-apps/api/core").then(({ invoke }) => invoke("startup_progress", { progress: share, label: label ?? null }));
}

/** Marks a step as finished. */
export function startupStep(step: StartupStep) {
  if (finished || done.has(step)) return;
  done.add(step);
  if (step === "sanctum") {
    void coversShown().then(() => startupStep("covers"));
    void document.fonts?.ready.then(() => startupStep("fonts"));
  }
  progress();
  if (holds === 0 && STEPS.every((s) => done.has(s))) void finish();
}

/** Keeps the splash up, saying `words`, while `work` runs (installing an update). */
export async function startupHold<T>(words: string, work: () => Promise<T>): Promise<T> {
  if (finished) return work();
  holds++;
  label = words;
  progress();
  try {
    return await work();
  } finally {
    holds--;
    label = undefined;
    progress();
    if (holds === 0 && (overdue || STEPS.every((s) => done.has(s)))) void finish();
  }
}

/** Changes the words under the bar while something holds the splash up. */
export function startupSay(words: string) {
  if (finished || holds === 0) return;
  label = words;
  progress();
}

/** Whether TBV is still opening (the splash is up). */
export const stillOpening = () => !finished;

/** Waits for the covers on the first screen, but not for long. */
function coversShown(): Promise<void> {
  const pictures = [...document.querySelectorAll<HTMLImageElement>(".content img")].filter((img) => !img.complete);
  const loaded = Promise.all(
    pictures.map(
      (img) =>
        new Promise((ok) => {
          img.addEventListener("load", ok, { once: true });
          img.addEventListener("error", ok, { once: true });
        }),
    ),
  );
  return Promise.race([loaded.then(() => undefined), new Promise<void>((ok) => setTimeout(ok, COVERS_WAIT))]);
}

async function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(giveUp);
  done.clear();
  STEPS.forEach((s) => done.add(s));
  progress();
  const shownFor = performance.now() - openedAt;
  if (shownFor < AT_LEAST) await new Promise((ok) => setTimeout(ok, AT_LEAST - shownFor));
  // One more frame, so the page underneath is fully drawn. A hidden window
  // (the computer's, behind its card) may draw no frames at all, so this
  // never waits long.
  await Promise.race([
    new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))),
    new Promise((ok) => setTimeout(ok, 120)),
  ]);
  document.documentElement.classList.remove("is-starting");
  if (onComputer) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("startup_done").catch(() => undefined);
    return;
  }
  if (!overlay) return;
  const still =
    document.documentElement.hasAttribute("data-reduce-motion") || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still) {
    overlay.classList.add("is-leaving");
    setTimeout(() => overlay.remove(), 400);
    return;
  }
  await disintegrate(overlay).catch(() => overlay.remove());
}
