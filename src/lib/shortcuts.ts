// Whether to mention keyboard shortcuts (Ctrl+O, ⌘⇧N, right-click…). One
// check for the whole app, so phones never show them (embre, 17 November):
// - a computer (a mouse or trackpad that can hover): always;
// - phones (a screen under 600 points across): never;
// - a touch tablet such as an iPad: only once a keyboard is plugged in, which
//   shows itself by a key only a real keyboard has (Ctrl, ⌘, Alt, Esc, Tab, the
//   arrows) or by any key pressed outside a text box. It's forgotten when the
//   app restarts, in case the keyboard has gone.

import { useEffect, useState } from "react";

// A phone by its screen, not its window: an iPad in split view or a narrow
// window on a computer is narrow too, but isn't a phone.
const PHONE_SCREEN = 600;
const COMPUTER = "(hover: hover) and (pointer: fine)";
const KEYBOARD_ONLY = new Set(["Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]);

let keyboardSeen = false;
const listeners = new Set<() => void>();
const matches = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;

// Not instanceof: a book's page is another frame, with its own HTMLElement.
const typing = (target: EventTarget | null) => {
  const el = target as Partial<HTMLElement> | null;
  return !!el && (el.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName ?? ""));
};

/** A key that tells a real keyboard is there (an on-screen keyboard only types into text boxes). */
export function fromKeyboard(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target">): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || KEYBOARD_ONLY.has(e.key) || ["Control", "Meta", "Alt"].includes(e.key) || !typing(e.target);
}

export const isPhone = () => typeof screen !== "undefined" && Math.min(screen.width, screen.height) < PHONE_SCREEN;

/** Notes a key press. The window hears its own; a book's page (a frame of its own) passes its keys here. */
export function noteKey(e: KeyboardEvent): void {
  if (keyboardSeen || !fromKeyboard(e)) return;
  keyboardSeen = true;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") window.addEventListener("keydown", noteKey, true);

/** Whether shortcuts may be mentioned right now (see the top of this file). */
export function shortcutsShown(): boolean {
  if (matches(COMPUTER)) return true;
  if (isPhone()) return false;
  return keyboardSeen;
}

/** shortcutsShown, following the screen as it turns and a keyboard as it's plugged in. */
export function useShortcuts(): boolean {
  const [shown, setShown] = useState(shortcutsShown);
  useEffect(() => {
    const update = () => setShown(shortcutsShown());
    listeners.add(update);
    const queries = typeof matchMedia === "function" ? [matchMedia(COMPUTER)] : [];
    queries.forEach((q) => q.addEventListener("change", update));
    update();
    return () => {
      listeners.delete(update);
      queries.forEach((q) => q.removeEventListener("change", update));
    };
  }, []);
  return shown;
}

/** The shortcut when shortcuts are shown, otherwise nothing: for a menu's hint or a button's label. */
export const keyHint = (shown: boolean, keys: string): string | undefined => (shown ? keys : undefined);
