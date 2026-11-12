// Picture in picture for any video: pointing at a video shows a small button
// on it that pops the video out. It runs in every frame of a page, so a video
// inside an embedded player (a page from another site within the page) gets
// one too, and it finds the video even under a player's own layers. Browsers
// only pop a video out right after a click on its own page, which is why the
// button sits on the video rather than in TBV's toolbar.
(() => {
  if (window.__tbvPip) return;
  window.__tbvPip = true;
  const supported = () => document.pictureInPictureEnabled !== undefined || 'webkitSetPresentationMode' in HTMLVideoElement.prototype;
  if (typeof HTMLVideoElement === 'undefined' || !supported()) return;
  let host = null;
  let button = null;
  let aimed = null;
  let hideTimer = 0;
  const popped = () => document.pictureInPictureElement || Array.from(document.querySelectorAll('video')).find((v) => v.webkitPresentationMode === 'picture-in-picture');
  const make = () => {
    if (host) return;
    host = document.createElement('tbv-pip');
    host.style.cssText = 'position:fixed;z-index:2147483647;display:none;top:0;left:0';
    const root = host.attachShadow({ mode: 'closed' });
    button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'all:initial;font:600 12px system-ui,sans-serif;color:#fff;background:rgb(20 20 20 / 0.82);border:1px solid rgb(255 255 255 / 0.35);border-radius:14px;padding:5px 10px;cursor:pointer;white-space:nowrap';
    root.append(button);
  };
  const place = (video) => {
    make();
    if (!host.isConnected) document.documentElement.append(host);
    const r = video.getBoundingClientRect();
    button.textContent = popped() === video ? 'Exit picture in picture' : 'Picture in picture';
    host.style.display = 'block';
    const width = button.offsetWidth || 130;
    host.style.left = Math.max(4, Math.min(innerWidth - width - 4, r.right - width - 10)) + 'px';
    host.style.top = Math.max(4, r.top + 10) + 'px';
  };
  const hide = () => {
    if (host) host.style.display = 'none';
    aimed = null;
  };
  // The video at a spot, even with a player's controls or a clear layer over it.
  const videoAt = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el instanceof HTMLVideoElement) {
        const r = el.getBoundingClientRect();
        return r.width >= 160 && r.height >= 90 ? el : null;
      }
    }
    return null;
  };
  let pending = false;
  addEventListener('pointermove', (e) => {
    if (pending || (host && e.composedPath().includes(host))) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const video = videoAt(e.clientX, e.clientY);
      if (video) {
        clearTimeout(hideTimer);
        aimed = video;
        place(video);
      } else if (aimed && !hideTimer) {
        hideTimer = setTimeout(() => { hideTimer = 0; hide(); }, 1500);
      }
    });
  }, { capture: true, passive: true });
  addEventListener('scroll', () => aimed && place(aimed), { capture: true, passive: true });
  const toggle = async () => {
    const video = aimed;
    if (!video) return;
    try {
      const out = popped();
      if (out && document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (out) out.webkitSetPresentationMode('inline');
      if (out === video) return void place(video);
      // A player may switch picture in picture off; this is the reader's choice.
      video.disablePictureInPicture = false;
      video.removeAttribute('disablepictureinpicture');
      if (video.requestPictureInPicture) await video.requestPictureInPicture();
      else video.webkitSetPresentationMode('picture-in-picture');
      place(video);
    } catch (e) {
      button.textContent = 'Not possible for this video';
      window.__tbvNote && window.__tbvNote('picture in picture refused: ' + String(e && e.message || e).slice(0, 160));
    }
  };
  // Discover's Picture in picture button: pops out the video playing here (the
  // largest, if several), or brings back one already popped out. TBV calls it
  // in each frame of the page in turn, as if clicked.
  window.__tbvPipNow = async () => {
    const out = popped();
    try {
      if (out) {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else out.webkitSetPresentationMode('inline');
        return 'exited';
      }
      const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
      const video = Array.from(document.querySelectorAll('video'))
        .filter((v) => !v.paused && v.readyState >= 2 && v.videoWidth && area(v) > 0)
        .sort((a, b) => area(b) - area(a))[0];
      if (!video) return 'none';
      video.disablePictureInPicture = false;
      video.removeAttribute('disablepictureinpicture');
      if (video.requestPictureInPicture) await video.requestPictureInPicture();
      else video.webkitSetPresentationMode('picture-in-picture');
      return 'popped';
    } catch (e) {
      window.__tbvNote && window.__tbvNote('picture in picture refused: ' + String(e && e.message || e).slice(0, 160));
      return 'refused';
    }
  };
  // The button's presses are TBV's alone: these listeners come before the
  // page's own, so a player (or a click catcher) never hears them.
  for (const kind of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchend']) {
    addEventListener(kind, (e) => {
      if (!host || !e.composedPath().includes(host)) return;
      e.stopImmediatePropagation();
      if (kind !== 'touchstart' && kind !== 'pointerdown') e.preventDefault();
      if (kind === 'click') void toggle();
    }, { capture: true, passive: false });
  }
})();
