import { createElement, type ReactElement, useLayoutEffect, useRef, useState } from "react";
import type { StructuredContent, TableNode } from "./structuredContent";

function renderTable(node: TableNode, key = "table"): ReactElement {
  return createElement(node.tag, {
    key, id: node.id ? `tbv-expanded-${node.id}` : undefined,
    headers: node.headers?.split(" ").map((id) => `tbv-expanded-${id}`).join(" "),
    scope: node.scope, rowSpan: node.rowSpan, colSpan: node.colSpan,
  }, node.text ?? node.children.map((child, i) => renderTable(child, `${key}-${i}`)));
}

export function StructuredViewer({ content, onClose }: { content: StructuredContent; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [angle, setAngle] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 1, height: 1, areaWidth: 1, areaHeight: 1 });
  useLayoutEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    close.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const view = viewport.current;
    const item = surface.current;
    if (!view || !item) return;
    const update = () => setSize({
      width: item.offsetWidth || 1, height: item.offsetHeight || 1,
      areaWidth: Math.max(1, view.clientWidth - 24), areaHeight: Math.max(1, view.clientHeight - 24),
    });
    const observer = new ResizeObserver(update);
    observer.observe(view);
    observer.observe(item);
    update();
    return () => observer.disconnect();
  }, []);

  const sideways = angle % 180 !== 0;
  const width = sideways ? size.height : size.width;
  const height = sideways ? size.width : size.height;
  const fit = Math.max(0.5, Math.min(1, size.areaWidth / width, size.areaHeight / height));
  const scale = fit * zoom;
  return <dialog ref={dialog} className="dialog structured-viewer" aria-label={`Expanded ${content.label}`}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.altKey && event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        onClose();
      }
      event.stopPropagation();
    }}>
    <header className="structured-viewer-toolbar">
      <strong>{content.label}</strong>
      <button type="button" className="btn btn-quiet" onClick={() => setZoom(Math.max(1, zoom / 1.25))} disabled={zoom <= 1}>Zoom out</button>
      <button type="button" className="btn btn-quiet" onClick={() => setZoom(Math.min(8, zoom * 1.25))} disabled={zoom >= 8}>Zoom in</button>
      <button type="button" className="btn btn-quiet" onClick={() => setAngle((angle + 90) % 360)}>Rotate</button>
      <button type="button" className="btn btn-quiet" onClick={() => { setAngle(0); setZoom(1); }}>Reset view</button>
      <button ref={close} type="button" className="btn btn-primary" onClick={onClose}>Close</button>
    </header>
    <div ref={viewport} className="structured-viewer-viewport" tabIndex={0} aria-label="Expanded content, scroll to pan">
      <div className="structured-viewer-stage" style={{ width: width * scale, height: height * scale }}>
        <div ref={surface} className="structured-viewer-surface"
          style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})` }}
          onPointerDown={(event) => { gesture.current = { x: event.clientX, y: event.clientY, moved: !event.isPrimary }; }}
          onPointerMove={(event) => {
            const start = gesture.current;
            if (start && Math.hypot(start.x - event.clientX, start.y - event.clientY) > 6) start.moved = true;
          }}
          onPointerCancel={() => { if (gesture.current) gesture.current.moved = true; }}
          onClick={() => {
            const tap = gesture.current;
            gesture.current = null;
            if (tap && !tap.moved && !window.getSelection()?.toString()) onClose();
          }}>
          {content.kind === "table" ? renderTable(content.table) : <pre>{content.text}</pre>}
        </div>
      </div>
    </div>
  </dialog>;
}
