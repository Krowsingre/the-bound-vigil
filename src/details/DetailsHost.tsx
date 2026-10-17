import { useEffect, useState } from "react";
import { DetailsEditor } from "./DetailsEditor";
import { FetchDetails } from "./FetchDetails";
import { onDetailsDialog, type DetailsAsk } from "./openDetails";

/** Shows the details editor and the online search, wherever they're asked for. */
export function DetailsHost({ onChanged }: { onChanged: () => void }) {
  const [ask, setAsk] = useState<DetailsAsk | null>(null);
  useEffect(() => onDetailsDialog(setAsk), []);
  if (!ask) return null;
  const close = (changed: boolean) => {
    setAsk(null);
    if (changed) onChanged();
  };
  return ask.kind === "edit" ? (
    <DetailsEditor key={ask.books.map((b) => b.id).join()} books={ask.books} onClose={close} />
  ) : (
    <FetchDetails key={ask.book.id} book={ask.book} onClose={close} />
  );
}
