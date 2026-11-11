export const isYouTube = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
};

export const READ_SELECTION = `(() => JSON.stringify({
  text: String(window.getSelection() || '').trim().slice(0, 16000),
  title: document.title.slice(0, 200),
  url: location.href
}))()`;

const pipVideo = `document.pictureInPictureElement || Array.from(document.querySelectorAll('video'))
  .find(video => video.webkitPresentationMode === 'picture-in-picture')`;

export const HAS_PIP = `JSON.stringify(Boolean(${pipVideo}))`;

// The user clicks in the video document, which supplies the browser's
// required user activation for picture-in-picture.
export const INSTALL_YOUTUBE_PIP = `(() => {
  if (!/(^|\\.)youtube\\.com$/.test(location.hostname) || document.getElementById('tbv-youtube-pip')) return 'null';
  const button = document.createElement('button');
  button.id = 'tbv-youtube-pip';
  button.type = 'button';
  button.textContent = 'Picture-in-picture';
  button.title = 'Picture-in-picture';
  button.style.cssText = 'position:fixed;z-index:2147483646;right:16px;bottom:16px;padding:8px 12px;background:#202020;color:#fff;border:1px solid #777;border-radius:8px;cursor:pointer';
  button.hidden = true;
  const playing = () => Array.from(document.querySelectorAll('video')).find(video => !video.paused && video.videoWidth);
  const supported = video => Boolean(video && (document.pictureInPictureEnabled && video.requestPictureInPicture && !video.disablePictureInPicture
    || video.webkitSupportsPresentationMode?.('picture-in-picture')));
  const update = () => {
    const active = Boolean(${pipVideo});
    button.hidden = !active && !supported(playing());
    button.textContent = active ? 'Exit picture-in-picture' : 'Picture-in-picture';
  };
  button.addEventListener('click', async () => {
    const active = ${pipVideo};
    const video = active || playing();
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (active) video.webkitSetPresentationMode('inline');
      else if (document.pictureInPictureEnabled && video.requestPictureInPicture && !video.disablePictureInPicture)
        await video.requestPictureInPicture();
      else if (video.webkitSupportsPresentationMode?.('picture-in-picture'))
        video.webkitSetPresentationMode('picture-in-picture');
    } catch {
      button.textContent = 'Picture-in-picture unavailable';
      return;
    }
    update();
  });
  for (const event of ['play', 'pause', 'loadedmetadata', 'enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged', 'yt-navigate-finish'])
    document.addEventListener(event, update, true);
  document.body.append(button);
  update();
  return 'null';
})()`;

/** Starts picking parts of the page to remove (src-tauri/src/browser_page_tools.js). */
export const REMOVE_FROM_PAGE = `JSON.stringify(Boolean(window.__tbvPickToRemove && window.__tbvPickToRemove(true)))`;

/** The page's own part of "Copy page report" (browser_page_report.js). */
export const PAGE_REPORT = `(window.__tbvReport ? window.__tbvReport() : JSON.stringify(null))`;
