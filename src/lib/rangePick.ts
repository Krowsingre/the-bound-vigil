// Shift-click picks every item between the one clicked last and this one,
// as anywhere else (embre, 28 November). Without Shift, a click flips one.

import { useRef } from "react";

/** Whether Shift was held for a click, or a checkbox's change from one. */
export const withShift = (e: { nativeEvent: Event }) => (e.nativeEvent as MouseEvent).shiftKey === true;

/** Picks with Shift for a range. `order` is the items as shown. */
export function useRangePick(): (chosen: ReadonlySet<string>, order: readonly string[], id: string, shift: boolean) => Set<string> {
  const last = useRef<string | null>(null);
  return (chosen, order, id, shift) => {
    const next = new Set(chosen);
    const from = last.current === null ? -1 : order.indexOf(last.current);
    const to = order.indexOf(id);
    if (shift && from >= 0 && to >= 0 && from !== to) {
      const [a, b] = from < to ? [from, to] : [to, from];
      for (let i = a; i <= b; i++) next.add(order[i]);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    last.current = id;
    return next;
  };
}
