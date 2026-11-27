import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BookCover } from "../components/BookCover";
import { AppSettingsProvider } from "./AppSettingsProvider";
import { applyPrivacy, parseAppSettings, PRIVACY_STORE, storedPrivacy, useAppSettings } from "./appSettings";

const root = document.documentElement;

afterEach(() => {
  applyPrivacy({ on: false, hideAvatar: false, hideActivity: false });
  localStorage.clear();
});

describe("privacy mode", () => {
  it("is off unless saved, and reads saved choices", () => {
    expect(parseAppSettings(null).privacy).toEqual({ on: false, hideAvatar: false, hideActivity: false });
    expect(parseAppSettings(JSON.stringify({ privacy: { on: true, hideAvatar: true, hideActivity: true } })).privacy).toEqual({
      on: true,
      hideAvatar: true,
      hideActivity: true,
    });
  });

  it("keeps a picture hidden that was hidden with the covers before", () => {
    expect(parseAppSettings(JSON.stringify({ privacy: { on: true, style: "blank", avatar: true } })).privacy.hideAvatar).toBe(true);
    expect(parseAppSettings(JSON.stringify({ privacy: { on: false, style: "titles", avatar: true } })).privacy.hideAvatar).toBe(false);
  });

  it("marks the whole window, and remembers it for the next start", () => {
    applyPrivacy({ on: true, hideAvatar: true, hideActivity: true });
    expect(root.hasAttribute("data-privacy")).toBe(true);
    expect(root.hasAttribute("data-privacy-avatar")).toBe(true);
    expect(root.hasAttribute("data-privacy-activity")).toBe(true);
    expect(JSON.parse(localStorage.getItem(PRIVACY_STORE)!).on).toBe(true);
    expect(storedPrivacy().on).toBe(true);
    applyPrivacy({ on: false, hideAvatar: false, hideActivity: false });
    expect(root.hasAttribute("data-privacy")).toBe(false);
    expect(root.hasAttribute("data-privacy-avatar")).toBe(false);
    expect(root.hasAttribute("data-privacy-activity")).toBe(false);
  });

  it("keeps the cover loaded under a plain tile, so switching is instant", () => {
    render(<BookCover book={{ id: "sha256:b1", title: "Dracula", authors: ["Bram Stoker"], coverPath: "covers/b1.jpg" }} />);
    expect(document.querySelector(".cover-private")?.textContent).toContain("Dracula");
  });

  it("toggles straight away, before anything else draws", () => {
    function Switch() {
      const { togglePrivacy } = useAppSettings();
      return (
        <button type="button" onClick={togglePrivacy}>
          toggle
        </button>
      );
    }
    render(
      <AppSettingsProvider>
        <Switch />
      </AppSettingsProvider>,
    );
    act(() => fireEvent.click(screen.getByText("toggle")));
    expect(root.hasAttribute("data-privacy")).toBe(true);
    act(() => fireEvent.click(screen.getByText("toggle")));
    expect(root.hasAttribute("data-privacy")).toBe(false);
  });
});
