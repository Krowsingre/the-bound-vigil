// A page of the Archive on a computer is as many full rows as fit the window
// (embre, 21 November): no fixed 24, and the Pinned and Last read cards count
// inside the page instead of being added on top.
import { useEffect, useState, type RefObject } from "react";
import { pageScroller } from "../lib/pageScroller";
import { PAGE_SIZE } from "./libraryView";

const KEY = "tbv.archive.pageFit.";
const MAX = 200;

function remembered(layout: string): number {
  try {
    const n = Number(localStorage.getItem(KEY + layout));
    return Number.isInteger(n) && n > 0 && n <= MAX ? n : PAGE_SIZE;
  } catch {
    return PAGE_SIZE;
  }
}

function remember(layout: string, n: number) {
  try {
    localStorage.setItem(KEY + layout, String(n));
  } catch {
    // Not kept: the page is measured again next time.
  }
}

/** How many items fill the window in the layout shown under `root`, or null when nothing is there to measure. */
export function measureFit(root: HTMLElement, content: HTMLElement): number | null {
  const box = root.querySelector<HTMLElement>(".book-grid, .book-list, .book-table");
  if (!box) return null;
  let cols = 1;
  let items: HTMLElement[];
  let gap = 0;
  if (box.classList.contains("book-grid")) {
    const style = getComputedStyle(box);
    cols = Math.max(1, style.gridTemplateColumns.split(" ").filter(Boolean).length);
    gap = parseFloat(style.rowGap) || 0;
    items = Array.from(box.children) as HTMLElement[];
  } else if (box.classList.contains("book-table")) {
    items = Array.from(box.querySelectorAll<HTMLElement>("tbody tr"));
  } else {
    items = Array.from(box.children) as HTMLElement[];
  }
  if (!items.length) return null;
  // One row's height with the gap under it, from a row of plain books: the Last read label makes
  // its row taller, and measuring that row would size the first page and the others differently.
  let start = -1;
  for (let i = 0; i < items.length; i += cols) {
    if (!items.slice(i, i + cols).some((item) => item.matches(".is-lead, .pinned-stack, .series-fan, .series-fan-row"))) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const next = items[start + cols];
  const pitch = next
    ? next.getBoundingClientRect().top - items[start].getBoundingClientRect().top
    : Math.max(...items.slice(start, start + cols).map((item) => item.getBoundingClientRect().height)) + gap;
  if (!(pitch > 0)) return null;
  const rows = Math.max(1, Math.floor((content.clientHeight + gap) / pitch));
  // Full rows, with room for at least one book beside the two cards.
  return Math.min(MAX, Math.max(cols * rows, cols * Math.ceil(3 / cols)));
}

/**
 * The page size for a paged Archive: measured from the books shown and the window's height,
 * remembered for each layout so the next visit starts at the right size.
 * `measureKey` changes whenever new books are on screen to measure.
 */
export function usePageFit(root: RefObject<HTMLElement | null>, layout: string, paged: boolean, measureKey: unknown): number {
  const [fit, setFit] = useState(() => remembered(layout));
  useEffect(() => setFit(remembered(layout)), [layout]);
  useEffect(() => {
    if (!paged) return;
    const content = pageScroller(root.current);
    if (!content) return;
    const measure = () => {
      if (!root.current) return;
      const n = measureFit(root.current, content);
      if (n == null) return;
      remember(layout, n);
      setFit(n);
    };
    const frame = requestAnimationFrame(measure);
    let wait: number | undefined;
    const watch = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
        window.clearTimeout(wait);
        wait = window.setTimeout(measure, 150);
      })
      : null;
    watch?.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(wait);
      watch?.disconnect();
    };
  }, [root, layout, paged, measureKey]);
  return fit;
}
