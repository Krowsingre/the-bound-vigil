import { jsx as _jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DefineCard, SelectionToolbar } from "./ReaderPopovers";
import { googleTranslate } from "./Reader";
vi.mock("../api", () => ({ api: { coverUrl: () => "", getSetting: async () => null }, isApp: false, isIOS: false, isMac: false, isAndroid: false }));
afterEach(() => cleanup());
const rect = new DOMRect(100, 200, 60, 20);
it("offers Define, Search and Translate beside highlighting", () => {
    const onDefine = vi.fn();
    const onSearch = vi.fn();
    const onTranslate = vi.fn();
    render(_jsx(SelectionToolbar, { rect: rect, onColor: vi.fn(), onNote: vi.fn(), onCopy: vi.fn(), onDefine: onDefine, onSearch: onSearch, onTranslate: onTranslate }));
    fireEvent.click(screen.getByRole("button", { name: "Define" }));
    fireEvent.click(screen.getByRole("button", { name: "Search the web" }));
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect([onDefine, onSearch, onTranslate].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
});
it("shows a word's meanings by part of speech, or says none were found", () => {
    const onSearch = vi.fn();
    const { rerender } = render(_jsx(DefineCard, { rect: rect, text: "stopped", definitions: [
            { word: "stopped", senses: [{ part: "adjective", definition: "not moving or operating", example: "stopped machinery" }] },
            { word: "stop", senses: [{ part: "noun", definition: "the event of something ending", example: null }, { part: "verb", definition: "come to a halt", example: null }] },
        ], onSearch: onSearch, onClose: vi.fn() }));
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["stopped", "stop"]);
    expect(screen.getByText("verb")).toBeTruthy();
    expect(screen.getByText(/“stopped machinery”/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Search the web/ }));
    expect(onSearch).toHaveBeenCalled();
    rerender(_jsx(DefineCard, { rect: rect, text: "zzqxv", definitions: [], onSearch: onSearch, onClose: vi.fn() }));
    expect(screen.getByText(/No meaning found/)).toBeTruthy();
});
it("translates in Google Translate into the device's language", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    expect(googleTranslate("a quiet lantern")).toBe("https://translate.google.com/?sl=auto&tl=fr&text=a%20quiet%20lantern&op=translate");
});
