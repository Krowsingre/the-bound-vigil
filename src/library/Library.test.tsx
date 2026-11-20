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
const removeDownload = vi.fn<(id: string) => Promise<void>>(async () => {});
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
    removeDownload: (id: string) => removeDownload(id),
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

test("pinned books are the first stack, opened like a series", async () => {
  getLibrary.mockImplementation(async (query) => ({
    books: query?.pinned ? [book(1, { pinnedAt: "2026-01-01" })] : [book(25)],
    total: query?.pinned ? 1 : 30,
    page: query?.page ?? 0, pageSize: query?.pageSize ?? 24, counts, formats: ["epub"],
    tags: [], genres: [], authors: [], narrators: [], languages: [],
  }));
  renderLibrary();
  // No folding section any more: a Pinned card leads the list.
  expect(screen.queryByText("Pinned books")).toBeNull();
  const card = await screen.findByRole("button", { name: "Open Pinned, 1 pinned" });
  expect(getLibrary).toHaveBeenCalledWith(expect.objectContaining({ pinned: true, page: 0 }));
  expect(getLibrary).toHaveBeenCalledWith(expect.objectContaining({ pinned: false, page: 0 }));
  fireEvent.click(card);
  expect(await screen.findByRole("heading", { name: "Pinned" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "More for Book 1" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Back to/ }));
  expect(await screen.findByRole("button", { name: "More for Book 25" })).toBeInTheDocument();
});

test("opening a series from Pinned shows that series' books", async () => {
  getLibrary.mockImplementation(async (query) => ({
    books: query?.pinned ? [book(1, { pinnedAt: "2026-01-01" })] : query?.series?.length ? [book(7, { series: "Saga" })] : [book(25)],
    total: query?.pinned ? 1 : 30,
    page: query?.page ?? 0, pageSize: query?.pageSize ?? 24, counts, formats: ["epub"],
    tags: [], genres: [], authors: [], narrators: [], languages: [],
  }));
  const props = { search: "", refreshKey: 0, onChange: vi.fn(), onClearSearch: () => {}, onImportBooks: () => {}, onImportFolder: () => {}, onOpenBook: () => {}, onOpenCollection: () => {} };
  const { rerender } = render(<ToastProvider><Library view={view} {...props} /></ToastProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Open Pinned, 1 pinned" }));
  expect(await screen.findByRole("heading", { name: "Pinned" })).toBeInTheDocument();
  // The app keeps the same Library and hands it the series.
  rerender(<ToastProvider><Library view={{ ...view, series: ["Saga"] }} seriesBack={() => {}} {...props} /></ToastProvider>);
  expect(await screen.findByRole("heading", { name: "Saga" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "More for Book 7" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "More for Book 1" })).toBeNull();
});

test("the Pinned stack only leads the first page", async () => {
  getLibrary.mockImplementation(async (query) => ({
    books: query?.pinned ? [book(1, { pinnedAt: "2026-01-01" })] : [book(25)],
    total: query?.pinned ? 1 : 30,
    page: query?.page ?? 0, pageSize: query?.pageSize ?? 24, counts, formats: ["epub"],
    tags: [], genres: [], authors: [], narrators: [], languages: [],
  }));
  renderLibrary({ view: { ...view, page: 1 } });
  expect(await screen.findByRole("button", { name: "More for Book 25" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Open Pinned/ })).toBeNull();
});

test("Series stacks and Series first only works while Series is on", async () => {
  getLibrary.mockResolvedValue({ books: [book(1)], total: 1, page: 0, pageSize: 24, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] });
  const onChange = vi.fn();
  renderLibrary({ onChange });
  const series = await screen.findByRole("button", { name: "Series", pressed: false });
  expect(screen.getByRole("switch", { name: /Series first/ })).toBeDisabled();
  fireEvent.click(series);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ seriesGrouping: "mixed" }));
});

