// The fonts an exported EPUB can carry, fetched from the app's own copies.

import lora400 from "@fontsource/lora/files/lora-latin-400-normal.woff2?url";
import lora400i from "@fontsource/lora/files/lora-latin-400-italic.woff2?url";
import lora700 from "@fontsource/lora/files/lora-latin-700-normal.woff2?url";
import lora700i from "@fontsource/lora/files/lora-latin-700-italic.woff2?url";
import echolume from "../assets/fonts/echolume-variable.woff2?url";
import echolumeItalic from "../assets/fonts/echolume-italic-variable.woff2?url";
import type { WritingChapter } from "../api/types";
import { passageFonts, type BookFont, type EmbeddedFont, type ExportSettings, type FontFile } from "./epub";

const FILES: Record<Exclude<BookFont, "none">, { family: string; files: (Omit<FontFile, "bytes"> & { url: string })[] }> = {
  lora: {
    family: "Lora",
    files: [
      { name: "lora-400-normal.woff2", url: lora400, weight: "400", style: "normal" },
      { name: "lora-400-italic.woff2", url: lora400i, weight: "400", style: "italic" },
      { name: "lora-700-normal.woff2", url: lora700, weight: "700", style: "normal" },
      { name: "lora-700-italic.woff2", url: lora700i, weight: "700", style: "italic" },
    ],
  },
  echolume: {
    family: "Echolume",
    files: [
      { name: "echolume-variable.woff2", url: echolume, weight: "100 900", style: "normal" },
      { name: "echolume-italic-variable.woff2", url: echolumeItalic, weight: "100 900", style: "italic" },
    ],
  },
};

export async function loadFont(font: BookFont): Promise<EmbeddedFont | null> {
  if (font === "none") return null;
  const { family, files } = FILES[font];
  return {
    family,
    files: await Promise.all(
      files.map(async ({ url, ...file }) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`The ${family} font couldn't be loaded.`);
        return { ...file, bytes: new Uint8Array(await response.arrayBuffer()) };
      }),
    ),
  };
}

/** The book's own font and the ones its passages are set in, ready to put inside it. */
export async function loadBookFonts(settings: ExportSettings, chapters: WritingChapter[]): Promise<{ font: EmbeddedFont | null; passageFonts: EmbeddedFont[] }> {
  const wanted = passageFonts(chapters).filter((f) => f !== settings.font);
  const [font, ...passage] = await Promise.all([loadFont(settings.font), ...wanted.map(loadFont)]);
  return { font, passageFonts: passage.filter((f): f is EmbeddedFont => !!f) };
}

/** A cover's type from its first bytes. */
export function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}
