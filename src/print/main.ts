// The page that lays a book out for printing. In the app it runs in a window
// of its own (src-tauri/src/print.rs): it asks for the book, lays it out and
// says how many pages it made, and the app saves it as a PDF (Windows) or
// opens the print dialog (Mac). In a browser, the page that opened it hands
// over the book, and the browser's own print dialog opens.

import "./print.css";
import { layOut } from "./layout";

const status = document.createElement("p");
status.className = "print-status";
status.textContent = "Laying out the pages…";
document.body.append(status);
const counting = (n: number) => (status.textContent = `Laying out the pages… ${n}`);

async function inApp() {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const html = await invoke<string>("print_job");
    const pages = await layOut(html, counting);
    status.remove();
    await invoke("print_laid_out", { pages, error: null });
  } catch (e) {
    await invoke("print_laid_out", { pages: 0, error: String(e) });
  }
}

function inBrowser() {
  const print = (html: string) =>
    void layOut(html, counting).then((pages) => {
      status.remove();
      document.body.dataset.pages = String(pages);
      window.opener?.postMessage({ kind: "tbv-print-done", pages }, location.origin);
      if (!new URLSearchParams(location.search).has("noprint")) window.print();
    });
  window.addEventListener("message", (e: MessageEvent<{ kind?: string; html?: string }>) => {
    if (e.origin === location.origin && e.data?.kind === "tbv-print-job" && e.data.html) print(e.data.html);
  });
  if (window.opener) window.opener.postMessage({ kind: "tbv-print-ready" }, location.origin);
  else {
    // Opened on its own (as the tests do): the book waits in this tab's storage.
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem("tbv.print.job");
    } catch {
      // Nothing to lay out, then.
    }
    if (saved) print(saved);
  }
}

if ("__TAURI_INTERNALS__" in window) void inApp();
else inBrowser();
