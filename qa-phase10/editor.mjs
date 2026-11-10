const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const end = Date.now() + 15000;
let page;
while (!page && Date.now() < end) {
  try {
    const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
    page = targets.find((target) => target.type === "page" && target.url.includes("tauri.localhost"));
  } catch {}
  if (!page) await sleep(100);
}
if (!page) throw new Error("Could not reach TBV webview");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let seq = 0;
async function send(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id !== id) return;
      ws.removeEventListener("message", listener);
      if (reply.error || reply.result?.exceptionDetails) reject(JSON.stringify(reply));
      else resolve(reply.result);
    };
    ws.addEventListener("message", listener);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function waitFor(expression) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const reply = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (reply.result.value) return;
    await sleep(100);
  }
  throw new Error("Could not find UI: " + expression);
}
try {
  if (process.argv[2] === "open") {
    await waitFor("(() => { const b = [...document.querySelectorAll('button.nav-item')].find(b => b.textContent.includes('Scribe')); if (!b) return false; b.click(); return true; })()");
    await waitFor("(() => { const b = [...document.querySelectorAll('button[role=tab]')].find(b => b.textContent.includes('Write a book')); if (!b) return false; b.click(); return true; })()");
    await waitFor("(() => { const b = [...document.querySelectorAll('.scribe-book-open')].find(b => b.textContent.includes('Shutdown Probe')); if (!b) return false; b.click(); return true; })()");
    await waitFor("!!document.querySelector('.writing-page[contenteditable=true]')");
  } else {
    await waitFor("(() => { const editor = document.querySelector('.writing-page[contenteditable=true]'); if (!editor) return false; editor.focus(); getSelection().selectAllChildren(editor); getSelection().collapseToEnd(); return true; })()");
    await send("Input.insertText", { text: " saved on close" });
    await waitFor("document.querySelector('.writing-page').textContent.includes('saved on close')");
  }
} finally {
  ws.close();
}
