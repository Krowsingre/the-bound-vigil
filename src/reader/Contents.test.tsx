import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { BookPreview } from "../api/types";
import { LeftPanel, type AnnotationHandlers, type LeftTab } from "./ReaderPanels";
import { ReaderBottomBar } from "./ReaderBars";
import type { ContentsEntry } from "./pages";

vi.mock("../api", () => ({ api: { coverUrl: () => "", getSetting: async () => null } }));
vi.mock("../components/BookCover", () => ({ BookCover: () => null }));
vi.mock("../shell/WindowControls", () => ({ WindowControls: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const book: BookPreview = {
  id: "sha256:book", title: "Test book", authors: ["Author"], coverPath: null, format: "epub",
  synopsis: null, series: null, seriesIndex: null, addedAt: "2026-11-08", lastOpenedAt: null,
  status: "unread", totalProgression: null, resumeLocator: null, availability: "local",
  remotePositions: [], favorite: false, wantToRead: false, rating: null, finishedAt: null,
  tags: [], inCloud: false, genres: [],
};
const handlers: AnnotationHandlers = { onGo: vi.fn(), onEditNote: vi.fn(), onRecolor: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn() };
const entry = (id: string, parents: string[] = [], hasChildren = false): ContentsEntry => ({ id, label: id, href: `${id}.xhtml`, page: 1, depth: parents.length, parents, hasChildren });

function Harness({ entries, currentId, request = 0, fraction = 0.5 }: { entries: ContentsEntry[]; currentId: string; request?: number; fraction?: number }) {
  const [tab, onTab] = useState<LeftTab>("contents");
  return <LeftPanel book={book} fraction={fraction} position={null} previouslyOpenedAt={null}
    entries={entries} currentId={currentId} tab={tab} onTab={onTab} revealRequest={request}
    annotations={[]} handlers={handlers} onGoHref={vi.fn()} />;
}

// Give the list and rows realistic geometry. A scrollIntoView stub would not
// catch accidentally scrolling the reading surface or window instead.
function geometry(positions: Record<string, [number, number]>) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const pair = this.classList.contains("reader-left-body") ? [100, 300] :
      this.matches(".toc > li") ? positions[this.textContent?.replace(/1$/, "") ?? ""] ?? [0, 0] : [0, 0];
    return { top: pair[0], bottom: pair[1], left: 0, right: 300, width: 300, height: pair[1] - pair[0], x: 0, y: pair[0], toJSON() {} };
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("reader-left-body") ? 200 : 0;
  });
}

test("opening Contents reveals the current entry by moving only its list", () => {
  geometry({ first: [110, 140], current: [460, 490] });
  const page = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const { container } = render(<Harness entries={[entry("first"), entry("current")]} currentId="current" />);
  const body = container.querySelector(".reader-left-body") as HTMLElement;
  expect(body.scrollTop).toBe(190);
  expect(screen.getByRole("button", { name: "current 1" })).toHaveAttribute("aria-current", "location");
  expect(page).not.toHaveBeenCalled();
});

test("same-chapter reading and manual list browsing do not recenter; chapter changes and Contents reopening do", () => {
  geometry({ first: [40, 70], second: [440, 470] });
  const entries = [entry("first"), entry("second")];
  const { container, rerender } = render(<Harness entries={entries} currentId="second" />);
  const body = container.querySelector(".reader-left-body") as HTMLElement;
  body.scrollTop = 777;
  // Fresh metadata objects with the same chapter must not steal the list's position.
  rerender(<Harness entries={entries.map(e => ({ ...e }))} currentId="second" fraction={0.7} />);
  expect(body.scrollTop).toBe(777);
  rerender(<Harness entries={entries} currentId="first" />);
  expect(body.scrollTop).toBe(717);
  fireEvent.click(screen.getByRole("tab", { name: "Highlights" }));
  fireEvent.click(screen.getByRole("tab", { name: "Contents" }));
  expect(body.scrollTop).toBe(657);
});

test("repeated footer requests expand collapsed current ancestors and reveal the row", () => {
  geometry({ part: [110, 140], nested: [400, 430] });
  const entries = [entry("part", [], true), entry("nested", ["part"])];
  const { container, rerender } = render(<Harness entries={entries} currentId="nested" />);
  const body = container.querySelector(".reader-left-body") as HTMLElement;
  expect(screen.getByRole("button", { name: "nested 1" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Fold part" }));
  expect(screen.queryByRole("button", { name: "nested 1" })).not.toBeInTheDocument();
  body.scrollTop = 0;
  rerender(<Harness entries={entries} currentId="nested" request={1} />);
  expect(screen.getByRole("button", { name: "nested 1" })).toBeInTheDocument();
  expect(body.scrollTop).toBe(130);
});

test("an already-visible current row does not scroll, and resizing can reveal it", () => {
  const positions: Record<string, [number, number]> = { current: [140, 170] };
  geometry(positions);
  let resized: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {} disconnect = disconnect;
  });
  const { container, unmount } = render(<Harness entries={[entry("current")]} currentId="current" />);
  const body = container.querySelector(".reader-left-body") as HTMLElement;
  expect(body.scrollTop).toBe(0);
  positions.current = [280, 320];
  act(() => resized!());
  expect(body.scrollTop).toBe(20);
  unmount(); expect(disconnect).toHaveBeenCalled();
});

test("footer chapter is an accessible Contents action, with a fallback for books without a chapter label", () => {
  const onContents = vi.fn();
  const props = { position: { page: 59, total: 100 }, fraction: 0.59, onSeek: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(), onContents, focus: false };
  const { rerender } = render(<ReaderBottomBar {...props} chapter="Chapter 59" />);
  fireEvent.click(screen.getByRole("button", { name: "Show contents: Chapter 59" }));
  expect(onContents).toHaveBeenCalledTimes(1);
  expect(props.onSeek).not.toHaveBeenCalled();
  rerender(<ReaderBottomBar {...props} chapter={null} focus />);
  fireEvent.click(screen.getByRole("button", { name: "Show contents" }));
  expect(onContents).toHaveBeenCalledTimes(2);
});
