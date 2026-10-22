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
  pause: "M8.5 5.5v13M15.5 5.5v13",
  stop: "M7 7h10v10H7z",
  skipBack: "M17 6.5v11L9 12zM6.5 6v12",
  skipForward: "M7 6.5v11l8-5.5zM17.5 6v12",
  headphones: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z",
  shuffle: "M4 7h3.5c2 0 3 1 4 2.5l2 3c1 1.5 2 2.5 4 2.5H20M4 17h3.5c1.4 0 2.3-.5 3-1.3M13.5 8.3c.7-.8 1.6-1.3 3-1.3H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5",
  volume: "M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9.5a3.5 3.5 0 0 1 0 5",
  volumeOff: "M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 10l4 4M20 10l-4 4",
  back30: "M5.5 8.5A7.5 7.5 0 1 1 4.5 13M5 4.5v4h4",
  forward30: "M18.5 8.5A7.5 7.5 0 1 0 19.5 13M19 4.5v4h-4",
  readAloud: "M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10",
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
  eyeOff: "M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2M4 4l16 16",
  textSize: "M3 19 8 6l5 13M4.8 15h6.4M14 19l3.5-9 3.5 9M15.2 16h4.6",
  palette:
    "M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.6 0-.9.7-1.6 1.6-1.6h2.1a4 4 0 0 0 4-4c0-3.9-3.8-7.1-8.5-7.1zM7.5 12h.01M9.5 8h.01M14.5 8h.01",
  readingA: "M5 19 11 5h2l6 14M7.6 13.5h8.8",
  file: "M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v4h4",
  accessibility: "M12 3.5h.01M5 7.5l7 1.5 7-1.5M12 9v5M12 14l-3.5 6.5M12 14l3.5 6.5",
  keyboard: "M3.5 6.5h17v11h-17zM7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8",
  sliders: "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4",
  database: "M5 6c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 7.4 5 6zM5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19h14",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  ereader: "M6.5 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 7h6M9 10.5h6M9 14h4M11 18h2",
  email: "M3.5 6h17v12h-17zM3.5 6.5l8.5 6.5 8.5-6.5",
  tag: "M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0zM8 8h.01",
  pen: "M15.5 4.5l4 4L9 19H5v-4zM13.5 6.5l4 4M5 21h14",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  quote: "M6 17c-1.5-1-2-2.5-2-4.5C4 9.5 6 7.5 8.5 7M14 17c-1.5-1-2-2.5-2-4.5 0-3 2-5 4.5-5.5M5 17h3v-3.5H5.2M13 17h3v-3.5h-2.8",
  listBullet: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  listNumber: "M10 6h10M10 12h10M10 18h10M4 4.5h1.5V8M3.5 14.5c.3-.8 2.5-1 2.5.3 0 .9-2.5 2-2.5 3.2H6",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
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
