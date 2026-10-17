import { useEffect, useState } from "react";

/** Phone-sized screens, where the layout folds into one column (see styles/web.css). */
export const NARROW = "(max-width: 760px)";

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
