// Settings › Sync › Tidy up Supabase: removes Supabase's copies of books that
// aren't on this computer, so a phone shows only those as ready to download.
// Copies the other sync place hasn't got are sent there first.

import { useState } from "react";
import { api, isApp } from "../api";
import type { ProviderView, SyncOverview, TidyPlan, TidyProgress } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { serviceName } from "./SyncFolderPanel";
import { Section } from "./controls";

function size(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

const copies = (n: number) => `${n.toLocaleString()} ${n === 1 ? "copy" : "copies"}`;
const books = (n: number) => `${n.toLocaleString()} ${n === 1 ? "book" : "books"}`;

function placeName(view: ProviderView): string {
  if (view.kind === "folder") return serviceName(view.service);
  if (view.kind === "webdav") return "your WebDAV server";
  return "Supabase";
}

/** What the confirmation says, in plain words. */
export function tidyText(plan: TidyPlan, other: string | null): string {
  const going = plan.remove.length + plan.copyFirst.length + plan.lose.length;
  const one = (n: number, single: string, many: string) => (n === 1 ? single : many);
  const parts = [
    `Supabase has ${books(going)} that ${one(going, "isn't", "aren't")} on this computer${plan.bytes ? ` (${size(plan.bytes)})` : ""}. Their copies there are removed, so your phone shows only the books on this computer as ready to download.`,
  ];
  if (plan.copyFirst.length && other)
    parts.push(
      `${books(plan.copyFirst.length)} ${one(plan.copyFirst.length, "isn't", "aren't")} in ${other} yet, so ${one(plan.copyFirst.length, "it's", "they're")} copied there first.`,
    );
  if (plan.lose.length)
    parts.push(
      `${books(plan.lose.length)} ${one(plan.lose.length, "has", "have")} no other cloud copy. Once removed, ${one(plan.lose.length, "it", "they")} can only be downloaded from a device that still has the file.`,
    );
  parts.push("Every book stays in your library, with its cover, progress and notes.");
  return parts.join(" ");
}

export function TidySection({ overview }: { overview: SyncOverview }) {
  const toast = useToast();
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<TidyProgress | null>(null);

  const main = overview.provider;
  const also = overview.also?.provider ?? null;
  const mainIsSupabase = main.kind === "supabase" && !!overview.signedInAs;
  if (!mainIsSupabase && also?.kind !== "supabase") return null;
  const otherView = mainIsSupabase ? also : main.kind === "off" ? null : main;
  const other = otherView ? placeName(otherView) : null;

  const check = async () => {
    if (!isApp) toast("This is the browser preview: nothing is removed here.");
    setChecking(true);
    try {
      const found = await api.planTidyCloud();
      if (found.remove.length + found.copyFirst.length + found.lose.length === 0)
        toast("Supabase only holds books that are on this computer. There's nothing to tidy.");
      else setPlan(found);
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  const tidy = async () => {
    setPlan(null);
    setProgress({ done: 0, total: 0 });
    try {
      const report = await api.tidyCloud(setProgress);
      const copied = report.copied && other ? ` (${books(report.copied)} copied to ${other} first)` : "";
      const failed = report.failed
        ? ` ${books(report.failed)} couldn't be copied to ${other ?? "the other place"}, so they're still in Supabase.`
        : "";
      toast(`Removed ${copies(report.removed)} from Supabase${copied}.${failed}`);
    } catch (e) {
      toast(`Tidying stopped: ${String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Section
      id="tidy"
      title="Tidy up Supabase"
      lede="Keep only the books on this computer in Supabase, so your phone can download exactly those."
    >
      {progress ? (
        <div className="settings-subpanel move-panel" aria-live="polite">
          <p>Tidying up Supabase…</p>
          <ProgressBar
            value={progress.total ? progress.done / progress.total : 0}
            label={`${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}% done`}
          />
          {progress.total > 0 && (
            <p className="settings-row-hint">
              {progress.done.toLocaleString()} of {copies(progress.total)} done. You can keep reading while this runs.
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="settings-row-hint">
            Removes Supabase's copies of books that aren't on this computer.{" "}
            {other ? `Any that ${other} hasn't got are copied there first.` : "You'll see how many before anything is removed."}
          </p>
          <div className="dialog-actions move-start">
            <button type="button" className="btn btn-quiet" disabled={checking} onClick={() => void check()}>
              {checking ? "Checking Supabase…" : "Tidy up Supabase…"}
            </button>
          </div>
        </>
      )}
      {plan && (
        <ConfirmDialog
          title="Tidy up Supabase?"
          body={tidyText(plan, other)}
          confirm={`Remove ${copies(plan.remove.length + plan.copyFirst.length + plan.lose.length)}`}
          danger
          onCancel={() => setPlan(null)}
          onConfirm={() => void tidy()}
        />
      )}
    </Section>
  );
}
