// The ⓘ beside every Author field in Scribe: pen names, and what publishers
// ask for (embre's spec, 31 October 2026, section 8). Only information:
// nothing has to be read or agreed to. Recheck the publishers now and then.

import { openExternal } from "../api";
import { InfoTip } from "../components/InfoTip";

/** Checked 31 October 2026. */
const PUBLISHERS: { name: string; url: string; note: string }[] = [
  { name: "Amazon KDP", url: "https://kdp.amazon.com/en_US/help/topic/G2BWJN2BY98T5PV2", note: "Pen names allowed. Your legal identity is needed separately for tax and payments, and a published book's author name is hard to change." },
  { name: "IngramSpark", url: "https://www.ingramspark.com/blog/how-to-set-up-a-title-with-ingramspark-part-1", note: "Pen names allowed in a book's contributor details." },
  { name: "Draft2Digital", url: "https://draft2digital.freshdesk.com/support/solutions/articles/4000203524-what-do-i-need-to-make-a-draft2digital-account-", note: "Pen names allowed, kept separate from the account holder." },
  { name: "Lulu", url: "https://help.lulu.com/en/support/solutions/articles/64000255302-lulu-the-basics", note: "Pen names allowed in the author field." },
  { name: "BookBaby", url: "https://support.bookbaby.com/hc/en-us/articles/218710017-Can-I-use-a-Pseudonym-or-Pen-name", note: "Pen names allowed; your legal name is needed for legal and payment papers." },
];

/** "Author" with its ⓘ, for a field's label. */
export function AuthorLabel({ text = "Author" }: { text?: string }) {
  return (
    <span className="field-label-with-tip">
      {text}
      <InfoTip label="About author names and pen names" title="Author Names & Pen Names">
        <p>You may use your legal name or a pen name (pseudonym) as the author of your book.</p>
        <p>Many publishing platforms allow pen names on published books but require your legal name or registered business information for account verification, contracts, payments, and taxes.</p>
        <p>Some publishers or distribution agreements may have additional restrictions, so check your intended publisher's requirements before publishing.</p>
        <p>Your chosen author name should be accurate, appropriate, and consistent across editions. Some platforms restrict author-name changes after publication.</p>
        <ul className="info-tip-list">
          {PUBLISHERS.map((p) => (
            <li key={p.name}>
              <a
                href={p.url}
                onClick={(e) => {
                  e.preventDefault();
                  void openExternal(p.url);
                }}
              >
                {p.name}
              </a>
              : {p.note}
            </li>
          ))}
        </ul>
        <p className="muted">Checked October 2026. Policies change, so check with your publisher.</p>
      </InfoTip>
    </span>
  );
}
