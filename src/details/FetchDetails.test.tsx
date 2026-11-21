import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BookPreview } from "../api/types";
import type { Found } from "../lib/onlineDetails";
import { FetchDetails } from "./FetchDetails";

const { saveFetched, editDetails, searchOnline } = vi.hoisted(() => ({
  saveFetched: vi.fn(async () => {}),
  editDetails: vi.fn(async () => {}),
  searchOnline: vi.fn(),
}));
vi.mock("../api", () => ({
  isApp: false,
  api: { bookDetails: async () => ({ fields: [] }), saveFetched, editDetails, detailSuggestions: async () => [] },
}));
vi.mock("../lib/onlineDetails", async (original) => ({
  ...await original<typeof import("../lib/onlineDetails")>(),
  searchOnline,
}));

it("approves edited found values and leaves unchecked fields out", async () => {
  const found: Found = {
    id: "one", source: "google", title: "Catalogue title", authors: ["Online Author"],
    series: "The series", seriesIndex: "1", synopsis: null, genres: [], publisher: null,
    published: null, language: null, isbn: null, coverUrl: null,
  };
  searchOnline.mockResolvedValue([found]);
  const onClose = vi.fn();
  const book = { id: "book", title: "Local title", authors: [], format: "epub" } as unknown as BookPreview;
  render(<FetchDetails book={book} onClose={onClose} />);
  fireEvent.click(await screen.findByRole("button", { name: /Catalogue title/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Found Authors" }), { target: { value: "First Author\nSecond Author" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Series" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep ticked details" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  expect(saveFetched).toHaveBeenCalledWith("book", "google", {
    authors: '["First Author","Second Author"]',
  });
  expect(editDetails).not.toHaveBeenCalled();
});

it("sets the series found with the same rows as Edit details, kept as your own edit", async () => {
  const found: Found = {
    id: "one", source: "google", title: "Catalogue title", authors: [],
    series: "The series", seriesIndex: "1", synopsis: null, genres: [], publisher: null,
    published: null, language: null, isbn: null, coverUrl: null,
  };
  searchOnline.mockResolvedValue([found]);
  saveFetched.mockClear();
  editDetails.mockClear();
  const onClose = vi.fn();
  const book = { id: "book", title: "Local title", authors: [], format: "epub" } as unknown as BookPreview;
  render(<FetchDetails book={book} onClose={onClose} />);
  fireEvent.click(await screen.findByRole("button", { name: /Catalogue title/ }));
  // Filled in from what was found: an omnibus of books 1 to 3, and a second series.
  expect(screen.getByRole("textbox", { name: "Number in series" })).toHaveValue("1");
  fireEvent.change(screen.getByRole("textbox", { name: "Number in series" }), { target: { value: "1–3" } });
  fireEvent.click(screen.getByRole("button", { name: /Add series/ }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "Number in series" })[1], { target: { value: "10, 12" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Series 2" }), { target: { value: "Omnibus" } });
  fireEvent.click(screen.getByRole("button", { name: "Keep ticked details" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  expect(saveFetched).not.toHaveBeenCalled();
  expect(editDetails).toHaveBeenCalledWith(["book"], [
    { field: "series", value: "The series" },
    { field: "series_index", value: "1" },
    { field: "series_list", value: JSON.stringify([
      { name: "The series", number: 1, end: 3 },
      { name: "Omnibus", number: 10 },
      { name: "Omnibus", number: 12 },
    ]) },
  ]);
});

it("leaves the series unticked when you set it yourself", async () => {
  const { api } = await import("../api");
  const before = api.bookDetails;
  (api as { bookDetails: unknown }).bookDetails = async () => ({
    fields: [
      { field: "series", own: null, fetched: null, edited: "Mine" },
      { field: "series_index", own: "4", fetched: null, edited: null },
    ],
  });
  searchOnline.mockResolvedValue([{
    id: "one", source: "google", title: "Catalogue title", authors: [],
    series: "Mine", seriesIndex: "1", synopsis: null, genres: [], publisher: null,
    published: null, language: null, isbn: null, coverUrl: null,
  } satisfies Found]);
  const book = { id: "book", title: "Local title", authors: [], format: "epub" } as unknown as BookPreview;
  render(<FetchDetails book={book} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Catalogue title/ }));
  expect(screen.getByRole("checkbox", { name: "Series" })).not.toBeChecked();
  (api as { bookDetails: unknown }).bookDetails = before;
});

it("goes through several chosen books one at a time, kept or skipped", async () => {
  const { DetailsHost } = await import("./DetailsHost");
  const { askFetchManyDetails } = await import("./openDetails");
  const { act } = await import("@testing-library/react");
  const found: Found = {
    id: "one", source: "google", title: "Catalogue title", authors: ["Online Author"],
    series: null, seriesIndex: null, synopsis: null, genres: [], publisher: "Press",
    published: null, language: null, isbn: null, coverUrl: null,
  };
  searchOnline.mockResolvedValue([found]);
  saveFetched.mockClear();
  const onChanged = vi.fn();
  render(<DetailsHost onChanged={onChanged} />);
  const books = ["first", "second"].map((id) => ({ id, title: id, authors: [], format: "epub" }) as unknown as BookPreview);
  act(() => askFetchManyDetails(books));
  expect(await screen.findByText("Book 1 of 2")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: /Catalogue title/ }));
  fireEvent.click(screen.getByRole("button", { name: "Keep and go to next" }));
  expect(await screen.findByText("Book 2 of 2")).toBeTruthy();
  expect(saveFetched).toHaveBeenCalledWith("first", "google", expect.objectContaining({ publisher: "Press" }));
  expect(onChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Skip and finish" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(saveFetched).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenCalledTimes(1);
});
