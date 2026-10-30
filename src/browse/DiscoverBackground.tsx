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
export function backgroundUrl(choice: string = readBrowserPrefs().background): string | null {
  if (choice === "own") {
    try {
      return localStorage.getItem(OWN_KEY);
    } catch {
      return null;
    }
  }
  if (choice.startsWith("gallery:")) return galleryUrl(choice.slice("gallery:".length), "wide");
  return null;
}

/** Reads a picture and shrinks it to a JPEG that fits in storage. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, OWN_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** None, your own picture, and the gallery, as a grid to pick from. */
export function DiscoverBackgroundPicker({ value, onError }: { value: string; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [own, setOwn] = useState(() => backgroundUrl("own"));
  const choose = (background: string) => writeBrowserPrefs({ background });

  const pickOwn = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await shrink(file);
      localStorage.setItem(OWN_KEY, url);
      setOwn(url);
      choose("own");
    } catch {
      onError("That picture couldn't be used. Try a smaller JPEG or PNG.");
    }
  };

  return (
    <div className="discover-backgrounds" role="radiogroup" aria-label="Start page background">
      <button type="button" role="radio" aria-checked={value === ""} className="picture-choice discover-background-none" onClick={() => choose("")}>
        <span className="picture-choice-label">None</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "own"}
        className="picture-choice discover-background-own"
        style={own ? { backgroundImage: `url(${own})` } : undefined}
        title="Choose a picture of your own"
        onClick={() => (own && value !== "own" ? choose("own") : input.current?.click())}
      >
        {!own && <Icon name="image" size={22} />}
        <span className="picture-choice-label">{own ? "Your picture" : "Your own…"}</span>
      </button>
      {GALLERY.map((g) => {
        const choice = `gallery:${g.name}`;
        const url = galleryUrl(g.name, "square");
        return (
          <button
            key={g.name}
            type="button"
            role="radio"
            aria-checked={value === choice}
            className="picture-choice"
            title={g.label}
            aria-label={g.label}
            style={url ? { backgroundImage: `url(${url})` } : undefined}
            onClick={() => choose(choice)}
          />
        );
      })}
      {own && (
        <button type="button" className="link-btn discover-background-change" onClick={() => input.current?.click()}>
          Choose a different picture of your own
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pickOwn(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
