import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../components/Icon";
import { keyHint, useShortcuts } from "../lib/shortcuts";

const MIN = 1;
const MAX = 8;
const STEP = 1.25;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

/**
 * A picture from the book, shown over the page to look at closer: magnify and
 * demagnify with the buttons, a pinch, Ctrl + wheel or the + and − keys, and drag
 * to move around. Closing it leaves the reader exactly as it was, focus mode included.
 */
export function PictureViewer({ picture, onClose }: { picture: { src: string; alt: string }; onClose: () => void }) {
  const keys = useShortcuts();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoomTo = (next: number) => {
    const s = clamp(next);
    setScale(s);
    if (s === 1) setOffset({ x: 0, y: 0 });
    else setOffset((o) => ({ x: (o.x * s) / scale, y: (o.y * s) / scale }));
  };

  // The reader's own keys (page turns, focus mode) wait while the picture is open.
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomTo(scale * STEP);
      else if (e.key === "-" || e.key === "−") zoomTo(scale / STEP);
      else if (e.key === "0") zoomTo(1);
      else if (e.key === "Tab") return;
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const block = (e: KeyboardEvent) => {
      if (e.key !== "Tab") e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", block, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", block, true);
    };
  });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) setScaleBy(Math.exp(-e.deltaY / 200));
      else if (scaleRef.current > 1) setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const setScaleBy = (factor: number) => {
    const s = clamp(scaleRef.current * factor);
    setOffset((o) => (s === 1 ? { x: 0, y: 0 } : { x: (o.x * s) / scaleRef.current, y: (o.y * s) / scaleRef.current }));
    setScale(s);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const s = clamp((pinch.current.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist);
      setOffset((o) => (s === 1 ? { x: 0, y: 0 } : { x: (o.x * s) / scaleRef.current, y: (o.y * s) / scaleRef.current }));
      setScale(s);
    } else if (drag.current && scale > 1) {
      setOffset({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y });
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const start = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
    // A plain tap outside the picture, not zoomed in, closes it.
    if (start && scale === 1 && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6 && !(e.target as HTMLElement).closest("img")) onClose();
  };

  const zoomOut = `Make smaller${keyHint(keys, " (−)") ?? ""}`;
  const zoomIn = `Make bigger${keyHint(keys, " (+)") ?? ""}`;
  return (
    <div className="picture-viewer" role="dialog" aria-modal="true" aria-label={picture.alt || "Picture"}>
      <div
        ref={stage}
        className={`picture-viewer-stage${scale > 1 ? " is-zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => zoomTo(scale > 1 ? 1 : 2.5)}
      >
        <img
          src={picture.src}
          alt={picture.alt}
          draggable={false}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        />
      </div>
      <div className="picture-viewer-bar" role="group" aria-label="Picture size">
        <button type="button" className="icon-btn" aria-label="Make smaller" title={zoomOut} disabled={scale <= MIN} onClick={() => zoomTo(scale / STEP)}>
          <Icon name="minus" size={18} />
        </button>
        <button type="button" className="picture-viewer-size" title="Back to the picture's fitted size" onClick={() => zoomTo(1)}>
          {Math.round(scale * 100)}%
        </button>
        <button type="button" className="icon-btn" aria-label="Make bigger" title={zoomIn} disabled={scale >= MAX} onClick={() => zoomTo(scale * STEP)}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      <button ref={closeBtn} type="button" className="icon-btn picture-viewer-close" aria-label="Close picture" title={`Close${keyHint(keys, " (Esc)") ?? ""}`} onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}
