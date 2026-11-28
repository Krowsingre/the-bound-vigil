// Editing a book's details, or the same details on many books at once. Book
// files never change: an edit is kept beside the book and shows over its own
// details, and taking the edit away shows them again.

import { useEffect, useRef, useState } from "react";
import { useTickRange, withShift } from "../lib/rangePick";
import { api } from "../api";
import type { BookPreview, DetailChange, DetailField, DetailFieldName, SeriesPlace } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import {
  AUDIO_ONLY, cleanValue, DETAIL_FIELDS, detailsKindOf, effective, isList, labelFor, LISTENING_ONLY, listOf, MUSIC_FIELDS, MUSIC_MASS,
  SPOKEN_FIELDS, SPOKEN_MASS,
} from "../lib/details";
import { isAudio } from "../lib/queryBooks";
import { ChipInput } from "./ChipInput";
import { bulkPlaces, emptyRow, placeChanges, placesFromFields, placesFromRows, rowsOf, SeriesEditor, type PlaceRow } from "./SeriesEditor";
import { SuggestInput, useSuggestions } from "./Suggest";
import { AddOrReplace, joined, type ListMode } from "../components/AddOrReplace";

/** The details that make sense to set on many books at once. */
const MASS_FIELDS: DetailFieldName[] = ["authors", "series", "genres", "publisher", "published", "language"];

type EditGroup = { ids: string[]; list: DetailChange[] };

type Values = Partial<Record<DetailFieldName, string | string[]>>;

/** Places as text that's the same whenever they mean the same. */
const samePlaces = (json: string | null | undefined) => {
  try {
    const list = JSON.parse(json ?? "[]") as SeriesPlace[] | null;
    return JSON.stringify((list ?? []).map((p) => [p.name, p.number ?? null, p.end ?? null, p.after ?? null]));
  } catch {
    return json ?? "";
  }
};

const toForm = (field: DetailFieldName, value: string | null) => (isList(field) ? listOf(value) : (value ?? ""));
const fromForm = (value: string | string[]) => (Array.isArray(value) ? JSON.stringify(value) : value);

