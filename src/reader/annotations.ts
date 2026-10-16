// Grouping and ordering a book's highlights, notes and bookmarks for the panels.

import type { Annotation } from "../api/types";
import { pageAtFraction } from "./pages";

export type AnnotationFilter = "all" | "highlights" | "notes" | "bookmarks";
export type AnnotationSort = "position" | "recent";

/** A highlight with words of your own attached counts as a note. */
export const isNote = (a: Annotation) => a.kind === "note" || (a.kind === "highlight" && !!a.note);
export const isHighlight = (a: Annotation) => a.kind === "highlight" && !a.note;
export const isBookmark = (a: Annotation) => a.kind === "bookmark";

export function filterAnnotations(
  list: Annotation[],
  filter: AnnotationFilter,
  sort: AnnotationSort,
  query = "",
): Annotation[] {
  const q = query.trim().toLocaleLowerCase();
  const keep = list.filter((a) => {
    if (filter === "highlights" && !isHighlight(a)) return false;
    if (filter === "notes" && !isNote(a)) return false;
    if (filter === "bookmarks" && !isBookmark(a)) return false;
    if (q && ![a.excerpt, a.note ?? "", a.locator.chapter ?? ""].some((t) => t.toLocaleLowerCase().includes(q))) {
      return false;
    }
    return true;
  });
  return keep.sort(
    sort === "recent"
      ? (a, b) => b.createdAt.localeCompare(a.createdAt)
      : (a, b) => (a.locator.totalProgression ?? 0) - (b.locator.totalProgression ?? 0),
  );
}

export function counts(list: Annotation[]): Record<AnnotationFilter, number> {
  return {
    all: list.length,
    highlights: list.filter(isHighlight).length,
    notes: list.filter(isNote).length,
    bookmarks: list.filter(isBookmark).length,
  };
}

/** The fixed page an annotation sits on. */
export function annotationPage(a: Annotation, totalPages: number): number | null {
  if (a.locator.pageIndex != null) return a.locator.pageIndex + 1;
  if (a.locator.totalProgression != null && totalPages > 0) return pageAtFraction(a.locator.totalProgression, totalPages);
  return null;
}
