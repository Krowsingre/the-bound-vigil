// Printing a book from a browser (the web version and the preview): the print
// page opens in a tab of its own, lays the book out and opens the browser's
// print dialog, where "Save as PDF" is.

export function printInBrowser(html: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tab = window.open("/print.html", "_blank");
    if (!tab) return reject(new Error("Your browser blocked the print tab. Allow pop-ups for this page and try again."));
    const heard = (e: MessageEvent<{ kind?: string; pages?: number }>) => {
      if (e.origin !== location.origin || e.source !== tab) return;
      if (e.data?.kind === "tbv-print-ready") tab.postMessage({ kind: "tbv-print-job", html }, location.origin);
      else if (e.data?.kind === "tbv-print-done") {
        window.removeEventListener("message", heard);
        resolve(e.data.pages ?? 0);
      }
    };
    window.addEventListener("message", heard);
  });
}
