import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Paying for TBV: $2.99 a month, $19.99 a year or $59.99 for life (embre, 30 October), from
// the Microsoft Store after 30 days to try it in full, or from the App Store,
// where the yearly plan's first month is free (Apple's own trial). While the trial runs everything works;
// once it's over, this screen stands in front of the library until TBV is
// bought, with a way to take a backup so nothing is ever held hostage.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, isApp, openExternal } from "../api";
import emblem from "../assets/emblem.svg?raw";
import { useToast } from "../components/Toast";
import { startupStep } from "../splash/startup";
/** TBV's own Terms of Use and License Agreement, in place of each store's standard one. */
export const TERMS = "https://krowsingre.github.io/the-bound-vigil/terms/";
export const PRIVACY_POLICY = "https://krowsingre.github.io/the-bound-vigil/privacy/";
const STORE_PAGE = "https://apps.microsoft.com/search?query=The%20Bound%20Vigil";
/** Where each store lets people cancel a subscription. */
const SUBSCRIPTIONS = {
    apple: "https://apps.apple.com/account/subscriptions",
    microsoft: "https://account.microsoft.com/services",
    none: "https://account.microsoft.com/services",
    android: "",
};
/** The trial's last days get a reminder when TBV opens. */
const REMIND_DAYS = 3;
const Context = createContext({ license: null, busy: false, refresh: () => undefined, buy: async () => undefined, restore: async () => undefined, unlock: async () => false, activate: async () => false });
export function useLicense() {
    return useContext(Context);
}
/** Whether plans can be bought in this copy (a store copy; not a test build or Android's test version). */
export function canBuyIn(license) {
    return license.shop === "microsoft" || license.shop === "apple";
}
export function shopName(shop) {
    return shop === "apple" ? "the App Store" : "the Microsoft Store";
}
const LIFETIME_PLANS = ["lifetime", "publisherLifetime", "publisherUpgrade"];
/**
 * Whether buying `plan` leaves a subscription charging. Neither store turns
 * a subscription into a lifetime purchase, so buying for life while
 * subscribed means two purchases until the person cancels. The App Store
 * moves between its own subscriptions by itself; the Microsoft Store
 * doesn't, so there any new purchase leaves the old one running.
 */
