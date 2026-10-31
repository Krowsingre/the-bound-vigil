// TBV updating itself on a computer. Phones update from their app store.

import { useCallback, useEffect, useState } from "react";
import { api, isApp, isIOS } from "../api";
import type { UpdateInfo, UpdateProgress } from "../api/types";
import { useToast } from "../components/Toast";
import { startupHold, startupSay, stillOpening, UPDATED_KEY } from "../splash/startup";
import { APP_SETTINGS_KEY, parseAppSettings } from "./appSettings";

/** Notes the version being installed, so the splash can say "Updated to …" when TBV opens again. */
function remember(version: string) {
  try {
    localStorage.setItem(UPDATED_KEY, version);
  } catch {
    // It just says Loading… instead.
  }
}

/** Updating happens in the app on a computer only. */
export const canSelfUpdate = (isApp && !isIOS) || api.kind === "preview";

/** How long opening waits to hear whether there's an update to install. */
const LOOK_WAIT = 3000;

/** When TBV opens (if the settings allow): installs a newer version straight
 * away with the splash still up, or says that one is ready. */
export function useStartupUpdateCheck() {
  const toast = useToast();
  useEffect(() => {
    if (!canSelfUpdate) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const say = (info: UpdateInfo | null) =>
      info?.version && toast(`The Bound Vigil ${info.version} is ready. Install it in Preferences › Your plan.`);
    void api.getSetting(APP_SETTINGS_KEY).then((json) => {
      const settings = parseAppSettings(json);
      if (!settings.checkUpdates) return;
      if (settings.autoInstallUpdates && stillOpening()) {
        // Not reaching the update server just means no update this time.
        const looking = api.checkForUpdate().catch(() => undefined);
        // One hold for looking and installing, so the splash can't go in between.
        void startupHold("Looking for updates…", async () => {
          const info = await Promise.race([looking, new Promise<null>((ok) => setTimeout(() => ok(null), LOOK_WAIT))]);
          if (!info?.version) {
            // Too slow to wait for: it's said once it comes.
            if (info === null) void looking.then((late) => late && say(late));
            return;
          }
          const version = info.version;
          remember(version);
          startupSay(`Updating to ${version}…`);
          const stop = api.onUpdateProgress((p) => {
            if (p.total) startupSay(`Updating to ${version}… ${Math.round((p.downloaded / p.total) * 100)}%`);
          });
          // TBV starts again by itself once it's installed.
          await api.installUpdate().finally(stop);
        }).catch((e: unknown) => toast(`The update couldn't be installed: ${String(e)}`));
        return;
      }
      // A little after opening, so it never slows the first screen.
      timer = setTimeout(() => void api.checkForUpdate().then(say, () => undefined), 8000);
    });
    return () => clearTimeout(timer);
  }, [toast]);
}

export type UpdateState =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "checked"; info: UpdateInfo }
  | { step: "installing"; info: UpdateInfo; progress: UpdateProgress | null }
  | { step: "failed"; message: string };

/** Checking and installing, for Preferences › Your plan. */
export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ step: "idle" });
  const check = useCallback(() => {
    setState({ step: "checking" });
    api.checkForUpdate().then(
      (info) => setState({ step: "checked", info }),
      (e: unknown) => setState({ step: "failed", message: String(e) }),
    );
  }, []);
  const install = useCallback((info: UpdateInfo) => {
    setState({ step: "installing", info, progress: null });
    if (info.version) remember(info.version);
    const stop = api.onUpdateProgress((progress) => setState({ step: "installing", info, progress }));
    // TBV starts again by itself once it's installed.
    api.installUpdate().then(stop, (e: unknown) => {
      stop();
      setState({ step: "failed", message: String(e) });
    });
  }, []);
  return { state, check, install };
}
