// The check before uploading, as a window: choose the stores, see what each
// would turn away and what's worth fixing, in plain words.

import { useEffect, useState } from "react";
import type { WritingChapter, WritingProject } from "../api/types";
import { readExport } from "./epub";
import { pagesKey } from "./PaperbackCover";
import { preflight, STORES, type Finding, type Store } from "./preflight";
import { bookInput } from "./WritingDialogs";

const STORES_KEY = "tbv.preflight.stores";

const savedStores = (): Store[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORES_KEY) ?? "null");
    if (Array.isArray(saved)) return STORES.map((s) => s.value).filter((s) => saved.includes(s));
  } catch {
    // The usual stores, then.
  }
  return ["kdp", "apple", "kobo", "bn", "google", "kdpPrint"];
};

const GROUPS: { level: Finding["level"]; title: string; none: string }[] = [
  { level: "problem", title: "Stores would turn these away", none: "Nothing a store would turn away." },
  { level: "warning", title: "Worth fixing", none: "Nothing else to fix." },
  { level: "ok", title: "Checked and fine", none: "" },
];

export function PreflightDialog({ project, onFlush, onClose }: { project: WritingProject; onFlush: () => Promise<WritingChapter[]>; onClose: () => void }) {
  const [stores, setStores] = useState<Store[]>(savedStores);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setFindings(null);
    void (async () => {
      try {
        const chapters = await onFlush();
        const settings = readExport(project.export);
        let pages: number | null = null;
        try {
          pages = Number(localStorage.getItem(pagesKey(project.id))) || null;
        } catch {
          // Not known yet.
        }
        const found = preflight({ book: await bookInput(project, chapters, settings), stores, print: { pages, trim: settings.print.trim } });
        if (!stale) setFindings(found);
      } catch (e) {
        if (!stale) setError(String(e).replace(/^Error: /, ""));
      }
    })();
    return () => void (stale = true);
    // The book is read once per choice of stores.
  }, [stores]);

  const toggle = (store: Store) => {
    const next = stores.includes(store) ? stores.filter((s) => s !== store) : [...stores, store];
    setStores(next);
    try {
      localStorage.setItem(STORES_KEY, JSON.stringify(next));
    } catch {
      // Remembered for this time only.
    }
  };

  const problems = findings?.filter((f) => f.level === "problem").length ?? 0;

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog writing-dialog preflight" role="dialog" aria-label="Check before uploading" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>Check before uploading</h2>
        <p className="muted dialog-lede">Checks the book's pages and links, its details and cover, and each store's own rules, so nothing is turned away after you upload.</p>
        <div className="preflight-stores" role="group" aria-label="Where it's going">
          {STORES.map((s) => (
            <button key={s.value} type="button" className={`chip${stores.includes(s.value) ? " is-active" : ""}`} aria-pressed={stores.includes(s.value)} onClick={() => toggle(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : !findings ? (
          <p className="muted">Checking the book…</p>
        ) : (
          <>
            <p className={`preflight-summary${problems ? " is-problem" : " is-ready"}`}>
              {problems ? `${problems} ${problems === 1 ? "thing needs" : "things need"} fixing before you upload.` : stores.length ? "Ready to upload." : "Choose where the book is going."}
            </p>
            {GROUPS.map((g) => {
              const list = findings.filter((f) => f.level === g.level);
              if (!list.length && !g.none) return null;
              return (
                <section key={g.level} className={`preflight-group is-${g.level}`}>
                  <h3>{g.title}</h3>
                  {!list.length && <p className="muted">{g.none}</p>}
                  <ul>
                    {list.map((f, i) => (
                      <li key={i}>
                        <strong>{f.title}</strong>
                        {f.stores?.length ? <span className="preflight-for">{f.stores.map((s) => STORES.find((x) => x.value === s)!.label).join(" · ")}</span> : null}
                        <p>{f.detail}</p>
                        {f.where?.length ? <p className="muted preflight-where">On: {f.where.slice(0, 8).join(", ")}{f.where.length > 8 ? ` and ${f.where.length - 8} more` : ""}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
