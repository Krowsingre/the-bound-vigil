import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BookPreview, LibraryPage, LibraryQuery } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { queryBooks } from "../lib/queryBooks";
import { Library } from "./Library";
import { FinishedDownloadPrompt } from "./FinishedDownloadPrompt";
import type { LibraryView } from "./libraryView";

const getLibrary = vi.fn<(q: LibraryQuery) => Promise<LibraryPage>>();
const setFavorite = vi.fn(async () => {});
const downloadBook = vi.fn<(id: string) => Promise<void>>();
const getCollection = vi.fn();
const setBookStatus = vi.fn<(id: string, status: string) => Promise<void>>(async () => {});
vi.mock("../api", () => ({
  isApp: false,
  isWeb: false,
  isHome: false,
  api: {
    kind: "app",
    getLibrary: (q: LibraryQuery) => getLibrary(q),
    getCollections: async () => [],
    getCollection: (...args: unknown[]) => getCollection(...args),
    downloadBook: (id: string) => downloadBook(id),
    removeDownload: vi.fn(async () => {}),
    seriesReview: async () => null,
    timeSpent: async () => [],
    setFavorite: (...a: unknown[]) => setFavorite(...(a as [])),
    setWantToRead: vi.fn(),
    setBookStatus: (id: string, status: string) => setBookStatus(id, status),
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

const counts = { all: 30, favorites: 1, wantToRead: 0, sendToDevice: 0, inProgress: 2, read: 3, unread: 25, collections: 0 };
const view: LibraryView = { tab: "all", sort: "recently_added", formats: [], location: null, tags: [], genres: [], languages: [], downloadable: false, authors: [], series: [], narrators: [], hideRead: false, exclude: { formats: [], tags: [], genres: [], authors: [], narrators: [], series: [], languages: [] }, page: 0, layout: "grid", seriesGrouping: "individual" };

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
      <FinishedDownloadPrompt />
    </ToastProvider>,
  );
  return onChange;
}

beforeEach(() => getLibrary.mockReset());

function openShelves() {
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  const fold = screen.getByRole("button", { name: /Shelf/ });
  if (fold.getAttribute("aria-expanded") !== "true") fireEvent.click(fold);
}

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
  // The shelves, with their counts, are in Filter under Shelf.
  openShelves();
  expect(screen.getByRole("menuitemcheckbox", { name: /Read\s*3/ })).toBeInTheDocument();
  expect(getLibrary).toHaveBeenCalledWith(expect.objectContaining({ shelf: "all", page: 0, pageSize: 24, search: null }));
});

test("choosing a shelf and a page reports the change", async () => {
  getLibrary.mockResolvedValue({ books: [book(1)], total: 30, page: 0, pageSize: 24, counts, formats: ["epub"], tags: [], genres: [], languages: [], authors: [], narrators: [] });
  const onChange = renderLibrary();
  await screen.findAllByText("Book 1");
  openShelves();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Favourites/ }));
  expect(onChange).toHaveBeenCalledWith({ tab: "favorites" });
  fireEvent.click(screen.getAllByRole("button", { name: "Page 2" })[0]);
  expect(onChange).toHaveBeenCalledWith({ page: 1 });
});

test("pinned books stay above the second page of Archive results", async () => {
  getLibrary.mockImplementation(async (query) => ({
    books: query?.pinned ? [book(1, { pinnedAt: "2026-01-01" })] : [book(25)],
    total: query?.pinned ? 1 : 30,
    page: query?.page ?? 0, pageSize: query?.pageSize ?? 24, counts, formats: ["epub"],
    tags: [], genres: [], authors: [], narrators: [], languages: [],
  }));
  renderLibrary({ view: { ...view, page: 1 } });
  const heading = await screen.findByText("Pinned books");
  expect(heading.closest("details")).not.toHaveAttribute("open");
  expect(await screen.findByRole("button", { name: "More for Book 25" })).toBeInTheDocument();
  expect(getLibrary).toHaveBeenCalledWith(expect.objectContaining({ pinned: true, page: 0 }));
  expect(getLibrary).toHaveBeenCalledWith(expect.objectContaining({ pinned: false, page: 1 }));
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
  fireEvent.click(screen.getByRole("menuitem", { name: "Organize" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Add to favourites/ }));
  expect(setFavorite).toHaveBeenCalledWith("sha256:7", true);
});

test("series stacks count the whole series and apply combined filters to the same book", () => {
  const books = [
    book(1, { series: "Shared series", status: "read" }),
    book(2, { series: "Shared series", availability: "cloud" }),
    book(3, { series: "Shared series", status: "dropped" }),
  ];
  const query: LibraryQuery = { kind: "books", shelf: "all", sort: "title", search: null, formats: [], location: null, hideRead: true, groupSeries: true, page: 0, pageSize: 24 };
  const page = queryBooks(books, query, 0);
  expect(page.books.map(({ id }) => id)).toEqual([books[1].id]);
  expect(page.seriesCounts?.[books[1].id]).toBe(3);
  expect(queryBooks(books, { ...query, location: "on_device" }, 0).total).toBe(0);
});

test("series details report the filtered count and offer to show the rest", async () => {
  const showAll = vi.fn();
  getLibrary.mockImplementation(async (query) => ({
    books: [book(1, { series: "Shared series" })], total: query?.hideRead ? 1 : 5,
    page: 0, pageSize: 24, counts, formats: ["epub"], tags: [], genres: [], authors: [], narrators: [], languages: [],
  }));
  renderLibrary({ view: { ...view, series: ["Shared series"], hideRead: true }, seriesBack: () => {}, onShowAllSeries: showAll });
  expect(await screen.findByText("1 of 5 books shown")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show all books in this series" }));
  expect(showAll).toHaveBeenCalledOnce();
});

test("series download skips local files and retries only the failed title", async () => {
  const local = book(1, { series: "Shared series" });
  const remote = book(2, { availability: "cloud" });
  const failed = book(3, { availability: "cloud" });
  getLibrary.mockResolvedValue({ books: [local], total: 3, page: 0, pageSize: 24, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] });
  getCollection.mockResolvedValue({ books: [local, remote, failed] });
  downloadBook.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
  renderLibrary({ view: { ...view, series: ["Shared series"] }, seriesBack: () => {} });
  fireEvent.click(await screen.findByRole("button", { name: "Download to this device" }));
  expect(await screen.findByRole("region", { name: "Failed downloads" })).toHaveTextContent("Book 3");
  fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Failed downloads" })).toBeNull());
  expect(downloadBook.mock.calls).toEqual([[remote.id], [failed.id], [failed.id]]);
});

test("Undo restores reading status after dismissing the download prompt", async () => {
  const reading = book(4, { status: "in_progress", inCloud: true });
  getLibrary.mockResolvedValue({ books: [reading], total: 1, page: 0, pageSize: 24, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] });
  setBookStatus.mockClear();
  renderLibrary();
  fireEvent.click(await screen.findByRole("button", { name: "More for Book 4" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Reading status" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep on device" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(setBookStatus.mock.calls).toEqual([[reading.id, "read"], [reading.id, "in_progress"]]);
});
