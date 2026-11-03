// A simple cover maker: the book's title, author and series over a colour or
// a picture of your own, drawn at the size stores ask for (1600 × 2560) and
// kept as the book's cover. The words can be picked up and moved, one or
// several at once, and each block has its own lettering.

import { AuthorLabel } from "./AuthorInfo";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { api } from "../api";
import type { WritingProject } from "../api/types";
import { centreBlocks, dragBlocks, type Gap, type Place, type Size } from "./coverLayout";
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
] as const;

export const COVER_FONTS = [
  { value: "Lora", label: "Lora" },
  { value: "Echolume", label: "Echolume" },
  { value: "Georgia", label: "Georgia" },
  { value: "sans-serif", label: "Plain" },
] as const;

type Layout = "top" | "middle" | "bottom";

export type CoverBlock = "title" | "author" | "series";
export type CoverAlign = "left" | "center" | "right";
const BLOCKS: CoverBlock[] = ["title", "author", "series"];

/** How one block of words looks. Anything left out follows the cover's own choices. */
export interface CoverTextStyle {
  font?: (typeof COVER_FONTS)[number]["value"];
  /** Letter size in cover units (the cover is 1600 wide); left out, the title shrinks to fit and the others follow it. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  /** Left out, light or dark to suit the background. */
  colour?: string;
  align?: CoverAlign;
  /** In capitals. The author and series are, unless told otherwise. */
  upper?: boolean;
}

/** Where a block sits: its centre, as a share of the cover's width and height, so it fits any cover shape. */
export type CoverPlace = Place;

export interface CoverDesign {
  title: string;
  author: string;
  /** The series line, like "Book Two of The Ash Saga"; empty for none. */
  series?: string;
  background: number;
  /** A picture of your own behind the words, as an object URL. */
  picture: string | null;
  font: (typeof COVER_FONTS)[number]["value"];
  layout: Layout;
  /** Blocks moved by hand; one left out sits where the layout puts it. */
  places?: Partial<Record<CoverBlock, CoverPlace>>;
  styles?: Partial<Record<CoverBlock, CoverTextStyle>>;
  /** The short line under the title. On unless turned off. */
  rule?: boolean;
}

/** A block's box on the cover, in cover units, for picking it up and moving it. */
export interface CoverBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoverBoxes {
  /** The cover's height in cover units (its width is always 1600). */
  height: number;
  title: CoverBox;
  author: CoverBox | null;
  series: CoverBox | null;
}

/** Breaks text into lines no wider than `width`, keeping the writer's own line breaks. */
function lines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

