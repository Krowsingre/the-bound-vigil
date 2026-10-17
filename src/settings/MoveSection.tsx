// Settings › Sync: moving the library to another cloud service, or keeping
// a copy there. A short wizard (what to do, where, set it up, which books),
// then progress, then the check that nothing was missed. The copying runs in
// the background in the desktop app, so TBV can be used meanwhile.

import { useEffect, useState } from "react";
import { api, isApp } from "../api";
import { MOVE_DESKTOP_ONLY } from "../api/moveStub";
import type { MoveMode, MoveScope, MoveStatus, ProviderChoice, ProviderView, SupabaseProject, SyncOverview } from "../api/types";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { useAppSettings } from "./appSettings";
import { RadioList, Section } from "./controls";
import { PROVIDERS, type Provider } from "./providers";
import { SignInForm, SupabaseProjectForm } from "./SupabaseSetup";
import { serviceName, SyncFolderPanel, type FolderService } from "./SyncFolderPanel";

type Step = "mode" | "where" | "setup" | "scope";
const STEPS: Step[] = ["mode", "where", "setup", "scope"];

const NOWHERE: ProviderView = { kind: "off", service: null, location: null, username: null };

/** A service in words, as it fits in a sentence: "Dropbox", "your WebDAV server". */
export function placeName(view: ProviderView | null): string {
  if (!view || view.kind === "off") return "nowhere yet";
  if (view.kind === "supabase") return "Supabase";
  if (view.kind === "webdav") return "your WebDAV server";
  return view.service && view.service !== "custom" ? serviceName(view.service) : "that folder";
}

const STAGE_TEXT: Record<MoveStatus["progress"]["stage"], string> = {
  looking: "Looking at what to copy…",
  records: "Copying your progress, notes and collections…",
  files: "Copying books and covers…",
  checking: "Checking nothing was missed…",
};

const SCOPE_TEXT: Record<MoveScope, string> = { all: "everything", text: "your books and documents", audio: "your audiobooks" };

