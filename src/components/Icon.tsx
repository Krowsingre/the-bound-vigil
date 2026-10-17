// Small line icons drawn to match the emblem's stroke weight.

const paths = {
  home: "M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  library: "M5 4h3v16H5zM10 4h3v16h-3zM15.2 4.6l2.9-.8 3.6 15.4-2.9.8z",
  collections: "M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM6 4h12M8 7V5.5",
  notes: "M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8.5 12h7M8.5 16h5",
  settings:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.6-4.6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  cloud: "M7 18h10a4 4 0 0 0 .7-7.9A6 6 0 0 0 6.2 9.5 4.3 4.3 0 0 0 7 18z",
  cloudOff: "M7 18h10a4 4 0 0 0 .7-7.9A6 6 0 0 0 6.2 9.5 4.3 4.3 0 0 0 7 18zM4 4l16 16",
  sync: "M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2",
  importFile: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14",
  folder: "M3.5 6.5a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  play: "M8 5.5v13l10-6.5z",
  warning: "M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01",
  close: "M6 6l12 12M18 6 6 18",
  minimize: "M6 12h12",
  maximize: "M6.5 6.5h11v11h-11z",
  restore: "M8.5 8.5h9v9h-9zM6.5 15.5v-9h9",
  highlight: "M5 19h14M7 15l8.5-8.5 2.5 2.5L9.5 17.5H7z",
  note: "M5 5h14v10l-4 4H5zM15 19v-4h4",
  grid: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  list: "M4 6h3v3H4zM10 7.5h10M4 15h3v3H4zM10 16.5h10",
  rows: "M4 6h16M4 10h16M4 14h16M4 18h16",
  filter: "M4 5h16l-6 7.5V19l-4-1.5v-5z",
  chevronDown: "M7 10l5 5 5-5",
  chevronUp: "M7 14l5-5 5 5",
  chevronLeft: "M14.5 6.5 9 12l5.5 5.5",
  chevronRight: "M9.5 6.5 15 12l-5.5 5.5",
  heart: "M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 6.8a4.2 4.2 0 0 1 7.5 2.7c0 5.4-7.5 10-7.5 10z",
  bookmark: "M7 4h10v16l-5-3.5L7 20z",
  check: "M5.5 12.5l4 4 9-9",
  image: "M4.5 5.5h15v13h-15zM4.5 15.5l4.5-4.5 4 4 2.5-2.5 4 4M15 9.5h.01",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  fullscreen: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  exitFullscreen: "M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2",
  trash: "M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7",
  copy: "M9 9h10v11H9zM5 15V4h10",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  info: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 11v5M12 8h.01",
  panelLeft: "M4 5h16v14H4zM9.5 5v14",
  panelRight: "M4 5h16v14H4zM14.5 5v14",
  focus: "M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  textSize: "M3 19 8 6l5 13M4.8 15h6.4M14 19l3.5-9 3.5 9M15.2 16h4.6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 18,
  label,
  filled = false,
}: {
  name: IconName;
  size?: number;
  label?: string;
  /** Fills the shape, e.g. a bookmark that is set. */
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.6 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={paths[name]} />
    </svg>
  );
}
