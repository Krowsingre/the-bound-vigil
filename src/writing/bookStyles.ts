// Book styles: matched sets of chapter headings, ornaments, first letters,
// first lines, scene breaks and fonts, chosen in one go. Choosing one fills
// in the export settings it covers (each can still be changed afterwards)
// and adds its own look for headings. The same styles shape the EPUB, the
// preview and the printed PDF.

import type { ExportSettings } from "./epub";

export interface BookStyle {
  id: string;
  label: string;
  /** What it suits, in a few words. */
  about: string;
  /** The export settings it sets. */
  fields: Partial<Pick<ExportSettings, "font" | "sceneBreak" | "titles" | "dropCap" | "smallCaps" | "chapterHeading" | "paragraphs" | "align">>;
  /** Its own styles for headings and ornaments (EPUB-safe CSS). */
  css: string;
}

const ornament = (glyph: string, size = "1.1em") =>
  `section.chapter > h1::after { content: "${glyph}"; display: block; font-size: ${size}; margin-top: 0.6em; font-weight: normal; letter-spacing: 0.3em; }`;

export const BOOK_STYLES: BookStyle[] = [
  {
    id: "classic",
    label: "Classic",
    about: "Timeless novels",
    fields: { font: "lora", sceneBreak: "ornament", titles: "center", dropCap: true, smallCaps: true, chapterHeading: "words", paragraphs: "indent", align: "justify" },
    css: `.chapter-label { font-variant: small-caps; text-transform: none; letter-spacing: 0.15em; font-size: 0.95em; }
section.chapter > h1 { font-style: italic; }
${ornament("❦")}`,
  },
  {
    id: "vigil",
    label: "Vigil",
    about: "Gothic and dark fantasy",
    fields: { font: "lora", sceneBreak: "ornament", titles: "center", dropCap: true, smallCaps: false, chapterHeading: "numeral", paragraphs: "indent", align: "justify" },
    css: `.chapter-label { font-size: 2.4em; letter-spacing: 0; margin-bottom: -0.4em; }
section.chapter > h1 { text-transform: uppercase; letter-spacing: 0.22em; font-size: 1.15em; }
${ornament("◆", "0.6em")}`,
  },
  {
    id: "romance",
    label: "Romance",
    about: "Love stories",
    fields: { font: "lora", sceneBreak: "ornament", titles: "center", dropCap: false, smallCaps: true, chapterHeading: "words", paragraphs: "indent", align: "justify" },
    css: `.chapter-label { font-style: italic; text-transform: none; letter-spacing: 0.04em; font-size: 1em; }
section.chapter > h1 { font-style: italic; font-size: 1.9em; }
${ornament("❧")}`,
  },
  {
    id: "thriller",
    label: "Thriller",
    about: "Crime and suspense",
    fields: { font: "none", sceneBreak: "space", titles: "left", dropCap: false, smallCaps: false, chapterHeading: "numeral", paragraphs: "indent", align: "justify" },
    css: `.chapter-label { font-size: 3em; font-weight: bold; letter-spacing: -0.02em; margin-bottom: -0.3em; font-family: sans-serif; }
section.chapter > h1 { text-transform: uppercase; font-weight: bold; letter-spacing: 0.08em; font-size: 1em; font-family: sans-serif; border-bottom: 2px solid currentColor; padding-bottom: 0.4em; }`,
  },
  {
    id: "literary",
    label: "Literary",
    about: "Quiet, spacious pages",
    fields: { font: "lora", sceneBreak: "space", titles: "center", dropCap: false, smallCaps: true, chapterHeading: "title", paragraphs: "indent", align: "justify" },
    css: `section.chapter > h1 { font-size: 1.1em; text-transform: uppercase; letter-spacing: 0.35em; margin-top: 4em; margin-bottom: 3em; }`,
  },
  {
    id: "fantasy",
    label: "Fantasy",
    about: "Epics and adventures",
    fields: { font: "lora", sceneBreak: "ornament", titles: "center", dropCap: true, smallCaps: true, chapterHeading: "number", paragraphs: "indent", align: "justify" },
    css: `.chapter-label { letter-spacing: 0.3em; }
section.chapter > h1 { font-size: 1.8em; }
${ornament("✦ ✦ ✦", "0.7em")}`,
  },
  {
    id: "modern",
    label: "Modern",
    about: "Contemporary fiction",
    fields: { font: "none", sceneBreak: "line", titles: "left", dropCap: false, smallCaps: false, chapterHeading: "numeral", paragraphs: "indent", align: "left" },
    css: `.chapter-label { font-family: sans-serif; font-size: 1em; letter-spacing: 0.2em; }
section.chapter > h1 { font-family: sans-serif; font-weight: 300; font-size: 1.7em; }`,
  },
  {
    id: "mystery",
    label: "Mystery",
    about: "Whodunnits and cosy crime",
    fields: { font: "lora", sceneBreak: "asterisks", titles: "center", dropCap: false, smallCaps: true, chapterHeading: "number", paragraphs: "indent", align: "justify" },
    css: `.chapter-label::before, .chapter-label::after { content: " — "; }
section.chapter > h1 { font-style: italic; font-size: 1.5em; }`,
  },
  {
    id: "storybook",
    label: "Storybook",
    about: "Children's and fables",
    fields: { font: "lora", sceneBreak: "ornament", titles: "center", dropCap: true, smallCaps: false, chapterHeading: "words", paragraphs: "space", align: "left" },
    css: `.chapter-label { font-size: 1em; letter-spacing: 0.08em; }
section.chapter > h1 { font-size: 2em; font-weight: bold; }
${ornament("✿")}`,
  },
  {
    id: "nonfiction",
    label: "Non-fiction",
    about: "Memoir, history, how-to",
    fields: { font: "lora", sceneBreak: "line", titles: "left", dropCap: false, smallCaps: false, chapterHeading: "number", paragraphs: "space", align: "left" },
    css: `.chapter-label { font-family: sans-serif; font-size: 0.85em; }
section.chapter > h1 { font-weight: bold; font-size: 1.7em; border-bottom: 1px solid currentColor; padding-bottom: 0.3em; }
h2 { font-family: sans-serif; }`,
  },
  {
    id: "poetry",
    label: "Poetry",
    about: "Collections of poems",
    fields: { font: "lora", sceneBreak: "ornament", titles: "left", dropCap: false, smallCaps: false, chapterHeading: "title", paragraphs: "space", align: "left" },
    css: `section.chapter > h1 { font-style: italic; font-size: 1.3em; margin-bottom: 1.5em; }`,
  },
  {
    id: "minimal",
    label: "Minimal",
    about: "Clean and plain",
    fields: { font: "none", sceneBreak: "space", titles: "left", dropCap: false, smallCaps: false, chapterHeading: "title", paragraphs: "indent", align: "left" },
    css: `section.chapter > h1 { font-size: 1.3em; font-weight: normal; }`,
  },
];

export const styleById = (id: string | null | undefined) => BOOK_STYLES.find((s) => s.id === id) ?? null;

/** The settings with a style chosen: its fields filled in, and its looks kept. */
export function chooseStyle(settings: ExportSettings, id: string | null): ExportSettings {
  const style = styleById(id);
  return style ? { ...settings, ...style.fields, bookStyle: style.id } : { ...settings, bookStyle: null };
}

/** The chosen style's own CSS, for the book's stylesheet. */
export const styleCss = (settings: ExportSettings) => styleById(settings.bookStyle)?.css ?? "";
