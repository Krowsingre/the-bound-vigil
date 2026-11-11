// Discover blocks trackers, but many sites only follow a click (a sign-in
// button, a download link) once their tracker says it has counted it. With
// the tracker blocked that answer never comes and the button does nothing.
// This stands in for that answer: if the tracker hasn't answered within a
// moment, the site's own next step runs anyway (once, never twice).
(() => {
  if (window.__tbvStandIns) return;
  window.__tbvStandIns = true;
  const WAIT = 1000;
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
      for (const arg of arguments) guard(arg, 'hitCallback');
      return ga.apply(this, arguments);
    };
    for (const key of Object.keys(ga)) wrapped[key] = ga[key];
    Object.defineProperty(wrapped, '__tbv', { value: true });
    return wrapped;
  };
  let ga = watchGa(window.ga);
  try {
    Object.defineProperty(window, 'ga', {
      configurable: true,
      get() { return ga; },
      set(next) { ga = watchGa(next); },
    });
  } catch (_) {}
})();
