import type { Route } from "../shell/routes";

const PAGES: Record<Exclude<Route, "home">, { title: string; body: string }> = {
  library: {
    title: "Library",
    body: "Every book you own, with sorting, filters and search. This page is built in a later step.",
  },
  collections: {
    title: "Collections",
    body: "Your own groupings of books, synced across devices. This page is built in a later step.",
  },
  notes: {
    title: "Notes",
    body: "All your highlights, notes and bookmarks in one place. This page is built in a later step.",
  },
  settings: {
    title: "Settings",
    body: "Appearance, reading defaults, metadata and Sync & Accounts. This page is built in a later step.",
  },
  sync: {
    title: "Sync & Accounts",
    body: "Connect the cloud services you choose, and join your library from other devices. Part of Settings, built when sync arrives.",
  },
};

export function ComingSoon({ route }: { route: Exclude<Route, "home"> }) {
  const page = PAGES[route];
  return (
    <div className="coming-soon">
      <p className="eyebrow">{route === "sync" ? "Settings" : "Coming soon"}</p>
      <h1>{page.title}</h1>
      <p className="muted">{page.body}</p>
    </div>
  );
}
