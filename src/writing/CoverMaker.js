import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// A simple cover maker: the book's title, author and series over a colour or
// a picture of your own, drawn at the size stores ask for (1600 × 2560) and
// kept as the book's cover. The words can be picked up and moved, one or
// several at once, and each block has its own lettering.
import { AuthorLabel } from "./AuthorInfo";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { centreBlocks, dragBlocks } from "./coverLayout";
import { CanvaLink } from "./CanvaLink";
import { keepCoverPicture, keepDesign, keptCoverPicture, keptDesign } from "./coverStore";
export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 2560;
export const BACKGROUNDS = [
    { name: "Ink", top: "#1f2731", bottom: "#33414f", light: true },
    { name: "Ash", top: "#e9e4dc", bottom: "#cfc6b8", light: false },
    { name: "Ember", top: "#5a1f1b", bottom: "#a2412c", light: true },
    { name: "Forest", top: "#1d3128", bottom: "#3f5d46", light: true },
    { name: "Dusk", top: "#2b2346", bottom: "#7a4d6e", light: true },
    { name: "Sea", top: "#123544", bottom: "#3f7d8c", light: true },
    { name: "Sand", top: "#f2e3c4", bottom: "#d8b98a", light: false },
    { name: "Night", top: "#08090c", bottom: "#1a1d24", light: true },
];
export const COVER_FONTS = [
    { value: "Lora", label: "Lora" },
    { value: "Echolume", label: "Echolume" },
    { value: "Georgia", label: "Georgia" },
    { value: "sans-serif", label: "Plain" },
];
const BLOCKS = ["title", "author", "series"];
/** Breaks text into lines no wider than `width`, keeping the writer's own line breaks. */
function lines(ctx, text, width) {
    const out = [];
    for (const para of text.split(/\n/)) {
        let line = "";
        for (const word of para.split(/\s+/).filter(Boolean)) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width > width && line) {
                out.push(line);
                line = word;
            }
            else
                line = next;
        }
        if (line)
            out.push(line);
    }
    return out;
}
const familyOf = (font) => (font === "sans-serif" ? "system-ui, sans-serif" : `"${font}", Georgia, serif`);
const fontOf = (style, fallback, boldByDefault, size) => `${style.italic ? "italic " : ""}${(style.bold ?? boldByDefault) ? 600 : 400} ${size}px ${familyOf(style.font ?? fallback)}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Whether a block is in capitals: the author and series are unless told otherwise, the title isn't. */
export const isUpper = (block, style) => (block === "title" ? !!style?.upper : style?.upper !== false);
/**
 * Draws the cover onto `canvas`, 1600 × 2560 unless another size is given
 * (a paperback's front, at print resolution): it's laid out 1600 wide and
 * as tall as the size's shape, then scaled. Gives back where the words ended up.
 */
/** The newest drawing asked of each canvas, so a slower older one never lands on top of it. */
const drawings = new WeakMap();
export async function drawCover(target, design, pixels) {
    const turn = (drawings.get(target) ?? 0) + 1;
    drawings.set(target, turn);
    // Drawn out of sight, then shown in one go.
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = pixels?.width ?? COVER_WIDTH;
    canvas.height = pixels?.height ?? COVER_HEIGHT;
    const scale = canvas.width / COVER_WIDTH;
    ctx.scale(scale, scale);
    const height = canvas.height / scale;
    const bg = BACKGROUNDS[design.background] ?? BACKGROUNDS[0];
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, bg.top);
    gradient.addColorStop(1, bg.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, COVER_WIDTH, height);
    const styleOf = (b) => design.styles?.[b] ?? {};
    const moved = BLOCKS.some((b) => design.places?.[b]);
    let light = bg.light;
    if (design.picture) {
        const img = new Image();
        img.src = design.picture;
        await img.decode().catch(() => undefined);
        if (img.naturalWidth) {
            // Fills the cover, cropping what doesn't fit.
            const fit = Math.max(COVER_WIDTH / img.naturalWidth, height / img.naturalHeight);
            const w = img.naturalWidth * fit;
            const h = img.naturalHeight * fit;
            ctx.drawImage(img, (COVER_WIDTH - w) / 2, (height - h) / 2, w, h);
            // A shade behind the words so they read over any picture. Words moved
            // by hand get a lighter shade over the whole cover instead.
            const dark = "rgba(0,0,0,0.55)";
            const clear = "rgba(0,0,0,0)";
            if (moved)
                ctx.fillStyle = "rgba(0,0,0,0.3)";
            else {
                const shade = ctx.createLinearGradient(0, 0, 0, height);
                const [a, b, c] = design.layout === "top" ? [dark, clear, clear] : design.layout === "bottom" ? [clear, clear, dark] : [clear, dark, clear];
                shade.addColorStop(0, a);
                shade.addColorStop(0.5, b);
                shade.addColorStop(1, c);
                ctx.fillStyle = shade;
            }
            ctx.fillRect(0, 0, COVER_WIDTH, height);
            light = true;
        }
    }
    const fonts = new Set(BLOCKS.map((b) => styleOf(b).font ?? design.font));
    await Promise.all([...fonts].flatMap((f) => [document.fonts?.load(`600 160px ${familyOf(f)}`), document.fonts?.load(`400 80px ${familyOf(f)}`), document.fonts?.load(`italic 400 80px ${familyOf(f)}`)]).filter(Boolean)).catch(() => undefined);
    const autoColour = light ? "#f5f1ea" : "#1c1f24";
    ctx.textBaseline = "alphabetic";
    const margin = 160;
    const width = COVER_WIDTH - margin * 2;
    const anchor = (cx, w, align) => (align === "left" ? cx - w / 2 : align === "right" ? cx + w / 2 : cx);
    // The title shrinks until it fits in four lines, unless its size was chosen.
    const titleStyle = styleOf("title");
    let size = titleStyle.size ?? 200;
    let titleLines = [];
    const titleText = (t) => (titleStyle.upper ? t.toUpperCase() : t);
    if (titleStyle.size) {
        ctx.font = fontOf(titleStyle, design.font, true, size);
        titleLines = lines(ctx, titleText(design.title.trim() || "Untitled"), width);
    }
    else
        for (; size >= 90; size -= 10) {
            ctx.font = fontOf(titleStyle, design.font, true, size);
            titleLines = lines(ctx, titleText(design.title.trim() || "Untitled"), width);
            if (titleLines.length <= 4 && titleLines.every((l) => ctx.measureText(l).width <= width))
                break;
        }
    const lineHeight = size * 1.15;
    const textHeight = titleLines.length * lineHeight;
    const rule = design.rule !== false;
    const ruleGap = 70;
    // The title's box runs from the top of its first line to the bottom of the line under it.
    const titleBoxHeight = textHeight + (rule ? ruleGap + 6 : 0);
    ctx.font = fontOf(titleStyle, design.font, true, size);
    const titleWidth = Math.min(width, Math.max(1, ...titleLines.map((l) => ctx.measureText(l).width)));
    const autoTop = design.layout === "top" ? 380 : design.layout === "bottom" ? height - 520 - textHeight : (height - textHeight) / 2;
    const titlePlace = design.places?.title;
    const titleCx = titlePlace ? titlePlace.x * COVER_WIDTH : COVER_WIDTH / 2;
    const titleTop = titlePlace ? titlePlace.y * height - titleBoxHeight / 2 : autoTop;
    const titleAlign = titleStyle.align ?? "center";
    ctx.fillStyle = titleStyle.colour ?? autoColour;
    ctx.textAlign = titleAlign;
    const titleX = anchor(titleCx, titleWidth, titleAlign);
    titleLines.forEach((l, i) => ctx.fillText(l, titleX, titleTop + size + i * lineHeight, width));
    // A short rule between title and author, lined up with the title.
    const ruleY = titleTop + textHeight + ruleGap;
    if (rule) {
        const ruleX = titleAlign === "left" ? titleX : titleAlign === "right" ? titleX - 180 : titleX - 90;
        ctx.fillRect(ruleX, ruleY, 180, 6);
    }
    const title = { x: titleCx - titleWidth / 2, y: titleTop, width: titleWidth, height: titleBoxHeight };
    /** The author or series: a smaller block that follows the title unless it's been moved. */
    const smallBlock = (block, text, share, autoTopOf) => {
        const style = styleOf(block);
        if (!text.trim())
            return null;
        const blockSize = style.size ?? Math.round(size * share);
        ctx.font = fontOf(style, design.font, false, blockSize);
        const blockLines = lines(ctx, isUpper(block, style) ? text.trim().toUpperCase() : text.trim(), width);
        const blockLineHeight = blockSize * 1.25;
        const h = blockLines.length * blockLineHeight;
        const w = Math.min(width, Math.max(1, ...blockLines.map((l) => ctx.measureText(l).width)));
        const place = design.places?.[block];
        const cx = place ? place.x * COVER_WIDTH : titleCx;
        const top = place ? place.y * height - h / 2 : autoTopOf(h);
        const align = style.align ?? "center";
        ctx.fillStyle = style.colour ?? autoColour;
        ctx.textAlign = align;
        const x = anchor(cx, w, align);
        blockLines.forEach((l, i) => ctx.fillText(l, x, top + blockSize + i * blockLineHeight, width));
        return { x: cx - w / 2, y: top, width: w, height: h };
    };
    // Left alone, the author sits under the title (or its line), and the series above it.
    const author = smallBlock("author", design.author, 0.42, () => (rule ? ruleY + 6 : titleTop + textHeight) + 64);
    const series = smallBlock("series", design.series ?? "", 0.3, (h) => titleTop - 56 - h);
    if (drawings.get(target) === turn) {
        target.width = canvas.width;
        target.height = canvas.height;
        target.getContext("2d").drawImage(canvas, 0, 0);
    }
    return { height, title, author, series };
}
/** A box's centre as a place. */
export const placeOf = (box, height) => ({ x: (box.x + box.width / 2) / COVER_WIDTH, y: (box.y + box.height / 2) / height });
/** A box's size as shares of the cover. */
const sizeOf = (box, height) => ({ w: box.width / COVER_WIDTH, h: box.height / height });
/** Ready-made looks: the words, picture and series stay as they are. */
export const COVER_TEMPLATES = [
    { name: "Classic", design: { background: 0, font: "Lora", layout: "middle", rule: true, styles: {}, places: {} } },
    {
        name: "Literary",
        design: {
            background: 1,
            font: "Lora",
            layout: "top",
            rule: true,
            styles: { title: { italic: true, bold: false }, author: { size: 64 } },
            places: { author: { x: 0.5, y: 0.88 } },
        },
    },
    {
        name: "Thriller",
        design: {
            background: 2,
            font: "sans-serif",
            layout: "bottom",
            rule: false,
            styles: { title: { upper: true, size: 230 }, author: { size: 90, bold: true }, series: { colour: "#f2e3c4" } },
            places: { title: { x: 0.5, y: 0.7 }, author: { x: 0.5, y: 0.1 } },
        },
    },
    {
        name: "Fantasy",
        design: {
            background: 4,
            font: "Echolume",
            layout: "top",
            rule: false,
            styles: { title: { colour: "#e6c47a" }, author: { colour: "#e6c47a", font: "Lora" }, series: { font: "Lora", italic: true, upper: false } },
            places: { author: { x: 0.5, y: 0.9 } },
        },
    },
    {
        name: "Modern",
        design: {
            background: 7,
            font: "sans-serif",
            layout: "top",
            rule: false,
            styles: { title: { align: "left", size: 210 }, author: { align: "left" }, series: { align: "left" } },
            places: { title: { x: 0.42, y: 0.3 }, author: { x: 0.3, y: 0.9 } },
        },
    },
    {
        name: "Quiet",
        design: {
            background: 6,
            font: "Georgia",
            layout: "middle",
            rule: false,
            styles: { title: { size: 130, bold: false }, author: { size: 56 } },
            places: {},
        },
    },
];
const COLOURS = ["#f5f1ea", "#1c1f24", "#c9a45c", "#b8402e", "#8fb3c9", "#7fa07a"];
const SIZES = {
    title: { min: 60, max: 320, auto: 200 },
    author: { min: 30, max: 200, auto: 84 },
    series: { min: 24, max: 160, auto: 60 },
};
const BLOCK_LABEL = { title: "Title", author: "Author", series: "Series" };
/** How near the middle, in screen pixels, a block snaps onto it. */
const SNAP_PIXELS = 8;
function TemplatePreview({ design, onPick, picked }) {
    const canvas = useRef(null);
    useEffect(() => {
        if (canvas.current)
            void drawCover(canvas.current, design, { width: 120, height: 192 });
    }, [design]);
    return (_jsx("button", { type: "button", role: "radio", "aria-checked": picked, className: "cover-maker-template", onClick: onPick, children: _jsx("canvas", { ref: canvas, "aria-hidden": "true" }) }));
}
/** The cover maker. The made cover replaces any cover the book has. */
export function CoverMaker({ project, seriesLine = null, onMade, onCancel, }) {
    const [design, setDesign] = useState(() => {
        const kept = keptDesign(project.id);
        const { bookTitle, bookAuthor, picture: _picture, ...saved } = kept;
        const bookAuthorNow = project.author ?? "";
        return {
            background: 0,
            font: "Lora",
            layout: "middle",
            ...saved,
            // The words as you left them, unless the book's own title or author has changed since.
            title: saved.title !== undefined && bookTitle === project.title ? saved.title : project.title,
            author: saved.author !== undefined && bookAuthor === bookAuthorNow ? saved.author : bookAuthorNow,
            // A series line the writer cleared stays cleared.
            series: saved.series !== undefined ? saved.series : (seriesLine ?? ""),
            picture: null,
        };
    });
    // Your own picture comes back from this device's store.
    const pictureFile = useRef(null);
    useEffect(() => {
        let live = true;
        void keptCoverPicture(project.id).then((blob) => {
            if (live && blob) {
                pictureFile.current = blob;
                setDesign((d) => (d.picture ? d : { ...d, picture: URL.createObjectURL(blob) }));
            }
        });
        return () => {
            live = false;
        };
    }, [project.id]);
    // Everything else is kept as it changes, so closing the maker never loses it.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            const { picture: _picture, ...keep } = design;
            keepDesign(project.id, { ...keep, bookTitle: project.title, bookAuthor: project.author ?? "" });
        }, 300);
        return () => window.clearTimeout(timer);
    }, [design, project.id, project.title, project.author]);
    const [boxes, setBoxes] = useState(null);
    const [selected, setSelected] = useState(["title"]);
    const [guides, setGuides] = useState({ x: false, y: false });
    const [gaps, setGaps] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const canvas = useRef(null);
    const picking = useRef(null);
    const finished = useRef(null);
    const textBox = useRef(null);
    const drag = useRef(null);
    const set = (change) => setDesign((d) => ({ ...d, ...change }));
    const setStyle = (change) => setDesign((d) => ({ ...d, styles: { ...d.styles, ...Object.fromEntries(selected.map((b) => [b, { ...d.styles?.[b], ...change }])) } }));
    const setPlaces = (places) => setDesign((d) => ({ ...d, places: { ...d.places, ...places } }));
    useEffect(() => {
        let live = true;
        if (canvas.current)
            void drawCover(canvas.current, design).then((b) => {
                if (live)
                    setBoxes(b);
            });
        return () => {
            live = false;
        };
    }, [design]);
    // A chosen picture's address is let go when it's replaced or the maker closes.
    useEffect(() => () => void (design.picture && URL.revokeObjectURL(design.picture)), [design.picture]);
    const keepCover = async (bytes, ext) => {
        setBusy(true);
        setError(null);
        try {
            const made = await api.setWritingCoverPicture(project.id, bytes, ext);
            onMade(made);
        }
        catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };
    const save = async () => {
        if (!canvas.current)
            return;
        await drawCover(canvas.current, design);
        const blob = await new Promise((resolve) => canvas.current.toBlob(resolve, "image/jpeg", 0.9));
        if (!blob)
            return setError("The cover couldn't be drawn.");
        await keepCover(new Uint8Array(await blob.arrayBuffer()), "jpg");
    };
    const boxOf = (b) => (boxes ? boxes[b] : null);
    const shown = BLOCKS.filter((b) => boxOf(b));
    const placeFor = (b) => design.places?.[b] ?? placeOf(boxOf(b), boxes.height);
    /** Cover units per screen pixel. */
    const unitsPerPixel = () => (canvas.current ? COVER_WIDTH / canvas.current.getBoundingClientRect().width : 1);
    const pickUp = (block, e) => {
        if (!boxes || e.button !== 0)
            return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        // Keyboard focus follows, so the arrow keys move what was just picked.
        e.currentTarget.focus();
        const adding = e.ctrlKey || e.metaKey || e.shiftKey;
        let next;
        let collapseTo = null;
        if (adding)
            next = selected.includes(block) && selected.length > 1 && !e.shiftKey ? selected.filter((b) => b !== block) : [...new Set([...selected, block])];
        else if (selected.includes(block)) {
            // Picks up the whole group; a click that doesn't move picks just this one.
            next = selected;
            collapseTo = selected.length > 1 ? block : null;
        }
        else
            next = [block];
        // The block clicked comes last, so its words show in the side panel.
        next = [...next.filter((b) => b !== block), ...(next.includes(block) ? [block] : [])];
        setSelected(next);
        // Ctrl-clicking a picked block only lets go of it.
        if (!next.includes(block))
            return;
        const blocks = next.filter((b) => boxOf(b));
        drag.current = {
            id: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            blocks,
            from: blocks.map(placeFor),
            sizes: blocks.map((b) => sizeOf(boxOf(b), boxes.height)),
            moved: false,
            collapseTo,
        };
    };
    const move = (e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId || !boxes)
            return;
        const k = unitsPerPixel();
        const dx = (e.clientX - d.startX) * k;
        const dy = (e.clientY - d.startY) * k;
        if (!d.moved && Math.hypot(dx, dy) < 2 * k)
            return;
        d.moved = true;
        const reach = e.altKey ? null : { x: (SNAP_PIXELS * k) / COVER_WIDTH, y: (SNAP_PIXELS * k) / boxes.height };
        const others = shown.filter((b) => !d.blocks.includes(b)).map((b) => ({ place: placeFor(b), size: sizeOf(boxOf(b), boxes.height) }));
        const result = dragBlocks(d.from, d.sizes, dx / COVER_WIDTH, dy / boxes.height, { axisLock: e.shiftKey, reach, others });
        setGuides(result.snapped);
        setGaps(result.gaps);
        setPlaces(Object.fromEntries(d.blocks.map((b, i) => [b, result.places[i]])));
    };
    const letGo = (e) => {
        const d = drag.current;
        if (d?.id !== e.pointerId)
            return;
        if (!d.moved && d.collapseTo)
            setSelected([d.collapseTo]);
        drag.current = null;
        setGuides({ x: false, y: false });
        setGaps([]);
    };
    const nudge = (e) => {
        const step = e.shiftKey ? 50 : 10;
        const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!by || !boxes)
            return;
        e.preventDefault();
        const blocks = selected.filter((b) => boxOf(b));
        setPlaces(Object.fromEntries(blocks.map((b) => [b, { x: clamp(placeFor(b).x + by[0] / COVER_WIDTH, 0, 1), y: clamp(placeFor(b).y + by[1] / boxes.height, 0, 1) }])));
    };
    const centre = (axis) => {
        if (!boxes)
            return;
        const blocks = selected.filter((b) => boxOf(b));
        const places = centreBlocks(blocks.map(placeFor), blocks.map((b) => sizeOf(boxOf(b), boxes.height)), axis);
        setPlaces(Object.fromEntries(blocks.map((b, i) => [b, places[i]])));
    };
    const primary = selected[selected.length - 1] ?? "title";
    const style = design.styles?.[primary] ?? {};
    const upper = isUpper(primary, style);
    const sizeRange = SIZES[primary];
    const moved = BLOCKS.some((b) => design.places?.[b]);
    const several = selected.length > 1;
    const choose = (blocks) => setSelected(blocks);
    const textOf = {
        title: { value: design.title, set: (v) => set({ title: v }) },
        author: { value: design.author, set: (v) => set({ author: v }) },
        series: { value: design.series ?? "", set: (v) => set({ series: v }) },
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onCancel(), children: _jsxs("form", { className: "dialog writing-dialog cover-maker", role: "dialog", "aria-label": "Make a cover", onSubmit: (e) => {
                e.preventDefault();
                void save();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onCancel(), children: [_jsx("h2", { children: "Make a cover" }), _jsx("div", { className: "cover-maker-templates", role: "radiogroup", "aria-label": "Start from a look", children: COVER_TEMPLATES.map((t) => (_jsxs("div", { className: "cover-maker-template-item", children: [_jsx(TemplatePreview, { design: { ...design, ...t.design, picture: design.picture }, picked: false, onPick: () => set({ ...t.design }) }), _jsx("span", { children: t.name })] }, t.name))) }), _jsxs("div", { className: "cover-maker-grid", children: [_jsxs("div", { className: "cover-maker-stage", children: [_jsxs("div", { className: "cover-maker-canvas", children: [_jsx("canvas", { ref: canvas, className: "cover-maker-preview", "aria-label": "The cover as it will look" }), guides.x && _jsx("span", { className: "cover-maker-guide across", "aria-hidden": "true" }), guides.y && _jsx("span", { className: "cover-maker-guide down", "aria-hidden": "true" }), gaps.map((g, i) => (_jsx("span", { className: `cover-maker-gap ${g.axis}`, "aria-hidden": "true", style: g.axis === "y"
                                                ? { top: `${g.a * 100}%`, height: `${(g.b - g.a) * 100}%`, left: `${g.at * 100}%` }
                                                : { left: `${g.a * 100}%`, width: `${(g.b - g.a) * 100}%`, top: `${g.at * 100}%` } }, i))), boxes &&
                                            shown.map((block) => {
                                                const box = boxOf(block);
                                                return (_jsx("div", { role: "button", tabIndex: 0, "aria-label": `${BLOCK_LABEL[block]}: drag to move, or use the arrow keys`, "aria-pressed": selected.includes(block), className: `cover-maker-block${selected.includes(block) ? " selected" : ""}`, style: {
                                                        left: `${((box.x - 20) / COVER_WIDTH) * 100}%`,
                                                        top: `${((box.y - 20) / boxes.height) * 100}%`,
                                                        width: `${((box.width + 40) / COVER_WIDTH) * 100}%`,
                                                        height: `${((box.height + 40) / boxes.height) * 100}%`,
                                                    }, onPointerDown: (e) => pickUp(block, e), onPointerMove: move, onPointerUp: letGo, onPointerCancel: letGo, onKeyDown: nudge, 
                                                    // Tabbing to a block picks it, unless it's already among those picked.
                                                    onFocus: () => setSelected((s) => (s.includes(block) ? s : [block])), onDoubleClick: () => {
                                                        setSelected([block]);
                                                        requestAnimationFrame(() => textBox.current?.focus());
                                                    } }, block));
                                            })] }), _jsx("p", { className: "muted cover-maker-tip", children: "Drag the words to move them. Hold Shift to move straight across or straight up and down. Ctrl-click (\u2318 on a Mac) picks more than one. They snap to the middle and to even spacing; hold Alt to stop that." }), _jsxs("div", { className: "cover-maker-centre", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => centre("x"), children: "Centre across" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => centre("y"), children: "Centre up and down" })] }), moved && (_jsx("button", { type: "button", className: "link-btn", onClick: () => set({ places: {} }), children: "Put the words back in place" }))] }), _jsxs("div", { className: "cover-maker-fields", children: [_jsxs("div", { className: "segmented", role: "radiogroup", "aria-label": "Which words to change", children: [BLOCKS.map((block) => (_jsx("button", { type: "button", role: "radio", "aria-checked": !several && primary === block, onClick: () => choose([block]), children: BLOCK_LABEL[block] }, block))), _jsx("button", { type: "button", role: "radio", "aria-checked": selected.length === shown.length && several, onClick: () => choose(shown), children: "All" })] }), BLOCKS.filter((b) => selected.includes(b)).map((block) => block === "title" ? (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Title" }), _jsx("textarea", { ref: primary === block ? textBox : undefined, rows: 2, value: design.title, onChange: (e) => set({ title: e.target.value }), maxLength: 200 }), _jsx("span", { className: "settings-row-hint", children: "Press Enter to start a new line." })] }, block)) : (_jsxs("label", { className: "field", children: [block === "author" ? _jsx(AuthorLabel, {}) : _jsx("span", { children: "Series" }), _jsx("input", { ref: primary === block ? textBox : undefined, value: textOf[block].value, placeholder: block === "series" ? "None, e.g. Book One of The Ash Saga" : undefined, onChange: (e) => textOf[block].set(e.target.value), maxLength: 200 }), block === "series" && !seriesLine && _jsx("span", { className: "settings-row-hint", children: "Set the series and its number in Book details to fill this in." })] }, block))), _jsxs("div", { className: "cover-maker-format", "aria-label": several ? "How the picked words look" : `How the ${BLOCK_LABEL[primary].toLowerCase()} looks`, role: "group", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Lettering" }), _jsxs("select", { value: style.font ?? "", onChange: (e) => setStyle({ font: (e.target.value || undefined) }), children: [_jsxs("option", { value: "", children: ["Same as the cover (", COVER_FONTS.find((f) => f.value === design.font)?.label, ")"] }), COVER_FONTS.map((f) => (_jsx("option", { value: f.value, children: f.label }, f.value)))] })] }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Size" }), _jsxs("div", { className: "cover-maker-size", children: [_jsx("input", { type: "range", "aria-label": `${BLOCK_LABEL[primary]} size`, min: sizeRange.min, max: sizeRange.max, step: 2, value: style.size ?? sizeRange.auto, onChange: (e) => setStyle({ size: Number(e.target.value) }) }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: style.size === undefined, onClick: () => setStyle({ size: undefined }), children: primary === "title" ? "Fit" : "Match title" })] })] }), _jsxs("div", { className: "cover-maker-toggles", children: [_jsx("button", { type: "button", className: "cover-maker-toggle", "aria-pressed": style.bold ?? primary === "title", "aria-label": "Bold", title: "Bold", onClick: () => setStyle({ bold: !(style.bold ?? primary === "title") }), children: _jsx("b", { children: "B" }) }), _jsx("button", { type: "button", className: "cover-maker-toggle", "aria-pressed": !!style.italic, "aria-label": "Italic", title: "Italic", onClick: () => setStyle({ italic: !style.italic }), children: _jsx("i", { children: "I" }) }), _jsx("button", { type: "button", className: "cover-maker-toggle", "aria-pressed": upper, "aria-label": "Capitals", title: "Capitals", onClick: () => setStyle({ upper: !upper }), children: "AA" }), _jsx("span", { className: "cover-maker-toggle-gap" }), [
                                                    ["left", "Left"],
                                                    ["center", "Centre"],
                                                    ["right", "Right"],
                                                ].map(([value, label]) => (_jsx("button", { type: "button", className: "cover-maker-toggle", "aria-pressed": (style.align ?? "center") === value, "aria-label": `Line up ${label.toLowerCase()}`, title: `Line up ${label.toLowerCase()}`, onClick: () => setStyle({ align: value }), children: _jsxs("span", { className: `cover-maker-align ${value}`, "aria-hidden": "true", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }) }, value)))] }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Colour" }), _jsxs("div", { className: "cover-maker-swatches", role: "radiogroup", "aria-label": `${BLOCK_LABEL[primary]} colour`, children: [_jsx("button", { type: "button", role: "radio", "aria-checked": !style.colour, className: "btn btn-quiet btn-small", onClick: () => setStyle({ colour: undefined }), children: "Automatic" }), COLOURS.map((c) => (_jsx("button", { type: "button", role: "radio", "aria-checked": style.colour === c, "aria-label": c, className: "cover-maker-colour", style: { background: c }, onClick: () => setStyle({ colour: c }) }, c))), _jsx("input", { type: "color", className: "cover-maker-colour-pick", "aria-label": "Another colour", title: "Another colour", value: style.colour ?? "#f5f1ea", onChange: (e) => setStyle({ colour: e.target.value }) })] })] }), selected.includes("title") && (_jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: design.rule !== false, onChange: (e) => set({ rule: e.target.checked }) }), _jsx("span", { children: "A short line under the title" })] }))] }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Background" }), _jsx("div", { className: "cover-maker-swatches", role: "radiogroup", "aria-label": "Background colour", children: BACKGROUNDS.map((b, i) => (_jsx("button", { type: "button", role: "radio", "aria-checked": !design.picture && design.background === i, "aria-label": b.name, title: b.name, className: "cover-maker-swatch", style: { background: `linear-gradient(${b.top}, ${b.bottom})` }, onClick: () => {
                                                    if (design.picture)
                                                        void keepCoverPicture(project.id, null);
                                                    set({ background: i, picture: null });
                                                } }, b.name))) }), _jsxs("span", { className: "cover-maker-picture", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => picking.current?.click(), children: design.picture ? "Change picture" : "Use a picture of my own" }), design.picture && (_jsx("button", { type: "button", className: "link-btn", onClick: () => {
                                                        pictureFile.current = null;
                                                        void keepCoverPicture(project.id, null);
                                                        set({ picture: null });
                                                    }, children: "Remove picture" }))] }), _jsx("input", { ref: picking, type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, onChange: (e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    pictureFile.current = file;
                                                    void keepCoverPicture(project.id, file);
                                                    set({ picture: URL.createObjectURL(file) });
                                                }
                                                e.target.value = "";
                                            } })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Lettering for the cover" }), _jsx("select", { value: design.font, onChange: (e) => set({ font: e.target.value }), children: COVER_FONTS.map((f) => (_jsx("option", { value: f.value, children: f.label }, f.value))) })] }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Words" }), _jsx("div", { className: "segmented", role: "radiogroup", "aria-label": "Where the words sit", children: [
                                                ["top", "Top"],
                                                ["middle", "Middle"],
                                                ["bottom", "Bottom"],
                                            ].map(([value, label]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": !moved && design.layout === value, onClick: () => set({ layout: value, places: {} }), children: label }, value))) })] }), _jsx(CanvaLink, { what: "an e-book cover", size: "1600 \u00D7 2560 px", canva: {
                                        project,
                                        for: "cover",
                                        title: `${project.title} (cover)`,
                                        width: COVER_WIDTH,
                                        height: COVER_HEIGHT,
                                        format: "jpg",
                                        backLabel: "Use the Canva cover",
                                        onBack: (bytes) => keepCover(bytes, "jpg"),
                                    }, extra: _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => finished.current?.click(), children: "Use the finished cover" }), _jsx("input", { ref: finished, type: "file", accept: "image/png,image/jpeg", hidden: true, onChange: (e) => {
                                                    const file = e.target.files?.[0];
                                                    e.target.value = "";
                                                    if (file)
                                                        void file.arrayBuffer().then((b) => keepCover(new Uint8Array(b), /png$/i.test(file.type) ? "png" : "jpg"));
                                                } })] }) }), _jsx("p", { className: "muted", children: "Made at 1600 \u00D7 2560, the size e-book stores ask for. It replaces the book's current cover." })] })] }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: busy ? "Saving…" : "Use this cover" })] })] }) }));
}
