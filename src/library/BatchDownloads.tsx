import { useRef, useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { useToast } from "../components/Toast";
import { bookDownload, tracked, wasStopped } from "./cloudDownloads";

export const downloadable = (book: BookPreview) =>
  !book.fileUnavailable && (book.availability === "cloud" || book.availability === "missing");

export function useBatchDownloads(onChanged: () => void) {
  const toast = useToast();
  const running = useRef(false);
  // Stop all: the book coming down now is stopped and the rest aren't started.
  const stopping = useRef(false);
  const current = useRef<string | null>(null);
  const [progress, setProgress] = useState("");
  const [failed, setFailed] = useState<BookPreview[]>([]);

  const download = async (load: () => Promise<BookPreview[]>) => {
    if (running.current) return;
    running.current = true;
    stopping.current = false;
    setProgress("Finding downloads…");
    try {
      const books = (await load()).filter(downloadable);
      const errors: BookPreview[] = [];
      let completed = 0;
      for (const [index, book] of books.entries()) {
        if (stopping.current) break;
        setProgress(`Downloading ${index + 1} of ${books.length}…`);
        current.current = book.id;
        try {
          await tracked(book.id, api.downloadBook(book.id));
          completed++;
        } catch (error) {
          if (!wasStopped(error)) errors.push(book);
        }
      }
      current.current = null;
      setFailed(errors);
      if (books.length) onChanged();
      toast(
        !books.length ? "There are no files to download."
          : stopping.current ? `Stopped. Downloaded ${completed} of ${books.length} to this device.`
          : `Downloaded ${completed} of ${books.length} to this device.`,
      );
    } catch (error) {
      toast(String(error));
    } finally {
      running.current = false;
      setProgress("");
    }
  };

  const stopAll = () => {
    stopping.current = true;
    if (current.current) void api.stopDownload?.(bookDownload(current.current));
  };

  const feedback = (
    <>
      {progress && (
        <p role="status" className="batch-download-status">
          {progress}
          {api.stopDownload && running.current && (
            <button type="button" className="btn btn-quiet btn-small btn-danger-text" onClick={stopAll}>
              Stop all
            </button>
          )}
        </p>
      )}
      {failed.length > 0 && (
        <section aria-label="Failed downloads">
          <p>These files couldn’t be downloaded.</p>
          <ul>{failed.map((book) => <li key={book.id}>{book.title}</li>)}</ul>
          <button type="button" className="btn btn-quiet" disabled={!!progress} onClick={() => void download(async () => failed)}>
            Retry failed
          </button>
        </section>
      )}
    </>
  );
  return { download, feedback, progress };
}
