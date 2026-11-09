export function SplitDivider({ value, onChange, label, minimum = 280 }: {
  value: number;
  onChange: (ratio: number) => void;
  label: string;
  minimum?: number;
}) {
  const limits = (width: number) => {
    const min = Math.min(50, (minimum / Math.max(1, width)) * 100);
    return { min, max: 100 - min };
  };
  return <div role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0}
    aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} className="split-divider"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus();
      document.body.classList.add("split-resizing");
    }}
    onLostPointerCapture={() => document.body.classList.remove("split-resizing")}
    onPointerMove={(event) => {
      const el = event.currentTarget;
      if (!el.hasPointerCapture(event.pointerId)) return;
      const bounds = el.parentElement?.getBoundingClientRect();
      if (!bounds) return;
      const { min, max } = limits(bounds.width);
      onChange(Math.min(max, Math.max(min, ((event.clientX - bounds.left) / bounds.width) * 100)));
    }}
    onKeyDown={(event) => {
      const { min, max } = limits(event.currentTarget.parentElement?.clientWidth ?? 0);
      const next = event.key === "ArrowLeft" ? value - 5 : event.key === "ArrowRight" ? value + 5 :
        event.key === "Home" ? min : event.key === "End" ? max : null;
      if (next === null) return;
      event.preventDefault();
      onChange(Math.min(max, Math.max(min, next)));
    }} />;
}
