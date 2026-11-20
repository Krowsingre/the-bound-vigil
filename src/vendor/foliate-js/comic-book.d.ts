/** Manga order from a comic's ComicInfo.xml: "rtl" when it says YesAndRightToLeft. */
export function comicDirection(archive: {
  entries: { filename: string }[];
  loadBlob: (name: string) => Promise<{ text(): Promise<string> }>;
}): Promise<"ltr" | "rtl">;
export function makeComicBook(loader: unknown, file: File): Promise<unknown>;
