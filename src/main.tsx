import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
// Bundled so titles look the same on machines without Georgia.
import "@fontsource/gelasio/400.css";
import "@fontsource/gelasio/400-italic.css";
// The reader's default font, also used to preview it in the text settings.
import "@fontsource/lora/400.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/home.css";
import "./styles/library.css";
import "./styles/reader.css";
import "./styles/collections.css";
import { isApp } from "./api";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
