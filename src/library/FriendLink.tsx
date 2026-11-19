// Send to a TBV friend (embre, 19 November): a link a friend sent, pasted
// in, brings their books into this library. Tapping the link on an iPhone or
// iPad with TBV does the same by itself; this is for a link that opened
// somewhere else (a browser, a computer).

import { useEffect, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";

let listener: ((open: boolean) => void) | null = null;

export const canReceiveFromFriend = () => !!api.receiveFromFriend;

export function askFriendLink() {
  listener?.(true);
}

export function FriendLinkHost() {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    listener = setOpen;
    return () => {
      listener = null;
    };
  }, []);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    setLink("");
    setBusy(false);
  };
  const bringIn = async () => {
    setBusy(true);
    try {
      const count = await api.receiveFromFriend!(link.trim());
      toast(count === 1 ? "The book is being added to your library." : `${count} books are being added to your library.`);
      close();
    } catch (error) {
      toast(String(error));
      setBusy(false);
    }
  };
  const looksRight = /^https:\/\/(www\.)?icloud\.com\/share\//i.test(link.trim());
  return (
    <ConfirmDialog
      title="Open a friend's link"
      body={
        <>
          <p className="muted">Paste the link a friend sent from TBV. Their books come into your library.</p>
          <input
            className="input friend-link"
            aria-label="Your friend's link"
            placeholder="https://www.icloud.com/share/…"
            value={link}
            autoFocus
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && looksRight && !busy && void bringIn()}
          />
        </>
      }
      confirm={busy ? "Bringing them in…" : "Bring them in"}
      confirmDisabled={!looksRight || busy}
      onConfirm={() => void bringIn()}
      onCancel={close}
    />
  );
}
