import { useEffect, useState } from "react";

/** Phones held either way, and tablets (touch screens up to an iPad's width), where the layout folds into one column with the menu of pages sliding in (see styles/web.css). */
export const NARROW = "(max-width: 760px), (pointer: coarse) and (max-width: 1400px)";

/**
 * The reader's own: phones, and tablets held upright, read as on a phone; a
 * tablet held sideways gets the computer's reader (embre, 18 November).
 */
export const READER_NARROW = "(max-width: 760px), (pointer: coarse) and (max-width: 1400px) and (orientation: portrait)";

export const isNarrow = () => typeof matchMedia === "function" && matchMedia(NARROW).matches;

/** Whether the screen is phone-sized, following it as it turns or resizes. */
export function useNarrow(query: string = NARROW): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const watched = matchMedia(query);
    const change = () => setNarrow(watched.matches);
    change();
    watched.addEventListener("change", change);
    return () => watched.removeEventListener("change", change);
  }, [query]);
  return narrow;
}
