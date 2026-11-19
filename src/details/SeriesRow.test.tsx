import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BookPreview, SeriesReview } from "../api/types";
import { SeriesRow } from "./SeriesRow";

const book = (id: string, title: string): BookPreview => ({ id, title, authors: ["A. Writer"], format: "epub", coverPath: null }) as unknown as BookPreview;
const current = book("one", "First");
const elsewhere = book("two", "Second Book");
const review: SeriesReview = {
  name: "Saga",
  checkedAt: "2026-11-19T00:00:00Z",
  listed: 3,
  owned: 1,
  ownedBooks: [{ book: current, position: 1, place: null }],
  missing: [
    { key: "second", title: "Second", position: 2, authors: ["A. Writer"], coverUrl: null, source: "google", hidden: false, read: false },
    { key: "third", title: "Third", position: 3, authors: ["A. Writer"], coverUrl: null, source: "google", hidden: false, read: false },
  ],
  matches: [{ book: elsewhere, position: 2, reason: "Same title and author, with no series in its details", forKey: "second" }],
} as unknown as SeriesReview;

const { approveSeriesMatches } = vi.hoisted(() => ({ approveSeriesMatches: vi.fn() }));
vi.mock("../api", () => ({
  isWeb: false,
  isApp: false,
  isHome: false,
  api: {
    seriesReview: async () => review,
    approveSeriesMatches,
    coverUrl: () => "",
  },
}));

it("shows a listed book that's in the library under other details, and offers it to approve", async () => {
  approveSeriesMatches.mockResolvedValue({ ...review, matches: [] });
  render(<SeriesRow name="Saga" author="A. Writer" bookId="one" refreshKey={0} />);
  expect(await screen.findByText(/Book 2 · In your library/)).toBeInTheDocument();
  expect(screen.getAllByText("Second Book").length).toBeGreaterThan(0);
  // The one not in the library stays greyed out.
  expect(screen.getAllByText("Third")[0].closest("li")).toHaveClass("is-missing");
  expect(screen.getByText("Might be in this series")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(approveSeriesMatches).toHaveBeenCalledWith("Saga", [{ bookId: "two", position: 2 }]));
  await waitFor(() => expect(screen.queryByText("Might be in this series")).toBeNull());
});
