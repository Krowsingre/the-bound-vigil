// Preferences › Sync › What's in Supabase: every file TBV keeps there, by type,
// and removing any of them. Tidy up Supabase does the usual clear-out; this
// is for choosing exactly what goes.

import { useMemo, useState } from "react";
import { api, isApp } from "../api";
import type { StoredFile, SyncOverview, TidyProgress } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { Section } from "./controls";
import { size } from "./UsageSection";

const KINDS: { kind: StoredFile["kind"]; label: string }[] = [
  { kind: "ebook", label: "Ebooks" },
  { kind: "document", label: "Documents" },
  { kind: "audiobook", label: "Audiobooks" },
  { kind: "cover", label: "Covers" },
  { kind: "picture", label: "Pictures" },
  { kind: "other", label: "Other files" },
];

/** Rows shown per type before "Show more". */
const PAGE = 200;

const fileCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "file" : "files"}`;
const total = (files: StoredFile[]) => files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
const nameOf = (f: StoredFile) => f.title ?? f.path.split("/").pop() ?? f.path;

/** What the confirmation says, in plain words. */
export function removeText(chosen: StoredFile[]): string {
  const only = chosen.filter((f) => !f.elsewhere && f.kind !== "cover").length;
  const parts = [`${fileCount(chosen.length)} (${size(total(chosen))}) ${chosen.length === 1 ? "is" : "are"} removed from Supabase.`];
  const one = only === 1;
  if (only === chosen.length)
    parts.push(
      `${one ? "It isn't" : "None of them are"} on this computer or in your other sync place, so ${one ? "this is the only copy" : "these are the only copies"}. Once removed, ${one ? "it's" : "they're"} gone for good.`,
    );
  else if (only)
    parts.push(
      `${only.toLocaleString()} of them ${one ? "isn't" : "aren't"} on this computer or in your other sync place, so that copy is the only one. Once removed, ${one ? "it's" : "they're"} gone for good.`,
    );
  parts.push("Your phone can't download a removed book. Every book stays in your library, and sync won't send removed files back.");
  return parts.join(" ");
}

export function ContentsSection({ overview }: { overview: SyncOverview }) {
  const toast = useToast();
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<TidyProgress | null>(null);

  const signedIn = overview.provider.kind === "supabase" ? !!overview.signedInAs : overview.also?.provider.kind === "supabase";
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = (files ?? []).filter((f) => !q || nameOf(f).toLowerCase().includes(q));
    return KINDS.map((k) => ({ ...k, files: matching.filter((f) => f.kind === k.kind) })).filter((g) => g.files.length);
  }, [files, search]);
  if (!signedIn) return null;

  const load = async () => {
    if (!isApp) toast("This is the browser preview: these files are made up.");
    setLoading(true);
    try {
      setFiles(await api.supabaseContents());
      setChosen(new Set());
    } catch (e) {
      toast(`Couldn't look in Supabase: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (paths: string[], on: boolean) =>
    setChosen((c) => {
      const next = new Set(c);
      for (const p of paths) {
        if (on) next.add(p);
        else next.delete(p);
      }
      return next;
    });

  const picked = (files ?? []).filter((f) => chosen.has(f.path));
  const remove = async () => {
    setConfirming(false);
    setProgress({ done: 0, total: picked.length });
    try {
      const report = await api.removeSupabaseFiles(
        picked.map((f) => f.path),
        setProgress,
      );
      toast(
        `Removed ${fileCount(report.removed)} from Supabase.${report.failed ? ` ${fileCount(report.failed)} couldn't be removed; try again later.` : ""}`,
      );
      await load();
    } catch (e) {
      toast(`That didn't finish: ${String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Section
      id="contents"
      title="What's in Supabase"
      lede="Every file TBV keeps in Supabase, by type. Choose any of them to remove."
    >
      {progress ? (
        <div className="settings-subpanel move-panel" aria-live="polite">
          <p>Removing from Supabase…</p>
          <ProgressBar value={progress.total ? progress.done / progress.total : 0} label={`${progress.done} of ${progress.total} removed`} />
        </div>
      ) : files ? (
        <div className="settings-subpanel contents-panel">
          <input
            type="search"
            className="input contents-search"
            placeholder="Find a book…"
            aria-label="Find a book"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {groups.length === 0 && <p className="settings-row-hint">{files.length ? "Nothing matches." : "Supabase holds no files from TBV."}</p>}
          {groups.map((g) => {
            const all = g.files.every((f) => chosen.has(f.path));
            const limit = shown[g.kind] ?? PAGE;
            return (
              <details key={g.kind} className="contents-group">
                <summary>
                  <input
                    type="checkbox"
                    checked={all}
                    aria-label={`Choose all ${g.label.toLowerCase()}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => toggle(g.files.map((f) => f.path), e.target.checked)}
                  />
                  <strong>{g.label}</strong>
                  <span className="muted">
                    {fileCount(g.files.length)} · {size(total(g.files))}
                  </span>
                </summary>
                <ul>
                  {g.files.slice(0, limit).map((f) => (
                    <li key={f.path}>
                      <label>
                        <input type="checkbox" checked={chosen.has(f.path)} onChange={(e) => toggle([f.path], e.target.checked)} />
                        <span className="contents-name" title={f.path}>
                          {nameOf(f)}
                        </span>
                        {!f.elsewhere && f.kind !== "cover" && <span className="contents-only">Only copy</span>}
                        <span className="muted">{f.bytes === null ? "" : size(f.bytes)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {g.files.length > limit && (
                  <button type="button" className="view-all" onClick={() => setShown((s) => ({ ...s, [g.kind]: limit + PAGE }))}>
                    Show more ({(g.files.length - limit).toLocaleString()} left)
                  </button>
                )}
              </details>
            );
          })}
          <div className="dialog-actions">
            <span className="muted">
              {picked.length ? `${fileCount(picked.length)} chosen (${size(total(picked))})` : "Nothing chosen"}
            </span>
            <button type="button" className="btn btn-quiet" disabled={loading} onClick={() => void load()}>
              {loading ? "Looking…" : "Look again"}
            </button>
            <button type="button" className="btn btn-danger" disabled={!picked.length} onClick={() => setConfirming(true)}>
              Remove from Supabase…
            </button>
          </div>
        </div>
      ) : (
        <div className="dialog-actions move-start">
          <button type="button" className="btn btn-quiet" disabled={loading} onClick={() => void load()}>
            {loading ? "Looking in Supabase…" : "Show what's in Supabase"}
          </button>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title="Remove from Supabase?"
          body={removeText(picked)}
          confirm={`Remove ${fileCount(picked.length)}`}
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      )}
    </Section>
  );
}
