import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
}

export type MenuEntry = MenuItem | "divider" | { heading: ReactNode };

/** A button that opens a small dropdown. Closes on outside click or Escape. */
export function Menu({
  trigger,
  label,
  items,
  align = "end",
  className = "icon-btn",
}: {
  trigger: ReactNode;
  label: string;
  items: MenuEntry[];
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    root.current?.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
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
      {open && (
        <div className={`menu menu-${align}`} role="menu" onKeyDown={onKeyDown}>
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
                role="menuitem"
                className={`menu-item${item.danger ? " menu-item-danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.icon && <Icon name={item.icon} size={16} />}
                <span className="menu-label">{item.label}</span>
                {item.hint && <span className="menu-hint">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
