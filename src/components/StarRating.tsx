import { useState } from "react";

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

/** Stars that show a rating, read-only. Shows nothing without one. */
export function Stars({ value, size = 14, label }: { value: number | null; size?: number; label?: string }) {
  if (value === null) return null;
  const text = label ?? `${Number.isInteger(value) ? value : value.toFixed(1)} of 5 stars`;
  return (
    <span className="stars" role="img" aria-label={text} title={text}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} fill={Math.max(0, Math.min(1, value - (n - 1)))} />
      ))}
    </span>
  );
}

/**
 * Five stars to pick a rating from. Choosing the current rating again
 * clears it.
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
  return (
    <span className="star-rating" role="radiogroup" aria-label="Your rating" onPointerLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}${value === n ? ", choose again to clear" : ""}`}
          title={value === n ? "Clear rating" : `${n} star${n === 1 ? "" : "s"}`}
          className={`star-btn${n <= shown ? " is-on" : ""}`}
          onPointerEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? null : n)}
        >
          <Star size={size} fill={n <= shown ? 1 : 0} />
        </button>
      ))}
    </span>
  );
}
