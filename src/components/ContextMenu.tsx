// The right-click menu. Anything can open one with `openContextMenu`; the one
// host in App draws it where the pointer is, and closes it on a click away,
// Escape, scrolling or resizing, as the "…" menus do.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MenuList, type MenuEntry } from "./Menu";

interface Request {
  x: number;
  y: number;
  label: string;
  items: MenuEntry[];
}

let listener: ((request: Request) => void) | null = null;

/** Opens a menu at the pointer instead of the browser's own. */
export function openContextMenu(e: React.MouseEvent, label: string, items: MenuEntry[]) {
  if (!listener) return;
  e.preventDefault();
  e.stopPropagation();
  listener({ x: e.clientX, y: e.clientY, label, items });
}

export function ContextMenuHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listener = (r) => {
      setPlace({ visibility: "hidden" });
      setRequest(r);
    };
    return () => {
      listener = null;
    };
  }, []);

  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!request || !box) return;
    const margin = 8;
    const left = request.x + box.width > window.innerWidth - margin ? Math.max(margin, request.x - box.width) : request.x;
    const top = request.y + box.height > window.innerHeight - margin ? Math.max(margin, window.innerHeight - margin - box.height) : request.y;
    setPlace({ top, left });
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const shut = () => setRequest(null);
    const away = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) shut();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && shut();
    document.addEventListener("pointerdown", away);
    document.addEventListener("scroll", away, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", shut);
    window.addEventListener("blur", shut);
    menu.current?.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("scroll", away, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", shut);
      window.removeEventListener("blur", shut);
    };
  }, [request]);

  if (!request) return null;
  return createPortal(
    <MenuList ref={menu} label={request.label} items={request.items} style={place} onClose={() => setRequest(null)} />,
    document.body,
  );
}
