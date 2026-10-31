// A small round ⓘ beside a field's label that shows a note: on hover with a
// mouse, on a tap or click anywhere, and from the keyboard (Enter or Space,
// Escape closes). It never blocks the field or asks for anything.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export function InfoTip({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState<"hover" | "pinned" | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const leaving = useRef<number | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const at = button.current.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 32);
    const left = Math.max(16, Math.min(at.left - 12, window.innerWidth - width - 16));
    const below = at.bottom + 8;
    const height = panel.current?.offsetHeight ?? 260;
    const top = below + height > window.innerHeight - 16 ? Math.max(16, at.top - 8 - height) : below;
    setPlace({ top, left, width });
  }, [open]);

  useEffect(() => {
    if (open !== "pinned") return;
    const away = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(null);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const stay = () => {
    if (leaving.current) window.clearTimeout(leaving.current);
    leaving.current = null;
  };
  const leave = () => {
    stay();
    leaving.current = window.setTimeout(() => setOpen((o) => (o === "hover" ? null : o)), 180);
  };

  return (
    <span className="info-tip">
      <button
        ref={button}
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-expanded={!!open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => (o === "pinned" ? null : "pinned"));
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          stay();
          setOpen((o) => o ?? "hover");
        }}
        onPointerLeave={(e) => e.pointerType === "mouse" && leave()}
      >
        <Icon name="info" size={15} />
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={title}
          className="info-tip-panel"
          style={place ? { top: place.top, left: place.left, width: place.width } : { visibility: "hidden" }}
          onPointerEnter={stay}
          onPointerLeave={(e) => e.pointerType === "mouse" && leave()}
          onClick={(e) => e.stopPropagation()}
        >
          <strong className="info-tip-title">{title}</strong>
          {children}
        </div>
      )}
    </span>
  );
}
