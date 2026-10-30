// The plagiarism check: the book's passages looked for, word for word, in the
// books of the library on this device. Nothing is sent anywhere.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { CopyMatch, WritingChapter, WritingProject } from "../api/types";
import { bookOrder } from "./epub";
import { isMade, readPage } from "./pages";

/** The pages worth checking, as plain text: quotations and epigraphs are left out, since they're meant to be someone else's words. */
export function writingSections(chapters: WritingChapter[]): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  for (const c of bookOrder(chapters)) {
    if (c.role === "part") continue;
    const page = readPage(c.page, c.role);
    if (isMade(page) || page.kind === "epigraph" || page.kind === "sources") continue;
    const doc = new DOMParser().parseFromString(`<body>${c.body}</body>`, "text/html");
    doc.querySelectorAll("blockquote, aside, [data-footnote]").forEach((el) => el.remove());
    doc.querySelectorAll("p, div, li, h1, h2, h3, br").forEach((el) => el.after("\n"));
    const text = (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").trim();
    if (text) out.push({ title: c.title.trim() || "Untitled page", text });
  }
  return out;
}

export function CopyCheckDialog({ project, onFlush, onClose }: { project: WritingProject; onFlush: () => Promise<WritingChapter[]>; onClose: () => void }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<CopyMatch[] | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    const stop = api.onCopyCheckProgress(setProgress);
    let stale = false;
    running.current = true;
    void (async () => {
      try {
        const sections = writingSections(await onFlush());
        setTitles(sections.map((s) => s.title));
        const result = await api.copyCheck(sections, project.title);
        if (!stale) setFound(result);
      } catch (e) {
        if (!stale) setError(String(e).replace(/^Error: /, ""));
      } finally {
        running.current = false;
      }
    })();
    return () => {
      stale = true;
      stop();
      if (running.current) void api.copyCheckStop();
    };
  }, [project.id]); // Once per opening.

  const words = found?.reduce((n, m) => n + m.words, 0) ?? 0;

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog writing-dialog copy-check" role="dialog" aria-label="Check for copied passages" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>Check for copied passages</h2>
        <p className="muted dialog-lede">
          Looks for passages of twelve words or more that also appear, word for word, in the books in your library on this device. Quotations and epigraphs are left out, and so are copies of this book. Nothing leaves your
          device.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : !found ? (
          <div className="copy-check-progress">
            <progress max={progress?.total || 1} value={progress?.done ?? 0} />
            <span className="muted">{progress ? `Read ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} books` : "Getting the books ready…"}</span>
          </div>
        ) : (
          <>
            <p className={`preflight-summary${found.length ? " is-problem" : " is-ready"}`}>
              {stopping ? "Stopped part-way. " : ""}
              {found.length
                ? `${words.toLocaleString()} words were found in ${found.length} ${found.length === 1 ? "book" : "books"}.`
                : `No passages of twelve words or more were found${progress ? ` in ${progress.done.toLocaleString()} books` : ""}.`}
            </p>
            <ul className="copy-check-list">
              {found.map((m) => (
                <li key={m.bookId}>
                  <div className="copy-check-book">
                    <strong>{m.title}</strong>
                    {m.author && <span className="muted"> by {m.author}</span>}
                    <span className="preflight-for">{m.words.toLocaleString()} words</span>
                  </div>
                  {m.passages.map((p, i) => (
                    <blockquote key={i}>
                      <span className="muted copy-check-where">
                        {titles[p.section] ?? "A page"} · {p.words} words
                      </span>
                      {p.text}
                    </blockquote>
                  ))}
                </li>
              ))}
            </ul>
            {found.length > 0 && <p className="muted writing-export-note">A match can be fine: a common saying, a quotation you've credited, or your own earlier book. Rewrite or credit anything that isn't.</p>}
          </>
        )}
        <div className="dialog-actions">
          {!found && !error && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                void api.copyCheckStop();
              }}
            >
              Stop
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {found || error ? "Done" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
