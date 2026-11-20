// Music albums (embre, 19 November): songs stay items of their own, kept
// together as an album. A song's album is its series and its track the
// number in it, so the album stacks like a series. Group as album puts the
// chosen songs in one; Ungroup takes them out again.

import { useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { placeChanges } from "../details/SeriesEditor";

/** The album most of these songs are already on, else the first one's title. */
export function albumNameFor(books: BookPreview[]): string {
  const counts = new Map<string, number>();
  for (const b of books) {
    const name = b.series?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0] ?? books[0]?.title ?? "";
}

/** Track numbers: the ones the songs have when they all differ, else 1, 2, 3 in the order shown. */
export function trackOrder(books: BookPreview[]): { book: BookPreview; track: number }[] {
  const numbers = books.map((b) => b.seriesIndex);
  const own = numbers.every((n): n is number => n != null) && new Set(numbers).size === numbers.length;
  if (own) return [...books].sort((a, b) => (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0)).map((book) => ({ book, track: book.seriesIndex! }));
  return books.map((book, i) => ({ book, track: i + 1 }));
}

export function AlbumDialog({ books, ungroup, onClose }: { books: BookPreview[]; ungroup: boolean; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [name, setName] = useState(() => albumNameFor(books));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const songs = books.length === 1 ? "this song" : `these ${books.length} songs`;

  if (ungroup) {
    return (
      <ConfirmDialog
        title="Ungroup the album?"
        body={`Takes ${songs} out of their album. They stay in Resonance as songs of their own.`}
        confirm="Ungroup"
        confirmDisabled={busy}
        onCancel={() => onClose(false)}
        onConfirm={() => {
          setBusy(true);
          api.editDetails(books.map((b) => b.id), placeChanges([])).then(
            () => {
              toast(books.length === 1 ? "Took the song out of its album." : `Took ${books.length} songs out of their album.`);
              onClose(true);
            },
            (e: unknown) => {
              toast(`Couldn't ungroup: ${String(e)}`);
              onClose(false);
            },
          );
        }}
      />
    );
  }

  const group = async () => {
    const album = name.split(/\s+/).filter(Boolean).join(" ");
    if (!album) return setError("Give the album a name.");
    setBusy(true);
    setError(null);
    try {
      for (const { book, track } of trackOrder(books)) {
        await api.editDetails([book.id], placeChanges([{ name: album, number: track }]));
        if (book.audioType !== "music") await api.setAudioType(book.id, "music");
      }
      toast(`Grouped ${books.length} songs as “${album}”.`);
      onClose(true);
    } catch (e) {
      setBusy(false);
      setError(`Couldn't group them: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <form
        className="dialog album-dialog"
        role="dialog"
        aria-label="Group as album"
        onKeyDown={(e) => e.key === "Escape" && onClose(false)}
        onSubmit={(e) => {
          e.preventDefault();
          void group();
        }}
      >
        <h2>Group as album</h2>
        <p className="muted">
          Keeps {songs} together as one album in Music, numbered as tracks. Each song stays an item of its own.
        </p>
        <label className="field">
          <span>Album</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Group
          </button>
        </div>
      </form>
    </div>
  );
}
