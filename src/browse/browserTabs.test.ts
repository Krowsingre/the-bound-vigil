import { closeTab, freshTabs, moveTab, openTab, readTabs, updateTab, writeTabs, type TabsState } from "./browserTabs";

const HOME = "https://www.gutenberg.org/";

beforeEach(() => localStorage.clear());

test("the first visit opens one tab at the last page, or home", () => {
  expect(readTabs(HOME).tabs.map((t) => t.url)).toEqual([HOME]);
  localStorage.setItem("tbv.browser.last", "https://standardebooks.org/");
  expect(readTabs(HOME).tabs.map((t) => t.url)).toEqual(["https://standardebooks.org/"]);
});

test("tabs come back as they were left", () => {
  const state = openTab(readTabs(HOME), { id: "tb", url: "https://openlibrary.org/", title: "Open Library" });
  writeTabs(state);
  const back = readTabs(HOME);
  expect(back.tabs.map((t) => t.id)).toEqual([state.tabs[0].id, "tb"]);
  expect(back.active).toBe("tb");
});

test("a new tab opens beside the one in front", () => {
  let state: TabsState = { tabs: [{ id: "a", url: HOME, title: null }, { id: "c", url: HOME, title: null }], active: "a" };
  state = openTab(state, { id: "b", url: HOME, title: null });
  expect(state.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
});

test("closing the tab in front brings its neighbour forward, and the last leaves a fresh one", () => {
  let state: TabsState = { tabs: [{ id: "a", url: HOME, title: null }, { id: "b", url: HOME, title: null }], active: "b" };
  state = closeTab(state, "b", HOME);
  expect(state).toEqual({ tabs: [{ id: "a", url: HOME, title: null }], active: "a" });
  state = closeTab(state, "a", HOME);
  expect(state.tabs).toHaveLength(1);
  expect(state.tabs[0].id).not.toBe("a");
  expect(state.tabs[0].url).toBe(HOME);
});

test("a page change updates only its tab", () => {
  const state = { tabs: [{ id: "a", url: HOME, title: null }], active: "a" };
  expect(updateTab(state, "a", { title: "Gutenberg" }).tabs[0].title).toBe("Gutenberg");
  expect(updateTab(state, "zz", { title: "x" })).toBe(state);
});

describe("starting afresh", () => {
  it("is one tab at the home page", () => {
    const fresh = freshTabs("https://example.org/");
    expect(fresh.tabs).toEqual([{ id: fresh.active, url: "https://example.org/", title: null }]);
  });
});

describe("moving tabs", () => {
  const three: TabsState = {
    tabs: ["a", "b", "c"].map((id) => ({ id, url: `https://${id}.org/`, title: null })),
    active: "b",
  };
  const order = (s: TabsState) => s.tabs.map((t) => t.id).join("");
  it("takes the place of the tab it's dropped on, either way", () => {
    expect(order(moveTab(three, "a", "c"))).toBe("bca");
    expect(order(moveTab(three, "c", "a"))).toBe("cab");
    expect(order(moveTab(three, "a", "b"))).toBe("bac");
    expect(moveTab(three, "a", "c").active).toBe("b");
    expect(moveTab(three, "a", "a")).toBe(three);
  });
});
