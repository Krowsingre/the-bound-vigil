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
  const take = (el) => {
    el = box(el);
    if (!el) return false;
    el.style.setProperty('display', 'none', 'important');
    return true;
  };
  window.__tbvRemoveLast = () => take(last);
  // Picking: a box shows what a click takes away; Escape or a right-click ends it.
  let picking = null;
  window.__tbvPickToRemove = (on) => {
    if (!on && picking) return picking(), false;
    if (!on || picking) return !!picking;
    const outline = document.createElement('div');
    outline.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #d26a5c;background:rgb(210 106 92 / 0.15);border-radius:3px;display:none';
    const hint = document.createElement('div');
    hint.textContent = matchMedia('(pointer: coarse)').matches ? 'Tap something to remove it.' : 'Click something to remove it. Press Esc when done.';
    hint.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);padding:8px 14px;border-radius:18px;background:#202020;color:#fff;font:13px system-ui,sans-serif;pointer-events:none';
    document.documentElement.append(outline, hint);
    let under = null;
    const move = (e) => {
      under = box(document.elementFromPoint(e.clientX, e.clientY));
      if (!under) return void (outline.style.display = 'none');
      const r = under.getBoundingClientRect();
      Object.assign(outline.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    };
    const click = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      under = box(document.elementFromPoint(e.clientX, e.clientY)) || under;
      if (under) take(under);
      outline.style.display = 'none';
    };
    const stop = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      e.preventDefault();
      picking();
    };
    addEventListener('mousemove', move, true);
    addEventListener('click', click, true);
    addEventListener('keydown', stop, true);
    addEventListener('contextmenu', stop, true);
    picking = () => {
      removeEventListener('mousemove', move, true);
      removeEventListener('click', click, true);
      removeEventListener('keydown', stop, true);
      removeEventListener('contextmenu', stop, true);
      outline.remove();
      hint.remove();
      picking = null;
    };
    return true;
  };
})();
