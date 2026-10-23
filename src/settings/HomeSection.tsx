// Preferences › Sync › Use on your phone at home: TBV on this computer serves
// itself to a phone on the same Wi-Fi, so books and audiobooks here (and in
// a cloud app's folder, like iCloud) open on the phone without Supabase.

import { useEffect, useState } from "react";
import { api, isApp } from "../api";
import type { HomeStatus } from "../api/types";
import { Section, Toggle } from "./controls";

export function HomeSection() {
  const [status, setStatus] = useState<HomeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<HomeStatus>) => {
    setError(null);
    work().then(setStatus, (e: unknown) => setError(String(e).replace(/^Error: /, "")));
  };
  useEffect(() => {
    run(() => api.homeStatus());
    return api.onHomeChanged(() => run(() => api.homeStatus()));
  }, []);
  const address = status?.addresses[0];
  return (
    <Section
      id="home"
      title="Use on your phone at home"
      lede="Open TBV on your phone straight from this computer while both are on the same Wi-Fi. Books and audiobooks here, and in your iCloud or other cloud folder, open and play on the phone without going through Supabase."
    >
      <Toggle
        label="Serve TBV to my phone"
        hint="Works while TBV is open on this computer. Away from home, the phone uses the normal web version."
        checked={Boolean(status?.on)}
        disabled={!isApp && status === null}
        onChange={(on) => run(() => api.setHome(on))}
      />
      {status?.problem && <p className="form-error">{status.problem}</p>}
      {error && <p className="form-error">{error}</p>}
      {status?.on && !address && (
        <p className="form-error">
          This computer doesn't seem to be on a network. Connect it to your Wi-Fi, then turn this off and on.
        </p>
      )}
      {status?.on && address && (
        <div className="home-pair">
          {status.qr ? (
            <span
              className="home-qr"
              aria-label="QR code to open TBV on your phone"
              dangerouslySetInnerHTML={{ __html: status.qr }}
            />
          ) : (
            <div className="home-qr home-qr-used">
              <span className="muted">Code used</span>
            </div>
          )}
          <div className="home-steps">
            <ol>
              <li>Scan the code with your phone's camera, or open this address in Safari:</li>
            </ol>
            <p className="home-address mono">{address}</p>
            <ol start={2}>
              <li>
                {status.code ? (
                  <>
                    If it asks, enter <strong className="home-code mono">{status.code.replace(/(\d{3})(\d{3})/, "$1 $2")}</strong>
                    . Each code pairs one phone.
                  </>
                ) : (
                  "That code has been used. Ask for a new one to pair another phone."
                )}
              </li>
            </ol>
            <div className="home-actions">
              <button type="button" className="btn btn-quiet btn-small" onClick={() => run(() => api.newHomeCode())}>
                New code
              </button>
              {status.phones > 0 && (
                <button type="button" className="btn btn-quiet btn-small" onClick={() => run(() => api.forgetHomePhones())}>
                  Forget {status.phones === 1 ? "the paired phone" : `all ${status.phones} paired phones`}
                </button>
              )}
            </div>
            <p className="settings-row-hint">
              Windows may ask whether TBV can use your network. Allow it on private networks. The phone can read, listen and keep
              notes; changes to the library are made here.
            </p>
          </div>
        </div>
      )}
    </Section>
  );
}
