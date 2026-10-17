// Connects the React screen to foliate-js, the page engine. The engine draws
// the book in its own frames; this hook opens the book, applies the reading
// settings, draws highlights, and reports where the reader is and what they
// select.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Annotation } from "../api/types";
import type { Relocation, SearchResult, TocItem, View } from "../vendor/foliate-js/view.js";
import { fitTextToPage, hexToRgb, luminance } from "./darkText";
import type { ReaderSource } from "./formats";
import { DEFAULT_SETTINGS, highlightHex, readerCss, WIDTHS, type PageColors, type ReaderSettings } from "./settings";

export interface TextSelection {
  cfi: string;
  text: string;
  /** Where the selection is on screen, in window coordinates. */
  rect: DOMRect;
}

export interface EngineEvents {
  onRelocate?: (relocation: Relocation) => void;
  onSelect?: (selection: TextSelection | null) => void;
  onAnnotationClick?: (cfi: string, rect: DOMRect) => void;
  /** Key presses inside the book's frames, which the window never sees. */
  onKey?: (event: KeyboardEvent) => void;
}

export interface ReaderEngine {
  ready: boolean;
  error: string | null;
  relocation: Relocation | null;
  toc: TocItem[];
  /** Where each section (file) of the book starts, as a fraction of the whole. */
  sectionStarts: number[];
  sectionOf: (href: string) => number | null;
  goTo: (target: string) => Promise<void>;
  goToFraction: (fraction: number) => Promise<void>;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  search: (query: string) => AsyncGenerator<SearchResult> | null;
  clearSearch: () => void;
  deselect: () => void;
  /** The engine itself, for reading aloud. Null until a book is open. */
  getView: () => View | null;
}

const drawable = (a: Annotation) => a.kind !== "bookmark" && !!a.locator.cfi;

/** Rectangle of a range inside a book frame, moved into window coordinates. */
function windowRect(doc: Document, range: Range): DOMRect {
  const r = range.getBoundingClientRect();
  const frame = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
  return new DOMRect(r.left + (frame?.left ?? 0), r.top + (frame?.top ?? 0), r.width, r.height);
}

const isDarkPage = (colors: PageColors) => luminance(hexToRgb(colors.background)) < 0.2;

/** Styles inside the pages, and page layout around them. */
function applyLayout(view: View, settings: ReaderSettings, colors: PageColors) {
  const r = view.renderer;
  if (r.getAttribute("flow") !== settings.flow) r.setAttribute("flow", settings.flow);
  r.setAttribute("max-inline-size", `${WIDTHS[settings.width]}px`);
  r.setAttribute("max-column-count", "1");
  r.setAttribute("gap", "6%");
  r.setAttribute("margin", "32px");
  // Fixed-layout books (comics, pre-paginated EPUBs) keep their own styles.
  r.setStyles?.(readerCss(settings, colors));
  for (const { doc } of r.getContents?.() ?? []) fitTextToPage(doc, colors, isDarkPage(colors));
}

