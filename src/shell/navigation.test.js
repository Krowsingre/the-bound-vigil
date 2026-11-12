import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { navigationDirection, requestAppHistory } from "./navigationKeys";
import { useNavigationHistory } from "./useNavigationHistory";
import { useNavigationShortcuts } from "./useNavigationShortcuts";
afterEach(() => cleanup());
function session() {
    const [place, setPlace] = useState({ route: "archive", detail: null });
    const navigation = useNavigationHistory(place, setPlace, (a, b) => a.route === b.route && a.detail === b.detail);
    return { ...navigation, place, setPlace };
}
test("Back and Forward restore screens and book details; a new destination clears Forward", () => {
    const { result } = renderHook(session);
    act(() => result.current.setPlace({ route: "archive", detail: "book-a" }));
    act(() => result.current.setPlace({ route: "resonance", detail: null }));
    act(() => result.current.back());
    expect(result.current.place).toEqual({ route: "archive", detail: "book-a" });
    act(() => result.current.back());
    expect(result.current.place).toEqual({ route: "archive", detail: null });
    act(() => result.current.forward());
    expect(result.current.place.detail).toBe("book-a");
    act(() => result.current.setPlace({ route: "compendium", detail: null }));
    act(() => result.current.forward());
    expect(result.current.place.route).toBe("compendium");
    act(() => result.current.back());
    expect(result.current.place.detail).toBe("book-a");
});
test("repeated keys within one render use the updated history and stop at its bounds", () => {
    const { result } = renderHook(session);
    act(() => result.current.back());
    expect(result.current.place.route).toBe("archive");
    act(() => result.current.setPlace({ route: "resonance", detail: null }));
    act(() => result.current.setPlace({ route: "discover", detail: null }));
    act(() => { result.current.back(); result.current.back(); result.current.back(); });
    expect(result.current.place.route).toBe("archive");
    act(() => { result.current.forward(); result.current.forward(); result.current.forward(); });
    expect(result.current.place.route).toBe("discover");
});
test("non-navigation rerenders preserve Forward and each session retains at most 50 previous screens", () => {
    const { result, rerender } = renderHook(session);
    for (let n = 0; n < 55; n++)
        act(() => result.current.setPlace({ route: `screen-${n}`, detail: null }));
    act(() => result.current.back());
    rerender();
    act(() => result.current.forward());
    expect(result.current.place.route).toBe("screen-54");
    act(() => { for (let n = 0; n < 60; n++)
        result.current.back(); });
    expect(result.current.place.route).toBe("screen-4");
});
const key = (key, shiftKey = true, extra = {}) => new KeyboardEvent("keydown", {
    key, altKey: true, shiftKey, bubbles: true, cancelable: true, ...extra,
});
test("Shift distinguishes app/reader history from webpages and rejects extra modifiers", () => {
    expect(navigationDirection(key("ArrowLeft"), true)).toBe("back");
    expect(navigationDirection(key("ArrowRight"), true)).toBe("forward");
    expect(navigationDirection(key("ArrowLeft", false), true)).toBeNull();
    expect(navigationDirection(key("ArrowLeft", true, { ctrlKey: true }), true)).toBeNull();
    expect(navigationDirection(key("ArrowRight", true, { metaKey: true }), true)).toBeNull();
});
test("app and webpage keys stay separate even when an address input has focus", () => {
    const back = vi.fn(), forward = vi.fn(), webpage = vi.fn();
    renderHook(() => useNavigationShortcuts({ back, forward, webpage, reading: false, discover: true }));
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    input.dispatchEvent(key("ArrowLeft", false));
    input.dispatchEvent(key("ArrowRight", false));
    expect(webpage.mock.calls).toEqual([["back"], ["forward"]]);
    expect(back).not.toHaveBeenCalled();
    input.dispatchEvent(key("ArrowLeft"));
    input.dispatchEvent(key("ArrowRight"));
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
    input.remove();
});
test("native browser events navigate the app once and the listener is removed on leaving", () => {
    const back = vi.fn(), forward = vi.fn(), webpage = vi.fn();
    const { rerender, unmount } = renderHook(({ reading, discover }) => useNavigationShortcuts({ back, forward, webpage, reading, discover }), {
        initialProps: { reading: false, discover: true },
    });
    requestAppHistory("back");
    requestAppHistory("forward");
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
    expect(webpage).not.toHaveBeenCalled(); // page events belong to Browser, not the app history.
    rerender({ reading: true, discover: true });
    window.dispatchEvent(key("ArrowLeft"));
    requestAppHistory("back");
    expect(back).toHaveBeenCalledTimes(1);
    rerender({ reading: false, discover: false });
    requestAppHistory("forward");
    window.dispatchEvent(key("ArrowLeft", false));
    expect(forward).toHaveBeenCalledTimes(1);
    expect(webpage).not.toHaveBeenCalled();
    unmount();
    requestAppHistory("back");
    expect(back).toHaveBeenCalledTimes(1);
});
test("handled events are respected and the mouse Back button keeps working", () => {
    const back = vi.fn();
    renderHook(() => useNavigationShortcuts({ back, forward: vi.fn(), webpage: vi.fn(), reading: false, discover: false }));
    const event = key("ArrowLeft");
    event.preventDefault();
    window.dispatchEvent(event);
    expect(back).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("mouseup", { button: 3, cancelable: true }));
    expect(back).toHaveBeenCalledTimes(1);
});
