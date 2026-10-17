import { useState } from "react";

export type ReorderProps = React.LiHTMLAttributes<HTMLLIElement> & { "data-reorder"?: string };

/** Moves `item` to `to` in a copy of the list. */
export function moved<T>(list: readonly T[], item: T, to: number): T[] {
  const rest = list.filter((x) => x !== item);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, item);
  return rest;
}

/**
 * Putting cards in your own order: drag one onto another, or hold Alt and
 * press an arrow key. `onMove` gets the item and its new place in `order`.
 */
export function useReorder(order: readonly string[], enabled: boolean, onMove: (key: string, to: number) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (key: string) => {
    if (!enabled) return {} as ReorderProps;
    const index = order.indexOf(key);
    const props: ReorderProps = {
      draggable: true,
      "data-reorder": dragging === key ? "dragging" : over === key && dragging !== null ? "target" : undefined,
      onDragStart: (e: React.DragEvent) => {
        setDragging(key);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", key);
      },
      onDragOver: (e: React.DragEvent) => {
        if (dragging === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== key) setOver(key);
      },
      onDragLeave: () => over === key && setOver(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragging !== null && dragging !== key) onMove(dragging, index);
        setDragging(null);
        setOver(null);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (!e.altKey) return;
        const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
        if (!step || index + step < 0 || index + step >= order.length) return;
        e.preventDefault();
        onMove(key, index + step);
      },
    };
    return props;
  };
}
