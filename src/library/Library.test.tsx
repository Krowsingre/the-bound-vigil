import { fireEvent, render, screen } from "@testing-library/react";
import type { BookPreview, LibraryPage, LibraryQuery } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { Library } from "./Library";
import type { LibraryView } from "./libraryView";

const getLibrary = vi.fn<(q: LibraryQuery) => Promise<LibraryPage>>();
const setFavorite = vi.fn(async () => {});
vi.mock("../api", () => ({
  isApp: false,
  isWeb: false,
  api: {
    kind: "app",
    getLibrary: (q: LibraryQuery) => getLibrary(q),
    getCollections: async () => [],
    setFavorite: (...a: unknown[]) => setFavorite(...(a as [])),
    setWantToRead: vi.fn(),
    setBookStatus: vi.fn(),
    coverUrl: () => "",
  },
}));

const book = (n: number, extra: Partial<BookPreview> = {}): BookPreview => ({
  id: `sha256:${n}`,
  title: `Book ${n}`,
  authors: ["Author"],
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
  rating: null,
  finishedAt: null,
  tags: [],
  inCloud: false,
  genres: [],
  ...extra,
});

const counts = { all: 30, favorites: 1, wantToRead: 0, inProgress: 2, read: 3, unread: 25, collections: 0 };
const view: LibraryView = { tab: "all", sort: "recently_added", formats: [], location: null, tags: [], genres: [], languages: [], downloadable: false, authors: [], narrators: [], page: 0, layout: "grid" };

function renderLibrary(props: Partial<React.ComponentProps<typeof Library>> = {}) {
  const onChange = vi.fn();
  render(
    <ToastProvider>
      <Library
        view={view}
        search=""
        refreshKey={0}
        onChange={onChange}
        onClearSearch={() => {}}
        onImportBooks={() => {}}
        onImportFolder={() => {}}
        onOpenBook={() => {}}
        onOpenCollection={() => {}}
        {...props}
      />
    </ToastProvider>,
  );
  return onChange;
}

beforeEach(() => getLibrary.mockReset());

test("shows the shelf counts, the page of books and where it is in the list", async () => {
  getLibrary.mockResolvedValue({
    books: [book(1, { status: "in_progress", totalProgression: 0.56 }), book(2)],
    total: 30,
    page: 0,
    pageSize: 24,
    counts,
    formats: ["epub"],
    tags: [],
    genres: [],
    authors: [],
    narrators: [],
    languages: [],
  });
  renderLibrary();
  expect((await screen.findAllByText("Book 1")).length).toBeGreaterThan(0);
  expect(screen.getByText("56%")).toBeInTheDocument();
  expect(screen.getByText("Showing 1–24 of 30 books")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Read 3/ })).toBeInTheDocument();
  expect(getLibrary).toHaveBeenCalledWith(expect.objectContaining({ shelf: "all", page: 0, pageSize: 24, search: null }));
});

test("choosing a shelf and a page reports the change", async () => {
  getLibrary.mockResolvedValue({ books: [book(1)], total: 30, page: 0, pageSize: 24, counts, formats: ["epub"], tags: [], genres: [], languages: [], authors: [], narrators: [] });
  const onChange = renderLibrary();
  await screen.findAllByText("Book 1");
  fireEvent.click(screen.getByRole("tab", { name: /Favourites/ }));
  expect(onChange).toHaveBeenCalledWith({ tab: "favorites" });
  fireEvent.click(screen.getAllByRole("button", { name: "Page 2" })[0]);
  expect(onChange).toHaveBeenCalledWith({ page: 1 });
});

test("search with no results says so and offers a way back", async () => {
  getLibrary.mockResolvedValue({ books: [], total: 0, page: 0, pageSize: 24, counts, formats: ["epub"], tags: [], genres: [], languages: [], authors: [], narrators: [] });
  const onClearSearch = vi.fn();
  renderLibrary({ search: "zzz", onClearSearch });
  expect(await screen.findByText("Nothing matches")).toBeInTheDocument();
  expect(getLibrary).toHaveBeenCalledWith(expect.objectContaining({ search: "zzz" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(onClearSearch).toHaveBeenCalled();
});

test("an empty library offers import instead of an empty grid", async () => {
  getLibrary.mockResolvedValue({
    books: [],
    total: 0,
    page: 0,
    pageSize: 24,
    counts: { ...counts, all: 0, favorites: 0, inProgress: 0, read: 0, unread: 0 },
    formats: [],
    tags: [],
    genres: [],
    authors: [],
    narrators: [],
    languages: [],
  });
  renderLibrary();
  expect(await screen.findByText("No books yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Import books/ })).toBeInTheDocument();
});

test("the book menu can add a favourite", async () => {
  getLibrary.mockResolvedValue({ books: [book(7)], total: 1, page: 0, pageSize: 24, counts, formats: ["epub"], tags: [], genres: [], languages: [], authors: [], narrators: [] });
  renderLibrary();
  await screen.findAllByText("Book 7");
  fireEvent.click(screen.getByRole("button", { name: "More for Book 7" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Add to favourites/ }));
  expect(setFavorite).toHaveBeenCalledWith("sha256:7", true);
});
