// A book's details: the audiobook it's paired with (for an ebook or
// document), or the ebook or document (for an audiobook), with ways to pair,
// change or unpair.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { DOCUMENT_PAIR_NOTE, PairDialog } from "../audio/LinkEbook";
import { useToast } from "../components/Toast";
import { isAudio, isDocument } from "../lib/queryBooks";
import { showBookDetails } from "./openDetails";

type Partner = { id: string; name: string; format?: string } | null;

export function PairRow({ book, refreshKey }: { book: BookPreview; refreshKey: number }) {
  const toast = useToast();
  const listening = isAudio(book.format);
  const [partner, setPartner] = useState<Partner | undefined>(undefined);
  const [choosing, setChoosing] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    const found: Promise<Partner> = listening
      ? api.audiobook(book.id).then((a) => a.ebook)
      : api
          .audiobookForEbook(book.id)
          .then((id) => (id ? api.bookDetails(id).then((d) => ({ id, name: d.book.title, format: d.book.format })) : null));
    found.then(
      (p) => current && setPartner(p),
      () => current && setPartner(null),
    );
    return () => {
      current = false;
    };
  }, [book.id, listening, refreshKey, reload]);

  if (partner === undefined) return null;
  const unpair = () => {
    if (!partner) return;
    api.linkEbook(listening ? book.id : partner.id, null).then(
      () => setReload((n) => n + 1),
      (e: unknown) => toast(`Couldn't unpair them: ${String(e)}`),
    );
  };
  // A document on either side: the pages are turned by hand.
  const byHand = isDocument(book.format) || (!!partner?.format && isDocument(partner.format));

  return (
    <div>
      <dt>{listening ? "Read along with" : "Listen along with"}</dt>
      <dd>
        {partner ? (
          <button type="button" className="view-all" onClick={() => showBookDetails(partner.id)}>
            {partner.name}
          </button>
        ) : (
          <span className="muted">{listening ? "No ebook or document paired" : "No audiobook paired"}</span>
        )}{" "}
        <button type="button" className="view-all" onClick={() => setChoosing(true)}>
          {partner ? "Change" : "Pair"}
        </button>
        {partner && (
          <button type="button" className="view-all" onClick={unpair}>
            Unpair
          </button>
        )}
        {partner && byHand && <span className="details-origin">{DOCUMENT_PAIR_NOTE}</span>}
        {choosing && (
          <PairDialog
            book={book}
            onClose={(other) => {
              setChoosing(false);
              if (other) setReload((n) => n + 1);
            }}
          />
        )}
      </dd>
    </div>
  );
}
