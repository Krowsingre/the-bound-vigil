import { useRef, useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { useToast } from "../components/Toast";

export const downloadable = (book: BookPreview) =>
  !book.fileUnavailable && (book.availability === "cloud" || book.availability === "missing");

export function useBatchDownloads(onChanged: () => void) {
  const toast = useToast();
  const running = useRef(false);
  const [progress, setProgress] = useState("");
  const [failed, setFailed] = useState<BookPreview[]>([]);

  const download = async (load: () => Promise<BookPreview[]>) => {
    if (running.current) return;
    running.current = true;
    setProgress("Finding downloads…");
    try {
      const books = (await load()).filter(downloadable);
      const errors: BookPreview[] = [];
      for (const [index, book] of books.entries()) {
        setProgress(`Downloading ${index + 1} of ${books.length}…`);
        try {
          await api.downloadBook(book.id);
        } catch {
          errors.push(book);
        }
      }
      setFailed(errors);
      if (books.length) onChanged();
      const completed = books.length - errors.length;
      toast(books.length ? `Downloaded ${completed} of ${books.length} to this device.` : "There are no files to download.");
    } catch (error) {
      toast(String(error));
    } finally {
      running.current = false;
      setProgress("");
    }
  };

  const feedback = (
    <>
      {progress && <p role="status">{progress}</p>}
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
