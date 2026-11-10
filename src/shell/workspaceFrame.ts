// Each pane has its own document so shortcuts, dialogs, and Reader layout
// follow its viewport. Native commands still belong to the main TBV webview.
export const workspaceFrame = window.frameElement?.getAttribute("data-tbv-workspace") === "secondary";
export const workspaceHost = (workspaceFrame ? window.parent : window) as WorkspaceWindow;

type WorkspaceWindow = Window & {
  __TAURI_INTERNALS__?: object;
  __TAURI_EVENT_PLUGIN_INTERNALS__?: object;
  tbvWorkspace?: {
    open: (route: string) => void;
    flush?: () => Promise<void>;
    dispose?: () => void;
  };
};

if (workspaceFrame) {
  const child = window as WorkspaceWindow;
  const native = workspaceHost.__TAURI_INTERNALS__;
  if (native && !child.__TAURI_INTERNALS__) {
    Object.defineProperty(child, "__TAURI_INTERNALS__", { value: native, configurable: true });
    Object.defineProperty(child, "__TAURI_EVENT_PLUGIN_INTERNALS__", { value: workspaceHost.__TAURI_EVENT_PLUGIN_INTERNALS__, configurable: true });
  }
  document.documentElement.classList.add("tbv-workspace-frame");
  document.documentElement.classList.remove("is-starting");
}
