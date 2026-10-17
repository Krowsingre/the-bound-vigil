import { render, screen } from "@testing-library/react";
import type { BookPreview, HomeViewModel } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { Home } from "./Home";

const getHome = vi.fn<() => Promise<HomeViewModel>>();
vi.mock("../api", () => ({
  isApp: false,
  api: {
    kind: "app",
    getHome: () => getHome(),
    coverUrl: () => "",
    setBookStatus: vi.fn(),
    setFavorite: vi.fn(),
    setWantToRead: vi.fn(),
  },
}));

const emptyHome: HomeViewModel = {
  resumeBook: null,
  recentlyAdded: [],
  inProgress: [],
  collections: [],
  annotations: [],
  libraryCounts: { total: 0, unread: 0, inProgress: 0, read: 0 },
  activity: null,
  sync: { state: "disabled", lastSuccessAt: null },
};

const dracula: BookPreview = {
  id: "sha256:ab",
  title: "Dracula",
  authors: ["Bram Stoker"],
  coverPath: null,
  format: "epub",
  synopsis: null,
  series: null,
  seriesIndex: null,
  addedAt: "2026-10-16T10:00:00.000Z",
  lastOpenedAt: null,
  status: "unread",
  totalProgression: null,
  resumeLocator: null,
  availability: "local",
  remotePositions: [],
  favorite: false,
  wantToRead: false,
};

function renderHome() {
  return render(
    <ToastProvider>
      <Home refreshKey={0} onNavigate={() => {}} onOpenLibrary={() => {}} onImportBooks={() => {}} onImportFolder={() => {}} />
    </ToastProvider>,
  );
}

test("an empty library offers import and invents nothing", async () => {
  getHome.mockResolvedValue(emptyHome);
  renderHome();
  expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Import books/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: /Join an existing library/ })).toBeDisabled();
  expect(screen.queryByText(/Reading activity/i)).toBeNull();
});

test("a library with nothing in progress invites the reader to begin", async () => {
  getHome.mockResolvedValue({
    ...emptyHome,
    recentlyAdded: [dracula],
    libraryCounts: { total: 1, unread: 1, inProgress: 0, read: 0 },
  });
  renderHome();
  expect(await screen.findByText("Begin reading")).toBeInTheDocument();
  expect(screen.getAllByText("Dracula").length).toBeGreaterThan(0);
  // No reading has been recorded, so no numbers are shown.
  expect(screen.getByText(/Time spent reading will appear here/)).toBeInTheDocument();
  expect(screen.queryByText("Hours read")).toBeNull();
});

test("the resume hero shows the in-progress book and other devices' positions", async () => {
  const reading = {
    ...dracula,
    status: "in_progress" as const,
    totalProgression: 0.42,
    remotePositions: [{ deviceName: "Phone", totalProgression: 0.5, at: new Date().toISOString() }],
  };
  getHome.mockResolvedValue({
    ...emptyHome,
    resumeBook: reading,
    inProgress: [reading],
    recentlyAdded: [reading],
    libraryCounts: { total: 1, unread: 0, inProgress: 1, read: 0 },
  });
  renderHome();
  expect(await screen.findByRole("heading", { name: "Dracula", level: 1 })).toBeInTheDocument();
  expect(screen.getByText(/On Phone you're at 50%/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Continue reading/ })).toBeInTheDocument();
});