export function leavesSubscriptionRunning(license, plan) {
    if (!license || !onSubscription(license))
        return false;
    // Shared by family: it's the organiser's to keep or cancel, and buying doesn't charge this person twice.
    if (license.subscriptionShared)
        return false;
    return LIFETIME_PLANS.includes(plan) || license.shop !== "apple";
}
/** A subscription is running: a plan of its own, or Publisher monthly or yearly on top of TBV for life. */
export function onSubscription(license) {
    if (license.state !== "owned" || !canBuyIn(license))
        return false;
    return license.plan === "monthly" || license.plan === "yearly" || (license.plan === "lifetime" && !!license.publisher && !license.publisherForLife);
}
/** The subscription someone is on, as words and what it charges. */
function currentSubscription(license) {
    // TBV for life with Publisher by subscription: which one isn't known here.
    if (license.plan === "lifetime")
        return { name: "TBV Publisher subscription", charge: "each time it renews" };
    const monthly = license.plan === "monthly";
    const price = license.publisher ? (monthly ? license.publisherMonthlyPrice : license.publisherYearlyPrice) : monthly ? license.monthlyPrice : license.yearlyPrice;
    return { name: `${license.publisher ? "TBV Publisher " : ""}${monthly ? "monthly" : "yearly"} plan`, charge: price ? `${price} every ${monthly ? "month" : "year"}` : `every ${monthly ? "month" : "year"}` };
}
const PLAN_NAMES = {
    monthly: "the monthly plan",
    yearly: "the yearly plan",
    lifetime: "The Bound Vigil for life",
    publisherMonthly: "TBV Publisher monthly",
    publisherYearly: "TBV Publisher yearly",
    publisherLifetime: "TBV Publisher for life",
    publisherUpgrade: "the Publisher upgrade",
};
const whereToCancel = (shop) => shop === "apple" ? "Settings › your name › Subscriptions on your iPhone (or the App Store on a Mac)" : "your Microsoft account, under Services & subscriptions";
/** Before paying: says outright that the subscription keeps charging, and asks them to agree before the store's payment sheet opens. */
function KeepsChargingWarning({ license, plan, onGo, onCancel }) {
    const [understood, setUnderstood] = useState(false);
    const sub = currentSubscription(license);
    const store = license.shop === "apple" ? "Apple" : "Microsoft";
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onCancel(), children: _jsxs("div", { className: "dialog subscription-warning", role: "alertdialog", "aria-label": "Your subscription keeps charging", onKeyDown: (e) => e.key === "Escape" && onCancel(), children: [_jsx("h2", { children: "Your subscription will keep charging you" }), _jsxs("p", { children: ["You're on the ", _jsx("b", { children: sub.name }), ". Buying ", PLAN_NAMES[plan], " ", _jsx("b", { children: "does not cancel it" }), ". ", store, " will keep charging you ", _jsx("b", { children: sub.charge }), " until you cancel it yourself."] }), _jsxs("ul", { className: "subscription-warning-list", children: [_jsxs("li", { children: ["Neither The Bound Vigil nor ", shopName(license.shop), " cancels it for you."] }), _jsx("li", { children: "What you've already paid for the subscription isn't refunded or taken off this price." }), _jsxs("li", { children: ["To stop it, cancel it in ", whereToCancel(license.shop), ". You can do that now, before buying, and keep using TBV until the time you've paid for runs out."] })] }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: understood, onChange: (e) => setUnderstood(e.target.checked) }), _jsx("span", { children: "I understand my current subscription keeps charging me until I cancel it myself." })] }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void openExternal(SUBSCRIPTIONS[license.shop]), children: "Open my subscriptions" }), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, children: "Don't buy" }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: !understood, onClick: onGo, children: understood ? "Continue to payment" : "Tick the box to continue" })] })] }) }));
}
/** After paying: the subscription is still running, so cancelling it comes next. */
function CancelReminder({ license, before, onClose }) {
    const sub = currentSubscription(before);
    const store = license.shop === "apple" ? "Apple" : "Microsoft";
    return (_jsx("div", { className: "dialog-backdrop", children: _jsxs("div", { className: "dialog subscription-warning", role: "alertdialog", "aria-label": "Now cancel your subscription", onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsx("h2", { children: "Now cancel your subscription" }), _jsxs("p", { children: ["Thank you, ", license.plan === "lifetime" ? "it's yours for life" : "it's bought", ". Your ", _jsx("b", { children: sub.name }), " is ", _jsx("b", { children: "still active" }), ", and ", store, " will charge you ", _jsx("b", { children: sub.charge }), " again unless you cancel it."] }), _jsxs("p", { children: ["Cancel it in ", whereToCancel(license.shop), ". Nothing you've bought is lost when you do."] }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, children: "I'll do it later" }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => (void openExternal(SUBSCRIPTIONS[license.shop]), onClose()), children: "Cancel my subscription now" })] })] }) }));
}
export function LicenseProvider({ children }) {
    const toast = useToast();
    const [license, setLicense] = useState(null);
    const [busy, setBusy] = useState(false);
    const reminded = useRef(false);
    /** A purchase waiting on the warning, and how to finish it. */
    const [asking, setAsking] = useState(null);
    /** After a purchase that left a subscription running: the state from before it. */
    const [stillBilled, setStillBilled] = useState(null);
    const refresh = useCallback(() => {
        if (!isApp && api.kind !== "preview")
            return;
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
        if (!license || license.state !== "trial" || license.daysLeft > REMIND_DAYS || reminded.current)
            return;
        reminded.current = true;
        toast(`${license.daysLeft === 1 ? "1 day" : `${license.daysLeft} days`} left to try The Bound Vigil. Choose a plan in Preferences › Your plan.`);
    }, [license, toast]);
    const run = useCallback(async (action, after) => {
        setBusy(true);
        try {
            const view = await action();
            setLicense(view);
            after?.(view);
        }
        catch (e) {
            toast(String(e));
        }
        finally {
            setBusy(false);
        }
    }, [toast]);
    const purchase = useCallback((plan, before, warned) => run(() => api.buyLicense(plan), (v) => {
        // Closing the store's sheet changes nothing, and says nothing.
        const changed = v.state !== before?.state || v.plan !== before?.plan || !!v.publisher !== !!before?.publisher || !!v.publisherForLife !== !!before?.publisherForLife;
        if (v.state !== "owned" || !changed)
            return;
        // Bought: the old subscription is still there to cancel.
        if (warned && before)
            setStillBilled(before);
        else
            toast("Thank you. The Bound Vigil is yours.");
    }), [run, toast]);
    const buy = useCallback((plan) => {
        if (!leavesSubscriptionRunning(license, plan))
            return purchase(plan, license, false);
        // Asked first, before the store's payment sheet; settled once they choose.
        return new Promise((done) => setAsking({ plan, done }));
    }, [license, purchase]);
    const restore = useCallback(() => run(api.restoreLicense, (v) => toast(v.state === "owned" ? "Your purchase was found." : `No purchase was found in ${shopName(v.shop)}.`)), [run, toast]);
    const unlock = useCallback(async (code) => {
        try {
            const view = await api.unlockLicense(code);
            if (!view)
                return false;
            setLicense(view);
            toast("This device is unlocked.");
            return true;
        }
        catch (e) {
            toast(String(e));
            return false;
        }
    }, [toast]);
    const activate = useCallback(async (key) => {
        try {
            const view = await api.activateLicense(key);
            if (!view)
                return false;
            setLicense(view);
            toast("This phone is activated.");
            return true;
        }
        catch (e) {
            toast(String(e));
            return false;
        }
    }, [toast]);
    return (_jsxs(Context.Provider, { value: { license, busy, refresh, buy, restore, unlock, activate }, children: [license?.state === "expired" ? _jsx(LicenseGate, {}) : children, asking && license && (_jsx(KeepsChargingWarning, { license: license, plan: asking.plan, onCancel: () => (asking.done(), setAsking(null)), onGo: () => {
                    setAsking(null);
                    void purchase(asking.plan, license, true).then(asking.done);
                } })), stillBilled && license && _jsx(CancelReminder, { license: license, before: stillBilled, onClose: () => setStillBilled(null) })] }));
}
function LicenseGate() {
    const toast = useToast();
    const { license, busy, restore } = useLicense();
    // This is the first screen instead of Sanctum.
    useEffect(() => {
        startupStep("library");
        startupStep("sanctum");
    }, []);
    if (!license)
        return null;
    if (license.shop === "android")
        return _jsx(ActivateGate, { license: license });
    const canBuy = canBuyIn(license);
    return (_jsx("div", { className: "web-connect license-gate", children: _jsxs("div", { className: "web-connect-card", children: [_jsx("span", { className: "web-connect-emblem", "aria-hidden": true, dangerouslySetInnerHTML: { __html: emblem } }), license.trialDays > 0 ? (_jsxs(_Fragment, { children: [_jsxs("h1", { children: ["Your ", license.trialDays, " days are up"] }), _jsx("p", { className: "muted", children: "Thank you for trying The Bound Vigil. Choose a plan to keep reading. Your books, notes and places are all still here." })] })) : (_jsxs(_Fragment, { children: [_jsx("h1", { children: "Welcome to The Bound Vigil" }), _jsxs("p", { className: "muted", children: [license.freeMonth ? "Try it free for a month on the yearly plan, or buy it for life." : "Choose a plan to start reading.", " Your books stay on your own devices and in your own cloud."] })] })), canBuy ? (_jsxs(_Fragment, { children: [_jsx(PlanButtons, {}), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => void restore(), children: "I bought it already" })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "muted", children: "This copy didn't come from a store, so it can't be bought in. Get The Bound Vigil from the Microsoft Store." }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => void openExternal(STORE_PAGE), children: "Open the Microsoft Store" })] })), _jsx(OwnerCode, {}), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.createBackup().then((saved) => saved && toast("Backup saved."), (e) => toast(String(e))), children: "Back up my library" })] }) }));
}
/** Android's test version opens one phone at a time: it shows this phone's
 * code, and takes the key made for it by the "Activate an Android phone"
 * workflow in TBV's GitHub. */
