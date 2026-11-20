import { useEffect, useState } from "react";
import { isPhone } from "./shortcuts";

/**
 * Room for Quire's three columns (contents, page, tools): a computer, or a
 * tablet such as an iPad held sideways (embre, 18 November). Phones, tablets
 * held upright and windows narrowed past this keep the phone's one column.
 */
const WIDE_ENOUGH = "(min-width: 700px)";
/** A tablet held upright reads as a phone, scaled up (embre, 18 November); held sideways it's laid out as a computer. */
const UPRIGHT_TABLET = "(pointer: coarse) and (orientation: portrait)";

export const sideBySide = () => !isPhone() && typeof matchMedia === "function" && matchMedia(WIDE_ENOUGH).matches && !matchMedia(UPRIGHT_TABLET).matches;

export function useSideBySide(): boolean {
  const [wide, setWide] = useState(sideBySide);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const queries = [matchMedia(WIDE_ENOUGH), matchMedia(UPRIGHT_TABLET)];
    const change = () => setWide(sideBySide());
    queries.forEach((q) => q.addEventListener("change", change));
    window.addEventListener("orientationchange", change);
    return () => {
      queries.forEach((q) => q.removeEventListener("change", change));
      window.removeEventListener("orientationchange", change);
    };
  }, []);
  return wide;
}
