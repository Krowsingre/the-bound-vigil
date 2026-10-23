// Preferences › Sync › Tidy up Supabase: removes Supabase's copies of books that
// aren't on this computer, so a phone shows only those as ready to download.
// Copies the other sync place hasn't got are sent there first.

import { useState } from "react";
import { api, isApp } from "../api";
import type { ProviderView, SyncOverview, TidyPlan, TidyProgress } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { serviceName } from "./SyncFolderPanel";
import { useAppSettings } from "./appSettings";
import { Section } from "./controls";

function size(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

const copies = (n: number) => `${n.toLocaleString()} ${n === 1 ? "copy" : "copies"}`;
const files = (n: number) => `${n.toLocaleString()} ${n === 1 ? "file" : "files"}`;
const books = (n: number) => `${n.toLocaleString()} ${n === 1 ? "book" : "books"}`;

function placeName(view: ProviderView): string {
  if (view.kind === "folder") return serviceName(view.service);
  if (view.kind === "webdav") return "your WebDAV server";
  return "Supabase";
}

/** What the confirmation says, in plain words. */
export function tidyText(plan: TidyPlan, other: string | null, chosenOnly = false): string {
  const going = plan.remove.length + plan.copyFirst.length + plan.lose.length;
  const one = (n: number, single: string, many: string) => (n === 1 ? single : many);
  const covers = plan.covers.length;
  const room = plan.bytes ? ` (${size(plan.bytes)} in all)` : "";
  const parts = going
    ? [
        chosenOnly
          ? `Supabase has ${books(going)} that ${one(going, "wasn't", "weren't")} chosen for your phone${room}. Their copies there are removed, so your phone shows only the chosen books as ready to download. Books your phone has downloaded, or added, stay.`
          : `Supabase has ${books(going)} that ${one(going, "isn't", "aren't")} on this computer${room}. Their copies there are removed, so your phone shows only the books on this computer as ready to download. Books your phone has downloaded, or added, stay.`,
      ]
    : [];
  if (covers)
    parts.push(
      `${covers.toLocaleString()} ${one(covers, "cover belongs to a book", "covers belong to books")} whose file isn't kept in Supabase${going ? "" : room}, so ${one(covers, "it's", "they're")} removed there too. This computer keeps every cover.`,
    );
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
  const { settings } = useAppSettings();
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
      if (found.remove.length + found.copyFirst.length + found.lose.length + found.covers.length === 0)
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
            Removes Supabase's copies of books that aren't on this computer, and the covers of books whose file isn't kept there.{" "}
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
          body={tidyText(plan, other, settings.sync.phoneChosenOnly)}
          confirm={`Remove ${files(plan.remove.length + plan.copyFirst.length + plan.lose.length + plan.covers.length)}`}
          danger
          onCancel={() => setPlan(null)}
          onConfirm={() => void tidy()}
        />
      )}
    </Section>
  );
}
