// Discover's video reader view: the video from a page, played in TBV's own
// player, away from the page's adverts and redirects. The video comes through
// TBV (tbvvideo:), which fetches it from the site a part at a time, as the
// page's own player would; nothing is saved. Streams (HLS) play through
// hls.js where the system has what it needs, otherwise the system's own player.
import { useEffect, useRef, useState } from "react";
import type { PageVideo } from "../api/types";
import { Icon } from "../components/Icon";

export function VideoReader({ video, onClose, backLabel = "Back to the page" }: { video: PageVideo; onClose: () => void; backLabel?: string }) {
  const player = useRef<HTMLVideoElement>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  useEffect(() => {
    const el = player.current;
    if (!el) return;
    setTrouble(null);
    let stop = () => {};
    let gone = false;
    const start = () => {
      if (video.time > 2) el.currentTime = video.time;
      void el.play().catch(() => undefined);
    };
    const failed = () => setTrouble("This video wouldn't play here. The site may not allow it outside its own page.");
    el.addEventListener("error", failed);
    el.addEventListener("loadedmetadata", start, { once: true });
    if (video.kind === "hls") {
      void import("hls.js").then(({ default: Hls }) => {
        if (gone) return;
        if (!Hls.isSupported()) {
          el.src = video.src;
          return;
        }
        const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) failed();
        });
        hls.loadSource(video.src);
        hls.attachMedia(el);
        stop = () => hls.destroy();
      }, failed);
    } else {
      el.src = video.src;
    }
    return () => {
      gone = true;
      el.removeEventListener("error", failed);
      el.removeEventListener("loadedmetadata", start);
      stop();
      el.removeAttribute("src");
      el.load();
    };
  }, [video]);

  const popOut = () => {
    const el = player.current;
    if (!el) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else if (el.requestPictureInPicture) void el.requestPictureInPicture().catch(() => undefined);
    else (el as HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void }).webkitSetPresentationMode?.("picture-in-picture");
  };

  return (
    <section className="browser-video" aria-label="Video reader view" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="browser-reader-bar">
        <button type="button" className="btn btn-quiet btn-small" onClick={onClose}>
          <Icon name="arrowLeft" size={14} /> {backLabel}
        </button>
        <button type="button" className="btn btn-quiet btn-small" onClick={popOut}>
          <Icon name="pictureInPicture" size={14} /> Picture in picture
        </button>
      </div>
      <div className="browser-video-stage">
        <video ref={player} controls playsInline autoPlay aria-label={video.title || "Video"} />
        {trouble && <p className="browser-video-trouble" role="alert">{trouble}</p>}
      </div>
      {video.title && <h1 className="browser-video-title">{video.title}</h1>}
    </section>
  );
}
