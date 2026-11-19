// The menu window's page (see src/components/menuPopups.ts and
// src-tauri/src/menu_popup.rs): it draws the menu TBV's page asked for, in
// TBV's own look, tells the app its size so the window fits it, and says
// which item was chosen. A submenu opens in its place, as in TBV's menus.

import "@fontsource/gelasio/400.css";
import "../styles/echolume.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/shell.css";
import "./menuPopup.css";
import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MenuList, type MenuEntry } from "../components/Menu";
import type { PopupEntry, PopupRequest } from "../components/menuPopups";

function choose(id: number, path: number[] | null) {
  void invoke("menu_popup_choose", { id, path });
}

/** The menu's items, each saying where it is when chosen. */
function entries(items: PopupEntry[], id: number, path: number[], open: (path: number[]) => void): MenuEntry[] {
  return items.map((item, at): MenuEntry => {
    if (item.kind === "divider") return "divider";
    if (item.kind === "heading") return { heading: item.text };
    const here = [...path, at];
    return {
      ...item,
      // The window opens the submenu itself, in place.
      submenu: undefined,
      onSelect: item.submenu?.length ? () => open(here) : () => choose(id, here),
    };
  });
}

function PopupMenu() {
  const [request, setRequest] = useState<PopupRequest | null>(null);
  const [section, setSection] = useState<number[]>([]);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void invoke<PopupRequest | null>("menu_popup_request").then((r) => r && setRequest(r));
    const stop = listen<PopupRequest>("tbv://menu-popup-request", ({ payload }) => setRequest(payload));
    return () => void stop.then((unlisten) => unlisten());
  }, []);
  useEffect(() => setSection([]), [request?.id]);

  // TBV's look, then the window fits the menu.
  useLayoutEffect(() => {
    if (!request) return;
    const root = document.documentElement;
    const { look } = request.menu;
    root.className = look.className;
    for (const [name, value] of Object.entries(look.attributes)) root.setAttribute(name, value);
    root.setAttribute("style", look.style);
    const element = list.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    void invoke("menu_popup_fit", { id: request.id, width: Math.ceil(box.width), height: Math.ceil(Math.min(box.height, screen.availHeight - 16)) });
    element.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus({ preventScroll: true });
  }, [request, section]);

  useEffect(() => {
    if (!request) return;
    const escape = (e: KeyboardEvent) => e.key === "Escape" && (section.length ? setSection(section.slice(0, -1)) : choose(request.id, null));
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [request, section]);

  if (!request) return null;
  let items = request.menu.items;
  let label = request.menu.label;
  for (const at of section) {
    const item = items[at];
    if (item?.kind !== "item" || !item.submenu) break;
    label = item.label;
    items = item.submenu;
  }
  const shown = entries(items, request.id, section, setSection);
  const back: MenuEntry[] = section.length ? [
    { label: "Back to " + request.menu.label, icon: "arrowLeft", onSelect: () => setSection(section.slice(0, -1)) },
    "divider",
  ] : [];
  return (
    <MenuList ref={list} label={label} items={[...back, ...shown]} className="menu-in-popup" style={{}} onClose={() => undefined} back={section.length > 0} />
  );
}

createRoot(document.getElementById("menu")!).render(
  <StrictMode>
    <PopupMenu />
  </StrictMode>,
);