export function useReaderEngine({
  host,
  file,
  startCfi,
  settings,
  colors,
  annotations,
  events,
}: {
  host: RefObject<HTMLDivElement | null>;
  file: ReaderSource | null;
  startCfi: string | null;
  settings: ReaderSettings;
  colors: PageColors;
  annotations: Annotation[];
  events: EngineEvents;
}): ReaderEngine {
  const viewRef = useRef<View | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relocation, setRelocation] = useState<Relocation | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [sectionStarts, setSectionStarts] = useState<number[]>([]);

  // Latest values, read from inside the engine's event handlers.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const startRef = useRef(startCfi);
  startRef.current = startCfi;
  const styleRef = useRef({ settings, colors });
  styleRef.current = { settings, colors };

  useEffect(() => {
    const container = host.current;
    if (!file || !container) return;
    let cancelled = false;
    let view: View | null = null;
    setReady(false);
    setError(null);

    void (async () => {
      try {
        await import("../vendor/foliate-js/view.js");
        if (cancelled) return;
        view = document.createElement("foliate-view") as View;
        view.className = "reader-view";
        container.append(view);
        await view.open(file);
        if (cancelled) return;
        viewRef.current = view;
        const v = view;

        v.addEventListener("relocate", (e) => {
          const detail = (e as CustomEvent<Relocation>).detail;
          // A page can report before it has been laid out, with no position yet.
          if (!Number.isFinite(detail.fraction)) return;
          // PDFs and comics have real pages, so their page numbers are those
          // pages rather than the engine's measure of text length.
          if (v.isFixedLayout) {
            const { current, total } = detail.section;
            detail.location = { current, next: current, total };
            detail.fraction = total ? (current + 1) / total : 0;
          }
          setRelocation(detail);
          eventsRef.current.onRelocate?.(detail);
        });

        v.addEventListener("load", (e) => {
          const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
          // After the book's own styles have applied, so their colours are what's read.
          requestAnimationFrame(() => {
            const { colors } = styleRef.current;
            fitTextToPage(doc, colors, isDarkPage(colors));
          });
          const check = () => {
            const selection = doc.getSelection();
            const text = selection?.toString().trim() ?? "";
            if (!selection || selection.isCollapsed || !selection.rangeCount || !text) return;
            const range = selection.getRangeAt(0);
            eventsRef.current.onSelect?.({ cfi: v.getCFI(index, range), text, rect: windowRect(doc, range) });
          };
          doc.addEventListener("pointerdown", () => eventsRef.current.onSelect?.(null));
          doc.addEventListener("pointerup", () => setTimeout(check, 0));
          doc.addEventListener("keyup", (k) => k.shiftKey && check());
          doc.addEventListener("keydown", (k) => eventsRef.current.onKey?.(k));
        });

        v.addEventListener("create-overlay", (e) => {
          const { index } = (e as CustomEvent<{ index: number }>).detail;
          for (const a of annotationsRef.current.filter(drawable)) {
            if (v.resolveNavigation(a.locator.cfi!)?.index === index) {
              void v.addAnnotation({ value: a.locator.cfi!, color: a.color });
            }
          }
        });

        v.addEventListener("draw-annotation", async (e) => {
          const { draw, annotation } = (e as CustomEvent<{
            draw: (f: unknown, o: unknown) => void;
            annotation: { color?: string };
          }>).detail;
          const { Overlayer } = await import("../vendor/foliate-js/overlayer.js");
          draw(Overlayer.highlight, { color: highlightHex(annotation.color as Annotation["color"]) });
        });

        v.addEventListener("show-annotation", (e) => {
          const { value, index, range } = (e as CustomEvent<{ value: string; index: number; range: Range }>).detail;
          const doc = v.renderer.getContents().find((c) => c.index === index)?.doc;
          if (doc) eventsRef.current.onAnnotationClick?.(value, windowRect(doc, range));
        });

        v.addEventListener("external-link", (e) => {
          // Links to websites open in the browser, never inside the reader.
          e.preventDefault();
          const { href_ } = (e as CustomEvent<{ href_: string }>).detail;
          void import("../api").then(({ openExternal }) => openExternal(href_));
        });

        // Comics list their picture files as contents; show page numbers instead.
        const pictureName = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
        setToc((v.book.toc ?? []).map((item, i) => (pictureName.test(item.label) ? { ...item, label: `Page ${i + 1}` } : item)));
        setSectionStarts(v.getSectionFractions());
        applyLayout(v, styleRef.current.settings, styleRef.current.colors);
        await v.init({ lastLocation: startRef.current, showTextStart: true });
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      viewRef.current = null;
      // The engine's close leaves the book itself open: PDF.js workers and
      // laid-out chapters are let go here.
      const book = view?.book;
      view?.close();
      view?.remove();
      Promise.resolve(book?.destroy?.()).catch(() => {});
    };
  }, [file, host]);

  // Reading settings changed while the book is open. The read aloud voice
  // and speed don't change the page, so they don't lay it out again.
  const { font, size, lineHeight, width, flow, theme, justify } = settings;
  const look = useMemo(
    () => ({ ...DEFAULT_SETTINGS, font, size, lineHeight, width, flow, theme, justify }),
    [font, size, lineHeight, width, flow, theme, justify],
  );
  useEffect(() => {
    const view = viewRef.current;
    if (ready && view) applyLayout(view, look, colors);
  }, [ready, look, colors]);

  // Redraw highlights when they change (added, recoloured or deleted).
  const drawn = useRef(new Map<string, string>());
  useEffect(() => {
    const view = viewRef.current;
    if (!ready || !view) return;
    const want = new Map(annotations.filter(drawable).map((a) => [a.locator.cfi!, a.color ?? "rose"]));
    for (const [cfi] of drawn.current) if (!want.has(cfi)) void view.deleteAnnotation({ value: cfi });
    for (const [cfi, color] of want) {
      if (drawn.current.get(cfi) !== color) void view.addAnnotation({ value: cfi, color });
    }
    drawn.current = want;
  }, [ready, annotations]);

  const sectionOf = useCallback((href: string) => {
    try {
      return viewRef.current?.book.resolveHref(href)?.index ?? null;
    } catch {
      return null;
    }
  }, []);

  return {
    ready,
    error,
    relocation,
    toc,
    sectionStarts,
    sectionOf,
    goTo: useCallback(async (target: string) => {
      await viewRef.current?.goTo(target);
    }, []),
    goToFraction: useCallback(async (fraction: number) => {
      await viewRef.current?.goToFraction(fraction);
    }, []),
    prev: useCallback(async () => {
      await viewRef.current?.goLeft();
    }, []),
    next: useCallback(async () => {
      await viewRef.current?.goRight();
    }, []),
    search: useCallback((query: string) => {
      const view = viewRef.current;
      if (!view) return null;
      // Matches get a quiet slate outline rather than foliate's default red.
      return (async function* () {
        const { Overlayer } = await import("../vendor/foliate-js/overlayer.js");
        yield* view.search({ query, draw: Overlayer.outline, drawOptions: { color: "#5f84ad", width: 2 } });
      })();
    }, []),
    clearSearch: useCallback(() => viewRef.current?.clearSearch(), []),
    deselect: useCallback(() => viewRef.current?.deselect(), []),
    getView: useCallback(() => viewRef.current, []),
  };
}
