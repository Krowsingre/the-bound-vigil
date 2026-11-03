// The copyright page's edition: which edition this is, its ISBN for each
// format it comes in (all optional), and the editions before it.

import { Icon } from "../components/Icon";
import { EDITION_FORMATS, editionName, type EditionInfo } from "./bookEditions";

export function EditionFields({ edition, onChange }: { edition: EditionInfo; onChange: (edition: EditionInfo) => void }) {
  const change = (patch: Partial<EditionInfo>) => onChange({ ...edition, ...patch });
  const numbers = Array.from({ length: Math.max(10, edition.number) }, (_, i) => i + 1);
  return (
    <fieldset className="edition-fields">
      <legend>Edition</legend>
      <div className="writing-details-row">
        <label className="field">
          <span>Which edition</span>
          <select value={edition.number} onChange={(e) => change({ number: Number(e.target.value), name: editionName(Number(e.target.value)) })}>
            {numbers.map((n) => (
              <option key={n} value={n}>
                {editionName(n)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Year of this edition</span>
          <input value={edition.year} inputMode="numeric" placeholder={String(new Date().getFullYear())} onChange={(e) => change({ year: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>About this edition</span>
        <input value={edition.note} placeholder="Optional, e.g. Revised and expanded" onChange={(e) => change({ note: e.target.value })} />
      </label>
      <p className="settings-row-hint">
        ISBNs are optional. Fill in only the ones you already have. You can leave them all empty and get an ISBN from your publisher or printer instead.
      </p>
      <div className="edition-isbns">
        {EDITION_FORMATS.map((f) => (
          <label className="field" key={f.id}>
            <span>{f.label} ISBN</span>
            <input
              value={edition.isbns[f.id] ?? ""}
              placeholder="None"
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => change({ isbns: { ...edition.isbns, [f.id]: e.target.value } })}
            />
          </label>
        ))}
      </div>
      {(edition.earlier.length > 0 || edition.number > 1) && (
        <div className="edition-earlier">
          <span className="edition-earlier-head">Earlier editions</span>
          {edition.earlier.map((e, i) => (
            <div className="edition-earlier-row" key={i}>
              <input
                aria-label="Earlier edition"
                value={e.name}
                placeholder={editionName(i + 1)}
                onChange={(ev) => change({ earlier: edition.earlier.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)) })}
              />
              <input
                aria-label="Its year"
                value={e.year}
                inputMode="numeric"
                placeholder="Year"
                onChange={(ev) => change({ earlier: edition.earlier.map((x, j) => (j === i ? { ...x, year: ev.target.value } : x)) })}
              />
              <button type="button" className="icon-btn" aria-label={`Remove ${e.name || "this edition"}`} onClick={() => change({ earlier: edition.earlier.filter((_, j) => j !== i) })}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-quiet btn-small"
            onClick={() => change({ earlier: [...edition.earlier, { name: editionName(edition.earlier.length + 1), year: "" }] })}
          >
            <Icon name="plus" size={14} /> Add an earlier edition
          </button>
        </div>
      )}
    </fieldset>
  );
}
