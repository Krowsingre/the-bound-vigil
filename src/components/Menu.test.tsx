import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Menu } from "./Menu";

it("keeps the ellipsis menu's size and position when entering a short submenu and going back", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains("menu-floating")) return new DOMRect(400, 80, 20, 20);
    return this.textContent?.includes("Back to Book menu") ? new DOMRect(0, 0, 200, 80) : new DOMRect(0, 0, 320, 240);
  });
  const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(240);
  const click = (label: string) => {
    const button = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent === label);
    act(() => button!.click());
  };
  try {
    act(() => root.render(<Menu label="Book menu" trigger="…" items={[
      { label: "Reading status", submenu: [{ label: "Read" }] },
      { label: "Edit details" },
    ]} />));
    click("Book menu");
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const original = menu.style.cssText;
    expect(menu.style.width).toBe("320px");
    expect(menu.style.height).toBe("240px");
    click("Reading status");
    expect(menu.textContent).toContain("Back to Book menu");
    expect(menu.style.cssText).toBe(original);
    click("Back to Book menu");
    expect(menu.textContent).toContain("Edit details");
    expect(menu.style.cssText).toBe(original);
  } finally {
    act(() => root.unmount());
    container.remove();
    bounds.mockRestore();
    scrollHeight.mockRestore();
    vi.unstubAllGlobals();
  }
});
