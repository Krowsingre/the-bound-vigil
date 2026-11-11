import { isApp, openExternal } from "../api";

/**
 * In TBV's own screens, a link meant for a new window (or Ctrl/Shift-clicked)
 * opens in the computer's browser. Discover's pages handle their own links.
 */
export function sendOutsideLinksOut() {
  if (!isApp) return;
  window.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey) return;
    const link = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!link?.href || (link.target !== "_blank" && !event.ctrlKey && !event.shiftKey)) return;
    if (!/^(https?|mailto|tel):/i.test(link.href)) return;
    event.preventDefault();
    void openExternal(link.href).catch(() => undefined);
  });
}
