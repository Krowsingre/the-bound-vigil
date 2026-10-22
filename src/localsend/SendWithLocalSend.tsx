// "Send with LocalSend": any book menu, or the Library's Actions menu, asks
// for this dialog; the one host in App shows it, for books, documents and
// audiobooks alike. It finds devices nearby with LocalSend open, sends to the
// one chosen once its person accepts, and shows how it's going.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isHome, isWeb } from "../api";
import type { BookPreview, LocalSendSending, NearbyDevice } from "../api/types";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { kindOf } from "../lib/queryBooks";

let listener: ((books: BookPreview[]) => void) | null = null;

/** The web version and the at-home phone page can't reach devices nearby. */
export const canSendWithLocalSend = !isWeb && !isHome;

export function askSendWithLocalSend(books: BookPreview[]) {
  if (books.length) listener?.(books);
}

type Stage = { at: "choosing" } | { at: "sending"; to: NearbyDevice; progress: LocalSendSending | null };

export function SendWithLocalSendHost() {
  const [books, setBooks] = useState<BookPreview[] | null>(null);
  const [shown, setShown] = useState(false);
  const [stage, setStage] = useState<Stage>({ at: "choosing" });
  const toast = useToast();
  useEffect(() => {
    listener = (asked) => {
      // One send at a time: while one is going, asking again shows it.
      setStage((now) => {
        if (now.at === "choosing") setBooks(asked);
        return now;
      });
      setShown(true);
    };
    return () => {
      listener = null;
    };
  }, []);
  useEffect(() => api.onLocalSendSending((progress) => setStage((now) => (now.at === "sending" ? { ...now, progress } : now))), []);

  const send = (to: NearbyDevice) => {
    if (!books) return;
    setStage({ at: "sending", to, progress: null });
    api.sendWithLocalSend(to, books.map((b) => b.id)).then(
      ({ sent, skipped }) => {
        const word = wordFor(books);
        const what = sent === 1 ? `1 ${word.replace(/s$/, "")}` : `${sent} ${word}`;
        const left = skipped.length ? ` ${skipped.length === 1 ? `“${skipped[0][0]}” couldn't go: ${skipped[0][1]}` : `${skipped.length} couldn't go.`}` : "";
        toast(sent ? `Sent ${what} to ${to.alias}.${left}` : skipped.length ? `Nothing was sent.${left}` : `${to.alias} already has them.`);
        finish();
      },
      (e) => {
        toast(String(e).replace(/^Error: /, ""));
        finish();
      },
    );
  };
  const finish = () => {
    setStage({ at: "choosing" });
    setBooks(null);
    setShown(false);
  };

  if (!books || !shown) return null;
  const what = books.length === 1 ? books[0].title : `${books.length} ${wordFor(books)}`;
  const close = () => (stage.at === "sending" ? setShown(false) : finish());
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog send-dialog" role="dialog" aria-label="Send with LocalSend" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>Send with LocalSend</h2>
        <p className="muted add-dialog-book">{what}</p>
        {stage.at === "choosing" ? (
          <Devices onSend={send} onClose={close} />
        ) : (
          <>
            {stage.progress ? (
              <div className="localsend-progress">
                <p>
                  {stage.progress.books > 1 && `${stage.progress.book} of ${stage.progress.books}: `}
                  {stage.progress.title}
                </p>
                <ProgressBar value={stage.progress.size ? stage.progress.bytes / stage.progress.size : null} label={`Sending to ${stage.to.alias}`} />
              </div>
            ) : (
              <p className="localsend-waiting">
                Waiting for {stage.to.alias} to accept. Tap <strong>Accept</strong> in LocalSend on that device.
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => void api.stopSendingWithLocalSend()}>
                <Icon name="stop" size={16} /> Stop
              </button>
              <button type="button" className="btn btn-primary" onClick={close}>
                Hide
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "documents" when they're all documents, and so on; "books" when mixed. */
function wordFor(books: BookPreview[]): string {
  const kinds = new Set(books.map((b) => kindOf(b.format)));
  return kinds.size === 1 ? [...kinds][0] : "books";
}

/** The devices found nearby, and a way to type one's address in. */
function Devices({ onSend, onClose }: { onSend: (to: NearbyDevice) => void; onClose: () => void }) {
  const [devices, setDevices] = useState<NearbyDevice[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const look = useCallback(() => {
    setLooking(true);
    api.localSendNearby().then(
      (found) => {
        if (!alive.current) return;
        setDevices(found);
        setLooking(false);
      },
      (e) => {
        if (!alive.current) return;
        setDevices([]);
        setProblem(String(e).replace(/^Error: /, ""));
        setLooking(false);
      },
    );
  }, []);
  useEffect(look, [look]);

  const typed = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    api.localSendDeviceAt(address).then(onSend, (err) => setProblem(String(err).replace(/^Error: /, "")));
  };

  return (
    <>
      {devices === null ? (
        <p className="muted send-empty" aria-busy="true">
          Looking for devices nearby with LocalSend open…
        </p>
      ) : (
        <>
          <ul className="send-list">
            {devices.map((d) => (
              <li key={d.fingerprint}>
                <button type="button" className="send-choice" onClick={() => onSend(d)}>
                  <Icon name={d.deviceType === "mobile" ? "phone" : "computer"} size={20} />
                  <span className="send-choice-text">
                    <span className="send-choice-name">{d.alias}</span>
                    <span className="send-choice-note">{d.address}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!devices.length && (
            <p className="muted send-empty">
              No devices found. Open LocalSend on the other device and keep it on the same Wi-Fi, then look again.
            </p>
          )}
        </>
      )}
      <form className="localsend-address" onSubmit={typed}>
        <label htmlFor="localsend-address">Not listed? Type the address LocalSend shows on its Receive screen.</label>
        <span className="localsend-address-row">
          <input id="localsend-address" className="input" value={address} placeholder="192.168.1.20" inputMode="decimal" onChange={(e) => setAddress(e.target.value)} />
          <button type="submit" className="btn btn-quiet" disabled={!address.trim()}>
            Send
          </button>
        </span>
      </form>
      {problem && <p className="send-desktop-only">{problem}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" disabled={looking} onClick={look}>
          <Icon name="sync" size={16} /> {looking ? "Looking…" : "Look again"}
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
