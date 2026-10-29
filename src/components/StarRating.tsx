import { useState } from "react";
import type React from "react";

const STAR = "M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z";

function Star({ fill, size }: { fill: number; size: number }) {
  // `fill` is 0 to 1, so averages like 3.5 show a half star.
  const id = `star-${Math.round(fill * 100)}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="star">
      <defs>
        <linearGradient id={id}>
          <stop offset={`${fill * 100}%`} stopColor="currentColor" />
          <stop offset={`${fill * 100}%`} stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={STAR} fill={`url(#${id})`} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** A rating in words: quarter stars as they are, averages to one place. */
export const starsText = (value: number) => (Number.isInteger(value) ? String(value) : Number.isInteger(value * 4) ? String(value) : value.toFixed(1));

/** Stars that show a rating, read-only. Shows nothing without one. */
export function Stars({ value, size = 14, label }: { value: number | null; size?: number; label?: string }) {
  if (value === null) return null;
  const text = label ?? `${starsText(value)} of 5 stars`;
  return (
    <span className="stars" role="img" aria-label={text} title={text}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} fill={Math.max(0, Math.min(1, value - (n - 1)))} />
      ))}
    </span>
  );
}

const STEP = 0.25;

/**
 * Five stars to pick a rating from, in quarter stars: where the pointer is
 * across a star picks a quarter, half, three quarters or the whole of it.
 * Choosing the current rating again clears it. The arrow keys move a quarter
 * star at a time, and Delete clears.
 */
export function StarRating({
  value,
  onChange,
  size = 20,
}: {
  value: number | null;
  onChange: (rating: number | null) => void;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const at = (n: number, e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const across = Math.min(1, Math.max(0, (e.clientX - box.left) / Math.max(1, box.width)));
    return n - 1 + Math.max(STEP, Math.ceil(across / STEP) * STEP);
  };
  const choose = (rating: number) => onChange(value === rating ? null : rating);
  const step = (by: number) => onChange(Math.min(5, Math.max(STEP, (value ?? 0) + by)));
  return (
    <span className="star-rating-wrap">
      <span
        className="star-rating"
        role="slider"
        tabIndex={0}
        aria-label="Your rating"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={value ?? 0}
        aria-valuetext={value === null ? "Not rated" : `${starsText(value)} of 5 stars`}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          const moves: Record<string, () => void> = {
            ArrowRight: () => step(STEP),
            ArrowUp: () => step(STEP),
            ArrowLeft: () => step(-STEP),
            ArrowDown: () => step(-STEP),
            Home: () => onChange(STEP),
            End: () => onChange(5),
            Delete: () => onChange(null),
            Backspace: () => onChange(null),
          };
          if (!moves[e.key]) return;
          e.preventDefault();
          moves[e.key]();
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={`star-btn${n - 1 < shown ? " is-on" : ""}`}
            title={hover !== null ? `${starsText(hover)} stars` : value !== null ? "Choose the same again to clear" : undefined}
            onPointerMove={(e) => setHover(at(n, e))}
            onClick={(e) => choose(at(n, e as unknown as React.PointerEvent<HTMLElement>))}
          >
            <Star size={size} fill={Math.max(0, Math.min(1, shown - (n - 1)))} />
          </span>
        ))}
      </span>
      {(hover ?? value) !== null && <span className="star-rating-value num">{starsText((hover ?? value)!)}</span>}
    </span>
  );
}
