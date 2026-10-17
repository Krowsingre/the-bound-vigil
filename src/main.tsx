import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { AppSettingsProvider } from "./settings/AppSettingsProvider";
// Bundled so titles look the same on machines without Georgia.
import "@fontsource/gelasio/400.css";
import "@fontsource/gelasio/400-italic.css";
// The reader's default font, also used to preview it in the text settings.
import "@fontsource/lora/400.css";
// Krowsingre Publishing's own typeface, offered for reading and the interface.
import "./styles/echolume.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/home.css";
import "./styles/library.css";
import "./styles/reader.css";
import "./styles/collections.css";
import "./styles/notes.css";
import "./styles/settings.css";
import "./styles/imports.css";
import "./styles/web.css";
import { isApp, isWeb } from "./api";
import { WebGate } from "./web/WebConnect";
import { runBeforeQuit } from "./lib/beforeQuit";

// Closing the window another way (Alt+F4, the taskbar) asks the page to
// finish saving, then quit.
if (isApp) {
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen("tbv://quit-requested", async () => {
      await runBeforeQuit();
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("quit_app");
    }),
  );
}

// The web version keeps working offline once it has been opened (public/sw.js).
if (isWeb && import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then(() => navigator.serviceWorker.ready)
    .then((ready) => {
      const loaded = performance.getEntriesByType("resource").map((e) => e.name);
      ready.active?.postMessage({ cache: [location.href.split("#")[0], ...loaded] });
    })
    .catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AppSettingsProvider>
        {isWeb ? (
          <WebGate>
            <App />
          </WebGate>
        ) : (
          <App />
        )}
      </AppSettingsProvider>
    </ToastProvider>
  </StrictMode>,
);
