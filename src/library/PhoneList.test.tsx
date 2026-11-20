import { fireEvent, render, screen } from "@testing-library/react";
import type { BookPreview } from "../api/types";
import type { BookActions } from "../home/bookActions";
import { PhoneList } from "./BookViews";

vi.mock("../api", () => ({ isApp: false, isWeb: false, isHome: false, api: { kind: "app", coverUrl: () => "" } }));

const book = (n: number, extra: Partial<BookPreview> = {}): BookPreview => ({
  id: `sha256:${n}`, title: `Book ${n}`, authors: ["Author"], coverPath: null, format: "epub", synopsis: null,
  series: null, seriesIndex: null, addedAt: "2026-10-16T10:00:00.000Z", lastOpenedAt: null, status: "unread",
  totalProgression: null, resumeLocator: null, availability: "local", remotePositions: [], favorite: false,
  wantToRead: false, rating: null, finishedAt: null, tags: [], inCloud: false, genres: [], ...extra,
});

const actions = { open: vi.fn() } as unknown as BookActions;

test("the phone list is names, how far along once started, and •••; a series is just its name", () => {
  const onOpenSeries = vi.fn();
  const { container } = render(
    <PhoneList
      books={[book(1, { status: "in_progress", totalProgression: 0.42 }), book(2), book(3, { series: "Saga" })]}
      seriesCounts={{ "sha256:3": 4 }}
      onOpenSeries={onOpenSeries}
      seriesMenu={() => []}
      actions={actions}
      lead={{ book: book(2), label: "Last read" }}
    />,
  );
  // No covers anywhere, the series included.
  expect(container.querySelector(".cover")).toBeNull();
  expect(screen.getByText("42%")).toBeInTheDocument();
  expect(screen.getByText("Last read")).toBeInTheDocument();
  const rows = [...container.querySelectorAll(".phone-row .book-title")].map((t) => t.textContent);
  expect(rows).toEqual(["Book 2", "Book 1", "Book 2", "Saga"]);
  expect(screen.queryByText("Author")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open series Saga" }));
  expect(onOpenSeries).toHaveBeenCalledWith("Saga");
});
