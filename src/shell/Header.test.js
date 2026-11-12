import { jsx as _jsx } from "react/jsx-runtime";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Header } from "./Header";
vi.mock("./SyncMenu", () => ({ SyncMenu: () => null }));
vi.mock("./WindowControls", () => ({ WindowControls: () => null }));
it("clears the current search with Ctrl+X while preserving Cut in editable text", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const editor = document.createElement("textarea");
    document.body.append(container, editor);
    const root = createRoot(container);
    const change = vi.fn();
    const noop = () => undefined;
    const press = (target) => {
        const event = new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true, cancelable: true });
        act(() => target.dispatchEvent(event));
        return event.defaultPrevented;
    };
    try {
        act(() => root.render(_jsx(Header, { sync: null, profile: null, search: "Bourne", onSearchChange: change, onSearchSubmit: noop, onImportBooks: noop, onImportFolder: noop, onOpenSyncSettings: noop, onOpenProfile: noop })));
        const input = container.querySelector("input");
        input.setSelectionRange(0, 3);
        expect(press(input)).toBe(false);
        expect(press(editor)).toBe(false);
        expect(change).not.toHaveBeenCalled();
        input.setSelectionRange(3, 3);
        expect(press(input)).toBe(true);
        expect(change).toHaveBeenCalledWith("");
    }
    finally {
        act(() => root.unmount());
        container.remove();
        editor.remove();
        vi.unstubAllGlobals();
    }
});
