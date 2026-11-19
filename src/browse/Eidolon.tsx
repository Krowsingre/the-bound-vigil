// Eidolon: a page's video in TBV's own player, away from the page's adverts
// and redirects, as Focus Video, or just its sound as Focus Audio (embre, 19
// November). One compact header on every device: Back and the name on the
// left, Picture in picture and ••• on the right. ••• opens a small pop-up on
// a computer, an iPad held sideways and the Duo open, and a sheet from the
// bottom on phones, an iPad held upright and the Duo folded. Under the
// player, the page's other videos: Previous, "2 of 5", Next, and Loop.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { eidolonMedia, go, leave, setFill, setLoop, setMode, setRate, showIn, type EidolonState, type Loop } from "./eidolonPlayer";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const LOOPS: { value: Loop; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "one", label: "Loop One" },
  { value: "all", label: "Loop All" },
];

function siteOf(page: string): string {
  try {
    return new URL(page).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function Eidolon({ state, sheets, onClose }: { state: EidolonState; sheets: boolean; onClose: () => void }) {
  const place = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState(false);
  const video = state.queue[state.at];
  const audio = state.mode === "audio";

  // The one player comes here while Eidolon is open, and goes on playing out
  // of sight when Scry closes (background sound, embre 19 November).
  useLayoutEffect(() => {
    if (place.current) showIn(place.current);
  }, [audio]);
  useEffect(() => () => leave(true), []);

  useEffect(() => {
    if (!options) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOptions(false);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [options]);

  const popOut = () => {
    const el = eidolonMedia();
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else if (el.requestPictureInPicture) void el.requestPictureInPicture().catch(() => undefined);
    else (el as HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void }).webkitSetPresentationMode?.("picture-in-picture");
  };

  const name = audio ? "Focus Audio" : "Focus Video";
  const many = state.queue.length > 1;
  const loopLabel = LOOPS.find((l) => l.value === state.loop)?.label ?? "Off";
  const nextLoop: Loop = state.loop === "off" ? "all" : state.loop === "all" ? "one" : "off";

  return (
    <section className={`eidolon${audio ? " is-audio" : ""}`} aria-label={`Eidolon: ${name}`}
      onKeyDown={(e) => e.key === "Escape" && !options && onClose()}>
      <header className="eidolon-head">
        <button type="button" className="toolbar-button" aria-label="Back to the page" title="Back to the page" onClick={onClose}>
          <Icon name="arrowLeft" size={18} />
        </button>
        <div className="eidolon-name">
          <strong>Eidolon</strong>
          <span>{name}</span>
        </div>
        {!audio && (
          <button type="button" className="toolbar-button" aria-label="Picture in picture" title="Picture in picture" onClick={popOut}>
            <Icon name="pictureInPicture" size={18} />
          </button>
        )}
        <div className="eidolon-more">
          <button type="button" className={`toolbar-button${options ? " is-on" : ""}`} aria-label="More" title="More" aria-expanded={options} onClick={() => setOptions(!options)}>
            <Icon name="more" size={18} />
          </button>
          {options && (
            <>
              <div className={sheets ? "eidolon-sheet-backdrop" : "eidolon-popover-catch"} aria-hidden onClick={() => setOptions(false)} />
              <div className={sheets ? "eidolon-options eidolon-sheet" : "eidolon-options eidolon-popover"} role="dialog" aria-label="Eidolon options">
                {sheets && <span className="eidolon-sheet-grip" aria-hidden />}
                <div className="eidolon-option">
                  <span>Show</span>
                  <div className="segmented" role="radiogroup" aria-label="Show">
                    <button type="button" role="radio" aria-checked={!audio} onClick={() => setMode("video")}>Video</button>
                    <button type="button" role="radio" aria-checked={audio} onClick={() => setMode("audio")}>Sound only</button>
                  </div>
                </div>
                <div className="eidolon-option">
                  <span>Speed</span>
                  <div className="segmented eidolon-rates" role="radiogroup" aria-label="Speed">
                    {RATES.map((rate) => (
                      <button key={rate} type="button" role="radio" aria-checked={state.rate === rate} onClick={() => setRate(rate)}>{rate}×</button>
                    ))}
                  </div>
                </div>
                <div className="eidolon-option">
                  <span>Loop</span>
                  <div className="segmented" role="radiogroup" aria-label="Loop">
                    {LOOPS.map((l) => (
                      <button key={l.value} type="button" role="radio" aria-checked={state.loop === l.value} onClick={() => setLoop(l.value)}>{l.label}</button>
                    ))}
                  </div>
                </div>
                {!audio && (
                  <div className="eidolon-option">
                    <span>Picture</span>
                    <div className="segmented" role="radiogroup" aria-label="Picture">
                      <button type="button" role="radio" aria-checked={!state.fill} onClick={() => setFill(false)}>Fit</button>
                      <button type="button" role="radio" aria-checked={state.fill} onClick={() => setFill(true)}>Fill</button>
                    </div>
                  </div>
                )}
                {sheets && !audio && (
                  <button type="button" className="btn btn-quiet" onClick={() => (setOptions(false), popOut())}>
                    <Icon name="pictureInPicture" size={16} /> Picture in picture
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>
      <div className={`eidolon-stage${state.fill ? " is-fill" : ""}`}>
        {audio && (
          <div className="eidolon-audio-card">
            <Icon name="headphones" size={40} />
            <strong>{video?.title || "Sound from this page"}</strong>
            {video && <span className="muted">{siteOf(video.page)}</span>}
          </div>
        )}
        <div ref={place} className="eidolon-place" />
        {state.trouble && <p className="browser-video-trouble" role="alert">{state.trouble}</p>}
      </div>
      <footer className="eidolon-queue">
        {!audio && <span className="eidolon-title" title={video?.title}>{video?.title}</span>}
        {many && (
          <span className="eidolon-steps">
            <button type="button" className="toolbar-button" aria-label="Previous video" title="Previous video" disabled={state.at === 0 && state.loop !== "all"}
              onClick={() => go(state.at > 0 ? state.at - 1 : state.queue.length - 1)}>
              <Icon name="skipBack" size={16} />
            </button>
            <span className="eidolon-count">{state.at + 1} of {state.queue.length}</span>
            <button type="button" className="toolbar-button" aria-label="Next video" title="Next video" disabled={state.at === state.queue.length - 1 && state.loop !== "all"}
              onClick={() => go((state.at + 1) % state.queue.length)}>
              <Icon name="skipForward" size={16} />
            </button>
          </span>
        )}
        <button type="button" className={`btn btn-quiet btn-small eidolon-loop${state.loop !== "off" ? " is-on" : ""}`} aria-label={`Loop: ${loopLabel}`} title="Loop: off, all, one"
          onClick={() => setLoop(nextLoop)}>
          <Icon name="sync" size={14} /> {state.loop === "off" ? "Loop" : loopLabel}
        </button>
      </footer>
    </section>
  );
}
