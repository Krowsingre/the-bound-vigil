import type { ImportResult } from "../api/types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One plain sentence describing what an import did. */
export function importSummary(results: ImportResult[]): string {
  if (results.length === 0) return "No book files were found there.";
  const count = (outcome: ImportResult["outcome"]) => results.filter((r) => r.outcome === outcome).length;
  const imported = count("imported");
  const already = count("alreadyInLibrary");
  const unsupported = count("unsupported");
  const failed = results.filter((r) => r.outcome === "failed");

  const parts: string[] = [];
  if (imported === 1) {
    const only = results.find((r) => r.outcome === "imported");
    parts.push(`Added “${only && "title" in only ? only.title : "1 book"}”.`);
  } else if (imported > 1) parts.push(`Added ${plural(imported, "book")}.`);
  if (already) parts.push(`${plural(already, "book was", "books were")} already in your library.`);
  if (unsupported) parts.push(`${plural(unsupported, "file isn't a", "files aren't")} supported book format${unsupported === 1 ? "" : "s"}.`);
  if (failed.length === 1 && failed[0].outcome === "failed") parts.push(`One file couldn't be read: ${failed[0].reason}.`);
  else if (failed.length > 1) parts.push(`${failed.length} files couldn't be read.`);
  return parts.join(" ");
}
