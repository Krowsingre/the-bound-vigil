// Settings › Servers › LocalSend: TBV shows up in the LocalSend app on phones
// and computers on the same Wi-Fi, and asks before taking anything.

import { useEffect, useState } from "react";
import { api, isApp } from "../api";
import type { LocalSendStatus } from "../api/types";
import { Section, Toggle } from "./controls";

export function LocalSendSection() {
  const [status, setStatus] = useState<LocalSendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.localSendStatus().then(setStatus, () => undefined);
  }, []);
  const set = (on: boolean) => {
    setError(null);
    api.setLocalSend(on).then(setStatus, (e: unknown) => setError(String(e).replace(/^Error: /, "")));
  };
  return (
    <Section
      id="localsend"
      title="LocalSend"
      lede="Send books, documents and audiobooks to TBV from your phone with the free LocalSend app. Both need to be on the same Wi-Fi."
    >
      <Toggle
        label="Receive from LocalSend"
        hint={
          status?.running
            ? `TBV shows in LocalSend as “${status.alias}”. You're asked before anything is taken, and only books, documents and audiobooks are.`
            : "While this is on, TBV shows in LocalSend's list of nearby devices."
        }
        checked={Boolean(status?.enabled)}
        disabled={!isApp && status === null}
        onChange={set}
      />
      {status?.enabled && !status.running && status.problem && <p className="form-error">{status.problem}</p>}
      {error && <p className="form-error">{error}</p>}
      {status?.running && (
        <p className="settings-row-hint">
          The first time, Windows may ask whether TBV can use your network. Allow it on private networks, or LocalSend won't find TBV.
        </p>
      )}
    </Section>
  );
}
