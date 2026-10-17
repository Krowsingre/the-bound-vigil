import type { LibraryCounts } from "../api/types";
import { Stat } from "./ReadingActivity";
import { Section } from "./Section";

export function LibrarySnapshot({ counts, onOpenLibrary }: { counts: LibraryCounts; onOpenLibrary: () => void }) {
  return (
    <Section title="Library snapshot" className="snapshot">
      <div className="stats stats-4">
        <Stat value={counts.total} label="Total books" />
        <Stat value={counts.unread} label="Unread" />
        <Stat value={counts.inProgress} label="In progress" />
        <Stat value={counts.read} label="Read" />
      </div>
      <button type="button" className="btn btn-quiet btn-wide" onClick={onOpenLibrary}>
        Open Library <span aria-hidden>→</span>
      </button>
    </Section>
  );
}
