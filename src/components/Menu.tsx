import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

export interface MenuItem {
  label: string;
  id?: string;
  closeAction?: { label: string; run: () => void };
  icon?: IconName;
  hint?: string;
  /** A second, smaller line under the label, with a larger icon beside both. */
  description?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Shown as a tick; the menu stays open so several can be toggled. */
  checked?: boolean;
  /** With `checked`: turned round, so it's left out (shown as a cross). */
  excluded?: boolean;
  onSelect?: () => void;
  submenu?: MenuEntry[];
}

export type MenuEntry = MenuItem | "divider" | { heading: ReactNode };

export const itemMenus = new WeakMap<Element, { label: string; items: MenuEntry[] }>();

/**
 * A button that opens a small dropdown. Closes on outside click or Escape.
 * The dropdown sits on top of the whole window, so a small card or a
 * scrolling row never cuts it off, and it opens upwards or inwards when there
 * isn't room below or to the side.
 */
export function Menu({
  trigger,
  label,
  items,
  align = "end",
  className = "icon-btn",
  menuClassName = "",
}: {
  trigger: ReactNode;
  label: string;
  items: MenuEntry[];
  align?: "start" | "end";
  className?: string;
  /** Extra classes for the dropdown itself. */
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<number | null>(null);
  const group = section === null ? undefined : items[section];
  const submenu = group && typeof group === "object" && "label" in group ? group.submenu : undefined;
  const visible: MenuEntry[] = submenu ? [
    { label: "Back to " + label, icon: "arrowLeft", onSelect: () => setSection(null) },
    "divider",
    ...submenu,
  ] : items;
  const closeMenu = () => { setOpen(false); setSection(null); };
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    itemMenus.set(element, { label, items });
    return () => { itemMenus.delete(element); };
  }, [label, items]);

  useLayoutEffect(() => {
    if (!open) return;
    const button = root.current?.getBoundingClientRect();
    const box = menu.current?.getBoundingClientRect();
    if (!button || !box) return;
    const gap = 6;
    const margin = 8;
    const below = button.bottom + gap;
    const roomBelow = window.innerHeight - margin - below;
    const roomAbove = button.top - gap - margin;
    // Below when it fits, or when there's more room there; a long menu (a big
    // library's genres) then scrolls inside the room it has.
    const goBelow = box.height <= roomBelow || roomBelow >= roomAbove;
    const height = Math.min(box.height, goBelow ? roomBelow : roomAbove);
    const top = goBelow ? below : button.top - gap - height;
    const preferred = align === "end" ? button.right - box.width : button.left;
    const left = Math.max(
      margin,
      Math.min(preferred, window.innerWidth - margin - box.width),
    );
    setPlace({ top: Math.max(margin, top), left, maxHeight: Math.max(120, height) });
  }, [open, align, visible.length, section]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      root.current?.contains(target as Node) ||
      menu.current?.contains(target as Node);
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !inside(e.target))
        closeMenu();
    };
    // The dropdown is pinned to the window, so it closes rather than drift
    // away from its button when the page scrolls or the window changes size.
    const away = (e: Event) => {
      if (!inside(e.target)) closeMenu();
    };
    const shut = closeMenu;
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    document.addEventListener("scroll", away, true);
    window.addEventListener("resize", shut);
    menu.current
      ?.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")
      ?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      document.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", shut);
    };
  }, [open, section]);

  useEffect(() => {
    if (!open) setPlace({ visibility: "hidden" });
  }, [open]);

  return (
    <div className="menu-root" ref={root}>
      <button
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => open ? closeMenu() : setOpen(true)}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <MenuList
            ref={menu}
            label={label}
            items={visible}
            className={menuClassName}
            style={place}
            onClose={closeMenu}
            onSubmenu={submenu ? undefined : setSection}
            back={!!submenu}
          />,
          document.body,
        )}
    </div>
  );
}

/** The dropdown's list itself, for a Menu or a right-click menu. */
export const MenuList = forwardRef<
  HTMLDivElement,
  {
    label: string;
    items: MenuEntry[];
    className?: string;
    style: CSSProperties;
    onClose: () => void;
    onSubmenu?: (index: number) => void;
    back?: boolean;
  }
>(function MenuList({ label, items, className = "", style, onClose, onSubmenu, back }, ref) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".menu-item:not(:disabled)",
      ),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <div
      ref={ref}
      className={`menu menu-floating ${className}`.trim()}
      role="menu"
      aria-label={label}
      style={style}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => {
        if (item !== "divider" && "label" in item) {
          const row = (
            <button
              key={item.id ?? i}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-checked={item.excluded ? "mixed" : item.checked}
              className={`menu-item${item.danger ? " menu-item-danger" : ""}${item.excluded ? " menu-item-excluded" : ""}${item.description ? " has-description" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                if (item.submenu && onSubmenu) {
                  onSubmenu(i);
                  return;
                }
                if (item.checked === undefined && !(back && i === 0)) onClose();
                item.onSelect?.();
              }}
            >
              {item.checked !== undefined ? (
                <span className="menu-check">
                  {item.excluded ? <Icon name="close" size={16} /> : item.checked && <Icon name="check" size={16} />}
                </span>
              ) : (
                item.icon && <Icon name={item.icon} size={item.description ? 24 : 16} />
              )}
              {item.description ? (
                <span className="menu-label">
                  {item.label}
                  <span className="menu-description">{item.description}</span>
                </span>
              ) : (
                <span className="menu-label">{item.label}</span>
              )}
              {item.submenu && <Icon name="chevronRight" size={14} />}
              {(item.excluded ? "Hidden" : item.hint) && <span className="menu-hint">{item.excluded ? "Hidden" : item.hint}</span>}
            </button>
          );
          if (!item.closeAction) return row;
          const action = item.closeAction;
          return <div className="menu-row-action" key={item.id ?? i}>
            {row}
            <button type="button" role="menuitem" className="menu-item menu-row-close" aria-label={action.label} title={action.label}
              onClick={(event) => {
                const row = event.currentTarget.parentElement;
                const next = row?.nextElementSibling ?? row?.previousElementSibling;
                action.run();
                requestAnimationFrame(() => next?.querySelector<HTMLButtonElement>(".menu-row-close, .menu-item")?.focus());
              }}>
              <Icon name="close" size={14} />
            </button>
          </div>;
        }
        return item === "divider"
          ? <div key={i} className="menu-divider" role="separator" />
          : <div key={i} className="menu-heading">{item.heading}</div>;
      })}
    </div>
  );
});
