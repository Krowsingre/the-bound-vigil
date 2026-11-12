import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The ⓘ beside every Author field in Scribe: pen names, and what publishers
// ask for (embre's spec, 31 October 2026, section 8). Only information:
// nothing has to be read or agreed to. Recheck the publishers now and then.
import { openExternal } from "../api";
import { InfoTip } from "../components/InfoTip";
/** Checked 31 October 2026. */
const PUBLISHERS = [
    { name: "Amazon KDP", url: "https://kdp.amazon.com/en_US/help/topic/G2BWJN2BY98T5PV2", note: "Pen names allowed. Your legal identity is needed separately for tax and payments, and a published book's author name is hard to change." },
    { name: "IngramSpark", url: "https://www.ingramspark.com/blog/how-to-set-up-a-title-with-ingramspark-part-1", note: "Pen names allowed in a book's contributor details." },
    { name: "Draft2Digital", url: "https://draft2digital.freshdesk.com/support/solutions/articles/4000203524-what-do-i-need-to-make-a-draft2digital-account-", note: "Pen names allowed, kept separate from the account holder." },
    { name: "Lulu", url: "https://help.lulu.com/en/support/solutions/articles/64000255302-lulu-the-basics", note: "Pen names allowed in the author field." },
    { name: "BookBaby", url: "https://support.bookbaby.com/hc/en-us/articles/218710017-Can-I-use-a-Pseudonym-or-Pen-name", note: "Pen names allowed; your legal name is needed for legal and payment papers." },
];
/** "Author" with its ⓘ, for a field's label. */
export function AuthorLabel({ text = "Author" }) {
    return (_jsxs("span", { className: "field-label-with-tip", children: [text, _jsxs(InfoTip, { label: "About author names and pen names", title: "Author Names & Pen Names", children: [_jsx("p", { children: "You may use your legal name or a pen name (pseudonym) as the author of your book." }), _jsx("p", { children: "Many publishing platforms allow pen names on published books but require your legal name or registered business information for account verification, contracts, payments, and taxes." }), _jsx("p", { children: "Some publishers or distribution agreements may have additional restrictions, so check your intended publisher's requirements before publishing." }), _jsx("p", { children: "Your chosen author name should be accurate, appropriate, and consistent across editions. Some platforms restrict author-name changes after publication." }), _jsx("ul", { className: "info-tip-list", children: PUBLISHERS.map((p) => (_jsxs("li", { children: [_jsx("a", { href: p.url, onClick: (e) => {
                                        e.preventDefault();
                                        void openExternal(p.url);
                                    }, children: p.name }), ": ", p.note] }, p.name))) }), _jsx("p", { className: "muted", children: "Checked October 2026. Policies change, so check with your publisher." })] })] }));
}
