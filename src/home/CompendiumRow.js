import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Sanctum's Compendium row: your collections on their pictures, pinned
// ones first, each with how many books it holds. With none of your own yet,
// it shows the smart compendiums instead.
import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge } from "../collections/badges";
import { pictureUrl, SMART_INFO } from "../collections/collectionInfo";
import { GALLERY, galleryUrl } from "../collections/gallery";
import { hashOf } from "../lib/format";
import { EmptyNote, Section } from "./Section";
const SHOWN = 4;
/** A gallery painting for a collection that has no picture of its own, the same one each time. */
const paintingFor = (id) => galleryUrl(GALLERY[hashOf(id) % GALLERY.length].name, "wide");
const items = (n) => `${n.toLocaleString()} ${n === 1 ? "item" : "items"}`;
export function CompendiumRow({ refreshKey, onOpenCollection, onOpenCompendium, onViewAll, }) {
    const [overview, setOverview] = useState(null);
    useEffect(() => {
        let current = true;
        api.getCollectionsOverview().then((o) => current && setOverview(o), () => undefined);
        return () => {
            current = false;
        };
    }, [refreshKey]);
    const own = overview ? [...overview.pinned, ...overview.collections.filter((c) => !overview.pinned.some((p) => p.id === c.id))] : [];
    const cards = own.length
        ? own.slice(0, SHOWN).map((c) => ({ key: c.id, name: c.name, count: c.count, badge: c.badge, picture: pictureUrl(c) ?? paintingFor(c.id), own: !!pictureUrl(c) && !c.picture?.startsWith("gallery:"), open: () => onOpenCollection(c.id) }))
        : (overview?.smart ?? [])
            .filter((s) => s.kind !== "recently_added")
            .slice(0, SHOWN)
            .map((s) => ({ key: s.kind, name: SMART_INFO[s.kind].name, count: s.count, badge: SMART_INFO[s.kind].badge, picture: paintingFor(s.kind), own: false, open: () => onOpenCompendium(s.kind) }));
    return (_jsx(Section, { title: "Compendium", className: "compendium-row", onViewAll: onViewAll, children: overview && cards.length === 0 ? (_jsx(EmptyNote, { children: "Collections you make in the Compendium will show here." })) : (_jsx("ul", { className: "compendium-cards", children: cards.map((c) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "compendium-card", onClick: c.open, title: c.name, children: [c.picture && _jsx("img", { className: c.own ? "private-picture" : undefined, src: c.picture, alt: "", loading: "lazy", draggable: false }), _jsxs("span", { className: "compendium-card-text", children: [_jsxs("span", { className: "compendium-card-name", children: [_jsx(Badge, { name: c.badge, size: 22 }), c.name] }), _jsx("span", { className: "compendium-card-count", children: items(c.count) })] })] }) }, c.key))) })) }));
}
