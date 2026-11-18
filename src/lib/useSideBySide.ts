import { useEffect, useState } from "react";
import { isPhone } from "./shortcuts";

/**
 * Room for Scribe's three columns (contents, page, tools): a computer, or a
 * tablet such as an iPad, which follows the computer's layout (embre,
 * 18 November). Phones, and windows narrowed past this, keep one column.
 */
const WIDE_ENOUGH = "(min-width: 700px)";

export const sideBySide = () => !isPhone() && typeof matchMedia === "function" && matchMedia(WIDE_ENOUGH).matches;

export function useSideBySide(): boolean {
  const [wide, setWide] = useState(sideBySide);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(WIDE_ENOUGH);
    const change = () => setWide(sideBySide());
    query.addEventListener("change", change);
    window.addEventListener("orientationchange", change);
    return () => {
      query.removeEventListener("change", change);
      window.removeEventListener("orientationchange", change);
    };
  }, []);
  return wide;
}
