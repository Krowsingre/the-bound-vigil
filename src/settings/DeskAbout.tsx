// Attunement › Accessibility and About on a computer (embre, 28 November). Accessibility in cards,
// with Windows' own choices (starting with Windows, closing to the tray) beside the shortcuts;
// About: TBV itself and its updates, the plan, and troubleshooting. Phones keep their pages.

import { useEffect, useState } from "react";
import { api, isApp, isWindows, openExternal } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { PRIVACY_POLICY, TERMS, useLicense } from "../license/License";
import type { LicenseView } from "../api/types";
import { useAppSettings } from "./appSettings";
import { AtPage, AtPair, AtRow, AtRows, AtSection, AtSwitch, usePhone } from "./attune";
import { Icon } from "../components/Icon";
import { AtWindow } from "./AtWindow";
import { PlanTab, ShortcutsTab, useLibraryInfo } from "./OtherTabs";
import { canSelfUpdate, useUpdater } from "./updates";

export function DeskAccessibility({ keys }: { keys: boolean }) {
  const { settings, change } = useAppSettings();
  const toast = useToast();
  const [shortcuts, setShortcuts] = useState(false);
  // Read from Windows itself, so it's right even if the entry was removed elsewhere.
  const [startsWithWindows, setStartsWithWindows] = useState(false);
  useEffect(() => {
    if (isWindows) void api.startWithWindows().then(setStartsWithWindows, () => undefined);
  }, []);
  const windows = isWindows && (
    <AtSection id="windows" title="Windows">
      <AtRows>
        <AtSwitch
          label="Start with Windows"
          checked={startsWithWindows}
          onChange={(on) =>
            void api.setStartWithWindows(on).then(
              () => setStartsWithWindows(on),
              (e: unknown) => toast(String(e)),
            )
          }
        />
        <AtSwitch label="Close to system tray" checked={settings.closeToTray} onChange={(closeToTray) => change({ closeToTray })} />
      </AtRows>
    </AtSection>
  );
  const keyboard = keys && (
    <AtSection id="keys" title="Keyboard shortcuts">
      <AtRows>
        <AtRow label="Shortcuts">
          <button type="button" className="btn btn-quiet" onClick={() => setShortcuts(true)}>
            Show…
          </button>
        </AtRow>
      </AtRows>
    </AtSection>
  );
  return (
    <AtPage>
      <AtSection id="vision" title="Seeing and motion">
        <AtRows>
          <AtSwitch label="High contrast" checked={settings.highContrast} onChange={(highContrast) => change({ highContrast })} />
          <AtSwitch label="Focus ring" checked={settings.strongFocus} onChange={(strongFocus) => change({ strongFocus })} />
          <AtSwitch label="Underline links" checked={settings.underlineLinks} onChange={(underlineLinks) => change({ underlineLinks })} />
          <AtSwitch label="Reduce motion" checked={settings.reduceMotion} onChange={(reduceMotion) => change({ reduceMotion })} />
        </AtRows>
      </AtSection>
      {windows && keyboard ? (
        <AtPair>
          {windows}
          {keyboard}
        </AtPair>
      ) : (
        windows || keyboard
      )}
      {shortcuts && (
        <AtWindow title="Keyboard shortcuts" className="shortcuts-sheet" onClose={() => setShortcuts(false)}>
          <ShortcutsTab />
        </AtWindow>
      )}
    </AtPage>
  );
}

