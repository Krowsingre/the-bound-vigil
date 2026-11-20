// Favourite series and the Top five (embre, 18 November). Favouriting a
// series favourites the stack, not each book in it. Up to five favourite
// books or series can be marked Top five; a sixth asks which to replace.
// Both are kept in the library and sync (series_favourites, top_favourites).

import { useEffect, useState } from "react";
import { api } from "../api";
import type { TopFavourite } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { TOP_FIVE, TOP_FIVE_FULL } from "./shelfLimits";

const CHANGED = "tbv:favourites-changed";
const REPLACE = "tbv:replace-top-five";

export const bookTopKey = (bookId: string) => `book:${bookId}`;
export const seriesTopKey = (name: string) => `series:${name.trim().toLowerCase()}`;

let seriesNow: string[] = [];
let topNow: TopFavourite[] = [];
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  loading ??= Promise.all([api.favouriteSeries?.() ?? [], api.topFavourites?.() ?? []])
    .then(([series, top]) => {
      seriesNow = series;
      topNow = top;
    }, () => undefined)
    .finally(() => {
      loading = null;
      window.dispatchEvent(new Event(CHANGED + ":loaded"));
    });
  return loading;
}

/** Tells every list of favourites to look again (after a book's heart changes, say). */
export function favouritesChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

/** The favourite series and the Top five, kept up to date. */
export function useFavourites(refreshKey = 0): { series: string[]; top: TopFavourite[] } {
  const [state, setState] = useState(() => ({ series: seriesNow, top: topNow }));
  useEffect(() => {
    const show = () => setState({ series: seriesNow, top: topNow });
    const again = () => void load();
    window.addEventListener(CHANGED + ":loaded", show);
    window.addEventListener(CHANGED, again);
    void load();
    return () => {
      window.removeEventListener(CHANGED + ":loaded", show);
      window.removeEventListener(CHANGED, again);
    };
  }, [refreshKey]);
  return state;
}

export const isFavouriteSeries = (name: string, series = seriesNow) => series.some((s) => s.trim().toLowerCase() === name.trim().toLowerCase());
export const isTopFive = (key: string, top = topNow) => top.some((t) => t.key === key);

/** Adds a series to favourites, or takes it out (and out of the Top five). */
export async function setSeriesFavourite(name: string, favourite: boolean): Promise<void> {
  await api.setSeriesFavourite(name, favourite);
  favouritesChanged();
}

/** Adds a favourite to the Top five, or takes it out. When five are there already, asks which one to replace. */
export async function setTopFive(key: string, label: string, top: boolean): Promise<void> {
  try {
    await api.setTopFavourite(key, label, top);
    favouritesChanged();
  } catch (error) {
    if (!top || !String(error).includes(TOP_FIVE_FULL)) throw error;
    window.dispatchEvent(new CustomEvent(REPLACE, { detail: { key, label } }));
  }
}

/** Asks which of the Top five to replace with the one being added. */
export function TopFiveReplaceHost() {
  const [adding, setAdding] = useState<TopFavourite | null>(null);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { top } = useFavourites();
  useEffect(() => {
    const open = (event: Event) => {
      setAdding((event as CustomEvent<TopFavourite>).detail);
      setPicked("");
      setError("");
    };
    window.addEventListener(REPLACE, open);
    return () => window.removeEventListener(REPLACE, open);
  }, []);
  if (!adding) return null;
  const replace = async () => {
    const out = top.find((t) => t.key === picked);
    if (busy || !out) return;
    setBusy(true);
    try {
      await api.setTopFavourite(out.key, out.label, false);
      await api.setTopFavourite(adding.key, adding.label, true);
      favouritesChanged();
      setAdding(null);
    } catch (failure) {
      setError(String(failure).replace(/^Error: /, ""));
      favouritesChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      title="Replace one of your Top five"
      body={
        <>
          <p>Your Top five holds {TOP_FIVE}. Choose which one “{adding.label}” replaces.</p>
          <label>
            Replace
            <select disabled={busy} value={picked} onChange={(event) => (setPicked(event.target.value), setError(""))}>
              <option value="">Choose one</option>
              {top.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                  {t.key.startsWith("series:") ? " (series)" : ""}
                </option>
              ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
        </>
      }
      confirm={busy ? "Replacing…" : "Replace"}
      confirmDisabled={busy || !picked}
      onConfirm={() => void replace()}
      onCancel={() => !busy && setAdding(null)}
    />
  );
}

/** The heart on a series' page: favourites the series as a whole. */
export function SeriesHeart({ name, favourite, onChange }: { name: string; favourite: boolean; onChange: (favourite: boolean) => void }) {
  return (
    <button
      type="button"
      className={`btn btn-quiet series-heart${favourite ? " is-on" : ""}`}
      aria-pressed={favourite}
      title={favourite ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
      onClick={() => onChange(!favourite)}
    >
      <Icon name="heart" size={16} /> {favourite ? "Favourite" : "Add to favourites"}
    </button>
  );
}
