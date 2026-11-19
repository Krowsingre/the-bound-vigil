// Scry's menus in a small window of their own, on the computer (embre, 19
// November). A website in Scry is a separate window laid over TBV's, so a menu
// TBV draws itself sits under it, and the page used to go blank while one was
// open. While Scry is showing a website, its menus (and right-click menus)
// open instead in a little window floating over the page, drawn by menu.html
// (src/menuPopup) and placed by src-tauri/src/menu_popup.rs.

import { isValidElement, type ReactNode } from "react";
import type { IconName } from "./Icon";
import type { MenuEntry, MenuItem } from "./Menu";

/** A menu's items as the menu window gets them: plain words, no actions. */
export type PopupEntry =
  | { kind: "item"; label: string; icon?: IconName; hint?: string; description?: string; disabled?: boolean; danger?: boolean;
      checked?: boolean; excluded?: boolean; indent?: boolean; submenu?: PopupEntry[] }
  | { kind: "divider" }
  | { kind: "heading"; text: string };

export interface PopupMenu {
  label: string;
  items: PopupEntry[];
  /** TBV's look (theme, accent, text size), copied onto the menu window's page. */
  look: { className: string; attributes: Record<string, string>; style: string };
}

export interface PopupRequest {
  id: number;
  menu: PopupMenu;
  x: number;
  y: number;
  width: number;
  height: number;
  align: "start" | "end" | "point";
}

/** A heading's words, from whatever it's drawn with (<strong>Saved sites</strong>). */
export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

export function toPopup(items: MenuEntry[]): PopupEntry[] {
  return items.map((item): PopupEntry => {
    if (item === "divider") return { kind: "divider" };
    if (!("label" in item)) return { kind: "heading", text: textOf(item.heading) };
    return {
      kind: "item",
      label: item.label,
      icon: item.icon,
      hint: item.hint,
      description: item.description,
      disabled: item.disabled,
      danger: item.danger,
      checked: item.checked,
      excluded: item.excluded,
      indent: item.indent,
      submenu: item.submenu ? toPopup(item.submenu) : undefined,
    };
  });
}

/** The item at a place the menu window named (its place, then its place in the submenu). */
export function itemAt(items: MenuEntry[], path: number[]): MenuItem | null {
  let list = items;
  let found: MenuItem | null = null;
  for (const at of path) {
    const item = list[at];
    if (!item || item === "divider" || !("label" in item)) return null;
    found = item;
    list = item.submenu ?? [];
  }
  return found;
}

function look(): PopupMenu["look"] {
  const root = document.documentElement;
  const attributes: Record<string, string> = {};
  for (const { name, value } of Array.from(root.attributes)) {
    if (name !== "class" && name !== "style") attributes[name] = value;
  }
  return { className: root.className, attributes, style: root.getAttribute("style") ?? "" };
}

/** Scry turns this on while it shows a website on the computer. */
let wanted = 0;
export function floatMenus(on: boolean) {
  wanted = Math.max(0, wanted + (on ? 1 : -1));
}
export const menusFloat = () => wanted > 0;

/** The last menu to close, so a click on its own button closes it rather than opening it again. */
let closed = { label: "", at: 0 };
export const justClosed = (label: string) => closed.label === label && Date.now() - closed.at < 400;

let next = 1;
let waiting: { id: number; done: (path: number[] | null) => void } | null = null;
let listening: Promise<void> | null = null;

function listen() {
  listening ??= import("@tauri-apps/api/event").then(({ listen }) =>
    listen<{ id: number; path: number[] | null }>("tbv://menu-popup-chosen", ({ payload }) => {
      if (waiting?.id !== payload.id) return;
      const { done } = waiting;
      waiting = null;
      done(payload.path);
    }).then(() => undefined));
  return listening;
}

/**
 * Opens a menu in the menu window, by the box given (a button's, or the
 * point right-clicked), and runs the item chosen. Resolves once it closes.
 */
export async function openMenuPopup(label: string, items: MenuEntry[], box: { x: number; y: number; width: number; height: number }, align: PopupRequest["align"]): Promise<void> {
  await listen();
  const id = next++;
  // A menu still open closes unchosen.
  waiting?.done(null);
  const path = await new Promise<number[] | null>((done) => {
    waiting = { id, done };
    const request: PopupRequest = { id, menu: { label, items: toPopup(items), look: look() }, ...box, align };
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("menu_popup_open", { request })).catch(() => {
      if (waiting?.id === id) waiting = null;
      done(null);
    });
  });
  closed = { label, at: Date.now() };
  if (path) itemAt(items, path)?.onSelect?.();
}