/** The open-source work TBV is built on, each with its licence's full text (in public/licences). */
const LICENCES: { name: string; licence: string; file: string }[] = [
  { name: "foliate-js", licence: "MIT", file: "foliate-js" },
  { name: "WordNet 3.1", licence: "WordNet licence", file: "wordnet" },
  { name: "zip.js", licence: "BSD 3-Clause", file: "zipjs" },
  { name: "fflate", licence: "MIT", file: "fflate" },
  { name: "PDF.js", licence: "Apache 2.0", file: "pdfjs" },
  { name: "Readability", licence: "Apache 2.0", file: "readability" },
  { name: "adblock-rust", licence: "MPL 2.0", file: "adblock-rust" },
  { name: "EasyList and EasyPrivacy", licence: "GPLv3 or CC BY-SA 3.0", file: "easylist" },
  { name: "Mammoth", licence: "BSD 2-Clause", file: "mammoth" },
  { name: "Lora", licence: "SIL Open Font License 1.1", file: "lora" },
  { name: "Crimson Pro", licence: "SIL Open Font License 1.1", file: "crimson-pro" },
  { name: "Gelasio", licence: "SIL Open Font License 1.1", file: "gelasio" },
  { name: "Tauri", licence: "MIT or Apache 2.0", file: "tauri" },
  { name: "React", licence: "MIT", file: "react" },
  { name: "citeproc-js", licence: "CPAL 1.0", file: "citeproc-js" },
  { name: "Citation Style Language styles", licence: "CC BY-SA 3.0", file: "csl-styles" },
];

function Licences() {
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const l of LICENCES)
      void fetch(`${import.meta.env.BASE_URL}licences/${l.file}.txt`)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(
          (text) => live && setTexts((t) => ({ ...t, [l.file]: text })),
          () => live && setTexts((t) => ({ ...t, [l.file]: "This licence's text couldn't be read." })),
        );
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="at-licences">
      {LICENCES.map((l) => (
        <section key={l.file} className="at-licence">
          <h3>
            {l.name} <span className="muted">· {l.licence}</span>
          </h3>
          <pre className="at-licence-text">{texts[l.file] ?? "…"}</pre>
        </section>
      ))}
    </div>
  );
}

/** A plan's period in a word or two, for the Plan card. */
function standardPlan(license: LicenseView): string {
  if (license.shop === "android") return "Activated";
  if (license.state === "owned") {
    if (license.plan === "lifetime") return "Lifetime";
    if (license.plan === "yearly") return "Yearly";
    if (license.plan === "monthly") return "Monthly";
    return "Unlocked";
  }
  if (license.state === "trial" && license.trialDays > 0) return license.daysLeft === 1 ? "Trial, 1 day left" : `Trial, ${license.daysLeft} days left`;
  return "Not bought";
}

function publisherPlan(license: LicenseView): string {
  if (!license.publisher) return "Not added";
  if (license.publisherForLife) return "Lifetime";
  if (license.publisherPlan === "yearly") return "Yearly";
  if (license.publisherPlan === "monthly") return "Monthly";
  return "Included";
}

function useVersion() {
  const [version, setVersion] = useState("0.172.0");
  useEffect(() => {
    if (!isApp) return;
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion, () => undefined));
  }, []);
  return version;
}

