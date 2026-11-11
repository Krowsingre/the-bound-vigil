import { useState, type ComponentPropsWithoutRef } from "react";

export function useRememberedDisclosure(id: string, initiallyOpen = false) {
  const key = `tbv.disclosure.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initiallyOpen : saved === "1";
    } catch { return initiallyOpen; }
  });
  return [open, (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* Keep the current view. */ }
  }] as const;
}

export function RememberedDetails({ disclosure, initiallyOpen, ...props }: Omit<ComponentPropsWithoutRef<"details">, "open" | "onToggle"> & { disclosure: string; initiallyOpen?: boolean }) {
  const [open, setOpen] = useRememberedDisclosure(disclosure, initiallyOpen);
  return <details {...props} open={open} onToggle={(event) => {
    if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
  }} />;
}
