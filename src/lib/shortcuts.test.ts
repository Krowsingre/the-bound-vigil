import { afterEach, describe, expect, it, vi } from "vitest";

function device(phone: boolean, computer: boolean) {
  vi.stubGlobal("screen", phone ? { width: 390, height: 844 } : { width: 1024, height: 1366 });
  vi.stubGlobal("matchMedia", () => ({
    matches: computer,
    addEventListener() {},
    removeEventListener() {},
  }));
}

async function fresh() {
  vi.resetModules();
  return import("./shortcuts");
}

afterEach(() => vi.unstubAllGlobals());

describe("keyboard shortcut hints", () => {
  it("never show on a phone, even with a keyboard", async () => {
    device(true, false);
    const { shortcutsShown } = await fresh();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
    expect(shortcutsShown()).toBe(false);
  });

  it("always show on a computer", async () => {
    device(false, true);
    const { shortcutsShown } = await fresh();
    expect(shortcutsShown()).toBe(true);
  });

  it("show on an iPad only once a real keyboard is used", async () => {
    device(false, false);
    const { shortcutsShown } = await fresh();
    expect(shortcutsShown()).toBe(false);
    const box = document.createElement("input");
    document.body.append(box);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(shortcutsShown()).toBe(false);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(shortcutsShown()).toBe(true);
    box.remove();
  });

  it("keeps showing them on a narrow window that isn't a phone", async () => {
    device(false, true);
    vi.stubGlobal("innerWidth", 500);
    const { shortcutsShown } = await fresh();
    expect(shortcutsShown()).toBe(true);
  });

  it("hears keys from a book's page", async () => {
    device(false, false);
    const { noteKey, shortcutsShown } = await fresh();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const page = frame.contentDocument!.createElement("p");
    noteKey({ key: "ArrowRight", ctrlKey: false, metaKey: false, altKey: false, target: page } as unknown as KeyboardEvent);
    expect(shortcutsShown()).toBe(true);
    frame.remove();
  });

  it("tells keyboard keys from on-screen typing", async () => {
    const { fromKeyboard } = await fresh();
    const box = document.createElement("textarea");
    const page = document.createElement("div");
    const key = (k: string, target: EventTarget, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, target, ...mods });
    expect(fromKeyboard(key("a", box))).toBe(false);
    expect(fromKeyboard(key("Enter", box))).toBe(false);
    expect(fromKeyboard(key("a", box, { metaKey: true }))).toBe(true);
    expect(fromKeyboard(key("ArrowDown", box))).toBe(true);
    expect(fromKeyboard(key("j", page))).toBe(true);
  });
});
