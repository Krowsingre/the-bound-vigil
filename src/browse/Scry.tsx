// Discover › Scry: films, shows and music streamed from your Plex, Jellyfin
// or Emby server, or a shared folder, in TBV's own player. Nothing is
// imported. Anything playing can be kept as a sigil on Sanctum.
import { useEffect, useState } from "react";
import { api } from "../api";
import type { MediaItem, MediaServerView, PageVideo } from "../api/types";
import { useToast } from "../components/Toast";
import { MediaPanel } from "./MediaPanel";
import { onScryAsk, streamTarget, takeScryAsk } from "./scryAsk";
import { VideoReader } from "./VideoReader";

const clean = (e: unknown) => String(e).replace(/^Error: /, "");

export function Scry() {
  const toast = useToast();
  const [film, setFilm] = useState<{ video: PageVideo; target: string | null } | null>(null);

  // A stream's sigil, followed from Sanctum.
  useEffect(() => {
    const play = async () => {
      const ask = takeScryAsk();
      if (!ask) return;
      try {
        const server = (await api.mediaServers()).find((s) => s.url === ask.server);
        if (!server) return toast("That server isn't connected on this device. Add it in Scry first.");
        const video = await api.mediaPlay(server.id, ask.item, ask.title, ask.audio);
        setFilm({ video, target: streamTarget(server.url, ask.item, ask.audio) });
      } catch (e) {
        toast(clean(e));
      }
    };
    void play();
    return onScryAsk(() => void play());
  }, [toast]);

  const makeSigil = async () => {
    if (!film?.target) return;
    try {
      await api.addSanctumLink(film.video.title || "Stream", film.target, "videoReader", "");
      toast(`"${film.video.title || "This stream"}" is in your Sigils on Sanctum.`);
    } catch (e) {
      toast(clean(e));
    }
  };

  return (
    <div className="scry-page">
      <MediaPanel
        title="Scry"
        onPlay={(video: PageVideo, from?: { server: MediaServerView; item: MediaItem }) =>
          setFilm({ video, target: from ? streamTarget(from.server.url, from.item.id, from.item.kind === "audio") : null })}
      />
      {film && <VideoReader video={film.video} onClose={() => setFilm(null)} backLabel="Back to Scry" onSigil={film.target ? () => void makeSigil() : undefined} />}
    </div>
  );
}
