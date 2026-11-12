// Remove from page: right-click something on a page and take it away (an
// advert, a sign-up box), or pick several in a row. Only this view of the
// page changes; reloading brings everything back.
(() => {
  if (window.__tbvPageTools) return;
  window.__tbvPageTools = true;
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
    el.style.setProperty('display', 'none', 'important');
    note('remove from page: hid ' + describe(el) + (el.tagName === 'IFRAME' ? ' (a page inside the page)' : ''));
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
