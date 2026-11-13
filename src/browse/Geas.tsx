// Discover › Geas: bringing books, documents and audiobooks in from your
// servers, Audiobookshelf and nearby devices (Grimoire). Laid out after
// embre's picture of 13 November: the servers beside Grimoire, with
// Audiobookshelf along the bottom. The tabs take you to each.
import { useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { AudiobookshelfSection } from "../settings/AudiobookshelfSection";
import { LocalSendSection } from "../settings/LocalSendSection";
import { ServersCard } from "../settings/ServersTab";
import { DiscoverHeader } from "./DiscoverPage";

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: "servers", label: "Servers", icon: "database" },
  { id: "audiobookshelf", label: "Audiobookshelf", icon: "headphones" },
  { id: "grimoire", label: "Grimoire", icon: "broadcast" },
];

export function Geas() {
  const [tab, setTab] = useState("servers");
  const go = (id: string) => {
    setTab(id);
    const card = document.getElementById(`discover-${id}`);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    card?.classList.remove("is-found");
    void card?.offsetWidth;
    card?.classList.add("is-found");
  };
  return (
    <div className="discover-page geas-page">
      <DiscoverHeader
        icon="database"
        title="Geas"
        caption="Transfers"
        about="Bring books, documents and audiobooks in from your servers. What TBV can open is added to your Archive or Resonance."
      />
      <nav className="discover-tabs" aria-label="Geas">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`discover-tab${tab === t.id ? " is-active" : ""}`} aria-current={tab === t.id ? "true" : undefined} onClick={() => go(t.id)}>
            <Icon name={t.icon} size={18} /> {t.label}
          </button>
        ))}
      </nav>
      <div className="geas-grid">
        <ServersCard />
        <LocalSendSection />
        <AudiobookshelfSection />
      </div>
    </div>
  );
}
