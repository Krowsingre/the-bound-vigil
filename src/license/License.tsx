// Paying for TBV: $2.99 a month, $19.99 a year or $59.99 for life (embre, 30 October), from
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
/** Where each store lets people cancel a subscription. */
const SUBSCRIPTIONS: Record<LicenseView["shop"], string> = {
  apple: "https://apps.apple.com/account/subscriptions",
  microsoft: "https://account.microsoft.com/services",
  none: "https://account.microsoft.com/services",
};
/** The trial's last days get a reminder when TBV opens. */
const REMIND_DAYS = 3;

interface LicenseContext {
  license: LicenseView | null;
  busy: boolean;
  /** Asks the store again, as when TBV opens: what's owned and the prices. */
  refresh(): void;
  buy(plan: LicensePlan): Promise<void>;
  restore(): Promise<void>;
  /** False when the code is wrong. */
  unlock(code: string): Promise<boolean>;
}

const Context = createContext<LicenseContext>({ license: null, busy: false, refresh: () => undefined, buy: async () => undefined, restore: async () => undefined, unlock: async () => false });

export function useLicense() {
  return useContext(Context);
}

export function shopName(shop: LicenseView["shop"]): string {
  return shop === "apple" ? "the App Store" : "the Microsoft Store";
}

const LIFETIME_PLANS: LicensePlan[] = ["lifetime", "publisherLifetime", "publisherUpgrade"];

/**
 * Whether buying `plan` leaves a subscription charging. Neither store turns
 * a subscription into a lifetime purchase, so buying for life while
 * subscribed means two purchases until the person cancels. The App Store
 * moves between its own subscriptions by itself; the Microsoft Store
 * doesn't, so there any new purchase leaves the old one running.
 */
export function leavesSubscriptionRunning(license: LicenseView | null, plan: LicensePlan): boolean {
  if (!license || !onSubscription(license)) return false;
  // Shared by family: it's the organiser's to keep or cancel, and buying doesn't charge this person twice.
  if (license.subscriptionShared) return false;
  return LIFETIME_PLANS.includes(plan) || license.shop !== "apple";
}

/** A subscription is running: a plan of its own, or Publisher monthly or yearly on top of TBV for life. */
export function onSubscription(license: LicenseView): boolean {
  if (license.state !== "owned" || license.shop === "none") return false;
  return license.plan === "monthly" || license.plan === "yearly" || (license.plan === "lifetime" && !!license.publisher && !license.publisherForLife);
}

/** The subscription someone is on, as words and what it charges. */
function currentSubscription(license: LicenseView) {
  // TBV for life with Publisher by subscription: which one isn't known here.
  if (license.plan === "lifetime") return { name: "TBV Publisher subscription", charge: "each time it renews" };
  const monthly = license.plan === "monthly";
  const price = license.publisher ? (monthly ? license.publisherMonthlyPrice : license.publisherYearlyPrice) : monthly ? license.monthlyPrice : license.yearlyPrice;
  return { name: `${license.publisher ? "TBV Publisher " : ""}${monthly ? "monthly" : "yearly"} plan`, charge: price ? `${price} every ${monthly ? "month" : "year"}` : `every ${monthly ? "month" : "year"}` };
}

const PLAN_NAMES: Record<LicensePlan, string> = {
  monthly: "the monthly plan",
  yearly: "the yearly plan",
  lifetime: "The Bound Vigil for life",
  publisherMonthly: "TBV Publisher monthly",
  publisherYearly: "TBV Publisher yearly",
  publisherLifetime: "TBV Publisher for life",
  publisherUpgrade: "the Publisher upgrade",
};

const whereToCancel = (shop: LicenseView["shop"]) =>
  shop === "apple" ? "Settings › your name › Subscriptions on your iPhone (or the App Store on a Mac)" : "your Microsoft account, under Services & subscriptions";

