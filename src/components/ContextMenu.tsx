// The right-click menu. Anything can open one with `openContextMenu`; the one
// host in App draws it where the pointer is, and closes it on a click away,
// Escape, scrolling or resizing, as the "…" menus do.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { itemMenus, MenuList, type MenuEntry } from "./Menu";

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

/** Opens a menu at a point, for one whose items arrive after the click (the browser's Back list). */
export function openContextMenuAt(x: number, y: number, label: string, items: MenuEntry[]) {
  listener?.({ x, y, label, items });
}

let held: { timer: number; x: number; y: number } | null = null;
/** A press that opened a menu doesn't also click what was under the finger. */
let swallowClickUntil = 0;

const letGo = () => {
  if (held) window.clearTimeout(held.timer);
  held = null;
};

/** Holding a finger on something opens its menu, as a right-click does
 *  (iPhone has no right-click). Spread onto the element. */
export function holdForMenu(label: string, items: () => MenuEntry[]) {
  return {
    "data-hold": "",
    onTouchStart: (e: React.TouchEvent) => {
      letGo();
      if (e.touches.length !== 1) return;
      const { clientX: x, clientY: y } = e.touches[0];
      held = {
        x,
        y,
        timer: window.setTimeout(() => {
          held = null;
          swallowClickUntil = Date.now() + 800;
          navigator.vibrate?.(10);
          listener?.({ x, y, label, items: items() });
        }, 500),
      };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (held && t && Math.hypot(t.clientX - held.x, t.clientY - held.y) > 10) letGo();
    },
    onTouchEnd: letGo,
    onTouchCancel: letGo,
    onClickCapture: (e: React.MouseEvent) => {
      if (Date.now() < swallowClickUntil) {
        swallowClickUntil = 0;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      // A phone that has its own long-press menu event: one menu, not two.
      letGo();
      openContextMenu(e, label, items());
    },
  };
}

export function ContextMenuHost() {
  const [section, setSection] = useState<number | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
  const menu = useRef<HTMLDivElement>(null);
  const sizedRequest = useRef<Request | null>(null);

  useEffect(() => {
    listener = (r) => {
      setPlace({ visibility: "hidden" });
      setSection(null);
      setRequest(r);
    };
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    const ownerSelector = "[data-item-menu], li, tr, article";
    const fromItem = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      if (event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=menu]")) return;
      const owner = event.target.closest(ownerSelector);
      if (!owner) return;
      const roots = [...owner.querySelectorAll(".menu-root")].filter((root) => root.closest(ownerSelector) === owner);
      const target = event.target.closest(".menu-root");
      const root = target && roots.includes(target) ? target : roots.length === 1 ? roots[0] : null;
      const request = root && itemMenus.get(root);
      if (!request?.items.length) return;
      event.preventDefault();
      letGo();
      const bounds = owner.getBoundingClientRect();
      const keyboard = event.clientX === 0 && event.clientY === 0;
      openContextMenuAt(keyboard ? bounds.left : event.clientX, keyboard ? bounds.bottom : event.clientY, request.label, request.items);
    };
    document.addEventListener("contextmenu", fromItem);
    return () => document.removeEventListener("contextmenu", fromItem);
  }, []);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!request || !element) return;
    if (sizedRequest.current === request) {
      element.scrollTop = 0;
      return;
    }
    const box = element.getBoundingClientRect();
    const margin = 8;
    const left = request.x + box.width > window.innerWidth - margin ? Math.max(margin, request.x - box.width) : request.x;
    const top = request.y + box.height > window.innerHeight - margin ? Math.max(margin, window.innerHeight - margin - box.height) : request.y;
    const stable = request.items.some((item) => typeof item === "object" && "submenu" in item && item.submenu?.length);
    sizedRequest.current = stable ? request : null;
    setPlace({ top, left, ...(stable ? { width: box.width, height: box.height } : {}) });
  }, [request, section]);

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
    menu.current?.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("scroll", away, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", shut);
      window.removeEventListener("blur", shut);
    };
  }, [request, section]);

  if (!request) return null;
  const group = section === null ? undefined : request.items[section];
  const submenu = group && typeof group === "object" && "label" in group ? group.submenu : undefined;
  const items: MenuEntry[] = submenu
    ? [{ label: "Back to book menu", icon: "arrowLeft", onSelect: () => setSection(null) }, "divider", ...submenu]
    : request.items;
  return createPortal(
    <MenuList ref={menu} label={request.label} items={items} back={!!submenu} onSubmenu={submenu ? undefined : setSection} style={place} onClose={() => setRequest(null)} />,
    document.body,
  );
}
