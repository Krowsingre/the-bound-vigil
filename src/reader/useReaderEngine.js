// Connects the React screen to foliate-js, the page engine. The engine draws
// the book in its own frames; this hook opens the book, applies the reading
// settings, draws highlights, and reports where the reader is and what they
// select.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAndroid, isIOS } from "../api";
import { fitTextToPage, hexToRgb, luminance } from "./darkText";
import { describeStructuredContent } from "./structuredContent";
import { DEFAULT_SETTINGS, highlightHex, readerCss, WIDTHS } from "./settings";
/** Phones and tablets, which select a word by pressing and holding it. */
const touchOnly = typeof window !== "undefined" && (isIOS || isAndroid || window.matchMedia?.("(hover: none)").matches === true);
/** Selects the word at a point in the page, if there's one there. */
export function selectWordAt(doc, x, y) {
    const caret = doc.caretRangeFromPoint?.(x, y) ?? null;
    const node = caret?.startContainer;
    if (!caret || !node || node.nodeType !== Node.TEXT_NODE)
        return false;
    const text = node.textContent ?? "";
    const isWord = (c) => !!c && /[\p{L}\p{N}'’-]/u.test(c);
    let start = caret.startOffset;
    let end = caret.startOffset;
    while (start > 0 && isWord(text[start - 1]))
        start--;
    while (end < text.length && isWord(text[end]))
        end++;
    // Quotes and dashes at the edges aren't part of the word.
    while (start < end && /['’-]/.test(text[start]))
        start++;
    while (end > start && /['’-]/.test(text[end - 1]))
        end--;
    if (start === end)
        return false;
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
}
const drawable = (a) => a.kind !== "bookmark" && !!a.locator.cfi;
/** Rectangle of a range inside a book frame, moved into window coordinates. */
function windowRect(doc, range) {
    const r = range.getBoundingClientRect();
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
    return new DOMRect(r.left + (frame?.left ?? 0), r.top + (frame?.top ?? 0), r.width, r.height);
}
const isDarkPage = (colors) => luminance(hexToRgb(colors.background)) < 0.2;
/** A book's own size in pixels for an absolute font size ("12pt", "18px"), or null. */
export function absoluteSize(value) {
    const m = /^\s*(\d*\.?\d+)\s*(px|pt)\s*$/i.exec(value);
    if (!m)
        return null;
    const n = Number(m[1]);
    return m[2].toLowerCase() === "pt" ? (n * 4) / 3 : n;
}
/**
 * Lets the reader's own choices win over what the book fixed in place, in
 * this open copy only (the book file is never changed): the size follows the
 * reader's (a book's 18px heading stays larger than its text, in proportion),
 * and the book can't lock its line spacing or font with "!important".
 */
export function applyReaderOverrides(doc) {
    const apply = (style) => {
        const size = style.getPropertyValue("font-size").trim().toLowerCase();
        if (size === "medium") {
            style.setProperty("font-size", "var(--tbv-reading-size)", style.getPropertyPriority("font-size"));
        }
        else {
            const px = absoluteSize(size);
            if (px !== null)
                style.setProperty("font-size", `calc(var(--tbv-reading-size) * ${+(px / 16).toFixed(4)})`, "");
        }
        for (const name of ["line-height", "font-family", "font-size"]) {
            if (style.getPropertyPriority(name))
                style.setProperty(name, style.getPropertyValue(name), "");
        }
    };
    const visit = (rules) => {
        for (const rule of Array.from(rules)) {
            if ("style" in rule)
                apply(rule.style);
            if ("cssRules" in rule)
                visit(rule.cssRules);
            if ("styleSheet" in rule)
                read(rule.styleSheet);
        }
    };
    const read = (sheet) => {
        try {
            if (sheet)
                visit(sheet.cssRules);
        }
        catch {
            // A cross-origin sheet can be applied by the browser but cannot be edited.
        }
    };
    for (const sheet of Array.from(doc.styleSheets)) {
        // TBV's own sheet stays as it is.
        if (sheet.ownerNode?.id?.startsWith("tbv-reader-style"))
            continue;
        read(sheet);
    }
    for (const element of doc.querySelectorAll("[style]"))
        apply(element.style);
    keepPicturesInShape(doc);
}
/**
 * Covers made as a picture inside an SVG (as Calibre makes them) often say
 * to stretch the picture to fill the page; the reader shows it whole and in
 * its own shape instead.
 */
export function keepPicturesInShape(doc) {
    for (const svg of Array.from(doc.querySelectorAll("svg"))) {
        if (!svg.querySelector("image"))
            continue;
        if ((svg.getAttribute("preserveAspectRatio") ?? "").trim().toLowerCase().startsWith("none")) {
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        }
        for (const image of Array.from(svg.querySelectorAll("image"))) {
            if ((image.getAttribute("preserveAspectRatio") ?? "").trim().toLowerCase().startsWith("none")) {
                image.setAttribute("preserveAspectRatio", "xMidYMid meet");
            }
        }
    }
}
/** Styles inside the pages, and page layout around them. */
async function applyLayout(view, settings, colors) {
    // Scrolling shows chapters one after another on a single long page, which
    // is a different renderer from turning pages: swapped here, at the same place.
    await view.setFlow(view.isFixedLayout ? settings.pageFlow : settings.flow);
    const r = view.renderer;
    if (view.isFixedLayout) {
        // Pages keep their own look; only their size and arrangement change.
        const set = (name, value) => r.getAttribute(name) !== value && r.setAttribute(name, value);
        set("zoom", String(settings.pageZoom));
        set("spread", settings.pageSpread === "one" ? "none" : settings.pageSpread === "two" ? "both" : "auto");
        for (const { doc } of r.getContents?.() ?? [])
            fitTextToPage(doc, colors, isDarkPage(colors));
        return;
    }
    // Read when the pages are laid out, which setting their width does next.
    r.setAttribute("max-column-count", settings.textSpread === "auto" ? "2" : "1");
    r.setAttribute("max-inline-size", `${WIDTHS[settings.width]}px`);
    r.setAttribute("gap", "6%");
    r.setAttribute("margin", "32px");
    // Fixed-layout books (comics, pre-paginated EPUBs) keep their own styles.
    r.setStyles?.(readerCss(settings, colors));
    for (const { doc } of r.getContents?.() ?? [])
        fitTextToPage(doc, colors, isDarkPage(colors));
}
export function useReaderEngine({ host, file, startCfi, settings, colors, annotations, events, }) {
    const viewRef = useRef(null);
    const [ready, setReady] = useState(false);
    const [structuredTargets, setStructuredTargets] = useState([]);
    const [error, setError] = useState(null);
    const [relocation, setRelocation] = useState(null);
    const [toc, setToc] = useState([]);
    const [sectionStarts, setSectionStarts] = useState([]);
    const [fixed, setFixed] = useState(false);
    const [scale, setScale] = useState(1);
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
        if (!file || !container)
            return;
        let cancelled = false;
        let view = null;
        setReady(false);
        setStructuredTargets([]);
        setError(null);
        void (async () => {
            try {
                await import("../vendor/foliate-js/view.js");
                if (cancelled)
                    return;
                view = document.createElement("foliate-view");
                view.className = "reader-view";
                container.append(view);
                await view.open(file);
                if (cancelled)
                    return;
                viewRef.current = view;
                const v = view;
                const supportsStructuredContent = file instanceof File && /\.(epub|kepub|mobi|azw3)$/i.test(file.name);
                const snapshots = new WeakMap();
                let inspectFrame = 0;
                const inspect = () => {
                    if (!supportsStructuredContent)
                        return;
                    cancelAnimationFrame(inspectFrame);
                    inspectFrame = requestAnimationFrame(() => {
                        if (cancelled || v.isFixedLayout || !host.current)
                            return;
                        const area = host.current.getBoundingClientRect();
                        const visible = [];
                        for (const { doc, index } of v.renderer.getContents()) {
                            const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
                            if (!frame)
                                continue;
                            const elements = doc.querySelectorAll("table, pre, figure");
                            for (let i = 0; i < Math.min(elements.length, 200); i++) {
                                const element = elements[i];
                                if (element.parentElement?.closest("table, pre, figure"))
                                    continue;
                                const intersects = Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0 &&
                                    rect.left + frame.left < Math.min(area.right, frame.right) &&
                                    rect.right + frame.left > Math.max(area.left, frame.left) &&
                                    rect.top + frame.top < Math.min(area.bottom, frame.bottom) &&
                                    rect.bottom + frame.top > Math.max(area.top, frame.top));
                                if (!intersects)
                                    continue;
                                if (!snapshots.has(element)) {
                                    const snapshot = describeStructuredContent(element);
                                    if (snapshot || element.localName !== "figure")
                                        snapshots.set(element, snapshot);
                                }
                                const content = snapshots.get(element);
                                if (content)
                                    visible.push({ id: `${index}:${i}`, content });
                                if (visible.length >= 8)
                                    break;
                            }
                            if (visible.length >= 8)
                                break;
                        }
                        setStructuredTargets((before) => before.length === visible.length &&
                            before.every((item, i) => item.id === visible[i].id && item.content === visible[i].content) ? before : visible);
                    });
                };
                v.addEventListener("relocate", (e) => {
                    const detail = e.detail;
                    // A page can report before it has been laid out, with no position yet.
                    if (!Number.isFinite(detail.fraction))
                        return;
                    // PDFs and comics have real pages, so their page numbers are those
                    // pages rather than the engine's measure of text length.
                    if (v.isFixedLayout) {
                        const { current, total } = detail.section;
                        detail.location = { current, next: current, total };
                        detail.fraction = total ? (current + 1) / total : 0;
                    }
                    setRelocation(detail);
                    inspect();
                    eventsRef.current.onRelocate?.(detail);
                });
                v.addEventListener("load", (e) => {
                    const { doc, index } = e.detail;
                    if (!v.isFixedLayout)
                        applyReaderOverrides(doc);
                    if (supportsStructuredContent)
                        doc.addEventListener("load", inspect, true);
                    inspect();
                    // After the book's own styles have applied, so their colours are what's read.
                    requestAnimationFrame(() => {
                        const { colors } = styleRef.current;
                        fitTextToPage(doc, colors, isDarkPage(colors));
                    });
                    const check = () => {
                        const selection = doc.getSelection();
                        const text = selection?.toString().trim() ?? "";
                        if (!selection || selection.isCollapsed || !selection.rangeCount || !text)
                            return;
                        const range = selection.getRangeAt(0);
                        eventsRef.current.onSelect?.({ cfi: v.getCFI(index, range), text, rect: windowRect(doc, range) });
                    };
                    doc.addEventListener("pointerdown", () => {
                        eventsRef.current.onSelect?.(null);
                        // The page is in a frame of its own, so a tap on it never reaches the
                        // reader's menus. Passed on, it closes whichever is open.
                        document.dispatchEvent(new Event("pointerdown"));
                    });
                    doc.addEventListener("pointerup", () => setTimeout(check, 0));
                    // Right-click (computers): the word under the pointer is selected, and its
                    // menu (highlight, note, Define, Search, Translate) shows in place of the
                    // system's. Phones press and hold instead, which selects the word already.
                    if (!touchOnly) {
                        doc.addEventListener("contextmenu", (e) => {
                            const selection = doc.getSelection();
                            if (!selection)
                                return;
                            const inside = selection.rangeCount > 0 && !selection.isCollapsed &&
                                [...selection.getRangeAt(0).getClientRects()].some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
                            if (!inside && !selectWordAt(doc, e.clientX, e.clientY))
                                return;
                            e.preventDefault();
                            check();
                        });
                    }
                    doc.addEventListener("keyup", (k) => k.shiftKey && check());
                    doc.addEventListener("keydown", (k) => eventsRef.current.onKey?.(k));
                    doc.addEventListener("keyup", (k) => eventsRef.current.onKeyUp?.(k));
                });
                v.addEventListener("create-overlay", (e) => {
                    const { index } = e.detail;
                    for (const a of annotationsRef.current.filter(drawable)) {
                        if (v.resolveNavigation(a.locator.cfi)?.index === index) {
                            void v.addAnnotation({ value: a.locator.cfi, color: a.color });
                        }
                    }
                });
                v.addEventListener("draw-annotation", async (e) => {
                    const { draw, annotation } = e.detail;
                    const { Overlayer } = await import("../vendor/foliate-js/overlayer.js");
                    draw(Overlayer.highlight, { color: highlightHex(annotation.color) });
                });
                v.addEventListener("show-annotation", (e) => {
                    const { value, index, range } = e.detail;
                    const doc = v.renderer.getContents().find((c) => c.index === index)?.doc;
                    if (doc)
                        eventsRef.current.onAnnotationClick?.(value, windowRect(doc, range));
                });
                if (v.isFixedLayout) {
                    v.renderer.addEventListener("scale", (e) => setScale(e.detail.scale));
                    v.renderer.addEventListener("zoom-change", (e) => eventsRef.current.onZoom?.(e.detail.zoom));
                }
                setFixed(v.isFixedLayout);
                v.addEventListener("external-link", (e) => {
                    // Links to websites open in the browser, never inside the reader.
                    e.preventDefault();
                    const { href_ } = e.detail;
                    void import("../api").then(({ openExternal }) => openExternal(href_));
                });
                // Comics list their picture files as contents; show page numbers instead.
                const pictureName = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
                setToc((v.book.toc ?? []).map((item, i) => (pictureName.test(item.label) ? { ...item, label: `Page ${i + 1}` } : item)));
                setSectionStarts(v.getSectionFractions());
                await applyLayout(v, styleRef.current.settings, styleRef.current.colors);
                if (cancelled)
                    return;
                await v.init({ lastLocation: startRef.current, showTextStart: true });
                if (!cancelled)
                    setReady(true);
            }
            catch (e) {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : String(e));
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
            Promise.resolve(book?.destroy?.()).catch(() => { });
        };
    }, [file, host]);
    // Reading settings changed while the book is open. The read aloud voice
    // and speed don't change the page, so they don't lay it out again.
    const { font, size, lineHeight, width, flow, textSpread, theme, justify, pageZoom, pageSpread, pageFlow } = settings;
    const look = useMemo(() => ({ ...DEFAULT_SETTINGS, font, size, lineHeight, width, flow, textSpread, theme, justify, pageZoom, pageSpread, pageFlow }), [font, size, lineHeight, width, flow, textSpread, theme, justify, pageZoom, pageSpread, pageFlow]);
    useEffect(() => {
        const view = viewRef.current;
        if (ready && view)
            void applyLayout(view, look, colors);
    }, [ready, look, colors]);
    // Redraw highlights when they change (added, recoloured or deleted).
    const drawn = useRef(new Map());
    useEffect(() => {
        const view = viewRef.current;
        if (!ready || !view)
            return;
        const want = new Map(annotations.filter(drawable).map((a) => [a.locator.cfi, a.color ?? "rose"]));
        for (const [cfi] of drawn.current)
            if (!want.has(cfi))
                void view.deleteAnnotation({ value: cfi });
        for (const [cfi, color] of want) {
            if (drawn.current.get(cfi) !== color)
                void view.addAnnotation({ value: cfi, color });
        }
        drawn.current = want;
    }, [ready, annotations]);
    const sectionOf = useCallback((href) => {
        try {
            return viewRef.current?.book.resolveHref(href)?.index ?? null;
        }
        catch {
            return null;
        }
    }, []);
    return {
        ready,
        error,
        relocation,
        structuredTargets,
        toc,
        sectionStarts,
        sectionOf,
        goTo: useCallback(async (target) => {
            await viewRef.current?.goTo(target);
        }, []),
        goToFraction: useCallback(async (fraction) => {
            await viewRef.current?.goToFraction(fraction);
        }, []),
        prev: useCallback(async () => {
            await viewRef.current?.goLeft();
        }, []),
        next: useCallback(async () => {
            await viewRef.current?.goRight();
        }, []),
        search: useCallback((query) => {
            const view = viewRef.current;
            if (!view)
                return null;
            // Matches get a quiet slate outline rather than foliate's default red.
            return (async function* () {
                const { Overlayer } = await import("../vendor/foliate-js/overlayer.js");
                for await (const result of view.search({ query, draw: Overlayer.outline, drawOptions: { color: "#5f84ad", width: 2 } })) {
                    // PDF and comic matches are grouped by page, which is what readers look for there.
                    if (view.isFixedLayout && typeof result === "object" && "subitems" in result && result.subitems[0]) {
                        const index = view.resolveNavigation(result.subitems[0].cfi)?.index;
                        if (index != null) {
                            const page = `Page ${index + 1}`;
                            yield { ...result, label: result.label && result.label !== page ? `${page} · ${result.label}` : page };
                            continue;
                        }
                    }
                    yield result;
                }
            })();
        }, []),
        clearSearch: useCallback(() => viewRef.current?.clearSearch(), []),
        deselect: useCallback(() => viewRef.current?.deselect(), []),
        getView: useCallback(() => viewRef.current, []),
        fixed,
        scale,
        scrollByPixels: useCallback((distance) => viewRef.current?.renderer.scrollByPixels?.(distance), []),
        scrollStep: useCallback((direction) => {
            viewRef.current?.renderer.scrollStep?.(direction);
        }, []),
    };
}
