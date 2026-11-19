import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BookPreview } from "../api/types";
import type { Found } from "../lib/onlineDetails";
import { FetchDetails } from "./FetchDetails";

const { saveFetched, searchOnline } = vi.hoisted(() => ({
  saveFetched: vi.fn(async () => {}),
  searchOnline: vi.fn(),
}));
vi.mock("../api", () => ({
  isApp: false,
  api: { bookDetails: async () => ({ fields: [] }), saveFetched },
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
  fireEvent.change(screen.getByRole("textbox", { name: "Found Number in series" }), { target: { value: "2,5" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Series" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep ticked details" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  expect(saveFetched).toHaveBeenCalledWith("book", "google", {
    authors: '["First Author","Second Author"]',
    series_index: "2.5",
  });
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
