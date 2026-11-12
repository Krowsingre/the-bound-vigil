// Each pane has its own document so shortcuts, dialogs, and Reader layout
// follow its viewport. Native commands still belong to the main TBV webview.
export const workspaceFrame = window.frameElement?.getAttribute("data-tbv-workspace") === "secondary";
export const workspaceHost = (workspaceFrame ? window.parent : window);
if (workspaceFrame) {
    const child = window;
    const native = workspaceHost.__TAURI_INTERNALS__;
    if (native && !child.__TAURI_INTERNALS__) {
        Object.defineProperty(child, "__TAURI_INTERNALS__", { value: native, configurable: true });
        Object.defineProperty(child, "__TAURI_EVENT_PLUGIN_INTERNALS__", { value: workspaceHost.__TAURI_EVENT_PLUGIN_INTERNALS__, configurable: true });
    }
    document.documentElement.classList.add("tbv-workspace-frame");
    document.documentElement.classList.remove("is-starting");
}
