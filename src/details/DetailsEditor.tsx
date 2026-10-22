// Editing a book's details, or the same details on many books at once. Book
// files never change: an edit is kept beside the book and shows over its own
// details, and taking the edit away shows them again.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { BookPreview, DetailChange, DetailField, DetailFieldName } from "../api/types";
import { useToast } from "../components/Toast";
import { AUDIO_ONLY, cleanValue, DETAIL_FIELDS, effective, isList, listOf } from "../lib/details";
import { isAudio } from "../lib/queryBooks";
import { ChipInput } from "./ChipInput";
import { AddOrReplace, joined, type ListMode } from "../components/AddOrReplace";

/** The details that make sense to set on many books at once. */
const MASS_FIELDS: DetailFieldName[] = ["authors", "series", "genres", "publisher", "published", "language"];

type Values = Partial<Record<DetailFieldName, string | string[]>>;

const toForm = (field: DetailFieldName, value: string | null) => (isList(field) ? listOf(value) : (value ?? ""));
const fromForm = (value: string | string[]) => (Array.isArray(value) ? JSON.stringify(value) : value);

export function DetailsEditor({ books, onClose }: { books: BookPreview[]; onClose: (changed: boolean) => void }) {
  const many = books.length > 1;
  const toast = useToast();
  const [fields, setFields] = useState<DetailField[] | null>(many ? [] : null);
  const [values, setValues] = useState<Values>({});
  // Many books: only the details ticked here change.
  const [chosen, setChosen] = useState<Set<DetailFieldName>>(new Set());
  // Lists (authors, genres, narrators): add to what a book has, or replace it.
  // Many books start on Add; one book shows its list to change.
  const [modes, setModes] = useState<Partial<Record<DetailFieldName, ListMode>>>({});
  const modeOf = (field: DetailFieldName): ListMode => modes[field] ?? (many ? "add" : "replace");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (many) return;
    api.bookDetails(books[0].id).then(
      (d) => {
        setFields(d.fields);
        setValues(Object.fromEntries(d.fields.map((f) => [f.field, toForm(f.field, effective(f))])));
      },
      (e: unknown) => {
        toast(`Couldn't open the details: ${String(e)}`);
        close.current(false);
      },
    );
  }, [many, books, toast]);

  const set = (field: DetailFieldName, value: string | string[]) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (many) setChosen((c) => new Set(c).add(field));
    setError(null);
  };

  /** A list a book has now, as it shows. */
  const listNow = (book: BookPreview, field: DetailFieldName): string[] => {
    if (!many) return listOf(effective(fields?.find((f) => f.field === field) ?? ({} as DetailField)) ?? null);
    return (field === "authors" ? book.authors : field === "genres" ? book.genres : (book.narrators ?? [])) ?? [];
  };
  /** What's typed, joined to what `book` has where the field adds. */
  const typedFor = (book: BookPreview, field: DetailFieldName, typed: string | string[]) =>
    Array.isArray(typed) && modeOf(field) === "add" ? joined(listNow(book, field), typed) : typed;

  const changes = (book: BookPreview): DetailChange[] => {
    if (many)
      return [...chosen].flatMap((field) => {
        const v = values[field] ?? (isList(field) ? [] : "");
        // Adding nothing changes nothing.
        if (Array.isArray(v) && !v.length && modeOf(field) === "add") return [];
        return [{ field, value: cleanValue(field, fromForm(typedFor(book, field, v))) }];
      });
    const out: DetailChange[] = [];
    for (const f of fields ?? []) {
      const typed = values[f.field];
      if (typed === undefined) continue;
      const value = cleanValue(f.field, fromForm(typedFor(book, f.field, typed)));
      const shown = effective(f);
      if (value === (shown ?? (isList(f.field) ? "[]" : ""))) continue;
      // Back to what it would show anyway: take the edit away instead of keeping a copy.
      const beneath = f.fetched ?? f.own;
      out.push({ field: f.field, value: beneath !== null && value === beneath ? null : value });
    }
    return out;
  };

  const save = () => {
    // Books whose changes come out the same are saved together.
    const groups = new Map<string, { ids: string[]; list: DetailChange[] }>();
    try {
      for (const book of books) {
        const list = changes(book);
        if (!list.length) continue;
        const key = JSON.stringify(list);
        const group = groups.get(key) ?? { ids: [], list };
        group.ids.push(book.id);
        groups.set(key, group);
      }
    } catch (e) {
      return setError(e instanceof Error ? e.message : String(e));
    }
    if (!groups.size) return onClose(false);
    setSaving(true);
    [...groups.values()]
      .reduce<Promise<void>>((done, g) => done.then(() => api.editDetails(g.ids, g.list)), Promise.resolve())
      .then(
        () => {
          toast(many ? `Updated ${books.length} books.` : `Saved the details of “${books[0].title}”.`);
          onClose(true);
        },
        (e: unknown) => {
          setSaving(false);
          setError(String(e));
        },
      );
  };

  // Narrators belong to audiobooks only.
  const audio = books.every((b) => isAudio(b.format));
  const shownFields = DETAIL_FIELDS.filter(
    (f) => (!many || MASS_FIELDS.includes(f.field) || (audio && f.field === "narrators")) && (audio || !AUDIO_ONLY.includes(f.field)),
  );
  const undoEdit = (f: DetailField) => {
    setModes((m) => ({ ...m, [f.field]: "replace" }));
    set(f.field, toForm(f.field, f.fetched ?? f.own));
  };
  const chooseMode = (field: DetailFieldName, mode: ListMode) => {
    if (mode === modeOf(field)) return;
    setModes((m) => ({ ...m, [field]: mode }));
    // One book: Replace shows the list it has, Add starts empty.
    if (!many) {
      const had = listNow(books[0], field);
      const typed = (values[field] as string[] | undefined) ?? [];
      set(field, mode === "replace" ? joined(had, typed) : typed.filter((t) => !had.includes(t)));
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div
        className="dialog details-dialog"
        role="dialog"
        aria-label={many ? "Edit details of many books" : "Edit details"}
        onKeyDown={(e) => e.key === "Escape" && onClose(false)}
      >
        <h2>{many ? `Edit ${books.length} books` : "Edit details"}</h2>
        <p className="muted add-dialog-book">
          {many
            ? "Tick the details to change. They're set the same on every book you chose; the rest stay as they are."
            : books[0].title}
        </p>
        {fields === null ? (
          <div className="library-loading" aria-busy="true" aria-label="Loading the details" />
        ) : (
          <div className="details-form">
            {shownFields.map(({ field, label, long }) => {
              const f = fields.find((x) => x.field === field);
              const value = values[field] ?? (isList(field) ? [] : "");
              const off = many && !chosen.has(field);
              return (
                <div key={field} className={`field details-field${off ? " is-off" : ""}`}>
                  <span className="details-field-head">
                    {many ? (
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={!off}
                          onChange={(e) =>
                            setChosen((c) => {
                              const next = new Set(c);
                              if (e.target.checked) next.add(field);
                              else next.delete(field);
                              return next;
                            })
                          }
                        />
                        {label}
                      </label>
                    ) : (
                      <label htmlFor={`detail-${field}`}>{label}</label>
                    )}
                    {f?.edited !== null && f?.edited !== undefined && (
                      <button type="button" className="view-all" onClick={() => undoEdit(f)}>
                        Undo my edit
                      </button>
                    )}
                  </span>
                  {Array.isArray(value) && (
                    <AddOrReplace mode={modeOf(field)} onChange={(m) => chooseMode(field, m)} label={`Add to or replace ${label.toLowerCase()}`} />
                  )}
                  {Array.isArray(value) && modeOf(field) === "add" && !many && listNow(books[0], field).length > 0 && (
                    <span className="details-origin">Joins {listNow(books[0], field).join(", ")}.</span>
                  )}
                  {Array.isArray(value) ? (
                    <ChipInput
                      value={value}
                      onChange={(v) => set(field, v)}
                      label={label}
                      placeholder={field === "genres" ? "Type a genre and press Enter" : "Type a name and press Enter"}
                    />
                  ) : long ? (
                    <textarea id={`detail-${field}`} rows={6} value={value} onChange={(e) => set(field, e.target.value)} />
                  ) : (
                    <input
                      id={`detail-${field}`}
                      value={value}
                      inputMode={field === "series_index" ? "decimal" : undefined}
                      placeholder={
                        field === "published"
                          ? "Like 1897 or 1897-05-26"
                          : field === "language"
                            ? "Like en or English"
                            : undefined
                      }
                      aria-label={many ? label : undefined}
                      onChange={(e) => set(field, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || fields === null || (many && !chosen.size)}
            onClick={save}
          >
            {many ? `Change ${books.length} books` : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
