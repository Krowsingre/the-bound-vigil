// Preferences › Archive › Reading history: books finished, dropped or rated,
// kept after they leave the library. Any one can be taken off for good.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { ReadingHistoryEntry } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Stars } from "../components/StarRating";
import { useToast } from "../components/Toast";
import { authorLine } from "../lib/format";
import { Section } from "./controls";

/** How many show before "Show all". */
const FIRST = 30;

export function ReadingHistorySection() {
  const toast = useToast();
  const [entries, setEntries] = useState<ReadingHistoryEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const [forgetting, setForgetting] = useState<ReadingHistoryEntry | null>(null);
  useEffect(() => {
    let current = true;
    api.readingHistory().then(
      (list) => current && setEntries(list),
      () => current && setEntries([]),
    );
    return () => {
      current = false;
    };
  }, []);

  const words = search.trim().toLowerCase();
  const found = (entries ?? []).filter((e) => !words || `${e.title} ${e.authors.join(" ")}`.toLowerCase().includes(words));
  const shown = all || words ? found : found.slice(0, FIRST);

  const forget = async (entry: ReadingHistoryEntry) => {
    setForgetting(null);
    try {
      await api.forgetReading(entry.bookId);
      setEntries((list) => (list ?? []).filter((e) => e.bookId !== entry.bookId));
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    }
  };

  return (
    <Section
      id="history"
      title="Reading history"
      lede="Books you've finished, dropped or rated, kept even after they leave your library. Take one off and nothing about it is kept, on any of your devices."
    >
      {entries === null ? (
        <div className="library-loading" aria-busy="true" aria-label="Loading your reading history" />
      ) : entries.length === 0 ? (
        <p className="settings-row-hint">Nothing yet. Books you finish, drop or rate show here.</p>
      ) : (
        <>
          {entries.length > 8 && (
            <label className="history-search">
              <Icon name="search" size={15} />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a book" aria-label="Find a book in your reading history" />
            </label>
          )}
          <ul className="history-list">
            {shown.map((e) => (
              <li key={e.bookId} className="history-row">
                <span className="history-text">
                  <span className="history-title">{e.title}</span>
                  <span className="muted history-meta">
                    {[
                      authorLine(e.authors),
                      e.status === "read" ? "Finished" : e.status === "dropped" ? "Dropped" : null,
                      e.finishedAt ? new Date(e.finishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null,
                      e.inLibrary ? null : "No longer in your library",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Stars value={e.stars} size={13} />
                <button
                  type="button"
                  className="icon-btn icon-btn-s"
                  aria-label={`Take ${e.title} off your reading history`}
                  title="Take off your reading history"
                  onClick={() => setForgetting(e)}
                >
                  <Icon name="close" size={15} />
                </button>
              </li>
            ))}
          </ul>
          {words && found.length === 0 && <p className="settings-row-hint">No book in your reading history matches “{search.trim()}”.</p>}
          {!all && !words && found.length > FIRST && (
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setAll(true)}>
              Show all {found.length}
            </button>
          )}
        </>
      )}
      {forgetting && (
        <ConfirmDialog
          title={`Take ${forgetting.title} off your reading history?`}
          body={
            forgetting.inLibrary
              ? "It goes from your history on all your devices. The book stays in your library with its rating and status, and comes back here if you finish, drop or rate it again."
              : "It goes for good, on all your devices. Nothing about it is kept."
          }
          confirm="Take it off"
          danger
          onCancel={() => setForgetting(null)}
          onConfirm={() => void forget(forgetting)}
        />
      )}
    </Section>
  );
}
