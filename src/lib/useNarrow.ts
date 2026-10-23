import { useEffect, useState } from "react";

/** Phones held either way, and tablets (touch screens up to an iPad's width), where the layout folds into one column with the menu of pages sliding in (see styles/web.css). */
export const NARROW = "(max-width: 760px), (pointer: coarse) and (max-width: 1400px)";

export const isNarrow = () => typeof matchMedia === "function" && matchMedia(NARROW).matches;

/** Whether the screen is phone-sized, following it as it turns or resizes. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(NARROW);
    const change = () => setNarrow(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return narrow;
}
