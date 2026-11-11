// Discover blocks trackers, but many sites only follow a click (a sign-in
// button, a download link) once their tracker says it has counted it. With
// the tracker blocked that answer never comes and the button does nothing.
// This stands in for that answer: if the tracker hasn't answered within a
// moment, the site's own next step runs anyway (once, never twice).
(() => {
  if (window.__tbvStandIns) return;
  window.__tbvStandIns = true;
  const WAIT = 1000;
  /** When the page last told a tracker something (a click counted, say). */
  let counted = 0;
  const once = (fn) => {
    let done = false;
    return function () {
      if (done) return;
      done = true;
      try { return fn.apply(this, arguments); } catch (e) { console.error(e); }
    };
  };
  // An object's callback key is answered later if nothing answers it first.
  const guard = (holder, key) => {
    if (!holder || typeof holder !== 'object' || typeof holder[key] !== 'function') return;
    const answer = once(holder[key]);
    holder[key] = answer;
    setTimeout(answer, WAIT);
  };
  // Google Tag Manager and gtag: dataLayer.push({ eventCallback }) or
  // gtag('event', name, { event_callback }).
  const watchLayer = (layer) => {
    if (!Array.isArray(layer) || layer.__tbv) return layer;
    const push = layer.push;
    Object.defineProperty(layer, '__tbv', { value: true });
    Object.defineProperty(layer, 'push', {
      configurable: true,
      enumerable: false,
      get() { return this.__tbvPush || wrapped; },
      set(next) {
        const replaced = function () { look(arguments); return next.apply(this, arguments); };
        Object.defineProperty(this, '__tbvPush', { value: replaced, configurable: true, writable: true });
      },
    });
    const wrapped = function () { look(arguments); return push.apply(this, arguments); };
    function look(items) {
      counted = Date.now();
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        guard(item, 'eventCallback');
        if (typeof item.length === 'number' && item[0] === 'event') guard(item[2], 'event_callback');
      }
    }
    return layer;
  };
  let layer = watchLayer(window.dataLayer);
  try {
    Object.defineProperty(window, 'dataLayer', {
      configurable: true,
      get() { return layer; },
      set(next) { layer = watchLayer(next); },
    });
  } catch (_) {}
  // Older Google Analytics: ga('send', ..., { hitCallback }).
  const watchGa = (ga) => {
    if (typeof ga !== 'function' || ga.__tbv) return ga;
    const wrapped = function () {
      counted = Date.now();
      for (const arg of arguments) guard(arg, 'hitCallback');
      return ga.apply(this, arguments);
    };
    for (const key of Object.keys(ga)) wrapped[key] = ga[key];
    Object.defineProperty(wrapped, '__tbv', { value: true });
    return wrapped;
  };
  // Any other kind: a link to another site whose click the page took over to
  // tell a tracker, and then never followed. Only when the page did tell a
  // tracker as it was clicked, and nothing else happened after a moment (no new
  // page, pop-up, change of address or dialog), TBV follows it.
  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon;
    navigator.sendBeacon = function () { counted = Date.now(); return beacon.apply(this, arguments); };
  }
  const LINK_WAIT = 1500;
  let opened = 0;
  const open = window.open;
  window.open = function () { opened++; return open.apply(this, arguments); };
  let leaving = 0;
  window.addEventListener('beforeunload', () => { leaving++; }, true);
  window.addEventListener('pagehide', () => { leaving++; }, true);
  document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || link.getAttribute('aria-haspopup') || link.hasAttribute('aria-expanded')) return;
    if (link.target && link.target !== '_self' && link.target !== '_top') return;
    let to;
    try { to = new URL(link.href, location.href); } catch (_) { return; }
    if (!/^https?:$/.test(to.protocol) || to.origin === location.origin) return;
    const clicked = Date.now();
    const before = { href: location.href, opened, leaving };
    // Seen after the page's own handlers have had their turn.
    setTimeout(() => {
      if (!event.defaultPrevented) return;
      setTimeout(() => {
        if (counted < clicked || counted - clicked > 500) return;
        if (location.href !== before.href || opened !== before.opened || leaving !== before.leaving || !link.isConnected) return;
        if (document.querySelector('dialog[open], [aria-modal="true"], [role="dialog"]:not([aria-hidden="true"]), [role="alertdialog"]')) return;
        location.assign(to.href);
      }, LINK_WAIT);
    }, 0);
  }, true);
  let ga = watchGa(window.ga);
  try {
    Object.defineProperty(window, 'ga', {
      configurable: true,
      get() { return ga; },
      set(next) { ga = watchGa(next); },
    });
  } catch (_) {}
})();