export function DetailsEditor({ books, onClose }: { books: BookPreview[]; onClose: (changed: boolean) => void }) {
  const many = books.length > 1;
  // Songs, podcasts and other audio have details of their own (embre, 19 November).
  const kind = detailsKindOf(books);
  const toast = useToast();
  const [fields, setFields] = useState<DetailField[] | null>(many ? [] : null);
  const [values, setValues] = useState<Values>({});
  // Many books: only the details ticked here change.
  const [chosen, setChosen] = useState<Set<DetailFieldName>>(new Set());
  const tickRange = useTickRange();
  // Lists (authors, genres, narrators): add to what a book has, or replace it.
  // Many books start on Add; one book shows its list to change.
  const [modes, setModes] = useState<Partial<Record<DetailFieldName, ListMode>>>({});
  const modeOf = (field: DetailFieldName): ListMode => modes[field] ?? (many && !(kind === "music" && field === "series") ? "add" : "replace");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<{ groups: EditGroup[]; fields: string[]; count: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // One book: its series as rows. Many: one series to put them all in.
  const [seriesRows, setSeriesRows] = useState<PlaceRow[] | null>(null);
  const [startedPlaces, setStartedPlaces] = useState("[]");
  const [bulkName, setBulkName] = useState("");
  const [bulkStart, setBulkStart] = useState("");
  // What the library has, to finish typing from.
  const suggested = {
    series: useSuggestions("series"),
    authors: useSuggestions("authors"),
    genres: useSuggestions("genres"),
    narrators: useSuggestions("narrators"),
    publisher: useSuggestions("publisher"),
    language: useSuggestions("language"),
  } as Partial<Record<DetailFieldName, string[]>>;

  useEffect(() => {
    if (many) return;
    api.bookDetails(books[0].id).then(
      (d) => {
        setFields(d.fields);
        setValues(Object.fromEntries(d.fields.map((f) => [f.field, toForm(f.field, effective(f))])));
        const places = placesFromFields(d.fields);
        setStartedPlaces(JSON.stringify(places));
        setSeriesRows(places.length ? rowsOf(places) : [emptyRow()]);
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
        if (field === "series") {
          const name = bulkName.split(/\s+/).filter(Boolean).join(" ");
          // An empty name takes them out of every series.
          if (!name) return modeOf("series") === "replace" ? placeChanges([]) : [];
          const typed = bulkStart.trim().replace(",", ".");
          const start = typed ? Number(typed) : null;
          if (start !== null && (!Number.isFinite(start) || start < 0 || start >= 100_000))
            throw new Error("The starting number should be a number, like 1.");
          const number = start === null ? null : start + books.indexOf(book);
          return placeChanges(bulkPlaces(book, name, number, modeOf("series") === "add"));
        }
        const v = values[field] ?? (isList(field) ? [] : "");
        // Adding nothing changes nothing.
        if (Array.isArray(v) && !v.length && modeOf(field) === "add") return [];
        return [{ field, value: cleanValue(field, fromForm(typedFor(book, field, v))) }];
      });
    const out: DetailChange[] = [];
    const places = placesFromRows(seriesRows ?? []);
    const placesChanged = samePlaces(JSON.stringify(places)) !== samePlaces(startedPlaces);
    for (const f of fields ?? []) {
      // A song's album and track are edited as plain details.
      if (kind === "music" && f.field === "series_list") continue;
      if (kind !== "music" && (f.field === "series" || f.field === "series_index" || f.field === "series_list")) {
        if (!placesChanged) continue;
        const value = placeChanges(places).find((c) => c.field === f.field)!.value;
        const shown = effective(f);
        if (f.field === "series_list" ? samePlaces(value) === samePlaces(shown) : (value ?? "") === (shown ?? "")) continue;
        const beneath = f.fetched ?? f.own;
        out.push({ field: f.field, value: value !== null && beneath !== null && value === beneath ? null : value });
        continue;
      }
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

  const save = async () => {
    // Books whose changes come out the same are saved together.
    const groups = new Map<string, EditGroup>();
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
    try {
      const touched = new Set<DetailFieldName>();
      let count = 0;
      for (const group of groups.values()) {
        for (const id of group.ids) {
          const current = (await api.bookDetails(id)).fields;
          const conflicts = group.list.filter((change) => current.some((field) =>
            field.field === change.field && field.fetched !== null && field.fetchedFrom && field.fetchedFrom !== "file" &&
            (field.edited === null || field.edited === field.fetched) && change.value !== null && change.value !== field.fetched
          ));
          if (conflicts.length) {
            count++;
            conflicts.forEach((change) => touched.add(change.field));
          }
        }
      }
      if (count) {
        setSaving(false);
        setConfirmation({ groups: [...groups.values()], fields: DETAIL_FIELDS.filter((entry) => touched.has(entry.field)).map((entry) => entry.label), count });
        return;
      }
      apply([...groups.values()]);
    } catch (failure) {
      setSaving(false);
      setError(String(failure));
    }
  };

  const apply = (groups: EditGroup[]) => {
    setConfirmation(null);
    setSaving(true);
    groups.reduce<Promise<void>>((done, g) => done.then(() => api.editDetails(g.ids, g.list)), Promise.resolve())
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
  const listening = kind === "music" ? (many ? MUSIC_MASS : MUSIC_FIELDS) : kind === "spoken" ? (many ? SPOKEN_MASS : SPOKEN_FIELDS) : null;
  const shownFields = (listening
    ? listening.map((field) => DETAIL_FIELDS.find((f) => f.field === field)!)
    : DETAIL_FIELDS.filter(
        (f) =>
          f.field !== "series_index" &&
          f.field !== "series_list" &&
          !LISTENING_ONLY.includes(f.field) &&
          (!many || MASS_FIELDS.includes(f.field) || (audio && f.field === "narrators")) &&
          (audio || !AUDIO_ONLY.includes(f.field)),
      )
  ).map((f) => ({ ...f, label: labelFor(f.field, kind) }));
  // A song's album is one name, not a list of series.
  const plainSeries = kind === "music" && !many;
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
    <>
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
                          onChange={(e) => {
                            // Shift: every detail from the one ticked last takes the same tick.
                            const next = new Set(chosen);
                            for (const f of tickRange(shownFields.map((x) => x.field), field, withShift(e)) as DetailFieldName[]) {
                              if (e.target.checked) next.add(f);
                              else next.delete(f);
                            }
                            setChosen(next);
                          }}
                        />
                        {label}
                      </label>
                    ) : (
                      <label htmlFor={`detail-${field}`}>{label}</label>
                    )}
                    {(field !== "series" || plainSeries) && f?.edited !== null && f?.edited !== undefined && (
                      <button type="button" className="view-all" onClick={() => undoEdit(f)}>
                        Undo my edit
                      </button>
                    )}
                  </span>
                  {field === "series" && !plainSeries ? (
                    many ? (
                      <>
                        {kind !== "music" && (
                          <AddOrReplace mode={modeOf("series")} onChange={(m) => setModes((ms) => ({ ...ms, series: m }))} label="Add to their series or replace them" />
                        )}
                        <div className="series-bulk">
                          <SuggestInput
                            value={bulkName}
                            onChange={(v) => { set("series", v); setBulkName(v); }}
                            all={suggested.series ?? []}
                            label={kind === "music" ? "Album" : "Series"}
                            placeholder={kind === "music" ? "Album name" : "Series name"}
                          />
                          <input
                            inputMode="decimal"
                            autoComplete="off"
                            value={bulkStart}
                            placeholder={kind === "music" ? "First track" : "Starting number"}
                            aria-label={kind === "music" ? "First track" : "Starting number"}
                            onChange={(e) => {
                              set("series", bulkName);
                              setBulkStart(e.target.value);
                            }}
                          />
                        </div>
                        <span className="details-origin">
                          {kind === "music"
                            ? "Becomes the album of every song you chose."
                            : modeOf("series") === "add"
                              ? "Joins the series each book is in; a book with none gets it as its main series."
                              : "Becomes each book's only series."}
                          {bulkStart.trim() ? " Numbered in the order you chose them." : ""}
                        </span>
                      </>
                    ) : (
                      <SeriesEditor rows={seriesRows ?? []} onChange={setSeriesRows} all={suggested.series ?? []} />
                    )
                  ) : null}
                  {(field !== "series" || plainSeries) && Array.isArray(value) && (
                    <AddOrReplace mode={modeOf(field)} onChange={(m) => chooseMode(field, m)} label={`Add to or replace ${label.toLowerCase()}`} />
                  )}
                  {Array.isArray(value) && modeOf(field) === "add" && !many && listNow(books[0], field).length > 0 && (
                    <span className="details-origin">Joins {listNow(books[0], field).join(", ")}.</span>
                  )}
                  {field === "series" && !plainSeries ? null : Array.isArray(value) ? (
                    <ChipInput
                      value={value}
                      onChange={(v) => set(field, v)}
                      suggestions={suggested[field]}
                      label={label}
                      placeholder={field === "genres" ? "Type a genre and press Enter" : "Type a name and press Enter"}
                    />
                  ) : long ? (
                    <textarea id={`detail-${field}`} rows={6} value={value} onChange={(e) => set(field, e.target.value)} />
                  ) : suggested[field] ? (
                    <SuggestInput
                      id={`detail-${field}`}
                      value={value}
                      onChange={(v) => set(field, v)}
                      all={suggested[field] ?? []}
                      label={many ? label : undefined}
                      placeholder={field === "language" ? "Like en or English" : undefined}
                    />
                  ) : (
                    <input
                      id={`detail-${field}`}
                      value={value}
                      autoComplete="off"
                      inputMode={field === "series_index" || field === "disc" ? "decimal" : undefined}
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
    {confirmation && (
      <ConfirmDialog
        title="Replace details found online?"
        body={confirmation.fields.join(", ") + (confirmation.count === 1 ? " on one book" : " on " + confirmation.count + " books") + " will use your edits."}
        confirm="Apply my edits"
        onConfirm={() => apply(confirmation.groups)}
        onCancel={() => setConfirmation(null)}
      />
    )}
    </>
  );
}
