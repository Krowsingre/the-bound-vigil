// Attunement › Connections on a computer (embre, 27 November): three full-width sections.
// Reading Services: Goodreads, which goes by file (no sign-in), and Hardcover. Publishing
// Services: Canva. E-readers: the readers plugged in now, and Kindle by email, whose
// settings open in their own window. Phones keep their pages as they were.

import { useCallback, useEffect, useState } from "react";
import { api, isApp, openExternal } from "../api";
import type { Ereader, HardcoverStatus, KindleEmailView } from "../api/types";
import { Icon } from "../components/Icon";
import { InfoTip } from "../components/InfoTip";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { DESKTOP_ONLY } from "../ereaders/ereaders";
import { usePublisher } from "../license/Publisher";
import { useCanvaStatus } from "../writing/CanvaLink";
import { AtPage, AtRow, AtRows, AtSection, AtSwitch, usePhone } from "./attune";
import { canvaHere } from "./CanvaSection";
import { KindleEmailForm } from "./EreadersTab";
import { useGoodreads } from "./OtherTabs";

export function DeskConnections() {
  const phone = usePhone();
  return (
    <AtPage className="at-connections">
      <AtSection id="reading-services" title="Reading Services" also={["ratings", "goodreads", "hardcover"]}>
        <AtRows>
          <GoodreadsRow />
          <HardcoverRows />
        </AtRows>
      </AtSection>
      {canvaHere && (
        <AtSection id="publishing-services" title="Publishing Services" also={["canva"]}>
          <AtRows>
            <CanvaRow />
          </AtRows>
        </AtSection>
      )}
      <AtSection id="ereaders" title="E-readers" also={["connected", "kindle"]}>
        <AtRows>
          {/* A phone has no plugged-in readers: Kindle by email only, opening in place (embre, 28 November). */}
          {!phone && <ReaderRows />}
          {phone ? <PhoneKindle /> : <KindleRow />}
        </AtRows>
      </AtSection>
    </AtPage>
  );
}

function GoodreadsRow() {
  const phone = usePhone();
  const { busy, start, exportFile, report } = useGoodreads();
  const name = (
    <span className="at-label-with-tip">
      Goodreads
      <InfoTip label="How to bring in a Goodreads export" title="Goodreads">
        <p>
          Goodreads doesn't let other apps change your account, so ratings travel by file. On the Goodreads website, open My Books, then Import and
          export, and choose Export Library. Save the file it gives you, then choose Import here.
        </p>
        <p>Importing only fills in what TBV is missing. Export makes a file of your ratings, reading status and shelves for Goodreads to import.</p>
      </InfoTip>
    </span>
  );
  return (
    <AtRow label={name} hint={phone ? undefined : "Transfer ratings, reading status and shelves."}>
      <div className="at-buttons">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void start()}>
          <Icon name="upload" size={16} /> Import
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void exportFile()}>
          <Icon name="download" size={16} /> Export
        </button>
      </div>
      {report}
    </AtRow>
  );
}

function HardcoverRows() {
  const toast = useToast();
  const [status, setStatus] = useState<HardcoverStatus | null>(null);
  const [busy, setBusy] = useState<"signIn" | "sendAll" | null>(null);
  useEffect(() => {
    api.hardcoverStatus().then(setStatus, () => setStatus(null));
  }, []);
  const signIn = async () => {
    if (!isApp) return toast("Signing in to Hardcover works in the desktop app.");
    setBusy("signIn");
    try {
      const next = await api.hardcoverSignIn();
      setStatus(next);
      toast(`Signed in to Hardcover as ${next.username}.`);
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(null);
    }
  };
  const sendAll = async () => {
    setBusy("sendAll");
    try {
      const { sent, notFound } = await api.hardcoverSendAll();
      const missing = notFound.length ? ` Hardcover doesn't seem to have ${notFound.length === 1 ? notFound[0] : `${notFound.length} of them`}.` : "";
      toast(`Sent ${sent} ${sent === 1 ? "rating" : "ratings"} to Hardcover.${missing}`);
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const change = (work: Promise<HardcoverStatus>) => work.then(setStatus, (e: unknown) => toast(String(e)));

  if (!status?.available) return <AtRow label="Hardcover" hint="Signing in to Hardcover arrives in the next version of TBV." />;
  if (!status.username)
    return (
      <AtRow label="Hardcover" hint={busy === "signIn" ? "Waiting for Hardcover in your browser…" : "Not connected"}>
        <div className="at-buttons">
          <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void signIn()}>
            Sign in
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => void openExternal("https://hardcover.app/join")}>
            Sign up
          </button>
        </div>
      </AtRow>
    );
  return (
    <>
      <AtRow label="Hardcover" hint={`@${status.username} · Connected on this device`}>
        <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => void change(api.hardcoverSignOut())}>
          Sign out
        </button>
      </AtRow>
      <AtSwitch label="Send ratings automatically" checked={status.sendRatings} onChange={(on) => void change(api.hardcoverSetSending(on))} />
      <AtRow label="Send existing ratings">
        <button type="button" className="btn btn-quiet" disabled={!status.sendRatings || busy !== null} onClick={() => void sendAll()}>
          {busy === "sendAll" ? "Sending… (a few seconds a book)" : "Send now"}
        </button>
      </AtRow>
    </>
  );
}

