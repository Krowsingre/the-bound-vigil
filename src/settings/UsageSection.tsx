// Settings › Sync › Supabase space: how much of the free plan's room TBV is
// using, so a big library doesn't fill it without warning.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { SupabaseUsage, SyncOverview } from "../api/types";
import SETUP_SQL from "../../supabase/setup.sql?raw";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { Section } from "./controls";

/** The free plan's room: 1 GB of files and a 500 MB database. */
export const FREE_FILES = 1024 ** 3;
export const FREE_DATABASE = 500 * 1024 ** 2;

export function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2).replace(/\.?0+$/, "")} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB`;
}

/** The line under each bar. */
export function usageLine(used: number, room: number): string {
  const share = Math.round((used / room) * 100);
  const over = used > room ? " That's over the free plan's room." : share >= 80 ? " That's nearly full." : "";
  return `${size(used)} of ${size(room)} (${share}%).${over}`;
}

/** What the files are, in words. */
export function filesBreakdown(usage: SupabaseUsage): string {
  const parts = [`books ${size(usage.bookBytes)}`];
  if (usage.audioBytes) parts.push(`audiobooks ${size(usage.audioBytes)}`);
  parts.push(`covers and pictures ${size(usage.pictureBytes)}`);
  return `${usage.files.toLocaleString()} files: ${parts.join(", ")}.`;
}

export function UsageSection({ overview }: { overview: SyncOverview }) {
  const toast = useToast();
  const [usage, setUsage] = useState<SupabaseUsage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const signedIn = overview.provider.kind === "supabase" ? !!overview.signedInAs : overview.also?.provider.kind === "supabase";

  const check = async () => {
    setChecking(true);
    setProblem(null);
    try {
      setUsage(await api.supabaseUsage());
    } catch (e) {
      setProblem(String(e));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (signedIn) void check();
  }, [signedIn]);

  if (!signedIn) return null;
  return (
    <Section
      id="usage"
      title="Supabase space"
      lede="How much room TBV is using in your Supabase project, measured against the free plan."
    >
      {usage && (
        <div className="settings-subpanel move-panel usage-panel">
          <p>Files</p>
          <ProgressBar value={usage.fileBytes / FREE_FILES} label={`Files: ${usageLine(usage.fileBytes, FREE_FILES)}`} />
          <p className="settings-row-hint">
            {usageLine(usage.fileBytes, FREE_FILES)} {filesBreakdown(usage)}
          </p>
          <p>Database</p>
          {usage.databaseBytes === null ? (
            <p className="settings-row-hint">
              To see this, run TBV's setup script once more in Supabase's SQL Editor. It's safe to run again and changes nothing
              you've synced.{" "}
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() =>
                  navigator.clipboard.writeText(SETUP_SQL).then(
                    () => toast("Setup script copied. Paste it into Supabase's SQL Editor and press Run."),
                    () => toast("Couldn't copy. The script is supabase/setup.sql in TBV's code."),
                  )
                }
              >
                Copy setup script
              </button>
            </p>
          ) : (
            <>
              <ProgressBar
                value={usage.databaseBytes / FREE_DATABASE}
                label={`Database: ${usageLine(usage.databaseBytes, FREE_DATABASE)}`}
              />
              <p className="settings-row-hint">
                {usageLine(usage.databaseBytes, FREE_DATABASE)} This holds your library's details, progress and notes.
              </p>
            </>
          )}
          <p className="settings-row-hint">
            On Supabase's paid plan the room is much larger (100 GB of files), so these bars only matter on the free plan.
          </p>
        </div>
      )}
      {problem && <p className="settings-row-hint">Couldn't check: {problem}</p>}
      <div className="dialog-actions move-start">
        <button type="button" className="btn btn-quiet" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking Supabase…" : "Check again"}
        </button>
      </div>
    </Section>
  );
}
