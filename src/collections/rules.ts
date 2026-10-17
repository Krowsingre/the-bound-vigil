// The rules a collection can fill itself from, as the editor offers them.
// The core (rules.rs) decides which books match; the preview copies it.

import type { BookPreview, CollectionRules, Rule, RuleField, RuleOp } from "../api/types";

type ValueKind = "text" | "choice" | "number" | "none";

export interface FieldInfo {
  field: RuleField;
  label: string;
  ops: { op: RuleOp; label: string }[];
  /** For a choice: the values, as saved and as shown. */
  choices?: { value: string; label: string }[];
  /** Words after a number, such as "days". */
  unit?: string;
}

const TEXT_OPS: FieldInfo["ops"] = [
  { op: "contains", label: "contains" },
  { op: "notContains", label: "doesn't contain" },
  { op: "is", label: "is" },
  { op: "isNot", label: "is not" },
  { op: "startsWith", label: "starts with" },
  { op: "isEmpty", label: "is empty" },
];

const STARS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "star" : "stars"}` }));
const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
/** As the core allows (rules.rs). */
export const MAX_RULES = 12;

export const FORMATS = ["epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz", "cbz", "txt", "docx", "doc"];

export const FIELDS: FieldInfo[] = [
  { field: "title", label: "Title", ops: TEXT_OPS },
  { field: "author", label: "Author", ops: TEXT_OPS.map((o) => (o.op === "isEmpty" ? { ...o, label: "is missing" } : o)) },
  { field: "series", label: "Series", ops: TEXT_OPS },
  { field: "publisher", label: "Publisher", ops: TEXT_OPS },
  { field: "language", label: "Language", ops: TEXT_OPS },
  {
    field: "format",
    label: "Format",
    ops: [
      { op: "is", label: "is" },
      { op: "isNot", label: "is not" },
    ],
    choices: FORMATS.map((f) => ({ value: f, label: f.toUpperCase() })),
  },
  {
    field: "rating",
    label: "Your rating",
    ops: [
      { op: "atLeast", label: "is at least" },
      { op: "atMost", label: "is at most" },
      { op: "is", label: "is exactly" },
      { op: "isEmpty", label: "isn't rated" },
    ],
    choices: STARS,
  },
  {
    field: "status",
    label: "Reading",
    ops: [
      { op: "is", label: "is" },
      { op: "isNot", label: "is not" },
    ],
    choices: [
      { value: "unread", label: "Unread" },
      { value: "in_progress", label: "In progress" },
      { value: "read", label: "Read" },
    ],
  },
  { field: "favorite", label: "Favourite", ops: [{ op: "is", label: "is" }], choices: YES_NO },
  { field: "upNext", label: "Up next", ops: [{ op: "is", label: "is" }], choices: YES_NO },
  {
    field: "added",
    label: "Added",
    ops: [
      { op: "withinDays", label: "in the last" },
      { op: "olderThanDays", label: "more than" },
    ],
    unit: "days",
  },
  {
    field: "location",
    label: "Book file",
    ops: [{ op: "is", label: "is" }],
    choices: [
      { value: "device", label: "On this device" },
      { value: "cloud", label: "Only in the cloud" },
    ],
  },
  {
    field: "tag",
    label: "Tag",
    ops: [
      { op: "is", label: "is" },
      { op: "isNot", label: "is not" },
      { op: "contains", label: "contains" },
      { op: "isEmpty", label: "has no tags" },
    ],
  },
];

export const fieldInfo = (field: RuleField) => FIELDS.find((f) => f.field === field)!;

export function valueKind(rule: Rule): ValueKind {
  const info = fieldInfo(rule.field);
  if (rule.op === "isEmpty") return "none";
  if (info.choices) return "choice";
  if (info.unit) return "number";
  return "text";
}

/** A rule for `field` with its first test and a sensible value. */
export function newRule(field: RuleField = "author"): Rule {
  const info = fieldInfo(field);
  const op = info.ops[0].op;
  const value = info.choices ? (field === "rating" ? "4" : info.choices[0].value) : info.unit ? "30" : "";
  return { field, op, value };
}

/** A rule that's complete enough to use. */
export function usable(rule: Rule): boolean {
  const kind = valueKind(rule);
  if (kind === "none") return true;
  if (kind === "number") return /^\d+$/.test(rule.value.trim());
  return rule.value.trim() !== "";
}

/** Whether a book matches, as the core decides it. For the browser preview. */
export function matches(book: BookPreview, rules: CollectionRules, extra: { publisher?: string; language?: string } = {}): boolean {
  const results = rules.rules.filter(usable).map((r) => matchesRule(book, r, extra));
  if (!results.length) return true;
  return rules.any ? results.some(Boolean) : results.every(Boolean);
}

function matchesRule(book: BookPreview, rule: Rule, extra: { publisher?: string; language?: string }): boolean {
  const v = rule.value.trim().toLowerCase();
  const textTest = (text: string | null | undefined) => {
    const t = (text ?? "").toLowerCase();
    switch (rule.op) {
      case "isEmpty":
        return t.trim() === "";
      case "contains":
        return t.includes(v);
      case "notContains":
        return !t.includes(v);
      case "is":
        return t === v;
      case "isNot":
        return t !== v;
      case "startsWith":
        return t.startsWith(v);
      default:
        return false;
    }
  };
  const n = Number(v);
  switch (rule.field) {
    case "title":
      return textTest(book.title);
    case "series":
      return textTest(book.series);
    case "publisher":
      return textTest(extra.publisher);
    case "language":
      return textTest(extra.language);
    case "author":
      if (rule.op === "isEmpty") return book.authors.length === 0;
      if (rule.op === "notContains") return !book.authors.some((a) => a.toLowerCase().includes(v));
      if (rule.op === "isNot") return !book.authors.some((a) => a.toLowerCase() === v);
      return book.authors.some(textTest);
    case "format":
      return rule.op === "is" ? book.format.toLowerCase() === v : book.format.toLowerCase() !== v;
    case "rating":
      if (rule.op === "isEmpty") return book.rating === null;
      if (book.rating === null) return false;
      return rule.op === "atLeast" ? book.rating >= n : rule.op === "atMost" ? book.rating <= n : book.rating === n;
    case "status":
      return rule.op === "is" ? book.status === v : book.status !== v;
    case "favorite":
      return book.favorite === (v === "yes");
    case "upNext":
      return book.wantToRead === (v === "yes");
    case "added": {
      const since = Date.now() - n * 86_400_000;
      return rule.op === "withinDays" ? Date.parse(book.addedAt) >= since : Date.parse(book.addedAt) < since;
    }
    case "location":
      return v === "device" ? book.availability === "local" : book.availability !== "local";
    case "tag": {
      const tags = (book.tags ?? []).map((t) => t.toLowerCase());
      if (rule.op === "isEmpty") return tags.length === 0;
      if (rule.op === "isNot") return !tags.includes(v);
      if (rule.op === "contains") return tags.some((t) => t.includes(v));
      return tags.includes(v);
    }
  }
}

/** A short line saying what the rules ask for, for a collection's card. */
export function describeRules(rules: CollectionRules): string {
  const parts = rules.rules.filter(usable).map((r) => {
    const info = fieldInfo(r.field);
    const op = info.ops.find((o) => o.op === r.op)?.label ?? r.op;
    const value = valueKind(r) === "none" ? "" : (info.choices?.find((c) => c.value === r.value)?.label ?? `“${r.value}”`);
    return [info.label, op, value, info.unit && valueKind(r) === "number" ? info.unit : ""].filter(Boolean).join(" ");
  });
  return parts.join(rules.any ? ", or " : ", and ");
}