const familyOf = (font: CoverDesign["font"]) => (font === "sans-serif" ? "system-ui, sans-serif" : `"${font}", Georgia, serif`);
const fontOf = (style: CoverTextStyle, fallback: CoverDesign["font"], boldByDefault: boolean, size: number) =>
  `${style.italic ? "italic " : ""}${(style.bold ?? boldByDefault) ? 600 : 400} ${size}px ${familyOf(style.font ?? fallback)}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Whether a block is in capitals: the author and series are unless told otherwise, the title isn't. */
export const isUpper = (block: CoverBlock, style: CoverTextStyle | undefined) => (block === "title" ? !!style?.upper : style?.upper !== false);

/**
 * Draws the cover onto `canvas`, 1600 × 2560 unless another size is given
 * (a paperback's front, at print resolution): it's laid out 1600 wide and
 * as tall as the size's shape, then scaled. Gives back where the words ended up.
 */
/** The newest drawing asked of each canvas, so a slower older one never lands on top of it. */
const drawings = new WeakMap<HTMLCanvasElement, number>();

export async function drawCover(target: HTMLCanvasElement, design: CoverDesign, pixels?: { width: number; height: number }): Promise<CoverBoxes> {
  const turn = (drawings.get(target) ?? 0) + 1;
  drawings.set(target, turn);
  // Drawn out of sight, then shown in one go.
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
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

  const styleOf = (b: CoverBlock) => design.styles?.[b] ?? {};
  const moved = BLOCKS.some((b) => design.places?.[b]);
  let light: boolean = bg.light;
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
      if (moved) ctx.fillStyle = "rgba(0,0,0,0.3)";
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
  await Promise.all(
    [...fonts].flatMap((f) => [document.fonts?.load(`600 160px ${familyOf(f)}`), document.fonts?.load(`400 80px ${familyOf(f)}`), document.fonts?.load(`italic 400 80px ${familyOf(f)}`)]).filter(Boolean),
  ).catch(() => undefined);
  const autoColour = light ? "#f5f1ea" : "#1c1f24";
  ctx.textBaseline = "alphabetic";
  const margin = 160;
  const width = COVER_WIDTH - margin * 2;
  const anchor = (cx: number, w: number, align: CoverAlign) => (align === "left" ? cx - w / 2 : align === "right" ? cx + w / 2 : cx);

  // The title shrinks until it fits in four lines, unless its size was chosen.
  const titleStyle = styleOf("title");
  let size = titleStyle.size ?? 200;
  let titleLines: string[] = [];
  const titleText = (t: string) => (titleStyle.upper ? t.toUpperCase() : t);
  if (titleStyle.size) {
    ctx.font = fontOf(titleStyle, design.font, true, size);
    titleLines = lines(ctx, titleText(design.title.trim() || "Untitled"), width);
  } else
    for (; size >= 90; size -= 10) {
      ctx.font = fontOf(titleStyle, design.font, true, size);
      titleLines = lines(ctx, titleText(design.title.trim() || "Untitled"), width);
      if (titleLines.length <= 4 && titleLines.every((l) => ctx.measureText(l).width <= width)) break;
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
  const title: CoverBox = { x: titleCx - titleWidth / 2, y: titleTop, width: titleWidth, height: titleBoxHeight };

  /** The author or series: a smaller block that follows the title unless it's been moved. */
  const smallBlock = (block: "author" | "series", text: string, share: number, autoTopOf: (h: number) => number): CoverBox | null => {
    const style = styleOf(block);
    if (!text.trim()) return null;
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
    target.getContext("2d")!.drawImage(canvas, 0, 0);
  }
  return { height, title, author, series };
}

/** A box's centre as a place. */
export const placeOf = (box: CoverBox, height: number): CoverPlace => ({ x: (box.x + box.width / 2) / COVER_WIDTH, y: (box.y + box.height / 2) / height });

/** A box's size as shares of the cover. */
const sizeOf = (box: CoverBox, height: number): Size => ({ w: box.width / COVER_WIDTH, h: box.height / height });

/** Ready-made looks: the words, picture and series stay as they are. */
export const COVER_TEMPLATES: { name: string; design: Pick<CoverDesign, "background" | "font" | "layout" | "rule" | "styles" | "places"> }[] = [
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
const SIZES: Record<CoverBlock, { min: number; max: number; auto: number }> = {
  title: { min: 60, max: 320, auto: 200 },
  author: { min: 30, max: 200, auto: 84 },
  series: { min: 24, max: 160, auto: 60 },
};
const BLOCK_LABEL: Record<CoverBlock, string> = { title: "Title", author: "Author", series: "Series" };
/** How near the middle, in screen pixels, a block snaps onto it. */
const SNAP_PIXELS = 8;

function TemplatePreview({ design, onPick, picked }: { design: CoverDesign; onPick: () => void; picked: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) void drawCover(canvas.current, design, { width: 120, height: 192 });
  }, [design]);
  return (
    <button type="button" role="radio" aria-checked={picked} className="cover-maker-template" onClick={onPick}>
      <canvas ref={canvas} aria-hidden="true" />
    </button>
  );
}

/** The cover maker. The made cover replaces any cover the book has. */
export function CoverMaker({
  project,
  seriesLine = null,
  onMade,
  onCancel,
}: {
  project: WritingProject;
  /** The book's place in its series as the cover shows it, like "Book Two of The Ash Saga"; null when it has none. */
  seriesLine?: string | null;
  onMade: (project: WritingProject) => void;
  onCancel: () => void;
}) {
  const [design, setDesign] = useState<CoverDesign>(() => {
    const kept = keptDesign<CoverDesign>(project.id);
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
  const pictureFile = useRef<Blob | null>(null);
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
  const [boxes, setBoxes] = useState<CoverBoxes | null>(null);
  const [selected, setSelected] = useState<CoverBlock[]>(["title"]);
  const [guides, setGuides] = useState({ x: false, y: false });
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const picking = useRef<HTMLInputElement>(null);
  const finished = useRef<HTMLInputElement>(null);
  const textBox = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; blocks: CoverBlock[]; from: Place[]; sizes: Size[]; moved: boolean; collapseTo: CoverBlock | null } | null>(null);
  const set = (change: Partial<CoverDesign>) => setDesign((d) => ({ ...d, ...change }));
  const setStyle = (change: Partial<CoverTextStyle>) =>
    setDesign((d) => ({ ...d, styles: { ...d.styles, ...Object.fromEntries(selected.map((b) => [b, { ...d.styles?.[b], ...change }])) } }));
  const setPlaces = (places: Partial<Record<CoverBlock, CoverPlace>>) => setDesign((d) => ({ ...d, places: { ...d.places, ...places } }));

  useEffect(() => {
    let live = true;
    if (canvas.current)
      void drawCover(canvas.current, design).then((b) => {
        if (live) setBoxes(b);
      });
    return () => {
      live = false;
    };
  }, [design]);
  // A chosen picture's address is let go when it's replaced or the maker closes.
  useEffect(() => () => void (design.picture && URL.revokeObjectURL(design.picture)), [design.picture]);

  const keepCover = async (bytes: Uint8Array, ext: "png" | "jpg") => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.setWritingCoverPicture(project.id, bytes, ext);
      onMade(made);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const save = async () => {
    if (!canvas.current) return;
    await drawCover(canvas.current, design);
    const blob = await new Promise<Blob | null>((resolve) => canvas.current!.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return setError("The cover couldn't be drawn.");
    await keepCover(new Uint8Array(await blob.arrayBuffer()), "jpg");
  };

  const boxOf = (b: CoverBlock) => (boxes ? boxes[b] : null);
  const shown = BLOCKS.filter((b) => boxOf(b));
  const placeFor = (b: CoverBlock) => design.places?.[b] ?? placeOf(boxOf(b)!, boxes!.height);
  /** Cover units per screen pixel. */
  const unitsPerPixel = () => (canvas.current ? COVER_WIDTH / canvas.current.getBoundingClientRect().width : 1);

  const pickUp = (block: CoverBlock, e: PointerEvent<HTMLDivElement>) => {
    if (!boxes || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Keyboard focus follows, so the arrow keys move what was just picked.
    e.currentTarget.focus();
    const adding = e.ctrlKey || e.metaKey || e.shiftKey;
    let next: CoverBlock[];
    let collapseTo: CoverBlock | null = null;
    if (adding) next = selected.includes(block) && selected.length > 1 && !e.shiftKey ? selected.filter((b) => b !== block) : [...new Set([...selected, block])];
    else if (selected.includes(block)) {
      // Picks up the whole group; a click that doesn't move picks just this one.
      next = selected;
      collapseTo = selected.length > 1 ? block : null;
    } else next = [block];
    // The block clicked comes last, so its words show in the side panel.
    next = [...next.filter((b) => b !== block), ...(next.includes(block) ? [block] : [])];
    setSelected(next);
    // Ctrl-clicking a picked block only lets go of it.
    if (!next.includes(block)) return;
    const blocks = next.filter((b) => boxOf(b));
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      blocks,
      from: blocks.map(placeFor),
      sizes: blocks.map((b) => sizeOf(boxOf(b)!, boxes.height)),
      moved: false,
      collapseTo,
    };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !boxes) return;
    const k = unitsPerPixel();
    const dx = (e.clientX - d.startX) * k;
    const dy = (e.clientY - d.startY) * k;
    if (!d.moved && Math.hypot(dx, dy) < 2 * k) return;
    d.moved = true;
    const reach = e.altKey ? null : { x: (SNAP_PIXELS * k) / COVER_WIDTH, y: (SNAP_PIXELS * k) / boxes.height };
    const others = shown.filter((b) => !d.blocks.includes(b)).map((b) => ({ place: placeFor(b), size: sizeOf(boxOf(b)!, boxes.height) }));
    const result = dragBlocks(d.from, d.sizes, dx / COVER_WIDTH, dy / boxes.height, { axisLock: e.shiftKey, reach, others });
    setGuides(result.snapped);
    setGaps(result.gaps);
    setPlaces(Object.fromEntries(d.blocks.map((b, i) => [b, result.places[i]])));
  };
  const letGo = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    if (!d.moved && d.collapseTo) setSelected([d.collapseTo]);
    drag.current = null;
    setGuides({ x: false, y: false });
    setGaps([]);
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!by || !boxes) return;
    e.preventDefault();
    const blocks = selected.filter((b) => boxOf(b));
    setPlaces(Object.fromEntries(blocks.map((b) => [b, { x: clamp(placeFor(b).x + by[0] / COVER_WIDTH, 0, 1), y: clamp(placeFor(b).y + by[1] / boxes.height, 0, 1) }])));
  };
  const centre = (axis: "x" | "y") => {
    if (!boxes) return;
    const blocks = selected.filter((b) => boxOf(b));
    const places = centreBlocks(blocks.map(placeFor), blocks.map((b) => sizeOf(boxOf(b)!, boxes.height)), axis);
    setPlaces(Object.fromEntries(blocks.map((b, i) => [b, places[i]])));
  };

  const primary = selected[selected.length - 1] ?? "title";
  const style = design.styles?.[primary] ?? {};
  const upper = isUpper(primary, style);
  const sizeRange = SIZES[primary];
  const moved = BLOCKS.some((b) => design.places?.[b]);
  const several = selected.length > 1;
  const choose = (blocks: CoverBlock[]) => setSelected(blocks);
  const textOf: Record<CoverBlock, { value: string; set: (v: string) => void }> = {
    title: { value: design.title, set: (v) => set({ title: v }) },
    author: { value: design.author, set: (v) => set({ author: v }) },
    series: { value: design.series ?? "", set: (v) => set({ series: v }) },
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog writing-dialog cover-maker"
        role="dialog"
        aria-label="Make a cover"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2>Make a cover</h2>
        <div className="cover-maker-templates" role="radiogroup" aria-label="Start from a look">
          {COVER_TEMPLATES.map((t) => (
            <div key={t.name} className="cover-maker-template-item">
              <TemplatePreview
                design={{ ...design, ...t.design, picture: design.picture }}
                picked={false}
                onPick={() => set({ ...t.design })}
              />
              <span>{t.name}</span>
            </div>
          ))}
        </div>
        <div className="cover-maker-grid">
          <div className="cover-maker-stage">
            <div className="cover-maker-canvas">
              <canvas ref={canvas} className="cover-maker-preview" aria-label="The cover as it will look" />
              {guides.x && <span className="cover-maker-guide across" aria-hidden="true" />}
              {guides.y && <span className="cover-maker-guide down" aria-hidden="true" />}
              {gaps.map((g, i) => (
                <span
                  key={i}
                  className={`cover-maker-gap ${g.axis}`}
                  aria-hidden="true"
                  style={
                    g.axis === "y"
                      ? { top: `${g.a * 100}%`, height: `${(g.b - g.a) * 100}%`, left: `${g.at * 100}%` }
                      : { left: `${g.a * 100}%`, width: `${(g.b - g.a) * 100}%`, top: `${g.at * 100}%` }
                  }
                />
              ))}
              {boxes &&
                shown.map((block) => {
                  const box = boxOf(block)!;
                  return (
                    <div
                      key={block}
                      role="button"
                      tabIndex={0}
                      aria-label={`${BLOCK_LABEL[block]}: drag to move, or use the arrow keys`}
                      aria-pressed={selected.includes(block)}
                      className={`cover-maker-block${selected.includes(block) ? " selected" : ""}`}
                      style={{
                        left: `${((box.x - 20) / COVER_WIDTH) * 100}%`,
                        top: `${((box.y - 20) / boxes.height) * 100}%`,
                        width: `${((box.width + 40) / COVER_WIDTH) * 100}%`,
                        height: `${((box.height + 40) / boxes.height) * 100}%`,
                      }}
                      onPointerDown={(e) => pickUp(block, e)}
                      onPointerMove={move}
                      onPointerUp={letGo}
                      onPointerCancel={letGo}
                      onKeyDown={nudge}
                      // Tabbing to a block picks it, unless it's already among those picked.
                      onFocus={() => setSelected((s) => (s.includes(block) ? s : [block]))}
                      onDoubleClick={() => {
                        setSelected([block]);
                        requestAnimationFrame(() => textBox.current?.focus());
                      }}
                    />
                  );
                })}
            </div>
            <p className="muted cover-maker-tip">
              Drag the words to move them. Hold Shift to move straight across or straight up and down. Ctrl-click (⌘ on a Mac) picks more than one. They snap to the
              middle and to even spacing; hold Alt to stop that.
            </p>
            <div className="cover-maker-centre">
              <button type="button" className="btn btn-quiet btn-small" onClick={() => centre("x")}>
                Centre across
              </button>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => centre("y")}>
                Centre up and down
              </button>
            </div>
            {moved && (
              <button type="button" className="link-btn" onClick={() => set({ places: {} })}>
                Put the words back in place
              </button>
            )}
          </div>
          <div className="cover-maker-fields">
            <div className="segmented" role="radiogroup" aria-label="Which words to change">
              {BLOCKS.map((block) => (
                <button key={block} type="button" role="radio" aria-checked={!several && primary === block} onClick={() => choose([block])}>
                  {BLOCK_LABEL[block]}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={selected.length === shown.length && several} onClick={() => choose(shown)}>
                All
              </button>
            </div>
            {BLOCKS.filter((b) => selected.includes(b)).map((block) =>
              block === "title" ? (
                <label className="field" key={block}>
                  <span>Title</span>
                  <textarea ref={primary === block ? textBox : undefined} rows={2} value={design.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
                  <span className="settings-row-hint">Press Enter to start a new line.</span>
                </label>
              ) : (
                <label className="field" key={block}>
                  {block === "author" ? <AuthorLabel /> : <span>Series</span>}
                  <input
                    ref={primary === block ? textBox : undefined}
                    value={textOf[block].value}
                    placeholder={block === "series" ? "None, e.g. Book One of The Ash Saga" : undefined}
                    onChange={(e) => textOf[block].set(e.target.value)}
                    maxLength={200}
                  />
                  {block === "series" && !seriesLine && <span className="settings-row-hint">Set the series and its number in Book details to fill this in.</span>}
                </label>
              ),
            )}
            <div className="cover-maker-format" aria-label={several ? "How the picked words look" : `How the ${BLOCK_LABEL[primary].toLowerCase()} looks`} role="group">
              <label className="field">
                <span>Lettering</span>
                <select value={style.font ?? ""} onChange={(e) => setStyle({ font: (e.target.value || undefined) as CoverTextStyle["font"] })}>
                  <option value="">Same as the cover ({COVER_FONTS.find((f) => f.value === design.font)?.label})</option>
                  {COVER_FONTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>Size</span>
                <div className="cover-maker-size">
                  <input
                    type="range"
                    aria-label={`${BLOCK_LABEL[primary]} size`}
                    min={sizeRange.min}
                    max={sizeRange.max}
                    step={2}
                    value={style.size ?? sizeRange.auto}
                    onChange={(e) => setStyle({ size: Number(e.target.value) })}
                  />
                  <button type="button" className="btn btn-quiet btn-small" disabled={style.size === undefined} onClick={() => setStyle({ size: undefined })}>
                    {primary === "title" ? "Fit" : "Match title"}
                  </button>
                </div>
              </div>
              <div className="cover-maker-toggles">
                <button
                  type="button"
                  className="cover-maker-toggle"
                  aria-pressed={style.bold ?? primary === "title"}
                  aria-label="Bold"
                  title="Bold"
                  onClick={() => setStyle({ bold: !(style.bold ?? primary === "title") })}
                >
                  <b>B</b>
                </button>
                <button type="button" className="cover-maker-toggle" aria-pressed={!!style.italic} aria-label="Italic" title="Italic" onClick={() => setStyle({ italic: !style.italic })}>
                  <i>I</i>
                </button>
                <button type="button" className="cover-maker-toggle" aria-pressed={upper} aria-label="Capitals" title="Capitals" onClick={() => setStyle({ upper: !upper })}>
                  AA
                </button>
                <span className="cover-maker-toggle-gap" />
                {(
                  [
                    ["left", "Left"],
                    ["center", "Centre"],
                    ["right", "Right"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="cover-maker-toggle"
                    aria-pressed={(style.align ?? "center") === value}
                    aria-label={`Line up ${label.toLowerCase()}`}
                    title={`Line up ${label.toLowerCase()}`}
                    onClick={() => setStyle({ align: value })}
                  >
                    <span className={`cover-maker-align ${value}`} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </button>
                ))}
              </div>
              <div className="field">
                <span>Colour</span>
                <div className="cover-maker-swatches" role="radiogroup" aria-label={`${BLOCK_LABEL[primary]} colour`}>
                  <button type="button" role="radio" aria-checked={!style.colour} className="btn btn-quiet btn-small" onClick={() => setStyle({ colour: undefined })}>
                    Automatic
                  </button>
                  {COLOURS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={style.colour === c}
                      aria-label={c}
                      className="cover-maker-colour"
                      style={{ background: c }}
                      onClick={() => setStyle({ colour: c })}
                    />
                  ))}
                  <input
                    type="color"
                    className="cover-maker-colour-pick"
                    aria-label="Another colour"
                    title="Another colour"
                    value={style.colour ?? "#f5f1ea"}
                    onChange={(e) => setStyle({ colour: e.target.value })}
                  />
                </div>
              </div>
              {selected.includes("title") && (
                <label className="check-row">
                  <input type="checkbox" checked={design.rule !== false} onChange={(e) => set({ rule: e.target.checked })} />
                  <span>A short line under the title</span>
                </label>
              )}
            </div>
            <div className="field">
              <span>Background</span>
              <div className="cover-maker-swatches" role="radiogroup" aria-label="Background colour">
                {BACKGROUNDS.map((b, i) => (
                  <button
                    key={b.name}
                    type="button"
                    role="radio"
                    aria-checked={!design.picture && design.background === i}
                    aria-label={b.name}
                    title={b.name}
                    className="cover-maker-swatch"
                    style={{ background: `linear-gradient(${b.top}, ${b.bottom})` }}
                    onClick={() => {
                      if (design.picture) void keepCoverPicture(project.id, null);
                      set({ background: i, picture: null });
                    }}
                  />
                ))}
              </div>
              <span className="cover-maker-picture">
                <button type="button" className="btn btn-quiet btn-small" onClick={() => picking.current?.click()}>
                  {design.picture ? "Change picture" : "Use a picture of my own"}
                </button>
                {design.picture && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      pictureFile.current = null;
                      void keepCoverPicture(project.id, null);
                      set({ picture: null });
                    }}
                  >
                    Remove picture
                  </button>
                )}
              </span>
              <input
                ref={picking}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    pictureFile.current = file;
                    void keepCoverPicture(project.id, file);
                    set({ picture: URL.createObjectURL(file) });
                  }
                  e.target.value = "";
                }}
              />
            </div>
            <label className="field">
              <span>Lettering for the cover</span>
              <select value={design.font} onChange={(e) => set({ font: e.target.value as CoverDesign["font"] })}>
                {COVER_FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Words</span>
              <div className="segmented" role="radiogroup" aria-label="Where the words sit">
                {(
                  [
                    ["top", "Top"],
                    ["middle", "Middle"],
                    ["bottom", "Bottom"],
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={!moved && design.layout === value} onClick={() => set({ layout: value, places: {} })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <CanvaLink
              what="an e-book cover"
              size="1600 × 2560 px"
              extra={
                <>
                  <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => finished.current?.click()}>
                    Use the finished cover
                  </button>
                  <input
                    ref={finished}
                    type="file"
                    accept="image/png,image/jpeg"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void file.arrayBuffer().then((b) => keepCover(new Uint8Array(b), /png$/i.test(file.type) ? "png" : "jpg"));
                    }}
                  />
                </>
              }
            />
            <p className="muted">Made at 1600 × 2560, the size e-book stores ask for. It replaces the book's current cover.</p>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Use this cover"}
          </button>
        </div>
      </form>
    </div>
  );
}
