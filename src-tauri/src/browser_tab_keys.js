// Tab stays out of sites' text boxes (Preferences › Discover): with it on, a
// site's own search box never hears Tab, so its suggestions can't take the
// word on Tab; Tab just moves on, as it does everywhere else. It runs in every
// frame of a page; TBV puts the starting choice in the line below and changes
// it later through window.__tbvTabKeys.
(() => {
  const ON = false;
  if (window.__tbvTabKeys) return;
  let on = ON;
  window.__tbvTabKeys = (value) => { on = !!value; return 'null'; };
  const typing = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'url', 'email', 'tel', 'number', ''].includes(type);
  };
  // Registered before the page's own listeners, so with it on the page never hears Tab there.
  const quiet = (event) => {
    if (!on || event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    if (typing(target)) event.stopImmediatePropagation();
  };
  for (const kind of ['keydown', 'keypress', 'keyup']) window.addEventListener(kind, quiet, true);
})();
