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
