// First, so the splash is up before anything else is drawn.
import "./splash/startup";
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
import "./styles/details.css";
import "./styles/audio.css";
import "./styles/ereaders.css";
import "./styles/web.css";
import "./styles/privacy.css";
import "./styles/writing.css";
import "./styles/catalogs.css";
import "./styles/browse.css";
import "./styles/scribe.css";
import { isApp, isHome, isIOS, isMac, isWeb } from "./api";
import { HomePair } from "./web/HomePair";
import { WebGate } from "./web/WebConnect";
import { runBeforeQuit } from "./lib/beforeQuit";
import { PlayerProvider } from "./audio/player";
import { LicenseProvider } from "./license/License";
import { PublisherProvider } from "./license/Publisher";
import { restorePrivacy } from "./settings/appSettings";

// Covers stay hidden from the very first moment if privacy mode was on.
restorePrivacy();

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

// On the Mac, the window's own red, yellow and green buttons sit at the top of the sidebar.
if (isMac) document.documentElement.classList.add("is-mac-app");

// The iPhone app keeps clear of the notch, and doesn't zoom in when a box is tapped.
if (isIOS) {
  document.documentElement.classList.add("is-ios-app");
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover");
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
        <PlayerProvider>
          {isWeb ? (
            <WebGate>
              <App />
            </WebGate>
          ) : isHome ? (
            <HomePair>
              <App />
            </HomePair>
          ) : (
            <LicenseProvider>
              <PublisherProvider>
                <App />
              </PublisherProvider>
            </LicenseProvider>
          )}
        </PlayerProvider>
      </AppSettingsProvider>
    </ToastProvider>
  </StrictMode>,
);
