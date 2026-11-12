// Page report: what the page itself did lately (clicks, where it tried to go,
// windows it asked for, errors), for Discover's "Copy page report". Kept in
// the page only, never sent anywhere; read when the report is copied.
(() => {
  if (window.__tbvReport) return;
  const lines = [];
  const started = Date.now();
  const note = (text) => {
    lines.push(`+${((Date.now() - started) / 1000).toFixed(2)}s ${text}`);
    if (lines.length > 200) lines.shift();
  };
  const short = (value, size = 160) => String(value).replace(/\s+/g, ' ').trim().slice(0, size);
  const describe = (el) => {
    if (!(el instanceof Element)) return String(el);
    const link = el.closest('a[href], button, [role=button], input[type=submit]') || el;
    const tag = link.tagName.toLowerCase();
    const bits = [tag];
    if (link.id) bits.push('#' + link.id);
    if (link.getAttribute('href')) bits.push('href=' + short(link.getAttribute('href'), 240));
    if (link.getAttribute('target')) bits.push('target=' + link.getAttribute('target'));
    if (link.getAttribute('onclick')) bits.push('onclick');
    const text = short(link.textContent || link.value || '', 60);
    if (text) bits.push(`"${text}"`);
    return bits.join(' ');
  };
  window.__tbvReport = () => JSON.stringify({ address: location.href, lines });
  // Other page helpers (Remove from page) note what they did here too.
  window.__tbvNote = note;
  window.__tbvDescribe = describe;
  note('page started ' + location.href);
  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    note('click on ' + describe(event.target));
    setTimeout(() => note('  the page ' + (event.defaultPrevented ? 'took over that click' : 'let that click go ahead')), 0);
  }, true);
  document.addEventListener('submit', (event) => {
    const form = event.target;
    note('form sent to ' + short(form && form.action, 240) + ' (' + ((form && form.method) || 'get') + ')');
    setTimeout(() => event.defaultPrevented && note('  the page took over that form'), 0);
  }, true);
  const open = window.open;
  window.open = function (url, name, features) {
    const got = open.apply(this, arguments);
    note(`page opened a window: ${short(url, 240)} name=${name || ''} features=${features || ''} -> ${got ? 'opened' : 'refused'}`);
    return got;
  };
  for (const kind of ['pushState', 'replaceState']) {
    const original = history[kind];
    history[kind] = function () {
      const out = original.apply(this, arguments);
      note(`page changed its address (${kind}) to ${location.href}`);
      return out;
    };
  }
  addEventListener('beforeunload', () => note('page is leaving'), true);
  addEventListener('error', (e) => {
    if (e.target && e.target !== window && e.target.tagName) note(`couldn't load ${e.target.tagName.toLowerCase()} ${short(e.target.src || e.target.href || '', 240)}`);
    else note('script error: ' + short(e.message) + (e.filename ? ' at ' + short(e.filename, 200) + ':' + e.lineno : ''));
  }, true);
  addEventListener('unhandledrejection', (e) => note('script error (promise): ' + short(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  const consoleError = console.error;
  console.error = function () {
    note('console error: ' + short(Array.from(arguments).map((a) => (a && a.message) || a).join(' '), 300));
    return consoleError.apply(this, arguments);
  };
})();
