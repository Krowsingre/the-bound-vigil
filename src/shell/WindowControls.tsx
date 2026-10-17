import { useEffect, useState } from "react";
import { isApp, isWeb } from "../api";
import type { Window as AppWindow } from "@tauri-apps/api/window";
import { Icon } from "../components/Icon";
import { runBeforeQuit } from "../lib/beforeQuit";

/** Real minimize / maximize / close buttons, since the window has no system title bar. */
export function WindowControls() {
  const [win, setWin] = useState<AppWindow | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isApp) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      setWin(w);
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => unlisten?.();
  }, []);

  // Quit the whole app rather than only closing the window, so no process is left behind.
  const quit = () => {
    void runBeforeQuit()
      .then(() => import("@tauri-apps/api/core"))
      .then(({ invoke }) => invoke("quit_app"))
      .catch(() => win?.close());
  };

  // A browser tab has its own.
  if (isWeb) return null;
  return (
    <div className="window-controls">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => void win?.minimize()}>
        <Icon name="minimize" size={16} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void win?.toggleMaximize()}
      >
        <Icon name={maximized ? "restore" : "maximize"} size={16} />
      </button>
      <button type="button" className="window-close" aria-label="Close" title="Close" onClick={quit}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
