// The book's research sources: add each once (a book, an article, a web
// page…), choose the citation style, and cite one at the cursor with the page
// it's from. Opened from the editor's Cite tool, or from the book's menu.

import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { emptySource, FIELD_LABELS, SOURCE_TYPES, STYLES, citationLabel, type CitationStyle, type Source, type SourceType } from "./sources";

const newId = () => `src-${crypto.randomUUID()}`;

const HINTS: Partial<Record<keyof Source, string>> = {
  authors: "One a line, as Family, Given. An organisation goes as its name.",
  editors: "One a line, as Family, Given.",
  date: "Year, or year-month-day, e.g. 2024 or 2024-03-18",
  accessed: "e.g. 2026-10-30",
  pages: "e.g. 45-67",
};

function SourceForm({ source, onSave, onCancel }: { source: Source; onSave: (s: Source) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(source);
  const type = SOURCE_TYPES.find((t) => t.value === draft.type) ?? SOURCE_TYPES[0];
  const set = (change: Partial<Source>) => setDraft((d) => ({ ...d, ...change }));
  return (
    <div className="sources-form">
      <label className="field">
        <span>Kind</span>
        <select value={draft.type} onChange={(e) => set({ type: e.target.value as SourceType })}>
          {SOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="sources-fields">
        {type.fields.map((key) => {
          const label = key === "container" ? (type.container ?? FIELD_LABELS.container) : FIELD_LABELS[key];
          const many = key === "authors" || key === "editors";
          const wide = many || key === "title" || key === "container" || key === "url";
          return (
            <label key={key} className={`field${wide ? " is-wide" : ""}`}>
              <span>{label}</span>
              {many ? (
                <textarea rows={2} value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} placeholder={HINTS[key]} />
              ) : (
                <input value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} placeholder={HINTS[key]} autoFocus={key === type.fields[0]} />
              )}
            </label>
          );
        })}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!draft.title.trim()} onClick={() => onSave(draft)}>
          Save source
        </button>
      </div>
    </div>
  );
}

export function SourcesDialog({
  sources,
  style,
  onChange,
  onCite,
  current,
  onClose,
}: {
  sources: Source[];
  style: CitationStyle;
  onChange: (sources: Source[], style: CitationStyle) => void;
  /** Given when citing: puts a citation of the source in the text. */
  onCite?: (source: Source, locator: string) => void;
  /** The citation selected in the text, to change. */
  current?: { source: string; locator: string } | null;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Source | null>(null);
  const [search, setSearch] = useState("");
  const [locator, setLocator] = useState(current?.locator ?? "");
  const [chosen, setChosen] = useState<string | null>(current?.source ?? null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...sources].sort((a, b) => citationLabel(a, "").localeCompare(citationLabel(b, "")));
    return q ? list.filter((s) => `${s.title} ${s.authors} ${s.container} ${s.date}`.toLowerCase().includes(q)) : list;
  }, [sources, search]);
  const save = (s: Source) => {
    const next = sources.some((x) => x.id === s.id) ? sources.map((x) => (x.id === s.id ? s : x)) : [...sources, s];
    onChange(next, style);
    setEditing(null);
    if (onCite) setChosen(s.id);
  };
  const citing = !!onCite;
  const pick = chosen ? sources.find((s) => s.id === chosen) : undefined;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog writing-dialog sources-dialog" role="dialog" aria-label={citing ? "Cite a source" : "Sources"} onKeyDown={(e) => e.key === "Escape" && (editing ? setEditing(null) : onClose())}>
        <h2>{editing ? (sources.some((s) => s.id === editing.id) ? "Change source" : "Add a source") : citing ? "Cite a source" : "Sources"}</h2>
        {editing ? (
          <SourceForm source={editing} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <>
            <label className="field">
              <span>Citation style</span>
              <select value={style} onChange={(e) => onChange(sources, e.target.value as CitationStyle)}>
                {STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} · {s.hint}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted sources-note">The style sets how citations and the Sources page at the back are written. It doesn't change the rest of the book.</p>
            <div className="sources-bar">
              <input type="search" className="sources-search" placeholder="Find a source" aria-label="Find a source" value={search} onChange={(e) => setSearch(e.target.value)} />
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setEditing(emptySource(newId()))}>
                <Icon name="plus" size={15} /> Add a source
              </button>
            </div>
            {sources.length === 0 ? (
              <p className="muted sources-empty">No sources yet. Add the books, articles and pages you draw on, then cite them anywhere in the book.</p>
            ) : (
              <ul className="sources-list" role={citing ? "listbox" : undefined} aria-label="Sources">
                {shown.map((s) => (
                  <li key={s.id} className={chosen === s.id ? "is-on" : ""}>
                    <button
                      type="button"
                      className="sources-item"
                      role={citing ? "option" : undefined}
                      aria-selected={citing ? chosen === s.id : undefined}
                      onClick={() => (citing ? setChosen(s.id) : setEditing(s))}
                    >
                      <strong>{s.title || "Untitled"}</strong>
                      <span className="muted">
                        {[s.authors.split("\n")[0], s.container, s.date].filter((x) => x.trim()).join(" · ") || SOURCE_TYPES.find((t) => t.value === s.type)?.label}
                      </span>
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Change ${s.title}`} title="Change" onClick={() => setEditing(s)}>
                      <Icon name="edit" size={15} />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${s.title}`} title="Remove" onClick={() => setRemoving(s)}>
                      <Icon name="trash" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {removing && (
              <div className="sources-confirm" role="alert">
                <span>Remove “{removing.title || "Untitled"}”? Citations of it in the text will show as a removed source.</span>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => setRemoving(null)}>
                  Keep
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={() => {
                    onChange(
                      sources.filter((x) => x.id !== removing.id),
                      style,
                    );
                    if (chosen === removing.id) setChosen(null);
                    setRemoving(null);
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            <div className="dialog-actions">
              {citing && (
                <label className="field sources-locator">
                  <span>Page</span>
                  <input value={locator} onChange={(e) => setLocator(e.target.value)} placeholder="e.g. 12 or 45-47" maxLength={40} />
                </label>
              )}
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                {citing ? "Cancel" : "Done"}
              </button>
              {citing && (
                <button type="button" className="btn btn-primary" disabled={!pick} onClick={() => pick && onCite!(pick, locator)}>
                  {current ? "Change citation" : "Cite"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
