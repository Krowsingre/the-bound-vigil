// How a printed PDF is laid out (see printBook.ts), kept apart so the export
// settings can read them without the layout code.
export const DEFAULT_PRINT = { trim: "6x9", mirrored: true, bleed: false, chaptersRight: true, runningHeads: true, pageNumbers: true };
/** Trim sizes, in inches, with their names. */
export const TRIMS = [
    { value: "5x8", label: "5 × 8 in", width: 5, height: 8 },
    { value: "5.25x8", label: "5.25 × 8 in", width: 5.25, height: 8 },
    { value: "5.5x8.5", label: "5.5 × 8.5 in", width: 5.5, height: 8.5 },
    { value: "6x9", label: "6 × 9 in (most novels)", width: 6, height: 9 },
    { value: "7x10", label: "7 × 10 in", width: 7, height: 10 },
    { value: "a5", label: "A5 (148 × 210 mm)", width: 5.83, height: 8.27 },
    { value: "letter", label: "US Letter (8.5 × 11 in)", width: 8.5, height: 11 },
];
export function readPrint(saved) {
    const p = (saved && typeof saved === "object" ? saved : {});
    const bool = (v, d) => (typeof v === "boolean" ? v : d);
    return {
        trim: TRIMS.some((t) => t.value === p.trim) ? p.trim : DEFAULT_PRINT.trim,
        mirrored: bool(p.mirrored, DEFAULT_PRINT.mirrored),
        bleed: bool(p.bleed, DEFAULT_PRINT.bleed),
        chaptersRight: bool(p.chaptersRight, DEFAULT_PRINT.chaptersRight),
        runningHeads: bool(p.runningHeads, DEFAULT_PRINT.runningHeads),
        pageNumbers: bool(p.pageNumbers, DEFAULT_PRINT.pageNumbers),
    };
}
