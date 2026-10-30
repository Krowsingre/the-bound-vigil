// The editor's own pieces beyond the usual formatting: pictures kept inside
// the chapter, footnotes, and page breaks. Both are saved in the chapter's HTML, so they
// sync with it and the EPUB export finds them there (see epub.ts).

import { Extension, Mark, mergeAttributes, Node } from "@tiptap/react";

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    picture: {
      /** Places a picture (a `data:` address) where the cursor is. */
      insertPicture: (src: string, alt: string) => ReturnType;
      /** Changes the selected picture's caption, description or size. */
      setPictureLook: (look: Partial<{ caption: string; alt: string; size: "inline" | "full" }>) => ReturnType;
    };
    footnote: {
      /** Adds a footnote at the cursor, or changes the one selected. */
      setFootnote: (text: string) => ReturnType;
    };
    pageBreak: {
      /** Starts a new page at the cursor, within the same chapter. */
      setPageBreak: () => ReturnType;
    };
    textLook: {
      /** Sets parts of the selected words' look (font, size, capitals, spacing); null takes one off. */
      setTextLook: (look: Partial<TextLook>) => ReturnType;
      /** Changes the selected words' letters to Title Case. */
      titleCase: () => ReturnType;
    };
    citation: {
      /** Cites a source at the cursor, with a page or other place in it; or changes the citation selected. */
      setCitation: (source: string, locator: string, label: string) => ReturnType;
    };
    blockLook: {
      /** Sets the selected paragraphs' alignment or line spacing; null goes back to the book's own. */
      setBlockLook: (look: Partial<BlockLook>) => ReturnType;
    };
  }
}

/** A picture on a line of its own, with a caption under it if it has one, or on a page of its own. */
export const Picture = Node.create({
  name: "picture",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, alt: { default: "" }, caption: { default: "" }, size: { default: "inline" } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-picture]",
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector("img");
          if (!img?.getAttribute("src")) return false;
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt") ?? "",
            caption: ((el as HTMLElement).querySelector("figcaption")?.textContent ?? "").trim(),
            size: (el as HTMLElement).getAttribute("data-size") === "full" ? "full" : "inline",
          };
        },
      },
      { tag: "img[src]" },
    ];
  },
  renderHTML({ node }) {
    const { src, alt, caption, size } = node.attrs as { src: string; alt: string; caption: string; size: string };
    const img = ["img", { src, alt, class: "writing-picture" }];
    return [
      "figure",
      { "data-picture": "", class: `writing-figure${size === "full" ? " is-full" : ""}`, ...(size === "full" ? { "data-size": "full" } : {}) },
      img,
      ...(caption ? [["figcaption", {}, caption]] : []),
    ] as unknown as readonly [string, ...unknown[]];
  },
  addCommands() {
    return {
      insertPicture:
        (src, alt) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src, alt } }),
      setPictureLook:
        (look) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, look),
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

/** A new page within a chapter: what follows starts on the next page of the EPUB. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "writing-page-break" })];
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name }, { type: "paragraph" }]),
    };
  },
});

/** The longest side a picture is kept at, and how much it's squeezed, so chapters stay light enough to sync. */
const LONGEST_SIDE = 1600;
const QUALITY = 0.85;
/** Pictures already this small are kept as they are. */
const SMALL_ENOUGH = 300_000;
/** The largest GIF kept, since GIFs can't be made smaller here. */
const MAX_GIF = 4_000_000;

/** A picture file as a `data:` address, made smaller first when it's large. */
export async function pictureAddress(file: File): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That picture couldn't be read."));
    reader.readAsDataURL(file);
  });
  // A canvas keeps only a GIF's first frame, so GIFs stay as they are, moving or not.
  if (file.type === "image/gif") {
    if (file.size > MAX_GIF) throw new Error("That GIF is too large to keep in a chapter (over 4 MB). Make it smaller first.");
    return original;
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That picture couldn't be opened. Try a JPEG or PNG.");
  const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SMALL_ENOUGH && /^image\/(jpeg|png|webp)$/.test(file.type)) return original;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // PNGs keep their see-through parts unless that leaves them heavy; everything else becomes a JPEG.
  const png = file.type === "image/png" ? canvas.toDataURL("image/png") : null;
  return png && png.length < 4 * SMALL_ENOUGH ? png : canvas.toDataURL("image/jpeg", QUALITY);
}

/** Highlighted words, kept as <mark>. */
export const Highlight = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", HTMLAttributes, 0];
  },
});

/** Raised small letters (1st, x²), kept apart from footnote numbers. */
export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML() {
    return [{ tag: "sup", getAttrs: (el) => (el.hasAttribute("data-footnote") ? false : null) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", HTMLAttributes, 0];
  },
});

/** Lowered small letters (H₂O). */
export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sub", HTMLAttributes, 0];
  },
});

/**
 * How some words look, kept as a <span style> so it travels into the EPUB as
 * it is. Capitals are a style, not retyped letters, so taking them off gives
 * the words back as they were written.
 */
export interface TextLook {
  fontFamily: string | null;
  fontSize: string | null;
  /** "uppercase" for ALL CAPS. */
  textTransform: string | null;
  /** "small-caps". */
  fontVariant: string | null;
  letterSpacing: string | null;
  wordSpacing: string | null;
}

