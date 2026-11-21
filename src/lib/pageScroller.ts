/**
 * The element a page scrolls in: the window's content area, or on a computer
 * Resonance's book column, which scrolls by itself beside its side bar so the
 * two never show scroll bars side by side (embre, 21 November).
 */
export function pageScroller(from?: Element | null): HTMLElement | null {
  const inside = from?.closest<HTMLElement>(".page-scroll, .content");
  if (inside) return inside;
  const content = document.querySelector<HTMLElement>(".workspace-content > .content") ?? document.querySelector<HTMLElement>(".content");
  return content?.querySelector<HTMLElement>(".page-scroll") ?? content;
}