test("Deselect all lets every chosen book go and Select ends choosing", async () => {
  getLibrary.mockResolvedValue({ books: [book(1)], total: 1, page: 0, pageSize: 24, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] });
  renderLibrary();
  const select = await screen.findByRole("button", { name: "Select" });
  fireEvent.click(select);
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  const deselect = screen.getByRole("button", { name: "Deselect all" });
  expect(deselect).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Book 1/, pressed: false }));
  expect(await screen.findByText("1 chosen")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
  expect(await screen.findByText(/Click books to choose them/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Select", pressed: true }));
  expect(screen.queryByRole("button", { name: "Deselect all" })).toBeNull();
});

test("the last listened item leads the list whatever the sort", async () => {
  getLibrary.mockResolvedValue({ books: [book(1), book(2)], total: 2, page: 0, pageSize: 24, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] });
  const onFirstShown = vi.fn();
  renderLibrary({ lead: book(2), onFirstShown });
  await screen.findByRole("button", { name: "More for Book 1" });
  const titles = screen.getAllByRole("button", { name: /^More for Book/ }).map((b) => b.getAttribute("aria-label"));
  expect(titles).toEqual(["More for Book 2", "More for Book 1"]);
  await waitFor(() => expect(onFirstShown).toHaveBeenLastCalledWith(book(2).id));
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
  // The series still has books in the cloud, so its Download works.
  getLibrary.mockImplementation(async (query) => query?.location === "cloud_only"
    ? { books: [{ ...remote, series: "Shared series" }], seriesCounts: { [remote.id]: 2 }, total: 1, page: 0, pageSize: 200, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] }
    : { books: [local], total: 3, page: 0, pageSize: 24, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] });
  getCollection.mockResolvedValue({ books: [local, remote, failed] });
  downloadBook.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
  renderLibrary({ view: { ...view, series: ["Shared series"] }, seriesBack: () => {} });
  fireEvent.click(await screen.findByRole("button", { name: "Download" }));
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

test("removing downloads from a stack keeps cloud-only and local-only books untouched", async () => {
  const backedUp = book(1, { series: "Shared series", inCloud: true });
  const onlyCopy = book(2, { series: "Shared series" });
  const cloudOnly = book(3, { series: "Shared series", availability: "cloud", inCloud: true });
  getLibrary.mockResolvedValue({
    books: [backedUp], seriesCounts: { [backedUp.id]: 3 }, total: 1, page: 0, pageSize: 24,
    counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [],
  });
  getCollection.mockResolvedValue({ books: [backedUp, onlyCopy, cloudOnly] });
  removeDownload.mockClear();
  renderLibrary({ view: { ...view, seriesGrouping: "mixed" } });
  fireEvent.click(await screen.findByRole("button", { name: "More for Shared series" }));
  expect(screen.getByRole("menuitem", { name: "Download" })).toBeInTheDocument();
  // A stack's menu offers what the selection's Actions do, without choosing first.
  for (const name of ["Edit details", "Find details online", "Tags", "Remove from library", "Delete"]) {
    expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove download" }));
  const confirm = await screen.findByRole("button", { name: "Remove downloads" });
  expect(removeDownload).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.getByText(/was kept here/)).toBeInTheDocument());
  expect(removeDownload.mock.calls).toEqual([[backedUp.id]]);
});

test("Shift-click chooses a range of books, series stacks whole", async () => {
  const first = book(1);
  const stack = book(2, { series: "Long series" });
  const rest = book(3, { series: "Long series" });
  const last = book(4);
  const page = { counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [], page: 0, pageSize: 24 };
  getLibrary.mockImplementation(async (q) =>
    q?.series?.length
      ? { ...page, books: [stack, rest], total: 2 }
      : { ...page, books: [first, stack, last], seriesCounts: { [stack.id]: 2 }, total: 3 },
  );
  renderLibrary({ view: { ...view, seriesGrouping: "mixed" } });
  fireEvent.click(await screen.findByRole("button", { name: "Select" }));
  fireEvent.click(await screen.findByRole("button", { name: /Book 1/, pressed: false }));
  fireEvent.click(screen.getByRole("button", { name: /Book 4/, pressed: false }), { shiftKey: true });
  await waitFor(() => expect(screen.getByRole("button", { name: "Choose series Long series" })).toHaveAttribute("aria-pressed", "true"));
  expect(screen.getByText(/4 chosen|4 books/)).toBeInTheDocument();
});

test("a series' Download and Remove download grey out when there's nothing for them to do", async () => {
  const local = book(1, { series: "Shared series" });
  // Every book is on this device: nothing in the cloud only.
  getLibrary.mockImplementation(async (query) => query?.location === "cloud_only"
    ? { books: [], total: 0, page: 0, pageSize: 200, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] }
    : query?.location === "on_device"
      ? { books: [local], seriesCounts: { [local.id]: 1 }, total: 1, page: 0, pageSize: 200, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] }
      : { books: [local], total: 1, page: 0, pageSize: 24, counts, formats: [], tags: [], genres: [], authors: [], narrators: [], languages: [] });
  renderLibrary({ view: { ...view, series: ["Shared series"] }, seriesBack: () => {} });
  await waitFor(() => expect(screen.getByRole("button", { name: "Download" })).toBeDisabled());
  expect(screen.getByRole("button", { name: "Remove download" })).toBeEnabled();
  // Inside a series: Select, and no counts row.
  expect(screen.getByRole("button", { name: /Select/ })).toBeInTheDocument();
  expect(screen.queryByText("In progress")).toBeNull();
});
