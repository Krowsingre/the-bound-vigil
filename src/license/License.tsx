// Paying for TBV: 30 days to try it in full, then a one-time unlock from the
// Microsoft Store or the App Store. While the trial runs everything works;
// once it's over, this screen stands in front of the library until TBV is
// bought, with a way to take a backup so nothing is ever held hostage.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, isApp, openExternal } from "../api";
import type { LicenseView } from "../api/types";
import emblem from "../assets/emblem.svg?raw";
import { useToast } from "../components/Toast";

const STORE_PAGE = "https://apps.microsoft.com/search?query=The%20Bound%20Vigil";
/** The trial's last days get a reminder when TBV opens. */
const REMIND_DAYS = 3;

interface LicenseContext {
  license: LicenseView | null;
  busy: boolean;
  buy(): Promise<void>;
  restore(): Promise<void>;
  /** False when the code is wrong. */
  unlock(code: string): Promise<boolean>;
}

const Context = createContext<LicenseContext>({ license: null, busy: false, buy: async () => undefined, restore: async () => undefined, unlock: async () => false });

export function useLicense() {
  return useContext(Context);
}

export function shopName(shop: LicenseView["shop"]): string {
  return shop === "apple" ? "the App Store" : "the Microsoft Store";
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [license, setLicense] = useState<LicenseView | null>(null);
  const [busy, setBusy] = useState(false);
  const reminded = useRef(false);

  useEffect(() => {
    if (!isApp && api.kind !== "preview") return;
    void api.licenseStatus().then(setLicense, () => setLicense(null));
  }, []);

  useEffect(() => {
    if (!license || license.state !== "trial" || license.daysLeft > REMIND_DAYS || reminded.current) return;
    reminded.current = true;
    toast(`${license.daysLeft === 1 ? "1 day" : `${license.daysLeft} days`} left to try The Bound Vigil. Buy it in Preferences › About.`);
  }, [license, toast]);

  const run = useCallback(
    async (action: () => Promise<LicenseView>, after?: (view: LicenseView) => void) => {
      setBusy(true);
      try {
        const view = await action();
        setLicense(view);
        after?.(view);
      } catch (e) {
        toast(String(e));
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const buy = useCallback(() => run(api.buyLicense, (v) => v.state === "owned" && toast("Thank you. The Bound Vigil is yours.")), [run, toast]);
  const restore = useCallback(
    () => run(api.restoreLicense, (v) => toast(v.state === "owned" ? "Your purchase was found." : `No purchase was found in ${shopName(v.shop)}.`)),
    [run, toast],
  );

  const unlock = useCallback(
    async (code: string) => {
      try {
        const view = await api.unlockLicense(code);
        if (!view) return false;
        setLicense(view);
        toast("This device is unlocked.");
        return true;
      } catch (e) {
        toast(String(e));
        return false;
      }
    },
    [toast],
  );

  return (
    <Context.Provider value={{ license, busy, buy, restore, unlock }}>
      {license?.state === "expired" ? <LicenseGate /> : children}
    </Context.Provider>
  );
}

function LicenseGate() {
  const toast = useToast();
  const { license, busy, buy, restore } = useLicense();
  if (!license) return null;
  const canBuy = license.shop !== "none";
  return (
    <div className="web-connect license-gate">
      <div className="web-connect-card">
        <span className="web-connect-emblem" aria-hidden dangerouslySetInnerHTML={{ __html: emblem }} />
        <h1>Your 30 days are up</h1>
        <p className="muted">
          Thank you for trying The Bound Vigil. Buy it once{license.price ? ` for ${license.price}` : ""} to keep reading. Your books, notes and places are all still here.
        </p>
        {canBuy ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void buy()}>
              {busy ? "Opening the store…" : `Buy The Bound Vigil${license.price ? ` · ${license.price}` : ""}`}
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void restore()}>
              I bought it already
            </button>
          </>
        ) : (
          <>
            <p className="muted">This copy didn't come from a store, so it can't be bought in. Get The Bound Vigil from the Microsoft Store.</p>
            <button type="button" className="btn btn-primary" onClick={() => void openExternal(STORE_PAGE)}>
              Open the Microsoft Store
            </button>
          </>
        )}
        <OwnerCode />
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => void api.createBackup().then((saved) => saved && toast("Backup saved."), (e: unknown) => toast(String(e)))}
        >
          Back up my library
        </button>
      </div>
    </div>
  );
}

/** A box for the owner's code, behind a link so it stays out of the way. */
export function OwnerCode() {
  const { unlock } = useLicense();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  if (!open)
    return (
      <button type="button" className="link-btn owner-code-link" onClick={() => setOpen(true)}>
        I have an owner's code
      </button>
    );
  return (
    <form
      className="owner-code"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) void unlock(code).then((ok) => setWrong(!ok));
      }}
    >
      <label className="field">
        <span>Owner's code</span>
        <input value={code} autoFocus autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" onChange={(e) => (setCode(e.target.value), setWrong(false))} />
      </label>
      {wrong && <p className="form-error">That code isn't right.</p>}
      <button type="submit" className="btn btn-quiet" disabled={!code.trim()}>
        Unlock
      </button>
    </form>
  );
}
