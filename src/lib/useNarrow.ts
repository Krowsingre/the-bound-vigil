import { useEffect, useState } from "react";

/** Phones held either way, and tablets (touch screens up to an iPad's width), where the layout folds into one column with the menu of pages sliding in (see styles/web.css). */
export const NARROW = "(max-width: 760px), (pointer: coarse) and (max-width: 1400px)";

/** iPhone, portrait iPad and a Duo that's closed or upright (embre, 20 November): Covers is an on/off
 *  button and the list is just names. An iPad or open Duo on its side works like a computer here;
 *  a phone on its side is short, so it stays a phone. */
export const PHONE_LIST = "(max-width: 760px), (pointer: coarse) and (max-width: 1400px) and (orientation: portrait), (pointer: coarse) and (max-height: 600px)";

/**
 * The reader's own: phones, and tablets held upright, read as on a phone; a
 * tablet held sideways gets the computer's reader (embre, 18 November). A phone
 * held sideways is short, whatever its width, so it stays a phone.
 */
export const READER_NARROW = "(max-width: 760px), (pointer: coarse) and (max-width: 1400px) and (orientation: portrait), (pointer: coarse) and (max-height: 600px)";

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

/**
 * Scry's toolbar: the phone's row under the address on phones, on an iPad held
 * upright and on the Duo folded; the computer's bar on a computer, on an iPad
 * held sideways and on the Duo open (embre, 19 November). The same lines as
 * the reader's.
 */
export const BROWSER_NARROW = READER_NARROW;
