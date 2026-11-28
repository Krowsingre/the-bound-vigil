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

/** Controls inside a row keep their own clicks; the rest of the row picks it. */
const OWN_CLICKS = "button, a, input, select, textarea, label, [role=menu], [role=menuitem], [contenteditable=true]";

/**
 * A whole row picks its item, not only its checkbox (embre, 28 November):
 * a click anywhere but on a control in it, with Shift for a range. Shift
 * doesn't start a text selection.
 */
export function rowPick(pick: (shift: boolean) => void) {
  const own = (e: { target: EventTarget | null }) => !!(e.target as Element | null)?.closest?.(OWN_CLICKS);
  return {
    onClick: (e: { target: EventTarget | null; shiftKey: boolean }) => {
      if (!own(e)) pick(e.shiftKey);
    },
    onMouseDown: (e: { target: EventTarget | null; shiftKey: boolean; preventDefault: () => void }) => {
      if (e.shiftKey && !own(e)) e.preventDefault();
    },
  };
}

/**
 * For lists of ticks that each mean something (keep this detail, bring in
 * this section): Shift gives every item from the one ticked last the same
 * tick. Returns the items the tick applies to.
 */
export function useTickRange(): (order: readonly string[], id: string, shift: boolean) => string[] {
  const last = useRef<string | null>(null);
  return (order, id, shift) => {
    const from = last.current === null ? -1 : order.indexOf(last.current);
    const to = order.indexOf(id);
    last.current = id;
    if (!shift || from < 0 || to < 0 || from === to) return [id];
    return from < to ? order.slice(from, to + 1) : order.slice(to, from + 1);
  };
}