function ActivateGate({ license }) {
    const toast = useToast();
    const { activate } = useLicense();
    const [key, setKey] = useState("");
    const [wrong, setWrong] = useState(false);
    const [busy, setBusy] = useState(false);
    const code = license.deviceCode ?? "";
    return (_jsx("div", { className: "web-connect license-gate", children: _jsxs("div", { className: "web-connect-card", children: [_jsx("span", { className: "web-connect-emblem", "aria-hidden": true, dangerouslySetInnerHTML: { __html: emblem } }), _jsx("h1", { children: "Activate this phone" }), _jsx("p", { className: "muted", children: "This is the Android test version of The Bound Vigil. Each phone needs its own key, made for the code below." }), _jsxs("div", { className: "activate-code", children: [_jsx("span", { className: "muted", children: "This phone's code" }), _jsx("strong", { children: code || "…" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: !code, onClick: () => void navigator.clipboard?.writeText(code).then(() => toast("Code copied."), () => toast(code)), children: "Copy" })] }), _jsxs("form", { className: "owner-code", onSubmit: (e) => {
                        e.preventDefault();
                        if (!key.trim())
                            return;
                        setBusy(true);
                        void activate(key).then((ok) => (setWrong(!ok), setBusy(false)));
                    }, children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Activation key" }), _jsx("textarea", { value: key, rows: 3, autoComplete: "off", spellCheck: false, placeholder: "Paste the key here", onChange: (e) => (setKey(e.target.value), setWrong(false)) })] }), wrong && _jsx("p", { className: "form-error", children: "That key is for another phone, or it isn't whole. Check the code and paste the key again." }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: !key.trim() || busy, children: busy ? "Activating…" : "Activate" })] })] }) }));
}
/** A box for the owner's code, behind a link so it stays out of the way. */
export function OwnerCode() {
    const { license, unlock } = useLicense();
    const [open, setOpen] = useState(false);
    const [code, setCode] = useState("");
    const [wrong, setWrong] = useState(false);
    // Apple allows unlocking only through In-App Purchase (App Review 3.1.1).
    // A device already unlocked by code stays unlocked.
    if (license?.shop === "apple" || license?.shop === "android")
        return null;
    if (!open)
        return (_jsx("button", { type: "button", className: "link-btn owner-code-link", onClick: () => setOpen(true), children: "I have an owner's code" }));
    return (_jsxs("form", { className: "owner-code", onSubmit: (e) => {
            e.preventDefault();
            if (code.trim())
                void unlock(code).then((ok) => setWrong(!ok));
        }, children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Owner's code" }), _jsx("input", { value: code, autoFocus: true, autoComplete: "off", spellCheck: false, placeholder: "XXXXX-XXXXX-XXXXX-XXXXX", onChange: (e) => (setCode(e.target.value), setWrong(false)) })] }), wrong && _jsx("p", { className: "form-error", children: "That code isn't right." }), _jsx("button", { type: "submit", className: "btn btn-quiet", disabled: !code.trim(), children: "Unlock" })] }));
}
/** The yearly plan, the monthly one and the lifetime unlock, side by side. */
export function PlanButtons() {
    const { license, busy, buy } = useLicense();
    if (!license)
        return null;
    const yearly = license.yearlyPrice ? `${license.yearlyPrice} a year` : "Yearly";
    return (_jsxs("div", { className: "license-plans", children: [_jsxs("button", { type: "button", className: "btn btn-primary license-plan", disabled: busy, onClick: () => void buy("yearly"), children: [_jsx("b", { children: license.freeMonth ? "Start your free month" : yearly }), _jsx("span", { children: license.freeMonth ? `Then ${license.yearlyPrice ? `${license.yearlyPrice} a year` : "renews each year"}. Cancel any time.` : "Renews each year. Cancel any time." })] }), _jsxs("button", { type: "button", className: "btn btn-quiet license-plan", disabled: busy, onClick: () => void buy("monthly"), children: [_jsx("b", { children: license.monthlyPrice ? `${license.monthlyPrice} a month` : "Monthly" }), _jsx("span", { children: "Renews each month. Cancel any time." })] }), _jsxs("button", { type: "button", className: "btn btn-quiet license-plan", disabled: busy, onClick: () => void buy("lifetime"), children: [_jsx("b", { children: license.price ? `${license.price} for life` : "For life" }), _jsx("span", { children: "Pay once, keep it for good." })] }), _jsx(PurchaseLinks, {})] }));
}
/** Apple asks a subscription's screen to link its terms and the privacy policy. Prices that didn't load can be asked for again. */
export function PurchaseLinks() {
    const { license, busy, refresh } = useLicense();
    if (!license)
        return null;
    const missing = canBuyIn(license) && !license.price && !license.yearlyPrice;
    return (_jsxs("p", { className: "license-terms muted", children: [missing && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "link-btn", disabled: busy, onClick: refresh, children: "Prices didn't load. Try again" }), " · "] })), _jsx("button", { type: "button", className: "link-btn", onClick: () => void openExternal(TERMS), children: "Terms of use" }), " · ", _jsx("button", { type: "button", className: "link-btn", onClick: () => void openExternal(PRIVACY_POLICY), children: "Privacy policy" })] }));
}
/** Where the store lets them change or cancel a subscription. */
export function ManageSubscription() {
    const { license } = useLicense();
    if (!license || !onSubscription(license))
        return null;
    return (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void openExternal(SUBSCRIPTIONS[license.shop]), children: "Manage subscription" }));
}
const PERIOD = { monthly: ["Monthly", "month"], yearly: ["Annual", "year"] };
function manageWords(shop) {
    return shop === "apple" ? "manage it in your Apple ID's Subscriptions" : "manage it in the Microsoft Store's Subscriptions";
}
/** Exactly which TBV Standard plan someone owns, for Your plan. */
export function standardWords(license) {
    const shop = shopName(license.shop);
    if (license.shop === "android")
        return "This phone is activated for testing. Everything is open, Publisher too.";
    if (license.publisherForLife && license.plan === "lifetime")
        return `Included with TBV Publisher Lifetime, yours for good. Thank you.`;
    if (license.plan === "lifetime")
        return `TBV Standard Lifetime, bought in ${shop}. It's yours for good. Thank you.`;
    if (license.plan === "monthly" || license.plan === "yearly") {
        const [name, unit] = PERIOD[license.plan];
        if (license.publisher)
            return `Included with your TBV Publisher ${name} subscription.`;
        const price = license.plan === "monthly" ? license.monthlyPrice : license.yearlyPrice;
        return `TBV Standard ${name}${price ? `, ${price} a ${unit}` : ""}, from ${shop}. Thank you. It renews each ${unit} until you cancel; ${manageWords(license.shop)}.`;
    }
    return "Unlocked on this device.";
}
/** Exactly which TBV Publisher plan someone owns, for Your plan. */
export function publisherWords(license) {
    if (license.shop === "android")
        return "Open on this activated phone.";
    if (license.publisherForLife)
        return "TBV Publisher Lifetime. It's yours for good. Thank you.";
    if (license.publisherPlan) {
        const [name, unit] = PERIOD[license.publisherPlan];
        const price = license.publisherPlan === "monthly" ? license.publisherMonthlyPrice : license.publisherYearlyPrice;
        return `TBV Publisher ${name}${price ? `, ${price} a ${unit}` : ""}. Thank you. It renews each ${unit} until you cancel; ${manageWords(license.shop)}.`;
    }
    return "TBV Publisher comes with your subscription. Thank you.";
}