function CanvaRow() {
  const toast = useToast();
  const phone = usePhone();
  const publisher = usePublisher();
  // Shared with the book's Canva buttons, so connecting here shows them there straight away.
  const [status, setStatus] = useCanvaStatus();
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    if (!isApp && !import.meta.env.DEV) return toast("Connecting Canva works in the desktop app.");
    setBusy(true);
    try {
      const next = await api.canvaSignIn();
      setStatus(next);
      toast(`Canva is connected${next.name ? ` as ${next.name}` : ""}.`);
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };
  if (!status?.available) return <AtRow label="Canva" hint="Canva isn't set up in this copy of TBV." />;
  if (status.name)
    return (
      <AtRow label="Canva" hint={`${status.name} · Connected on this device`}>
        <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => void api.canvaSignOut().then(setStatus, (e: unknown) => toast(String(e)))}>
          Disconnect
        </button>
      </AtRow>
    );
  return (
    <AtRow label="Canva" hint="Not connected · Publisher">
      <div className="at-buttons">
        {!phone && (
          <button type="button" className="btn btn-quiet" onClick={() => void openExternal("https://www.canva.com/signup")}>
            Make a Canva account
          </button>
        )}
        <button type="button" className={phone ? "btn btn-quiet" : "btn btn-primary"} disabled={busy} onClick={() => publisher.check("Canva", () => void connect())}>
          {busy ? "Waiting for Canva in your browser…" : phone ? "Connect" : "Connect Canva"}
        </button>
      </div>
    </AtRow>
  );
}

function ReaderRows() {
  const toast = useToast();
  const [readers, setReaders] = useState<Ereader[] | null>(null);
  const look = useCallback(() => {
    setReaders(null);
    api.listEreaders().then(setReaders, () => setReaders([]));
  }, []);
  useEffect(look, [look]);
  const eject = async (r: Ereader) => {
    try {
      await api.ejectEreader(r);
      toast(`${r.name} can be unplugged now.`);
      look();
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    }
  };
  const state = !isApp && api.kind !== "preview"
    ? DESKTOP_ONLY
    : readers === null
      ? "Looking…"
      : readers.length === 0
        ? "No e-readers connected."
        : `${readers.length} connected`;
  return (
    <>
      <AtRow label="Connected devices" hint={state}>
        <button type="button" className="btn btn-quiet" disabled={readers === null} onClick={look}>
          <Icon name="sync" size={16} /> Look again
        </button>
      </AtRow>
      {readers?.map((r) => (
        <AtRow
          key={r.root}
          label={
            <span className="at-device">
              <Icon name={r.kind === "other" ? "folder" : "ereader"} size={20} />
              {r.kind === "other" ? `${r.name} (a drive with a books folder)` : r.name}
            </span>
          }
          hint={
            <>
              {[r.formats.map((f) => f.toUpperCase()).join(", "), r.booksFolder].filter(Boolean).join(" · ")}
              {r.kind === "kindle" && <span className="at-device-note">EPUB books go to Kindles by email instead.</span>}
            </>
          }
        >
          <Menu
            label={`More for ${r.name}`}
            className="btn btn-quiet at-more-button"
            trigger={<Icon name="more" size={18} />}
            items={[
              { label: "Show in File Explorer", icon: "folder", onSelect: () => void api.showFolder(r.booksFolder).catch((e: unknown) => toast(String(e))) },
              { label: "Eject", icon: "arrowUp", onSelect: () => void eject(r) },
            ]}
          />
        </AtRow>
      ))}
    </>
  );
}

function KindleRow() {
  const [saved, setSaved] = useState<KindleEmailView | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.kindleEmailSettings().then(setSaved, () => setSaved(null));
  }, []);
  const close = () => setOpen(false);
  return (
    <AtRow label="Kindle by email" hint={saved === undefined ? undefined : saved ? saved.kindle : "Not configured."}>
      <button type="button" className="btn btn-quiet" disabled={saved === undefined} onClick={() => setOpen(true)}>
        {saved ? "Edit" : "Configure"}
      </button>
      {open && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
          <div className="dialog kindle-dialog" role="dialog" aria-label="Kindle by email" onKeyDown={(e) => e.key === "Escape" && close()}>
            <div className="shortcuts-sheet-head">
              <h2>Kindle by email</h2>
              <button type="button" className="icon-btn" aria-label="Close" autoFocus onClick={close}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <p className="settings-row-hint">
              Amazon's Send to Kindle takes EPUB, PDF, Word and text books by email, and turns them into Kindle books. TBV sends them from your own email
              account.
            </p>
            <KindleEmailForm onChange={setSaved} onDone={close} />
          </div>
        </div>
      )}
    </AtRow>
  );
}

/** Kindle by email on a phone: one row that opens its settings in place under it. */
function PhoneKindle() {
  const [saved, setSaved] = useState<KindleEmailView | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.kindleEmailSettings().then(setSaved, () => setSaved(null));
  }, []);
  return (
    <>
      <AtRow label="Kindle by email">
        <button type="button" className={`at-ios-value${open ? " is-open" : ""}`} aria-expanded={open} disabled={saved === undefined} onClick={() => setOpen(!open)}>
          <span>{saved ? saved.kindle : "Not set"}</span>
          <Icon name="chevronRight" size={16} />
        </button>
      </AtRow>
      {open && (
        <div className="at-ios-form at-ios-kindle">
          <KindleEmailForm onChange={setSaved} onDone={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
