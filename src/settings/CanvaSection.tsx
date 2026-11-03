// Preferences › Scribe › Canva: connect a Canva account to design covers,
// pictures and whole pages there (a Scribe Publisher feature, on computers). In Preferences › Scribe.

import { useEffect, useState } from "react";
import { api, isApp, isIOS, openExternal } from "../api";
import type { CanvaStatus } from "../api/types";
import { useToast } from "../components/Toast";
import { usePublisher } from "../license/Publisher";
import { Row, Section } from "./controls";

/** Canva works on computers only for now. */
export const canvaHere = !isIOS && !(typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent));

export function CanvaSection() {
  const toast = useToast();
  const publisher = usePublisher();
  const [status, setStatus] = useState<CanvaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.canvaStatus().then(setStatus, () => setStatus(null));
  }, []);

  if (!canvaHere) return null;

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

  return (
    <Section
      id="canva"
      title="Canva"
      lede="Design covers, pictures and whole pages of your books in Canva, then bring them back into Scribe. Part of Scribe Publisher."
    >
      {!status?.available ? (
        <p className="settings-row-hint">Canva isn't set up in this copy of TBV.</p>
      ) : status.name ? (
        <Row label="Account" hint="Connected on this device only.">
          <div className="connection-actions">
            <span className="settings-value">{status.name}</span>
            <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => void api.canvaSignOut().then(setStatus, (e: unknown) => toast(String(e)))}>
              Disconnect
            </button>
          </div>
        </Row>
      ) : (
        <>
          <div className="connection-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => publisher.check("Canva", () => void connect())}>
              {busy ? "Waiting for Canva in your browser…" : "Connect Canva"}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void openExternal("https://www.canva.com/signup")}>
              Make a Canva account
            </button>
          </div>
          <p className="settings-row-hint">
            Your browser opens Canva to allow TBV. TBV never sees your Canva password, and only sees designs it made or you send it.
          </p>
        </>
      )}
    </Section>
  );
}
