// Paying for TBV: $19.99 a year or $59.99 for life (embre, 30 October), from
// the Microsoft Store after 30 days to try it in full, or from the App Store,
// where the yearly plan's first month is free (Apple's own trial). While the trial runs everything works;
// once it's over, this screen stands in front of the library until TBV is
// bought, with a way to take a backup so nothing is ever held hostage.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, isApp, openExternal } from "../api";
import type { LicensePlan, LicenseView } from "../api/types";
import emblem from "../assets/emblem.svg?raw";
import { useToast } from "../components/Toast";
import { startupStep } from "../splash/startup";

/** Apple's standard licence for apps, which TBV uses as its terms. */
const APPLE_TERMS = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_POLICY = "https://krowsingre.github.io/the-bound-vigil/privacy/";
const STORE_PAGE = "https://apps.microsoft.com/search?query=The%20Bound%20Vigil";
/** The trial's last days get a reminder when TBV opens. */
const REMIND_DAYS = 3;

interface LicenseContext {
  license: LicenseView | null;
  busy: boolean;
  buy(plan: LicensePlan): Promise<void>;
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

  const buy = useCallback(
    (plan: LicensePlan) => run(() => api.buyLicense(plan), (v) => v.state === "owned" && toast("Thank you. The Bound Vigil is yours.")),
    [run, toast],
  );
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
  const { license, busy, restore } = useLicense();
  // This is the first screen instead of Sanctum.
  useEffect(() => {
    startupStep("library");
    startupStep("sanctum");
  }, []);
  if (!license) return null;
  const canBuy = license.shop !== "none";
  return (
    <div className="web-connect license-gate">
      <div className="web-connect-card">
        <span className="web-connect-emblem" aria-hidden dangerouslySetInnerHTML={{ __html: emblem }} />
        {license.trialDays > 0 ? (
          <>
            <h1>Your {license.trialDays} days are up</h1>
            <p className="muted">
              Thank you for trying The Bound Vigil. Choose a plan to keep reading. Your books, notes and places are all still here.
            </p>
          </>
        ) : (
          <>
            <h1>Welcome to The Bound Vigil</h1>
            <p className="muted">
              {license.freeMonth ? "Try it free for a month on the yearly plan, or buy it for life." : "Choose a plan to start reading."} Your books stay on your own devices and in your own cloud.
            </p>
          </>
        )}
        {canBuy ? (
          <>
            <PlanButtons />
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

/** The yearly plan and the lifetime unlock, side by side. */
export function PlanButtons() {
  const { license, busy, buy } = useLicense();
  if (!license) return null;
  const yearly = license.yearlyPrice ? `${license.yearlyPrice} a year` : "Yearly";
  return (
    <div className="license-plans">
      <button type="button" className="btn btn-primary license-plan" disabled={busy} onClick={() => void buy("yearly")}>
        <b>{license.freeMonth ? "Start your free month" : yearly}</b>
        <span>{license.freeMonth ? `Then ${yearly}. Cancel any time.` : "Renews each year. Cancel any time."}</span>
      </button>
      <button type="button" className="btn btn-quiet license-plan" disabled={busy} onClick={() => void buy("lifetime")}>
        <b>{license.price ? `${license.price} for life` : "For life"}</b>
        <span>Pay once, keep it for good.</span>
      </button>
      {/* Apple asks a subscription's screen to link its terms and the privacy policy. */}
      <p className="license-terms muted">
        {license.shop === "apple" && (
          <>
            <button type="button" className="link-btn" onClick={() => void openExternal(APPLE_TERMS)}>
              Terms of use
            </button>
            {" · "}
          </>
        )}
        <button type="button" className="link-btn" onClick={() => void openExternal(PRIVACY_POLICY)}>
          Privacy policy
        </button>
      </p>
    </div>
  );
}
