// Remove from page: right-click something on a page and take it away (an
// advert, a sign-up box), or pick several in a row. What's removed is
// remembered for the site (in the site's own storage, on this device), so
// reloading or going to its next page keeps it away; ••• › Bring back
// removed things forgets it. Something a site renames on every visit can't
// be recognised again, so it can come back.
(() => {
  if (window.__tbvPageTools) return;
  window.__tbvPageTools = true;
  const KEY = '__tbvRemoved';
  const MOST = 200;
  const remembered = () => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(-MOST) : [];
    } catch (_) {
      return [];
    }
  };
  let hiding = null;
  const hideRemembered = () => {
    const list = remembered();
    if (!list.length && !hiding) return;
    try {
      hiding = hiding || new CSSStyleSheet();
      // One rule each, so a selector the browser can't read loses only itself.
      hiding.replaceSync('');
      for (const sel of list) {
        try { hiding.insertRule(sel + '{display:none!important}', hiding.cssRules.length); } catch (_) {}
      }
      if (!document.adoptedStyleSheets.includes(hiding)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, hiding];
    } catch (_) {}
  };
  hideRemembered();
  // A page that sets its own sheets can drop TBV's; it goes back on.
  addEventListener('DOMContentLoaded', hideRemembered);
  addEventListener('load', hideRemembered);
  // A name worth remembering: not one a site makes up afresh each visit.
  const lasting = (name) => !!name && name.length <= 40 && !/\d{3,}/.test(name)
    && !(/\d/.test(name) && /[A-Z]/.test(name) && /[a-z]/.test(name)) && !/^[a-z0-9]{1,3}$/i.test(name);
  const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch (_) { return Infinity; } };
  const named = (el) => {
    if (el.id && lasting(el.id)) return '#' + CSS.escape(el.id);
    const classes = Array.from(el.classList).filter(lasting).slice(0, 3);
    return classes.length ? el.tagName.toLowerCase() + classes.map((c) => '.' + CSS.escape(c)).join('') : null;
  };
  // A way to find the same thing on the next visit, or null when there isn't a lasting one.
  const selectorFor = (el) => {
    const tag = el.tagName.toLowerCase();
    if (/^(iframe|frame|embed|object)$/.test(tag)) {
      try {
        const from = new URL(el.getAttribute('src') || el.getAttribute('data') || '', location.href);
        if (/^https?:$/.test(from.protocol) && from.host !== location.host) return tag + '[src*="//' + from.host + '/"]';
      } catch (_) {}
    }
    const own = named(el);
    if (own) {
      let sel = own;
      let up = el.parentElement;
      for (let i = 0; i < 3 && count(sel) > 10 && up && up !== document.body; i++, up = up.parentElement) {
        const outer = named(up);
        if (outer) sel = outer + ' ' + sel;
      }
      return count(sel) <= 10 ? sel : null;
    }
    // Nothing lasting on it: its place inside the nearest thing that has a name.
    const steps = [];
    let node = el;
    for (let i = 0; i < 4 && node && node.parentElement && node !== document.body; i++) {
      const parent = node.parentElement;
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      steps.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(node) + 1) + ')');
      const outer = parent === document.body ? 'body' : named(parent);
      if (outer) {
        const sel = outer + ' > ' + steps.join(' > ');
        return count(sel) === 1 ? sel : null;
      }
      node = parent;
    }
    return null;
  };
  const remember = (el) => {
    const sel = selectorFor(el);
    if (!sel) {
      note('remove from page: nothing lasting to know it by, so it may come back');
      return;
    }
    try {
      const list = remembered().filter((x) => x !== sel);
      list.push(sel);
      localStorage.setItem(KEY, JSON.stringify(list.slice(-MOST)));
      hideRemembered();
      note('remove from page: remembered ' + sel);
    } catch (_) {
      note('remove from page: this site does not let TBV remember it');
    }
  };
  // ••• › Bring back removed things: forgets them for this site and shows the page afresh.
  window.__tbvBringBack = () => {
    const had = remembered().length;
    try { localStorage.removeItem(KEY); } catch (_) {}
    if (had) location.reload();
    return had;
  };
  let last = null;
  addEventListener('contextmenu', (e) => { last = e.target; }, true);
  // The whole box the thing sits in, not a word of text inside it.
  const box = (el) => {
    while (el && el.nodeType !== 1) el = el.parentNode;
    // A word or link inside a paragraph means the paragraph; a picture is itself.
    while (el && el.parentElement && el.parentElement !== document.body && !/^(IMG|VIDEO|IFRAME|SVG|CANVAS)$/i.test(el.tagName)
      && getComputedStyle(el).display.startsWith('inline')) el = el.parentElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    return el;
  };
  // Noted in the page report, so a removal that didn't work can be traced.
  const note = (text) => window.__tbvNote && window.__tbvNote(text);
  const describe = (el) => (window.__tbvDescribe ? window.__tbvDescribe(el) : el && el.tagName);
  const take = (el) => {
    const asked = el;
    el = box(el);
    if (!el) {
      note('remove from page: nothing to remove at ' + (asked ? describe(asked) : 'that spot'));
      return false;
    }
    note('remove from page: hid ' + describe(el) + (el.tagName === 'IFRAME' ? ' (a page inside the page)' : ''));
    remember(el);
    el.style.setProperty('display', 'none', 'important');
    return true;
  };
  window.__tbvRemoveLast = () => take(last);
  // A right-click inside a page within the page (a frame: often an invisible
  // layer laid over the site to catch clicks) never reaches this page, so
  // TBV says where it was. The frame itself is what goes. `zoom` is the
  // tab's zoom, which turns the window's measure into the page's.
  window.__tbvRemoveAt = (x, y, zoom) => {
    const frame = /^(IFRAME|FRAME|EMBED|OBJECT)$/;
    const spots = [[x / (zoom || 1), y / (zoom || 1)], [x / devicePixelRatio, y / devicePixelRatio]];
    let found = null;
    for (const [px, py] of spots) {
      const el = document.elementFromPoint(px, py);
      if (el && frame.test(el.tagName)) { found = el; break; }
      if (!found) found = el;
    }
    note('remove from page: the right-click was inside a page within the page');
    return take(found);
  };
  // Picking: a box shows what a click takes away; Escape or a right-click
  // ends it. A clear sheet over the page takes the clicks, so frames laid
  // over the site (which would swallow them) can be picked too.
  let picking = null;
  // While picking, a press on the sheet is TBV's alone: these listeners are
  // set before the page's own scripts run, so they come first, and the page's
  // click catchers (pop-unders) never hear it.
  let onSheet = null;
  for (const kind of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu', 'touchstart', 'touchend']) {
    addEventListener(kind, (e) => {
      if (!onSheet || e.target !== onSheet.sheet) return;
      e.stopImmediatePropagation();
      if (kind === 'contextmenu') return onSheet.stop(e);
      if (kind !== 'touchstart' && kind !== 'pointerdown') e.preventDefault();
      if (kind === 'click') onSheet.click(e);
    }, { capture: true, passive: false });
  }
  window.__tbvPickToRemove = (on) => {
    if (!on && picking) return picking(), false;
    if (!on || picking) return !!picking;
    note('remove from page: picking started');
    const top = 'position:fixed;z-index:2147483647;';
    const sheet = document.createElement('div');
    sheet.style.cssText = top + 'inset:0;cursor:crosshair;background:transparent';
    const outline = document.createElement('div');
    outline.style.cssText = top + 'pointer-events:none;border:2px solid #d26a5c;background:rgb(210 106 92 / 0.15);border-radius:3px;display:none';
    const hint = document.createElement('div');
    hint.textContent = matchMedia('(pointer: coarse)').matches ? 'Tap something to remove it.' : 'Click something to remove it. Press Esc when done.';
    hint.style.cssText = top + 'left:50%;top:12px;transform:translateX(-50%);padding:8px 14px;border-radius:18px;background:#202020;color:#fff;font:13px system-ui,sans-serif;pointer-events:none';
    document.documentElement.append(sheet, outline, hint);
    // What's under the sheet at a spot.
    const under = (x, y) => {
      sheet.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      sheet.style.pointerEvents = '';
      return box(el);
    };
    let aimed = null;
    const show = (el) => {
      if (!el) return void (outline.style.display = 'none');
      const r = el.getBoundingClientRect();
      Object.assign(outline.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    };
    const move = (e) => show((aimed = under(e.clientX, e.clientY)));
    const click = (e) => {
      const el = under(e.clientX, e.clientY) || aimed;
      if (el) take(el);
      else note('remove from page: nothing to remove at that spot');
      show((aimed = under(e.clientX, e.clientY)));
    };
    const stop = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      e.preventDefault();
      picking();
    };
    sheet.addEventListener('mousemove', move);
    onSheet = { sheet, click, stop };
    addEventListener('keydown', stop, true);
    picking = () => {
      removeEventListener('keydown', stop, true);
      onSheet = null;
      sheet.remove();
      outline.remove();
      hint.remove();
      picking = null;
      note('remove from page: picking ended');
    };
    return true;
  };
})();
