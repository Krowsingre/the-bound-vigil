import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TBV Publisher: the publishing tools (print PDF, book styles, the paperback
// cover maker, the pre-upload check, store editions, box sets, captions and
// full-page pictures, side-by-side previews) on top of TBV, $9.99 a month,
// $39.99 a year or $119.99 for life, or the difference for someone who owns
// TBV for life.
// Everything works while the trial runs; after that, using one of these
// tools without Publisher offers it instead.
import { createContext, useCallback, useContext, useState } from "react";
import { api } from "../api";
import { canBuyIn, OwnerCode, PurchaseLinks, shopName, useLicense } from "./License";
const Context = createContext({ allowed: true, check: (_, then) => then() });
export function usePublisher() {
    return useContext(Context);
}
/** In the preview, a way to see TBV as someone who owns it without Publisher: "1" for life, "yearly" on the yearly plan. */
function previewLicense() {
    if (api.kind !== "preview")
        return null;
    let owned = null;
    try {
        owned = localStorage.getItem("tbv.preview.notPublisher");
    }
    catch {
        return null;
    }
    if (owned !== "1" && owned !== "yearly")
        return null;
    return { state: "owned", daysLeft: 0, trialEnds: 0, trialDays: 30, shop: "microsoft", price: "$59.99", yearlyPrice: "$19.99", monthlyPrice: "$2.99", plan: owned === "yearly" ? "yearly" : "lifetime", publisher: false, publisherForLife: false, publisherPrice: "$119.99", publisherYearlyPrice: "$39.99", publisherMonthlyPrice: "$9.99", upgradePrice: "$60.00" };
}
/** Publisher is there when it's owned, while trying TBV, and wherever there's nothing to buy it from (the web version, a copy from outside a store unlocked by code). */
export function hasPublisher(license) {
    if (!license)
        return true;
    return license.state === "trial" || !!license.publisher;
}
export function PublisherProvider({ children }) {
    const { license: real } = useLicense();
    const license = previewLicense() ?? real;
    const allowed = hasPublisher(license);
    const [asking, setAsking] = useState(null);
    const check = useCallback((tool, then) => (allowed ? then() : setAsking(tool)), [allowed]);
    return (_jsxs(Context.Provider, { value: { allowed, check }, children: [children, asking && license && _jsx(PublisherOffer, { tool: asking, license: license, onClose: () => setAsking(null) })] }));
}
const TOOLS = [
    "Print-ready PDF for KDP and IngramSpark",
    "12 book styles for the ebook and the paperback",
    "Paperback cover maker, spine worked out for you",
    "Check before uploading, store by store",
    "Store editions with the right buy links",
    "Box sets",
    "Captions and full-page pictures",
    "Side-by-side previews on each device",
    "Canva for covers, pictures and page design",
];
/** Publisher's plans for this person: the upgrade for those who bought TBV for life, otherwise monthly, yearly and for life. */
export function PublisherPlans({ license, onDone }) {
    const { busy, buy, restore } = useLicense();
    // TBV for life without Publisher means the TBV for life purchase itself;
    // only someone who bought it (not family) gets the upgrade's price.
    const forLife = license.state === "owned" && license.plan === "lifetime" && !license.publisher;
    const upgrade = forLife && !license.lifetimeShared;
    const yearly = license.publisherYearlyPrice ? `${license.publisherYearlyPrice} a year` : "Yearly";
    const monthly = license.publisherMonthlyPrice ? `${license.publisherMonthlyPrice} a month` : "Monthly";
    const life = license.publisherPrice ? `${license.publisherPrice} for life` : "For life";
    const done = () => onDone?.();
    return (_jsxs("div", { className: "license-plans", children: [upgrade && (_jsxs("button", { type: "button", className: "btn btn-primary license-plan", disabled: busy, onClick: () => void buy("publisherUpgrade").then(done), children: [_jsx("b", { children: license.upgradePrice ? `Upgrade for ${license.upgradePrice}` : "Upgrade for the difference" }), _jsx("span", { children: "One payment. You own TBV for life, so you pay only the difference, and Publisher is yours for good." })] })), _jsxs("button", { type: "button", className: `btn ${upgrade ? "btn-quiet" : "btn-primary"} license-plan`, disabled: busy, onClick: () => void buy("publisherYearly").then(done), children: [_jsx("b", { children: yearly }), _jsxs("span", { children: [forLife ? "Publisher while it runs; TBV stays yours for life." : "All of TBV and Publisher.", " Renews each year until you cancel."] })] }), _jsxs("button", { type: "button", className: "btn btn-quiet license-plan", disabled: busy, onClick: () => void buy("publisherMonthly").then(done), children: [_jsx("b", { children: monthly }), _jsxs("span", { children: [forLife ? "Publisher while it runs; TBV stays yours for life." : "All of TBV and Publisher.", " Renews each month until you cancel."] })] }), !upgrade && (_jsxs("button", { type: "button", className: "btn btn-quiet license-plan", disabled: busy, onClick: () => void buy("publisherLifetime").then(done), children: [_jsx("b", { children: life }), _jsx("span", { children: "One payment, keep it for good. What you've paid for a subscription isn't taken off." })] })), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => void restore(), children: "I bought it already" }), _jsx(PurchaseLinks, {})] }));
}
/** What Publisher adds, as a list. */
export function PublisherTools() {
    return (_jsx("ul", { className: "publisher-offer-list", children: TOOLS.map((t) => (_jsx("li", { children: t }, t))) }));
}
function PublisherOffer({ tool, license, onClose }) {
    const { busy } = useLicense();
    const canBuy = canBuyIn(license);
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onClose(), children: _jsxs("div", { className: "dialog publisher-offer", role: "dialog", "aria-label": "TBV Publisher", onKeyDown: (e) => e.key === "Escape" && !busy && onClose(), children: [_jsx("p", { className: "publisher-offer-kicker", children: tool }), _jsx("h2", { children: "Part of TBV Publisher" }), _jsx("p", { className: "muted dialog-lede", children: "Everything you need to publish, on top of all of TBV. Your writing and exports to EPUB, Word and text stay free to use either way." }), _jsx(PublisherTools, {}), canBuy ? (_jsx(PublisherPlans, { license: license, onDone: onClose })) : (_jsxs("p", { className: "muted", children: ["This copy didn't come from a store, so Publisher can't be bought in it. Get The Bound Vigil from ", shopName("microsoft"), "."] })), _jsx(OwnerCode, {}), _jsx("div", { className: "dialog-actions", children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, disabled: busy, children: "Not now" }) })] }) }));
}