const TEXT_LOOK: { key: keyof TextLook; css: string }[] = [
  { key: "fontFamily", css: "font-family" },
  { key: "fontSize", css: "font-size" },
  { key: "textTransform", css: "text-transform" },
  { key: "fontVariant", css: "font-variant" },
  { key: "letterSpacing", css: "letter-spacing" },
  { key: "wordSpacing", css: "word-spacing" },
];

/** Words kept small in Title Case, unless first or last. */
const SMALL_WORDS = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via", "with", "from", "into", "than"]);

/** Title Case for a run of words: each word capitalized but the small joining ones. */
export function toTitleCase(text: string, startsTitle = true, endsTitle = true): string {
  const words = [...text.matchAll(/[\p{L}\p{N}'’]+/gu)];
  let out = text;
  words.forEach((m, i) => {
    const word = m[0];
    const lower = word.toLowerCase();
    const edge = (i === 0 && startsTitle) || (i === words.length - 1 && endsTitle);
    // Words written with capitals inside (iPhone, McKay, NASA) are left as they are, unless they're small joining words.
    const small = !edge && SMALL_WORDS.has(lower);
    const next = small ? lower : /\p{Lu}/u.test(word.slice(1)) ? word : lower.charAt(0).toUpperCase() + lower.slice(1);
    out = out.slice(0, m.index) + next + out.slice(m.index! + word.length);
  });
  return out;
}

export const TextLookMark = Mark.create({
  name: "textLook",
  addAttributes() {
    return Object.fromEntries(
      TEXT_LOOK.map(({ key, css }) => [
        key,
        {
          default: null,
          parseHTML: (el: HTMLElement) => el.style.getPropertyValue(css) || null,
          renderHTML: (attrs: Record<string, string | null>) => (attrs[key] ? { style: `${css}: ${attrs[key]}` } : {}),
        },
      ]),
    );
  },
  parseHTML() {
    return [{ tag: "span[style]", getAttrs: (el) => (TEXT_LOOK.some(({ css }) => el.style.getPropertyValue(css)) ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
  addCommands() {
    return {
      setTextLook:
        (look) =>
        ({ editor, chain }) => {
          const next: Record<string, string | null> = { ...(editor.getAttributes(this.name) as Record<string, string | null>), ...look };
          const any = TEXT_LOOK.some(({ key }) => next[key]);
          return any ? chain().setMark(this.name, next).run() : chain().unsetMark(this.name).run();
        },
      titleCase:
        () =>
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = state.selection;
          if (empty) return false;
          if (dispatch) {
            // Each run of text is changed where it stands; the letters only change case, so nothing moves.
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (!node.isText || !node.text) return;
              const start = Math.max(from, pos);
              const end = Math.min(to, pos + node.text.length);
              const part = node.text.slice(start - pos, end - pos);
              const titled = toTitleCase(part, start === from, end === to);
              if (titled !== part) tr.replaceWith(start, end, state.schema.text(titled, node.marks));
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

/** How a paragraph or heading is set: its alignment and line spacing. */
export interface BlockLook {
  textAlign: "left" | "center" | "right" | "justify" | null;
  lineHeight: string | null;
}

const BLOCK_TYPES = ["paragraph", "heading"];

export const BlockLookExtension = Extension.create({
  name: "blockLook",
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.textAlign || null,
            renderHTML: (attrs: Record<string, string | null>) => (attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {}),
          },
          lineHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.lineHeight || null,
            renderHTML: (attrs: Record<string, string | null>) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setBlockLook:
        (look) =>
        ({ commands }) =>
          BLOCK_TYPES.map((type) => commands.updateAttributes(type, look)).some(Boolean),
    };
  },
});

/**
 * Writing a poem: Enter ends a line, not the stanza, and a second Enter on
 * the empty line starts the next stanza. Tab indents the line by exact
 * spaces, which the EPUB keeps as an indent (see poemHtml in epub.ts).
 */
export const PoemLines = Extension.create({
  name: "poemLines",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== "paragraph" || $from.parentOffset === 0) return false;
        const before = $from.nodeBefore;
        if (before?.type.name === "hardBreak")
          return editor
            .chain()
            .deleteRange({ from: $from.pos - before.nodeSize, to: $from.pos })
            .splitBlock()
            .run();
        return editor.commands.setHardBreak();
      },
      Tab: ({ editor }) => editor.commands.insertContent("\u00a0\u00a0\u00a0\u00a0"),
    };
  },
});

/**
 * A citation of one of the book's sources, kept as <cite data-source>. The
 * editor shows a short label; the EPUB writes it in the book's citation
 * style (see sources.ts).
 */
export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      source: { default: "", parseHTML: (el) => el.getAttribute("data-source") ?? "", renderHTML: (a) => ({ "data-source": a.source as string }) },
      locator: { default: "", parseHTML: (el) => el.getAttribute("data-locator") ?? "", renderHTML: (a) => ({ "data-locator": a.locator as string }) },
      label: { default: "", parseHTML: (el) => el.textContent ?? "", renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [{ tag: "cite[data-source]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["cite", mergeAttributes(HTMLAttributes, { class: "writing-citation" }), (node.attrs.label as string) || "(source)"];
  },
  addCommands() {
    return {
      setCitation:
        (source, locator, label) =>
        ({ state, commands }) => {
          const selected = (state.selection as { node?: { type: { name: string } } }).node;
          const attrs = { source, locator, label };
          if (selected?.type.name === this.name) return commands.updateAttributes(this.name, attrs);
          return commands.insertContent({ type: this.name, attrs });
        },
    };
  },
});
