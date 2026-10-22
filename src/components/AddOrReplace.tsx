/** Whether names typed for a list (tags, genres, authors) join what a book has or take its place. */
export type ListMode = "add" | "replace";

export function AddOrReplace({ mode, onChange, label }: { mode: ListMode; onChange: (mode: ListMode) => void; label: string }) {
  return (
    <div className="segmented add-or-replace" role="radiogroup" aria-label={label}>
      {(
        [
          ["add", "Add to them"],
          ["replace", "Replace them"],
        ] as const
      ).map(([m, text]) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onChange(m)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** `names` added to `had`, each once, keeping the spelling already there. */
export function joined(had: string[], names: string[]): string[] {
  const out = [...had];
  for (const n of names) if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  return out;
}
