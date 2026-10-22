// Someone is sending files with LocalSend: TBV asks first. Accepted books
// go into the import queue.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { LocalSendOffer } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { formatBytes } from "../settings/controls";

export function LocalSendOffers() {
  const [offers, setOffers] = useState<LocalSendOffer[]>([]);
  const toast = useToast();
  useEffect(() => api.onLocalSendOffer((offer) => setOffers((list) => [...list, offer])), []);
  const offer = offers[0];
  if (!offer) return null;
  const answer = (accept: boolean) => {
    void api.answerLocalSend(offer.session, accept);
    if (accept) toast("Accepted. Follow each file on the Imports page.");
    setOffers((list) => list.slice(1));
  };
  const taken = offer.files.filter((f) => f.importable);
  const skipped = offer.files.length - taken.length;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-label={`${offer.from} wants to send files`}>
        <h2>{offer.from} wants to send {taken.length === 1 ? "a book" : `${taken.length} books`}</h2>
        <ul className="localsend-files">
          {taken.map((f) => (
            <li key={f.id}>
              <Icon name={/\.(mp3|m4a|m4b|aac|ogg|opus|flac)$/i.test(f.name) ? "headphones" : "file"} size={16} />
              <span className="browse-name">{f.name}</span>
              <span className="browse-size">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
        {skipped > 0 && (
          <p className="settings-row-hint">
            {skipped === 1 ? "1 other file isn't" : `${skipped} other files aren't`} a book, document or audiobook, so TBV won't take{" "}
            {skipped === 1 ? "it" : "them"}.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => answer(false)}>
            Decline
          </button>
          <button type="button" className="btn btn-primary" onClick={() => answer(true)}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
