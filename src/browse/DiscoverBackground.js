import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// A picture behind Discover's start page: one of TBV's gallery paintings or
// one of your own. Kept on this device; your own picture is shrunk first so
// it fits in the browser's storage.
import { useRef, useState } from "react";
import { GALLERY, galleryUrl } from "../collections/gallery";
import { Icon } from "../components/Icon";
import { readBrowserPrefs, writeBrowserPrefs } from "./browserPrefs";
const OWN_KEY = "tbv.browser.background.own";
/** Your own picture is shrunk to this width at most. */
const OWN_WIDTH = 2400;
/** The address of the start page's background, or null for none. */
export function backgroundUrl(choice = readBrowserPrefs().background) {
    if (choice === "own") {
        try {
            return localStorage.getItem(OWN_KEY);
        }
        catch {
            return null;
        }
    }
    if (choice.startsWith("gallery:"))
        return galleryUrl(choice.slice("gallery:".length), "wide");
    return null;
}
/** Reads a picture and shrinks it to a JPEG that fits in storage. */
async function shrink(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, OWN_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.82);
}
/** None, your own picture, and the gallery, as a grid to pick from. */
export function DiscoverBackgroundPicker({ value, onError }) {
    const input = useRef(null);
    const [own, setOwn] = useState(() => backgroundUrl("own"));
    const choose = (background) => writeBrowserPrefs({ background });
    const pickOwn = async (file) => {
        if (!file)
            return;
        try {
            const url = await shrink(file);
            localStorage.setItem(OWN_KEY, url);
            setOwn(url);
            choose("own");
        }
        catch {
            onError("That picture couldn't be used. Try a smaller JPEG or PNG.");
        }
    };
    return (_jsxs("div", { className: "discover-backgrounds", role: "radiogroup", "aria-label": "Start page background", children: [_jsx("button", { type: "button", role: "radio", "aria-checked": value === "", className: "picture-choice discover-background-none", onClick: () => choose(""), children: _jsx("span", { className: "picture-choice-label", children: "None" }) }), _jsxs("button", { type: "button", role: "radio", "aria-checked": value === "own", className: "picture-choice discover-background-own", style: own ? { backgroundImage: `url(${own})` } : undefined, title: "Choose a picture of your own", onClick: () => (own && value !== "own" ? choose("own") : input.current?.click()), children: [!own && _jsx(Icon, { name: "image", size: 22 }), _jsx("span", { className: "picture-choice-label", children: own ? "Your picture" : "Your own…" })] }), GALLERY.map((g) => {
                const choice = `gallery:${g.name}`;
                const url = galleryUrl(g.name, "square");
                return (_jsx("button", { type: "button", role: "radio", "aria-checked": value === choice, className: "picture-choice", title: g.label, "aria-label": g.label, style: url ? { backgroundImage: `url(${url})` } : undefined, onClick: () => choose(choice) }, g.name));
            }), own && (_jsx("button", { type: "button", className: "link-btn discover-background-change", onClick: () => input.current?.click(), children: "Choose a different picture of your own" })), _jsx("input", { ref: input, type: "file", accept: "image/*", hidden: true, onChange: (e) => {
                    void pickOwn(e.target.files?.[0]);
                    e.target.value = "";
                } })] }));
}
