// Keep videos playing in the background (Preferences › Discover): with it on,
// a page is never told it went out of sight when TBV is minimized or the
// screen locks, which is what most sites pause on. A video the page or the
// browser paused just as TBV went out of sight is started again. It runs in
// every frame of a page; TBV puts the starting choice in the line below and
// changes it later through window.__tbvKeepPlaying.
(() => {
  const ON = false;
  if (window.__tbvKeepPlaying) return;
  let on = ON;
  window.__tbvKeepPlaying = (value) => { on = !!value; return 'null'; };
  const proto = Document.prototype;
  const real = (name) => Object.getOwnPropertyDescriptor(proto, name);
  const hidden = real('hidden');
  const state = real('visibilityState');
  const webkitHidden = real('webkitHidden');
  const reallyHidden = (doc) => { try { return hidden ? hidden.get.call(doc) : false; } catch (_) { return false; } };
  const swap = (name, d, shown) => {
    if (!d || !d.get || !d.configurable) return;
    try {
      Object.defineProperty(proto, name, { configurable: true, enumerable: d.enumerable, get() { return on ? shown : d.get.call(this); } });
    } catch (_) {}
  };
  swap('hidden', hidden, false);
  swap('visibilityState', state, 'visible');
  swap('webkitHidden', webkitHidden, false);
  // When TBV last went out of sight, so a pause straight after is undone.
  let wentAt = 0;
  // Registered before the page's own listeners, so with it on the page never hears these.
  for (const kind of ['visibilitychange', 'webkitvisibilitychange', 'freeze']) {
    window.addEventListener(kind, (e) => {
      if (kind !== 'freeze' && reallyHidden(document)) wentAt = Date.now();
      if (on) e.stopImmediatePropagation();
    }, true);
  }
  // A pause the person asks for (from the lock screen, say) comes later than this.
  window.addEventListener('pause', (e) => {
    const media = e.target;
    if (!on || !(media instanceof HTMLMediaElement) || media.ended) return;
    if (!reallyHidden(document) || Date.now() - wentAt > 1500) return;
    setTimeout(() => { media.play().catch(() => {}); }, 0);
  }, true);
})();
