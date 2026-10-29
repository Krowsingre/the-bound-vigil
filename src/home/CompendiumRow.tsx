// Sanctum's Compendium row: your collections on their pictures, pinned
// ones first, each with how many books it holds. With none of your own yet,
// it shows the smart compendiums instead.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { CollectionsOverview, SmartKind } from "../api/types";
import { Badge } from "../collections/badges";
import { pictureUrl, SMART_INFO } from "../collections/collectionInfo";
import { GALLERY, galleryUrl } from "../collections/gallery";
import { hashOf } from "../lib/format";
import { EmptyNote, Section } from "./Section";

const SHOWN = 4;

interface Card {
  key: string;
  name: string;
  count: number;
  badge: string | null;
  picture: string | null;
  /** A cover or your own picture, hidden in privacy mode; gallery paintings stay. */
  own: boolean;
  open: () => void;
}

/** A gallery painting for a collection that has no picture of its own, the same one each time. */
const paintingFor = (id: string) => galleryUrl(GALLERY[hashOf(id) % GALLERY.length].name, "wide");

const items = (n: number) => `${n.toLocaleString()} ${n === 1 ? "item" : "items"}`;

export function CompendiumRow({
  refreshKey,
  onOpenCollection,
  onOpenCompendium,
  onViewAll,
}: {
  refreshKey: number;
  onOpenCollection: (id: string) => void;
  onOpenCompendium: (kind: SmartKind) => void;
  onViewAll: () => void;
}) {
  const [overview, setOverview] = useState<CollectionsOverview | null>(null);
  useEffect(() => {
    let current = true;
    api.getCollectionsOverview().then(
      (o) => current && setOverview(o),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [refreshKey]);

  const own = overview ? [...overview.pinned, ...overview.collections.filter((c) => !overview.pinned.some((p) => p.id === c.id))] : [];
  const cards: Card[] = own.length
    ? own.slice(0, SHOWN).map((c) => ({ key: c.id, name: c.name, count: c.count, badge: c.badge, picture: pictureUrl(c) ?? paintingFor(c.id), own: !!pictureUrl(c) && !c.picture?.startsWith("gallery:"), open: () => onOpenCollection(c.id) }))
    : (overview?.smart ?? [])
        .filter((s) => s.kind !== "recently_added")
        .slice(0, SHOWN)
        .map((s) => ({ key: s.kind, name: SMART_INFO[s.kind].name, count: s.count, badge: SMART_INFO[s.kind].badge, picture: paintingFor(s.kind), own: false, open: () => onOpenCompendium(s.kind) }));

  return (
    <Section title="Compendium" className="compendium-row" onViewAll={onViewAll}>
      {overview && cards.length === 0 ? (
        <EmptyNote>Collections you make in the Compendium will show here.</EmptyNote>
      ) : (
        <ul className="compendium-cards">
          {cards.map((c) => (
            <li key={c.key}>
              <button type="button" className="compendium-card" onClick={c.open} title={c.name}>
                {c.picture && <img className={c.own ? "private-picture" : undefined} src={c.picture} alt="" loading="lazy" draggable={false} />}
                <span className="compendium-card-text">
                  <span className="compendium-card-name">
                    <Badge name={c.badge} size={22} />
                    {c.name}
                  </span>
                  <span className="compendium-card-count">{items(c.count)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
