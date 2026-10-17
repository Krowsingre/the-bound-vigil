import {
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
  icon?: IconName;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Shown as a tick; the menu stays open so several can be toggled. */
  checked?: boolean;
  onSelect?: () => void;
}

export type MenuEntry = MenuItem | "divider" | { heading: ReactNode };

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
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const button = root.current?.getBoundingClientRect();
    const box = menu.current?.getBoundingClientRect();
    if (!button || !box) return;
    const gap = 6;
    const margin = 8;
    const below = button.bottom + gap;
    const top =
      below + box.height <= window.innerHeight - margin ||
      button.top - gap - box.height < margin
        ? below
        : button.top - gap - box.height;
    const preferred = align === "end" ? button.right - box.width : button.left;
    const left = Math.max(
      margin,
      Math.min(preferred, window.innerWidth - margin - box.width),
    );
    setPlace({ top: Math.max(margin, top), left });
  }, [open, align, items.length]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      root.current?.contains(target as Node) ||
      menu.current?.contains(target as Node);
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !inside(e.target))
        setOpen(false);
    };
    // The dropdown is pinned to the window, so it closes rather than drift
    // away from its button when the page scrolls or the window changes size.
    const away = (e: Event) => {
      if (!inside(e.target)) setOpen(false);
    };
    const shut = () => setOpen(false);
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
  }, [open]);

  useEffect(() => {
    if (!open) setPlace({ visibility: "hidden" });
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(
        ".menu-item:not(:disabled)",
      ) ?? []),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div className="menu-root" ref={root}>
      <button
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className={`menu menu-floating ${menuClassName}`.trim()}
            role="menu"
            aria-label={label}
            style={place}
            onKeyDown={onKeyDown}
          >
            {items.map((item, i) =>
              item === "divider" ? (
                <div key={i} className="menu-divider" role="separator" />
              ) : "heading" in item ? (
                <div key={i} className="menu-heading">
                  {item.heading}
                </div>
              ) : (
                <button
                  key={i}
                  type="button"
                  role={
                    item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                  }
                  aria-checked={item.checked}
                  className={`menu-item${item.danger ? " menu-item-danger" : ""}`}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.checked === undefined) setOpen(false);
                    item.onSelect?.();
                  }}
                >
                  {item.checked !== undefined ? (
                    <span className="menu-check">
                      {item.checked && <Icon name="check" size={16} />}
                    </span>
                  ) : (
                    item.icon && <Icon name={item.icon} size={16} />
                  )}
                  <span className="menu-label">{item.label}</span>
                  {item.hint && <span className="menu-hint">{item.hint}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
