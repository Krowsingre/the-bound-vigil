// "Send to e-reader…": any book menu, or the Library's Select mode, asks for
// this dialog; the one host in App shows it. Books go one at a time after
// the dialog closes, and a toast says how it went.

import { useCallback, useEffect, useState } from "react";
import { api, isApp } from "../api";
import type { BookPreview, Ereader, KindleEmailView } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { destination, DESKTOP_ONLY, problemFor, summary, targetNote, type SendResult, type SendTarget } from "./ereaders";

let listener: ((books: BookPreview[]) => void) | null = null;

export function askSendToEreader(books: BookPreview[]) {
  if (books.length) listener?.(books);
}

/** Sends each book that can go, one after another, and sums it up. */
async function sendAll(target: SendTarget, books: BookPreview[]): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const book of books) {
    const problem = problemFor(target, book);
    if (problem) {
      results.push({ title: book.title, outcome: "failed", reason: problem });
      continue;
    }
    try {
      if (target.kind === "email") {
        await api.sendToKindle(book.id);
        results.push({ title: book.title, outcome: "sent" });
      } else {
        const copied = await api.copyToEreader(book.id, target.reader.root);
        results.push({ title: book.title, outcome: copied.alreadyThere ? "already" : "sent" });
      }
    } catch (e) {
      results.push({ title: book.title, outcome: "failed", reason: String(e).replace(/^Error: /, "") });
    }
  }
  return results;
}

export function SendToEreaderHost({ onSetUp }: { onSetUp: () => void }) {
  const [books, setBooks] = useState<BookPreview[] | null>(null);
  const toast = useToast();
  useEffect(() => {
    listener = setBooks;
    return () => {
      listener = null;
    };
  }, []);
  if (!books) return null;
  return (
    <SendDialog
      books={books}
      onClose={() => setBooks(null)}
      onSetUp={() => {
        setBooks(null);
        onSetUp();
      }}
      onSend={(target) => {
        setBooks(null);
        if (!isApp) return toast(DESKTOP_ONLY);
        const what = books.length === 1 ? `“${books[0].title}”` : `${books.length} books`;
        toast(`Sending ${what} to ${destination(target)}…`);
        void sendAll(target, books).then((results) => toast(summary(target, results)));
      }}
    />
  );
}

function SendDialog({
  books,
  onClose,
  onSetUp,
  onSend,
}: {
  books: BookPreview[];
  onClose: () => void;
  onSetUp: () => void;
  onSend: (target: SendTarget) => void;
}) {
  const [readers, setReaders] = useState<Ereader[] | null>(null);
  const [email, setEmail] = useState<KindleEmailView | null>(null);
  const [looking, setLooking] = useState(false);

  const look = useCallback(() => {
    setLooking(true);
    Promise.all([api.listEreaders(), api.kindleEmailSettings()]).then(
      ([found, mail]) => {
        setReaders(found);
        setEmail(mail);
        setLooking(false);
      },
      () => {
        setReaders([]);
        setLooking(false);
      },
    );
  }, []);
  useEffect(look, [look]);

  const named = readers?.filter((r) => r.kind !== "other") ?? [];
  const others = readers?.filter((r) => r.kind === "other") ?? [];
  const choice = (target: SendTarget, icon: "ereader" | "email" | "folder", name: string) => {
    const note = targetNote(target, books);
    return (
      <li key={target.kind === "cable" ? target.reader.root : "email"}>
        <button type="button" className="send-choice" disabled={note.blocked} onClick={() => onSend(target)}>
          <Icon name={icon} size={20} />
          <span className="send-choice-text">
            <span className="send-choice-name">{name}</span>
            <span className={note.blocked ? "send-choice-note is-blocked" : "send-choice-note"}>{note.text}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog send-dialog"
        role="dialog"
        aria-label="Send to e-reader"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2>Send to e-reader</h2>
        <p className="muted add-dialog-book">{books.length === 1 ? books[0].title : `${books.length} books`}</p>
        {!isApp && <p className="send-desktop-only">{DESKTOP_ONLY}</p>}
        {readers === null ? (
          <div className="library-loading" aria-busy="true" aria-label="Looking for e-readers" />
        ) : (
          <>
            <ul className="send-list">
              {named.map((r) => choice({ kind: "cable", reader: r }, "ereader", r.name))}
              {email && choice({ kind: "email", kindle: email.kindle }, "email", "Kindle by email")}
            </ul>
            {!named.length && (
              <p className="muted send-empty">
                No e-readers are plugged in. Connect yours with its cable; if it asks, choose to connect it to the computer.
              </p>
            )}
            {others.length > 0 && (
              <>
                <h3 className="send-heading">Other drives</h3>
                <p className="settings-row-hint">These have a books folder. Choose one only if it's your e-reader.</p>
                <ul className="send-list">{others.map((r) => choice({ kind: "cable", reader: r }, "folder", r.name))}</ul>
              </>
            )}
            {!email && (
              <p className="send-setup">
                <Icon name="email" size={16} /> Send to your Kindle by email, even EPUB books.{" "}
                <button type="button" className="link-button" onClick={onSetUp}>
                  Set it up
                </button>
              </p>
            )}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" disabled={looking} onClick={look}>
            <Icon name="sync" size={16} /> {looking ? "Looking…" : "Look again"}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