/** Before paying: says outright that the subscription keeps charging, and asks them to agree before the store's payment sheet opens. */
function KeepsChargingWarning({ license, plan, onGo, onCancel }: { license: LicenseView; plan: LicensePlan; onGo: () => void; onCancel: () => void }) {
  const [understood, setUnderstood] = useState(false);
  const sub = currentSubscription(license);
  const store = license.shop === "apple" ? "Apple" : "Microsoft";
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog subscription-warning" role="alertdialog" aria-label="Your subscription keeps charging" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <h2>Your subscription will keep charging you</h2>
        <p>
          You're on the <b>{sub.name}</b>. Buying {PLAN_NAMES[plan]} <b>does not cancel it</b>. {store} will keep charging you <b>{sub.charge}</b> until you cancel it yourself.
        </p>
        <ul className="subscription-warning-list">
          <li>Neither The Bound Vigil nor {shopName(license.shop)} cancels it for you.</li>
          <li>What you've already paid for the subscription isn't refunded or taken off this price.</li>
          <li>To stop it, cancel it in {whereToCancel(license.shop)}. You can do that now, before buying, and keep using TBV until the time you've paid for runs out.</li>
        </ul>
        <label className="check-row">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>I understand my current subscription keeps charging me until I cancel it myself.</span>
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => void openExternal(SUBSCRIPTIONS[license.shop])}>
            Open my subscriptions
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Don't buy
          </button>
          <button type="button" className="btn btn-primary" disabled={!understood} onClick={onGo}>
            {understood ? "Continue to payment" : "Tick the box to continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** After paying: the subscription is still running, so cancelling it comes next. */
function CancelReminder({ license, before, onClose }: { license: LicenseView; before: LicenseView; onClose: () => void }) {
  const sub = currentSubscription(before);
  const store = license.shop === "apple" ? "Apple" : "Microsoft";
  return (
    <div className="dialog-backdrop">
      <div className="dialog subscription-warning" role="alertdialog" aria-label="Now cancel your subscription" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>Now cancel your subscription</h2>
        <p>
          Thank you, {license.plan === "lifetime" ? "it's yours for life" : "it's bought"}. Your <b>{sub.name}</b> is <b>still active</b>, and {store} will charge you <b>{sub.charge}</b> again unless you cancel it.
        </p>
        <p>Cancel it in {whereToCancel(license.shop)}. Nothing you've bought is lost when you do.</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            I'll do it later
          </button>
          <button type="button" className="btn btn-primary" onClick={() => (void openExternal(SUBSCRIPTIONS[license.shop]), onClose())}>
            Cancel my subscription now
          </button>
        </div>
      </div>
    </div>
  );
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [license, setLicense] = useState<LicenseView | null>(null);
  const [busy, setBusy] = useState(false);
  const reminded = useRef(false);
  /** A purchase waiting on the warning, and how to finish it. */
  const [asking, setAsking] = useState<{ plan: LicensePlan; done: () => void } | null>(null);
  /** After a purchase that left a subscription running: the state from before it. */
  const [stillBilled, setStillBilled] = useState<LicenseView | null>(null);

  const refresh = useCallback(() => {
    if (!isApp && api.kind !== "preview") return;
    void api.licenseStatus().then(setLicense, () => setLicense(null));
  }, []);

  // Asked when TBV opens and each time it comes back to the front, so a
  // renewal, a refund, an approved Ask to Buy or a family change shows.
  useEffect(() => {
    refresh();
    const back = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [refresh]);

  useEffect(() => {
    if (!license || license.state !== "trial" || license.daysLeft > REMIND_DAYS || reminded.current) return;
    reminded.current = true;
    toast(`${license.daysLeft === 1 ? "1 day" : `${license.daysLeft} days`} left to try The Bound Vigil. Choose a plan in Preferences › Your plan.`);
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

  const purchase = useCallback(
    (plan: LicensePlan, before: LicenseView | null, warned: boolean) =>
      run(
        () => api.buyLicense(plan),
        (v) => {
          // Closing the store's sheet changes nothing, and says nothing.
          const changed = v.state !== before?.state || v.plan !== before?.plan || !!v.publisher !== !!before?.publisher || !!v.publisherForLife !== !!before?.publisherForLife;
          if (v.state !== "owned" || !changed) return;
          // Bought: the old subscription is still there to cancel.
          if (warned && before) setStillBilled(before);
          else toast("Thank you. The Bound Vigil is yours.");
        },
      ),
    [run, toast],
  );
  const buy = useCallback(
    (plan: LicensePlan) => {
      if (!leavesSubscriptionRunning(license, plan)) return purchase(plan, license, false);
      // Asked first, before the store's payment sheet; settled once they choose.
      return new Promise<void>((done) => setAsking({ plan, done }));
    },
    [license, purchase],
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
    <Context.Provider value={{ license, busy, refresh, buy, restore, unlock }}>
      {license?.state === "expired" ? <LicenseGate /> : children}
      {asking && license && (
        <KeepsChargingWarning
          license={license}
          plan={asking.plan}
          onCancel={() => (asking.done(), setAsking(null))}
          onGo={() => {
            setAsking(null);
            void purchase(asking.plan, license, true).then(asking.done);
          }}
        />
      )}
      {stillBilled && license && <CancelReminder license={license} before={stillBilled} onClose={() => setStillBilled(null)} />}
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
  const { license, unlock } = useLicense();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  // Apple allows unlocking only through In-App Purchase (App Review 3.1.1).
  // A device already unlocked by code stays unlocked.
  if (license?.shop === "apple") return null;
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

/** The yearly plan, the monthly one and the lifetime unlock, side by side. */
export function PlanButtons() {
  const { license, busy, buy } = useLicense();
  if (!license) return null;
  const yearly = license.yearlyPrice ? `${license.yearlyPrice} a year` : "Yearly";
  return (
    <div className="license-plans">
      <button type="button" className="btn btn-primary license-plan" disabled={busy} onClick={() => void buy("yearly")}>
        <b>{license.freeMonth ? "Start your free month" : yearly}</b>
        <span>{license.freeMonth ? `Then ${license.yearlyPrice ? `${license.yearlyPrice} a year` : "renews each year"}. Cancel any time.` : "Renews each year. Cancel any time."}</span>
      </button>
      <button type="button" className="btn btn-quiet license-plan" disabled={busy} onClick={() => void buy("monthly")}>
        <b>{license.monthlyPrice ? `${license.monthlyPrice} a month` : "Monthly"}</b>
        <span>Renews each month. Cancel any time.</span>
      </button>
      <button type="button" className="btn btn-quiet license-plan" disabled={busy} onClick={() => void buy("lifetime")}>
        <b>{license.price ? `${license.price} for life` : "For life"}</b>
        <span>Pay once, keep it for good.</span>
      </button>
      <PurchaseLinks />
    </div>
  );
}

/** Apple asks a subscription's screen to link its terms and the privacy policy. Prices that didn't load can be asked for again. */
export function PurchaseLinks() {
  const { license, busy, refresh } = useLicense();
  if (!license) return null;
  const missing = license.shop !== "none" && !license.price && !license.yearlyPrice;
  return (
    <p className="license-terms muted">
      {missing && (
        <>
          <button type="button" className="link-btn" disabled={busy} onClick={refresh}>
            Prices didn't load. Try again
          </button>
          {" · "}
        </>
      )}
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
  );
}

/** Where the store lets them change or cancel a subscription. */
export function ManageSubscription() {
  const { license } = useLicense();
  if (!license || !onSubscription(license)) return null;
  return (
    <button type="button" className="btn btn-quiet" onClick={() => void openExternal(SUBSCRIPTIONS[license.shop])}>
      Manage subscription
    </button>
  );
}
