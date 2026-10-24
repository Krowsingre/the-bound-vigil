// TBV updating itself on a computer. Phones update from their app store.

import { useCallback, useEffect, useState } from "react";
import { api, isApp, isIOS } from "../api";
import type { UpdateInfo, UpdateProgress } from "../api/types";
import { useToast } from "../components/Toast";
import { APP_SETTINGS_KEY, parseAppSettings } from "./appSettings";

/** Updating happens in the app on a computer only. */
export const canSelfUpdate = (isApp && !isIOS) || api.kind === "preview";

/** Says once, when TBV opens, that a newer version is ready (if the setting allows). */
export function useStartupUpdateCheck() {
  const toast = useToast();
  useEffect(() => {
    if (!canSelfUpdate) return;
    // A little after opening, so it never slows the first screen.
    const timer = setTimeout(() => {
      void api
        .getSetting(APP_SETTINGS_KEY)
        .then((json) => (parseAppSettings(json).checkUpdates ? api.checkForUpdate() : null))
        .then((info) => info?.version && toast(`The Bound Vigil ${info.version} is ready. Install it in Preferences › About.`))
        .catch(() => undefined);
    }, 8000);
    return () => clearTimeout(timer);
  }, [toast]);
}

export type UpdateState =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "checked"; info: UpdateInfo }
  | { step: "installing"; info: UpdateInfo; progress: UpdateProgress | null }
  | { step: "failed"; message: string };

/** Checking and installing, for Preferences › About. */
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
    const stop = api.onUpdateProgress((progress) => setState({ step: "installing", info, progress }));
    // TBV starts again by itself once it's installed.
    api.installUpdate().then(stop, (e: unknown) => {
      stop();
      setState({ step: "failed", message: String(e) });
    });
  }, []);
  return { state, check, install };
}