/** `onOpenPlan`: a phone opens Your plan as its own page from the Plan rows. */
export function DeskAbout({ onOpenPlan }: { onOpenPlan?: () => void } = {}) {
  const phone = usePhone();
  const version = useVersion();
  const { license } = useLicense();
  const info = useLibraryInfo();
  const { reset } = useAppSettings();
  const toast = useToast();
  const [open, setOpen] = useState<"licences" | "plan" | "reset" | null>(null);
  const close = () => setOpen(null);
  const vigil = (
    <AtSection id="about" title="The Bound Vigil" also={["licences"]}>
      <AtRows>
        <AtRow label="Version">
          <span className="at-count">{version}</span>
        </AtRow>
        <AtRow label="Terms of use">
          <button type="button" className="btn btn-quiet" onClick={() => void openExternal(TERMS)}>
            Open
          </button>
        </AtRow>
        <AtRow label="Privacy policy">
          <button type="button" className="btn btn-quiet" onClick={() => void openExternal(PRIVACY_POLICY)}>
            Open
          </button>
        </AtRow>
        <AtRow label="Open-source licences">
          <button type="button" className="btn btn-quiet" onClick={() => setOpen("licences")}>
            Show…
          </button>
        </AtRow>
      </AtRows>
    </AtSection>
  );
  return (
    <AtPage>
      {canSelfUpdate ? (
        <AtPair>
          {vigil}
          <Updates />
        </AtPair>
      ) : (
        vigil
      )}
      {license && (
        <AtSection id="licence" title="Plan" also={["publisher"]}>
          {onOpenPlan ? (
            // Each row opens Your plan (embre, 28 November).
            <AtRows>
              <AtRow label="TBV Standard">
                <button type="button" className="at-ios-value" onClick={onOpenPlan}>
                  <span>{standardPlan(license)}</span>
                  <Icon name="chevronRight" size={16} />
                </button>
              </AtRow>
              <AtRow label="TBV Publisher">
                <button type="button" className="at-ios-value" onClick={onOpenPlan}>
                  <span>{publisherPlan(license)}</span>
                  <Icon name="chevronRight" size={16} />
                </button>
              </AtRow>
            </AtRows>
          ) : (
            <AtRows>
              <AtRow label="TBV Standard">
                <span className="at-count">{standardPlan(license)}</span>
                <button type="button" className="btn btn-quiet" onClick={() => setOpen("plan")}>
                  Your plan…
                </button>
              </AtRow>
              <AtRow label="TBV Publisher">
                <span className="at-count">{publisherPlan(license)}</span>
              </AtRow>
            </AtRows>
          )}
        </AtSection>
      )}
      <AtSection id="trouble" title="Troubleshooting" also={["data", "reset"]}>
        <AtRows>
          {/* The data version is for a future developer mode, not shown to people (embre, 28 November). */}
          {info && !phone && (
            <>
              <AtRow label="Database">
                <code className="path at-path" title={info.database}>
                  {info.database}
                </code>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => (isApp ? api.showFolder(info.database).catch((e: unknown) => toast(String(e))) : toast("This opens File Explorer in the desktop app."))}
                >
                  Show
                </button>
              </AtRow>
            </>
          )}
          <AtRow label="Reset settings">
            <button type="button" className="btn btn-quiet" onClick={() => setOpen("reset")}>
              Reset…
            </button>
          </AtRow>
        </AtRows>
      </AtSection>
      {open === "licences" && (
        <AtWindow title="Open-source licences" className="at-licences-window" onClose={close}>
          <Licences />
        </AtWindow>
      )}
      {open === "plan" && (
        <AtWindow title="Your plan" className="plan-sheet" onClose={close}>
          <PlanTab />
        </AtWindow>
      )}
      {open === "reset" && (
        <ConfirmDialog
          title="Reset settings?"
          body="Theme, scale, accessibility and sync choices go back to how they came. Your library, notes and collections stay as they are."
          confirm="Reset settings"
          onCancel={close}
          onConfirm={() => {
            reset();
            close();
            toast("Settings are back as they came.");
          }}
        />
      )}
    </AtPage>
  );
}

function Updates() {
  const { settings, change } = useAppSettings();
  const { state, check, install } = useUpdater();
  const ready = state.step === "checked" && state.info.version ? state.info : null;
  const status =
    state.step === "checking"
      ? "Checking…"
      : state.step === "installing"
        ? "Installing…"
        : state.step === "checked" && !ready
          ? "Up to date"
          : state.step === "failed"
            ? "Couldn't check"
            : null;
  return (
    <AtSection id="updates" title="Updates">
      <AtRows>
        <AtRow label="Updates">
          {status && <span className="at-count">{status}</span>}
          {ready ? (
            <button type="button" className="btn btn-primary" onClick={() => install(ready)}>
              Install {ready.version}
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" disabled={state.step === "checking" || state.step === "installing"} onClick={check}>
              Check now
            </button>
          )}
        </AtRow>
        <AtSwitch label="Check on open" checked={settings.checkUpdates} onChange={(checkUpdates) => change({ checkUpdates })} />
        <AtSwitch
          label="Auto-install"
          checked={settings.checkUpdates && settings.autoInstallUpdates}
          disabled={!settings.checkUpdates}
          onChange={(autoInstallUpdates) => change({ autoInstallUpdates })}
        />
      </AtRows>
    </AtSection>
  );
}
