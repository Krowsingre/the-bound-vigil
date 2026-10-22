// The editor's own pieces beyond the usual formatting: pictures kept inside
// the chapter, and footnotes. Both are saved in the chapter's HTML, so they
// sync with it and the EPUB export finds them there (see epub.ts).

import { mergeAttributes, Node } from "@tiptap/react";

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    picture: {
      /** Places a picture (a `data:` address) where the cursor is. */
      insertPicture: (src: string, alt: string) => ReturnType;
    };
    footnote: {
      /** Adds a footnote at the cursor, or changes the one selected. */
      setFootnote: (text: string) => ReturnType;
    };
  }
}

/** A picture on a line of its own. */
export const Picture = Node.create({
  name: "picture",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, alt: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { class: "writing-picture" })];
  },
  addCommands() {
    return {
      insertPicture:
        (src, alt) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src, alt } }),
    };
  },
});

/** A footnote: a number in the text, its words kept with it. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-footnote") ?? "",
        renderHTML: (attrs) => ({ "data-footnote": attrs.text as string }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },
  renderHTML({ HTMLAttributes }) {
    // The number is drawn by the page's stylesheet, counting footnotes in order.
    return ["sup", mergeAttributes(HTMLAttributes, { class: "writing-footnote", title: HTMLAttributes["data-footnote"] as string })];
  },
  addCommands() {
    return {
      setFootnote:
        (text) =>
        ({ state, commands }) => {
          const selected = (state.selection as { node?: { type: { name: string } } }).node;
          if (selected?.type.name === this.name) return commands.updateAttributes(this.name, { text });
          return commands.insertContent({ type: this.name, attrs: { text } });
        },
    };
  },
});

/** The longest side a picture is kept at, and how much it's squeezed, so chapters stay light enough to sync. */
const LONGEST_SIDE = 1600;
const QUALITY = 0.85;
/** Pictures already this small are kept as they are. */
const SMALL_ENOUGH = 300_000;

/** A picture file as a `data:` address, made smaller first when it's large. */
export async function pictureAddress(file: File): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That picture couldn't be read."));
    reader.readAsDataURL(file);
  });
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That picture couldn't be opened. Try a JPEG or PNG.");
  const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SMALL_ENOUGH && /^image\/(jpeg|png|gif|webp)$/.test(file.type)) return original;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // PNGs keep their see-through parts unless that leaves them heavy; everything else becomes a JPEG.
  const png = file.type === "image/png" ? canvas.toDataURL("image/png") : null;
  return png && png.length < 4 * SMALL_ENOUGH ? png : canvas.toDataURL("image/jpeg", QUALITY);
}