export function MoveSection({
  overview,
  inUse,
  onChanged,
}: {
  overview: SyncOverview | null;
  inUse: Provider | null;
  onChanged: () => unknown;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<MoveStatus | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [mode, setMode] = useState<MoveMode>("migrate");
  const [where, setWhere] = useState<Provider | null>(null);
  const [target, setTarget] = useState<ProviderChoice | null>(null);
  const [scope, setScope] = useState<MoveScope>("all");
  const [project, setProject] = useState<SupabaseProject | null>(null);
  const [anotherProject, setAnotherProject] = useState(false);

  const { changeSync } = useAppSettings();
  useEffect(() => {
    void api.moveStatus().then(setStatus, () => undefined);
    return api.onMove((s) => {
      setStatus(s);
      if (!s.switched) return;
      // The app turned off sending the files of books left behind; keep that here too.
      if (s.scope === "text") changeSync({ audioFiles: false });
      if (s.scope === "audio") changeSync({ bookFiles: false });
      onChanged();
    });
  }, [onChanged, changeSync]);

  const current = overview?.provider ?? NOWHERE;
  const from = placeName(inUse ? current : null);
  const reset = () => {
    setStep(null);
    setWhere(null);
    setTarget(null);
    setProject(null);
    setAnotherProject(false);
    setScope("all");
  };
  const act = (work: Promise<unknown>) => void work.catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));

  // Signed in to Supabase already, but syncing elsewhere: that sign-in can be the destination.
  const savedSupabase =
    !anotherProject && current.kind !== "supabase" && overview?.signedInAs && overview.project ? overview.signedInAs : null;

  const body = (() => {
    if (!status) return null;
    if (status.running) {
      const { stage, done, total } = status.progress;
      return (
        <div className="settings-subpanel move-panel" aria-live="polite">
          <h3>
            {status.mode === "migrate" ? "Moving" : "Copying"} {SCOPE_TEXT[status.scope]} to {placeName(status.to)}
          </h3>
          <p>{STAGE_TEXT[stage]}</p>
          <ProgressBar
            value={total ? done / total : stage === "checking" ? 1 : 0}
            label={`${total ? Math.round((done / total) * 100) : 0}% copied`}
          />
          <p className="settings-row-hint">
            {total > 0 && stage !== "looking" ? `${done} of ${total} copied. ` : ""}
            You can keep reading while this runs. It carries on from where it got to if you stop it and start again.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={() => act(api.cancelMove())}>
              <Icon name="stop" size={16} /> Stop
            </button>
          </div>
        </div>
      );
    }
    if (status.report || status.error)
      return <MoveResult status={status} onDone={() => (reset(), act(api.clearMove()))} onAgain={() => act(api.retryMove())} />;
    if (!step) {
      return (
        <div className="dialog-actions move-start">
          <button type="button" className="btn btn-primary" onClick={() => setStep("mode")}>
            <Icon name="upload" size={16} /> Move or back up…
          </button>
        </div>
      );
    }

    const n = STEPS.indexOf(step) + 1;
    const back = () => setStep(STEPS[n - 2] ?? null);
    return (
      <div className="settings-subpanel move-panel">
        <p className="move-step">Step {n} of 4</p>
        {step === "mode" && (
          <>
            <h3>What would you like to do?</h3>
            <RadioList<MoveMode>
              label="Move or back up"
              value={mode}
              options={[
                {
                  value: "migrate",
                  label: "Move my library",
                  hint: "Copy everything to a new service, check it all arrived, then sync there instead.",
                },
                {
                  value: "backup",
                  label: "Keep a copy there",
                  hint: `Copy everything to another service as a backup, and keep syncing through ${from === "nowhere yet" ? "this computer" : from}.`,
                },
              ]}
              onChange={setMode}
            />
          </>
        )}
        {step === "where" && (
          <>
            <h3>{mode === "migrate" ? "Where should your library go?" : "Where should the copy go?"}</h3>
            <div className="provider-cards" role="radiogroup" aria-label="Where to">
              {PROVIDERS.map((p) => {
                const here = p.id === inUse && p.id !== "custom" && p.id !== "supabase";
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={where === p.id}
                    disabled={here}
                    className={`provider-card${where === p.id ? " is-active" : ""}`}
                    onClick={() => setWhere(p.id)}
                  >
                    <span className="provider-art">{p.art}</span>
                    <span className="provider-text">
                      <span className="settings-row-label">{p.name}</span>
                      <span className="settings-row-hint">
                        {here
                          ? "Your library is here now"
                          : p.id === "supabase"
                            ? "Your own Supabase project"
                            : p.id === "custom"
                              ? "A folder or WebDAV"
                              : "Uses its app's folder"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {step === "setup" && where === "supabase" && (
          <>
            {status.supabaseAccount || savedSupabase ? (
              <div className="account-panel">
                <h3>Supabase is ready</h3>
                <p className="account-line">
                  <Icon name="check" size={16} /> Signed in as <strong>{status.supabaseAccount ?? savedSupabase}</strong>
                </p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => (setAnotherProject(true), setProject(null), act(api.moveSignOut()))}
                  >
                    Use another project
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => (setTarget({ kind: "supabase" }), setStep("scope"))}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : !project ? (
              <SupabaseProjectForm
                initial={current.kind === "supabase" ? null : (overview?.project ?? null)}
                saveLabel="Next"
                onSave={setProject}
              />
            ) : (
              <SignInForm
                title="Sign in to your new project"
                onSignIn={(email, password, create) => api.moveSignIn(project, email, password, create)}
                onDone={() => (setTarget({ kind: "supabase" }), setStep("scope"))}
              />
            )}
          </>
        )}
        {step === "setup" && where && where !== "supabase" && (
          <SyncFolderPanel
            key={where}
            service={where as FolderService}
            current={NOWHERE}
            onChanged={() => undefined}
            useLabel="Next"
            onUse={(choice) => (setTarget(choice), setStep("scope"))}
          />
        )}
        {step === "scope" && (
          <>
            <h3>Which books?</h3>
            <RadioList<MoveScope>
              label="Which books"
              value={scope}
              options={[
                {
                  value: "all",
                  label: "All",
                  hint: "Every book, document and audiobook, with your progress, notes and collections.",
                },
                { value: "text", label: "Text only", hint: "Books and documents." },
                {
                  value: "audio",
                  label: "Audio only",
                  hint: status.audioReady ? "Audiobooks." : "Arrives with audiobooks.",
                  disabled: !status.audioReady,
                },
              ]}
              onChange={setScope}
            />
            <p className="settings-row-hint">
              {mode === "migrate"
                ? `TBV copies ${SCOPE_TEXT[scope]} to ${placeName(target && viewOf(target))}, checks it all arrived, and only then syncs there. Until then, nothing changes.`
                : `TBV copies ${SCOPE_TEXT[scope]} to ${placeName(target && viewOf(target))}. Sync carries on as it is.`}{" "}
              Books only in the cloud are copied too, without being kept on this computer.
            </p>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => (n === 1 ? reset() : back())}>
            {n === 1 ? "Cancel" : "Back"}
          </button>
          {(step === "mode" || step === "where") && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={step === "where" && !where}
              onClick={() => setStep(STEPS[n])}
            >
              Next
            </button>
          )}
          {step === "scope" && target && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => act(api.startMove(mode, scope, target).then(() => setStep(null)))}
            >
              {mode === "migrate" ? "Start moving" : "Start copying"}
            </button>
          )}
        </div>
      </div>
    );
  })();

  return (
    <Section
      id="move"
      title="Move or back up your library"
      lede="Copy your whole library to another cloud service, to move there or to keep a spare copy."
    >
      {!isApp && <p className="settings-row-hint">{MOVE_DESKTOP_ONLY}</p>}
      {body}
    </Section>
  );
}

function viewOf(choice: ProviderChoice): ProviderView {
  if (choice.kind === "folder") return { kind: "folder", service: choice.service, location: choice.path, username: null };
  if (choice.kind === "webdav") return { kind: "webdav", service: null, location: choice.url, username: choice.username };
  return { kind: choice.kind, service: null, location: null, username: null };
}

function MoveResult({ status, onDone, onAgain }: { status: MoveStatus; onDone: () => void; onAgain: () => void }) {
  const to = placeName(status.to);
  const from = placeName(status.from);
  const report = status.report;
  const check = report?.check ?? null;
  const migrate = status.mode === "migrate";
  const passed = !!check && check.missing.length === 0 && check.moreMissing === 0;

  let title: string;
  let words: string;
  let again: string | null = null;
  if (status.error || !report) {
    title = "That didn't finish";
    words = `${status.error ?? "Something went wrong."} ${migrate ? `Your library still syncs through ${from}.` : ""}`;
    again = "Try again";
  } else if (report.cancelled) {
    title = "Stopped";
    words = `What was copied stays in ${to}. Start again to carry on from where it got to.${migrate ? ` Your library still syncs through ${from}.` : ""}`;
    again = "Carry on";
  } else if (passed) {
    title = migrate ? "Your library has moved" : "Your copy is complete";
    words = migrate
      ? status.switched
        ? `Everything arrived in ${to}, and your library syncs there from now on. Nothing was deleted from ${from}.`
        : `Everything arrived in ${to}.`
      : `Everything arrived in ${to}. Your library still syncs through ${from}.`;
  } else {
    title = `Some things didn't make it to ${to}`;
    words = migrate ? `So TBV hasn't switched over: your library still syncs through ${from}.` : "The rest of the copy is there.";
    again = "Try the missing ones again";
  }

  return (
    <div className="settings-subpanel move-panel" role="status">
      <h3>
        <Icon name={passed ? "check" : "warning"} size={18} /> {title}
      </h3>
      <p>{words}</p>
      {report && !report.cancelled && (
        <dl className="move-numbers">
          <dt>Copied</dt>
          <dd>
            {report.recordsCopied} {report.recordsCopied === 1 ? "item" : "items"} and {report.filesCopied}{" "}
            {report.filesCopied === 1 ? "file" : "files"}
          </dd>
          <dt>Already there</dt>
          <dd>{report.alreadyThere}</dd>
          {check && (
            <>
              <dt>Checked</dt>
              <dd>
                {check.recordsFound} of {check.records} items and {check.filesFound} of {check.files} files are there
              </dd>
            </>
          )}
        </dl>
      )}
      {check && check.missing.length > 0 && (
        <>
          <h4>Not there yet</h4>
          <ul className="move-missing">
            {check.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
            {check.moreMissing > 0 && <li>…and {check.moreMissing} more</li>}
          </ul>
        </>
      )}
      {check && check.notes.length > 0 && (
        <ul className="move-notes settings-row-hint">
          {check.notes.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" className={again ? "btn btn-quiet" : "btn btn-primary"} onClick={onDone}>
          Done
        </button>
        {again && (
          <button type="button" className="btn btn-primary" onClick={onAgain}>
            {again}
          </button>
        )}
      </div>
    </div>
  );
}
