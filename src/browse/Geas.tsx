// Discover › Geas: bringing books, documents and audiobooks in from your
// servers, Audiobookshelf and nearby devices (Grimoire). Laid out after
// embre's picture of 13 November: the servers beside Grimoire, with
// Audiobookshelf along the bottom. No icon by the name and no row of buttons
// above the cards (embre, 19 November).
import { AudiobookshelfSection } from "../settings/AudiobookshelfSection";
import { LocalSendSection } from "../settings/LocalSendSection";
import { ServersCard } from "../settings/ServersTab";
import { DiscoverHeader } from "./DiscoverPage";

export function Geas() {
  return (
    <div className="discover-page geas-page">
      <DiscoverHeader
        title="Geas"
        caption="Transfers"
        about="Bring books, documents and audiobooks in from your servers. What TBV can open is added to your Archive or Resonance."
      />
      <div className="geas-grid">
        <ServersCard />
        <LocalSendSection />
        <AudiobookshelfSection />
      </div>
    </div>
  );
}
