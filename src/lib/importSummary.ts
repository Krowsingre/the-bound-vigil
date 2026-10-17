import type { ImportsView } from "../api/types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Tally = Pick<ImportsView, "done" | "added" | "already" | "unsupported" | "failed" | "onlyAdded" | "onlyFailure">;

/** One plain sentence describing what an import did. */
export function importSummary(t: Tally): string {
  if (t.done === 0) return "No book files were found there.";
  const parts: string[] = [];
  if (t.added === 1) parts.push(`Added “${t.onlyAdded ?? "1 book"}”.`);
  else if (t.added > 1) parts.push(`Added ${plural(t.added, "book")}.`);
  if (t.already) parts.push(`${plural(t.already, "book was", "books were")} already in your library.`);
  if (t.unsupported) parts.push(`${plural(t.unsupported, "file isn't a", "files aren't")} supported book format${t.unsupported === 1 ? "" : "s"}.`);
  if (t.failed === 1) parts.push(`One file couldn't be read: ${t.onlyFailure}.`);
  else if (t.failed > 1) parts.push(`${t.failed} files couldn't be read.`);
  return parts.join(" ");
}
