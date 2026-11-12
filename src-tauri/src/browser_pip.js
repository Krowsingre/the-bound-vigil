// Picture in picture for any video: pointing at a video shows a small button
// on it that pops the video out (on a touch screen, tapping a video shows it). It runs in every frame of a page, so a video
// inside an embedded player (a page from another site within the page) gets
// one too, and it finds the video even under a player's own layers. Browsers
// only pop a video out right after a click on its own page, which is why the
// button sits on the video rather than in TBV's toolbar.
(() => {
  if (window.__tbvPip) return;
  window.__tbvPip = true;
  videoReader();
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
        hideTimer = 0;
        aimed = video;
        place(video);
      } else if (aimed && !hideTimer) {
        hideTimer = setTimeout(() => { hideTimer = 0; hide(); }, 1500);
      }
    });
  }, { capture: true, passive: true });
  // A touch screen has no pointing: a tap on a video shows the button for a while.
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || (host && e.composedPath().includes(host))) return;
    const video = videoAt(e.clientX, e.clientY);
    if (!video) return;
    aimed = video;
    place(video);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { hideTimer = 0; hide(); }, 4000);
  }, { capture: true, passive: true });
  addEventListener('scroll', () => aimed && place(aimed), { capture: true, passive: true });
  // On iPhone and iPad, a frame inside the page tells TBV a video started
  // playing in it, so TBV's own button can reach that frame too.
  addEventListener('play', () => {
    try {
      const to = window !== window.top && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tbvPipFrame;
      if (to) to.postMessage(1);
    } catch (_) {}
  }, { capture: true, passive: true });
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
  // largest, if several), or brings back one already popped out (unless
  // onlyPop, when TBV pops a video out as the iPhone leaves the app). TBV calls it
  // in each frame of the page in turn, as if clicked.
  window.__tbvPipNow = async (onlyPop) => {
    const out = popped();
    try {
      if (out && onlyPop) return 'already';
      if (out) {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else out.webkitSetPresentationMode('inline');
        return 'exited';
      }
      const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
      const video = Array.from(document.querySelectorAll('video'))
        .filter((v) => !v.paused && v.readyState >= 2 && v.videoWidth && area(v) > 0)
        .sort((a, b) => area(b) - area(a))[0];
      if (!video) {
        // Frames from the same site share this page's click, so ask them too
        // (frames from other sites are asked by TBV itself).
        for (const frame of document.querySelectorAll('iframe, frame')) {
          try {
            const inner = frame.contentWindow && frame.contentWindow.__tbvPipNow;
            const done = inner ? await inner(onlyPop) : 'none';
            if (done !== 'none') return done;
          } catch (_) {}
        }
        return 'none';
      }
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
  // Video reader view: finds the video playing on the page (or in a page from
  // another site within it) and where it really comes from, so TBV can play it
  // on its own, away from the page's adverts and redirects. A video put
  // together by the page (a "blob:" address) is traced to the stream the page
  // fetched. Frames tell the top page about their videos, since it can't look in.
  function videoReader() {
    if (typeof HTMLVideoElement === 'undefined') return;
    try { performance.setResourceTimingBufferSize(3000); } catch (_) {}
    const STREAM = /\.m3u8(\?|#|$)/i;
    const FILE = /\.(mp4|m4v|webm|mov|ogv)(\?|#|$)/i;
    const DASH = /\.mpd(\?|#|$)/i;
    const area = (v) => { const r = v.getBoundingClientRect(); return Math.round(r.width * r.height); };
    const fetched = () => { try { return performance.getEntriesByType('resource').map((e) => e.name); } catch (_) { return []; } };
    const describe = (v) => {
      let src = v.currentSrc || v.src || (v.querySelector('source[src]') || {}).src || '';
      let kind = STREAM.test(src) ? 'hls' : DASH.test(src) ? 'dash' : 'file';
      if (!/^https?:/i.test(src)) {
        const names = fetched();
        const hls = names.find((n) => STREAM.test(n) && /^https?:/i.test(n));
        const file = names.filter((n) => FILE.test(n) && /^https?:/i.test(n)).pop();
        const dash = names.find((n) => DASH.test(n));
        src = hls || file || '';
        kind = hls ? 'hls' : file ? 'file' : dash ? 'dash' : 'none';
      }
      return { src, kind, title: document.title || '', poster: v.poster || '', page: location.href, playing: !v.paused, area: area(v), time: Math.floor(v.currentTime || 0) };
    };
    const best = () => Array.from(document.querySelectorAll('video'))
      .filter((v) => v.currentSrc || v.src || v.querySelector('source[src]'))
      .sort((a, b) => (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || area(b) - area(a))[0];
    if (window === window.top) {
      const heard = [];
      addEventListener('message', (e) => {
        const info = e.data && e.data.__tbvVideo;
        if (!info || typeof info.src !== 'string' || typeof info.page !== 'string') return;
        const at = heard.findIndex((h) => h.page === info.page);
        if (at >= 0) heard.splice(at, 1);
        heard.push({ src: info.src.slice(0, 4000), kind: String(info.kind), title: String(info.title || '').slice(0, 300), poster: String(info.poster || '').slice(0, 2000), page: info.page.slice(0, 2000), playing: !!info.playing, area: +info.area || 0, time: +info.time || 0, frame: true });
        if (heard.length > 12) heard.shift();
      });
      // The video to show (pausing the page's own when asked), as JSON, or 'none'.
      window.__tbvVideoNow = (pause) => {
        const here = best();
        const all = (here ? [describe(here)] : []).concat(heard);
        const chosen = all.filter((v) => v.kind !== 'none').sort((a, b) => (b.playing ? 1 : 0) - (a.playing ? 1 : 0) || b.area - a.area)[0] || all[0];
        if (!chosen) return 'none';
        if (pause) {
          if (here) here.pause();
          const tell = (w) => { for (let i = 0; i < w.frames.length; i += 1) { try { w.frames[i].postMessage({ __tbvVideoPause: 1 }, '*'); } catch (_) {} } };
          tell(window);
        }
        chosen.title = chosen.frame ? document.title || chosen.title : chosen.title;
        chosen.top = location.href;
        return JSON.stringify(chosen);
      };
    } else {
      let last = 0;
      const report = () => {
        const v = best();
        if (!v) return;
        last = Date.now();
        try { window.top.postMessage({ __tbvVideo: describe(v) }, '*'); } catch (_) {}
      };
      for (const kind of ['play', 'pause', 'loadedmetadata']) addEventListener(kind, report, { capture: true, passive: true });
      addEventListener('timeupdate', () => { if (Date.now() - last > 5000) report(); }, { capture: true, passive: true });
      addEventListener('message', (e) => {
        if (!e.data || !e.data.__tbvVideoPause) return;
        document.querySelectorAll('video').forEach((v) => v.pause());
        for (let i = 0; i < window.frames.length; i += 1) { try { window.frames[i].postMessage({ __tbvVideoPause: 1 }, '*'); } catch (_) {} }
      });
    }
  }
})();
