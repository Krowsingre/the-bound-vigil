import { useEffect, useRef, useState } from "react";
import { AlbumDialog } from "../audio/AlbumDialog";
import { DetailsEditor } from "./DetailsEditor";
import { FetchDetails } from "./FetchDetails";
import { onDetailsDialog, type DetailsAsk } from "./openDetails";

/** Shows the details editor and the online search, wherever they're asked for. */
export function DetailsHost({ onChanged }: { onChanged: () => void }) {
  const [ask, setAsk] = useState<DetailsAsk | null>(null);
  // Several books looked up in turn: which one is showing.
  const [at, setAt] = useState(0);
  const changedAny = useRef(false);
  useEffect(
    () =>
      onDetailsDialog((next) => {
        setAt(0);
        changedAny.current = false;
        setAsk(next);
      }),
    [],
  );
  if (!ask) return null;
  const close = (changed: boolean) => {
    setAsk(null);
    if (changed || changedAny.current) onChanged();
    changedAny.current = false;
  };
  if (ask.kind === "edit") return <DetailsEditor key={ask.books.map((b) => b.id).join()} books={ask.books} onClose={close} />;
  if (ask.kind === "album") return <AlbumDialog key={ask.books.map((b) => b.id).join()} books={ask.books} ungroup={ask.ungroup} onClose={close} />;
  if (ask.kind === "fetch") return <FetchDetails key={ask.book.id} book={ask.book} onClose={close} />;
  const { books } = ask;
  const next = () => {
    if (at + 1 < books.length) setAt(at + 1);
    else close(false);
  };
  return (
    <FetchDetails
      key={books[at].id}
      book={books[at]}
      step={{ at, of: books.length, onSkip: next }}
      // Kept: on to the next book. Closed or stopped: the rest are left as they are.
      onClose={(changed) => {
        if (!changed) return close(false);
        changedAny.current = true;
        next();
      }}
    />
  );
}
