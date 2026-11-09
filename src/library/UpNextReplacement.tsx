import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { UP_NEXT_LIMIT } from "./shelfLimits";

const REPLACE = "tbv:replace-up-next";

export function askUpNextReplacement(book: BookPreview) {
  window.dispatchEvent(new CustomEvent(REPLACE, { detail: book }));
}

export function UpNextReplacementHost({ onChanged }: { onChanged: () => void }) {
  const [book, setBook] = useState<BookPreview | null>(null);
  const [members, setMembers] = useState<BookPreview[]>([]);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const open = (event: Event) => setBook((event as CustomEvent<BookPreview>).detail);
    window.addEventListener(REPLACE, open);
    return () => window.removeEventListener(REPLACE, open);
  }, []);

  useEffect(() => {
    if (!book) return;
    let active = true;
    setMembers([]);
    setPicked("");
    setError("");
    void api.getLibrary({ shelf: "want_to_read", sort: "title", search: null, formats: [], location: null, page: 0, pageSize: UP_NEXT_LIMIT }).then(
      (page) => { if (active) setMembers(page.books); },
      (failure: unknown) => { if (active) setError(String(failure)); },
    );
    return () => { active = false; };
  }, [book]);

  if (!book) return null;
  const replace = async () => {
    if (busy || !picked) return;
    setBusy(true);
    try {
      await api.setWantToRead(book.id, true, picked);
      onChanged();
      setBook(null);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      title="Replace a book in Up Next"
      body={<>
        <p>Up Next holds 15 books. Choose which book to replace with “{book.title}”.</p>
        <label>
          Book to replace
          <select disabled={busy || !members.length} value={picked} onChange={(event) => { setPicked(event.target.value); setError(""); }}>
            <option value="">Choose a book</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.title} · {member.authors.join(", ")}</option>)}
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
      </>}
      confirm={busy ? "Replacing..." : "Replace"}
      confirmDisabled={busy || !picked}
      onConfirm={() => void replace()}
      onCancel={() => { if (!busy) setBook(null); }}
    />
  );
}
