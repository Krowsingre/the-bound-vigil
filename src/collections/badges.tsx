// The badges a collection can wear. They ship inside TBV and are drawn in
// the same line style as the app's icons.

const BADGES = {
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  moon: "M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  compass: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM15.5 8.5l-2 5-5 2 2-5z",
  bookmark: "M7 4h10v16l-5-3.5L7 20z",
  check: "M5.5 12.5l4 4 9-9",
  heart: "M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 6.8a4.2 4.2 0 0 1 7.5 2.7c0 5.4-7.5 10-7.5 10z",
  book: "M4 5.5c2.7-1 5.3-1 8 .8 2.7-1.8 5.3-1.8 8-.8V19c-2.7-1-5.3-1-8 .8-2.7-1.8-5.3-1.8-8-.8zM12 6.3v13.5",
  feather: "M19.5 4.5C12 5 7 10 6 18.5M19.5 4.5c.5 6-3 10.5-9.5 11.5M6 18.5 4.5 20M10 16l-3-.2M13.5 12.5l-3.5-.3",
  flame: "M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 3-5.4 3.6-9.4 2.4 1.6 3.6 4 3.4 6.4 1-.6 1.8-1.8 2-3.2 1.8 1.8 3 4 3 6.2 0 3.2-2.4 5.6-6 5.6z",
  key: "M8.5 10.5a4 4 0 1 0 0 .1zM12.5 12H21M18 12v3M15.5 12v2",
  crown: "M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10zM4 20h16",
  mountain: "M2.5 19.5 9 8.5l3.5 5.5 2-3 7 8.5zM7.4 11.2 9 12.5l1.6-1.3",
  castle: "M5 20V9h2.5v2H10V9h4v2h2.5V9H19v11zM10 20v-4a2 2 0 0 1 4 0v4M12 9V4l3 1.2L12 6.4",
  tower: "M8 20V8.5L12 4l4 4.5V20M6.5 20h11M11 11h2M12 16a1.5 1.5 0 0 0-1.5 1.5V20h3v-2.5A1.5 1.5 0 0 0 12 16z",
  leaf: "M5 19C5 10 10 5 19.5 4.5 19 14 14 19 5 19zM5 19l8-8",
  flower: "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM12 9.5C10 5 14 5 12 9.5zM14.5 12c4.5-2 4.5 2 0 0zM12 14.5c2 4.5-2 4.5 0 0zM9.5 12C5 14 5 10 9.5 12z",
  tree: "M12 3 6.5 11h3L6 16h12l-3.5-5h3zM12 16v5",
  anchor: "M12 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 7.5V20M8 11h8M4.5 13.5c0 4 3.5 6.5 7.5 6.5s7.5-2.5 7.5-6.5",
  sword: "M19.5 4.5 9 15M19.5 4.5l-4.2.6M19.5 4.5l-.6 4.2M7 13l4 4M8 16l-3.5 3.5",
  scroll: "M7 4.5h11a2 2 0 0 1 0 4h-1.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5h10.5V18a2 2 0 0 0 2 2M7 4.5a2 2 0 0 0-2 2V16.5M9 9h4.5M9 12.5h4.5",
  hourglass: "M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 5 4.5 5.5 4.5 8.5s-4.5 3.5-4.5 8.5M16.5 3.5c0 5-4.5 5.5-4.5 8.5s4.5 3.5 4.5 8.5",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  sparkle: "M12 3.5c.8 4.6 3.9 7.7 8.5 8.5-4.6.8-7.7 3.9-8.5 8.5-.8-4.6-3.9-7.7-8.5-8.5 4.6-.8 7.7-3.9 8.5-8.5z",
  lantern: "M9.5 6.5h5M10 4h4M8 8.5c0-1 .9-2 2-2h4c1.1 0 2 1 2 2v9c0 1-.9 2-2 2h-4c-1.1 0-2-1-2-2zM12 11v4.5M8 19.5h8",
  wave: "M3 9.5c3-2.5 6-2.5 9 0s6 2.5 9 0M3 14.5c3-2.5 6-2.5 9 0s6 2.5 9 0",
} as const;

export type BadgeName = keyof typeof BADGES;

export const BADGE_NAMES = Object.keys(BADGES) as BadgeName[];

export const isBadge = (name: string | null | undefined): name is BadgeName => !!name && name in BADGES;

/** A collection's badge. Unknown names (from a newer TBV) draw nothing. */
export function Badge({ name, size = 18, label }: { name: string | null | undefined; size?: number; label?: string }) {
  if (!isBadge(name)) return null;
  return (
    <svg
      className="badge"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={BADGES[name]} />
    </svg>
  );
}
