// A simple cover maker: the book's title and author over a colour or a
// picture of your own, drawn at the size stores ask for (1600 × 2560) and
// kept as the book's cover.

import { AuthorLabel } from "./AuthorInfo";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { api } from "../api";
import type { WritingProject } from "../api/types";

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

export type CoverBlock = "title" | "author";
export type CoverAlign = "left" | "center" | "right";

/** How one block of words looks. Anything left out follows the cover's own choices. */
export interface CoverTextStyle {
  font?: (typeof COVER_FONTS)[number]["value"];
  /** Letter size in cover units (the cover is 1600 wide); left out, the title shrinks to fit and the author follows it. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  /** Left out, light or dark to suit the background. */
  colour?: string;
  align?: CoverAlign;
  /** In capitals. The author is, unless told otherwise. */
  upper?: boolean;
}

/** Where a block sits: its centre, as a share of the cover's width and height, so it fits any cover shape. */
export interface CoverPlace {
  x: number;
  y: number;
}

export interface CoverDesign {
  title: string;
  author: string;
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
  `${style.italic ? "italic " : ""}${style.bold ?? boldByDefault ? 600 : 400} ${size}px ${familyOf(style.font ?? fallback)}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Draws the cover onto `canvas`, 1600 × 2560 unless another size is given
 * (a paperback's front, at print resolution): it's laid out 1600 wide and
 * as tall as the size's shape, then scaled. Gives back where the title and
 * author ended up.
 */
export async function drawCover(canvas: HTMLCanvasElement, design: CoverDesign, pixels?: { width: number; height: number }): Promise<CoverBoxes> {
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

  const titleStyle = design.styles?.title ?? {};
  const authorStyle = design.styles?.author ?? {};
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
      if (design.places?.title || design.places?.author) ctx.fillStyle = "rgba(0,0,0,0.3)";
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

  const fonts = new Set([titleStyle.font ?? design.font, authorStyle.font ?? design.font]);
  await Promise.all(
    [...fonts].flatMap((f) => [document.fonts?.load(`600 160px ${familyOf(f)}`), document.fonts?.load(`400 80px ${familyOf(f)}`), document.fonts?.load(`italic 400 80px ${familyOf(f)}`)]).filter(Boolean),
  ).catch(() => undefined);
  const autoColour = light ? "#f5f1ea" : "#1c1f24";
  ctx.textBaseline = "alphabetic";
  const margin = 160;
  const width = COVER_WIDTH - margin * 2;

  // The title shrinks until it fits in four lines, unless its size was chosen.
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
  const titleWidth = Math.max(1, ...titleLines.map((l) => ctx.measureText(l).width));
  const autoTop = design.layout === "top" ? 380 : design.layout === "bottom" ? height - 520 - textHeight : (height - textHeight) / 2;
  const titlePlace = design.places?.title;
  const titleCx = titlePlace ? titlePlace.x * COVER_WIDTH : COVER_WIDTH / 2;
  const titleTop = titlePlace ? titlePlace.y * height - titleBoxHeight / 2 : autoTop;
  const titleAlign = titleStyle.align ?? "center";
  const anchor = (cx: number, w: number, align: CoverAlign) => (align === "left" ? cx - w / 2 : align === "right" ? cx + w / 2 : cx);
  ctx.fillStyle = titleStyle.colour ?? autoColour;
  ctx.textAlign = titleAlign;
  const titleX = anchor(titleCx, titleWidth, titleAlign);
  titleLines.forEach((l, i) => ctx.fillText(l, titleX, titleTop + size + i * lineHeight));

  // A short rule between title and author, lined up with the title.
  const ruleY = titleTop + textHeight + ruleGap;
  if (rule) {
    const ruleX = titleAlign === "left" ? titleX : titleAlign === "right" ? titleX - 180 : titleX - 90;
    ctx.fillRect(ruleX, ruleY, 180, 6);
  }
  const title: CoverBox = { x: titleCx - titleWidth / 2, y: titleTop, width: titleWidth, height: titleBoxHeight };

  let author: CoverBox | null = null;
  const authorText = design.author.trim();
  if (authorText) {
    const authorSize = authorStyle.size ?? Math.round(size * 0.42);
    ctx.font = fontOf(authorStyle, design.font, false, authorSize);
    const authorLines = lines(ctx, authorStyle.upper === false ? authorText : authorText.toUpperCase(), width);
    const authorLineHeight = authorSize * 1.25;
    const authorHeight = authorLines.length * authorLineHeight;
    const authorWidth = Math.max(1, ...authorLines.map((l) => ctx.measureText(l).width));
    const authorPlace = design.places?.author;
    const authorCx = authorPlace ? authorPlace.x * COVER_WIDTH : titlePlace ? titleCx : COVER_WIDTH / 2;
    // Left alone, the author sits under the title (or its line).
    const authorTop = authorPlace ? authorPlace.y * height - authorHeight / 2 : (rule ? ruleY + 6 : titleTop + textHeight) + 64;
    const authorAlign = authorStyle.align ?? "center";
    ctx.fillStyle = authorStyle.colour ?? autoColour;
    ctx.textAlign = authorAlign;
    const authorX = anchor(authorCx, authorWidth, authorAlign);
    authorLines.forEach((l, i) => ctx.fillText(l, authorX, authorTop + authorSize + i * authorLineHeight));
    author = { x: authorCx - authorWidth / 2, y: authorTop, width: authorWidth, height: authorHeight };
  }
  return { height, title, author };
}

/** Moves a block's centre by (dx, dy) cover units; with Shift held, only along the way it has moved most. */
export function movePlace(start: CoverPlace, dx: number, dy: number, height: number, axisLock: boolean): CoverPlace {
  if (axisLock) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  let x = start.x + dx / COVER_WIDTH;
  // Snaps to the middle when it comes close.
  if (Math.abs(x - 0.5) < 12 / COVER_WIDTH) x = 0.5;
  return { x: clamp(x, 0, 1), y: clamp(start.y + dy / height, 0, 1) };
}

/** A box's centre as a place. */
export const placeOf = (box: CoverBox, height: number): CoverPlace => ({ x: (box.x + box.width / 2) / COVER_WIDTH, y: (box.y + box.height / 2) / height });

const COLOURS = ["#f5f1ea", "#1c1f24", "#c9a45c", "#b8402e", "#8fb3c9", "#7fa07a"];
const SIZES: Record<CoverBlock, { min: number; max: number }> = { title: { min: 60, max: 320 }, author: { min: 30, max: 200 } };
const BLOCK_LABEL: Record<CoverBlock, string> = { title: "Title", author: "Author" };

/** What the maker remembers on this device for each book, so a cover can be changed later. The picture isn't kept. */
const savedKey = (id: string) => `tbv.coverMaker.${id}`;
function savedDesign(id: string): Partial<CoverDesign> {
  try {
    const raw = JSON.parse(localStorage.getItem(savedKey(id)) ?? "null") as Partial<CoverDesign> | null;
    return raw && typeof raw === "object" ? { ...raw, picture: null } : {};
  } catch {
    return {};
  }
}

/** The cover maker. The made cover replaces any cover the book has. */
export function CoverMaker({ project, onMade, onCancel }: { project: WritingProject; onMade: (project: WritingProject) => void; onCancel: () => void }) {
  const [design, setDesign] = useState<CoverDesign>(() => {
    const saved = savedDesign(project.id);
    return {
      background: 0,
      font: "Lora",
      layout: "middle",
      ...saved,
      title: project.title,
      author: project.author ?? "",
      picture: null,
    };
  });
  const [boxes, setBoxes] = useState<CoverBoxes | null>(null);
  const [selected, setSelected] = useState<CoverBlock>("title");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const picking = useRef<HTMLInputElement>(null);
  const textBox = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const drag = useRef<{ block: CoverBlock; id: number; startX: number; startY: number; from: CoverPlace } | null>(null);
  const set = (change: Partial<CoverDesign>) => setDesign((d) => ({ ...d, ...change }));
  const setStyle = (block: CoverBlock, change: Partial<CoverTextStyle>) =>
    setDesign((d) => ({ ...d, styles: { ...d.styles, [block]: { ...d.styles?.[block], ...change } } }));
  const setPlace = (block: CoverBlock, place: CoverPlace | undefined) =>
    setDesign((d) => {
      const places = { ...d.places };
      if (place) places[block] = place;
      else delete places[block];
      return { ...d, places };
    });

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

  const save = async () => {
    if (!canvas.current) return;
    setBusy(true);
    setError(null);
    try {
      await drawCover(canvas.current, design);
      const blob = await new Promise<Blob | null>((resolve) => canvas.current!.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("The cover couldn't be drawn.");
      const made = await api.setWritingCoverPicture(project.id, new Uint8Array(await blob.arrayBuffer()), "jpg");
      try {
        const { picture: _picture, title: _title, author: _author, ...keep } = design;
        localStorage.setItem(savedKey(project.id), JSON.stringify(keep));
      } catch {
        // Only a convenience.
      }
      onMade(made);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  /** Cover units per screen pixel. */
  const unitsPerPixel = () => (canvas.current ? COVER_WIDTH / canvas.current.getBoundingClientRect().width : 1);
  const pickUp = (block: CoverBlock, e: PointerEvent<HTMLDivElement>) => {
    if (!boxes || e.button !== 0) return;
    const box = block === "title" ? boxes.title : boxes.author;
    if (!box) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(block);
    drag.current = { block, id: e.pointerId, startX: e.clientX, startY: e.clientY, from: design.places?.[block] ?? placeOf(box, boxes.height) };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !boxes) return;
    const k = unitsPerPixel();
    const dx = (e.clientX - d.startX) * k;
    const dy = (e.clientY - d.startY) * k;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !design.places?.[d.block]) return;
    setPlace(d.block, movePlace(d.from, dx, dy, boxes.height, e.shiftKey));
  };
  const letGo = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const nudge = (block: CoverBlock, e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    const box = block === "title" ? boxes?.title : boxes?.author;
    if (!by || !boxes || !box) return;
    e.preventDefault();
    const from = design.places?.[block] ?? placeOf(box, boxes.height);
    setPlace(block, { x: clamp(from.x + by[0] / COVER_WIDTH, 0, 1), y: clamp(from.y + by[1] / boxes.height, 0, 1) });
  };

  const style = design.styles?.[selected] ?? {};
  const shownBoxes = boxes ? ([["title", boxes.title], ["author", boxes.author]] as const).filter((b): b is readonly [CoverBlock, CoverBox] => !!b[1]) : [];
  const upper = selected === "author" ? style.upper !== false : !!style.upper;
  const sizeRange = SIZES[selected];
  const moved = !!design.places?.title || !!design.places?.author;

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
        <div className="cover-maker-grid">
          <div className="cover-maker-stage">
            <div className="cover-maker-canvas">
              <canvas ref={canvas} className="cover-maker-preview" aria-label="The cover as it will look" />
              {boxes &&
                shownBoxes.map(([block, box]) => (
                  <div
                    key={block}
                    role="button"
                    tabIndex={0}
                    aria-label={`${BLOCK_LABEL[block]}: drag to move, or use the arrow keys`}
                    aria-pressed={selected === block}
                    className={`cover-maker-block${selected === block ? " selected" : ""}`}
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
                    onFocus={() => setSelected(block)}
                    onKeyDown={(e) => nudge(block, e)}
                    onDoubleClick={() => {
                      setSelected(block);
                      requestAnimationFrame(() => textBox.current?.focus());
                    }}
                  />
                ))}
            </div>
            <p className="muted cover-maker-tip">Drag the title or author to move it. Hold Shift to move straight across or straight up and down.</p>
            {moved && (
              <button type="button" className="link-btn" onClick={() => set({ places: {} })}>
                Put the words back in place
              </button>
            )}
          </div>
          <div className="cover-maker-fields">
            <div className="segmented" role="radiogroup" aria-label="Which words to change">
              {(["title", "author"] as const).map((block) => (
                <button key={block} type="button" role="radio" aria-checked={selected === block} onClick={() => setSelected(block)}>
                  {BLOCK_LABEL[block]}
                </button>
              ))}
            </div>
            {selected === "title" ? (
              <label className="field">
                <span>Title</span>
                <textarea ref={textBox} rows={2} value={design.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
                <span className="settings-row-hint">Press Enter to start a new line.</span>
              </label>
            ) : (
              <label className="field">
                <AuthorLabel />
                <input ref={textBox} value={design.author} onChange={(e) => set({ author: e.target.value })} maxLength={200} />
              </label>
            )}
            <div className="cover-maker-format" aria-label={`How the ${BLOCK_LABEL[selected].toLowerCase()} looks`} role="group">
              <label className="field">
                <span>Lettering</span>
                <select
                  value={style.font ?? ""}
                  onChange={(e) => setStyle(selected, { font: (e.target.value || undefined) as CoverTextStyle["font"] })}
                >
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
                    aria-label={`${BLOCK_LABEL[selected]} size`}
                    min={sizeRange.min}
                    max={sizeRange.max}
                    step={2}
                    value={style.size ?? (selected === "title" ? 200 : 84)}
                    onChange={(e) => setStyle(selected, { size: Number(e.target.value) })}
                  />
                  <button type="button" className="btn btn-quiet btn-small" disabled={style.size === undefined} onClick={() => setStyle(selected, { size: undefined })}>
                    {selected === "title" ? "Fit" : "Match title"}
                  </button>
                </div>
              </div>
              <div className="cover-maker-toggles">
                <button
                  type="button"
                  className="cover-maker-toggle"
                  aria-pressed={style.bold ?? selected === "title"}
                  aria-label="Bold"
                  title="Bold"
                  onClick={() => setStyle(selected, { bold: !(style.bold ?? selected === "title") })}
                >
                  <b>B</b>
                </button>
                <button type="button" className="cover-maker-toggle" aria-pressed={!!style.italic} aria-label="Italic" title="Italic" onClick={() => setStyle(selected, { italic: !style.italic })}>
                  <i>I</i>
                </button>
                <button type="button" className="cover-maker-toggle" aria-pressed={upper} aria-label="Capitals" title="Capitals" onClick={() => setStyle(selected, { upper: !upper })}>
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
                    onClick={() => setStyle(selected, { align: value })}
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
                <div className="cover-maker-swatches" role="radiogroup" aria-label={`${BLOCK_LABEL[selected]} colour`}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!style.colour}
                    className="btn btn-quiet btn-small"
                    onClick={() => setStyle(selected, { colour: undefined })}
                  >
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
                      onClick={() => setStyle(selected, { colour: c })}
                    />
                  ))}
                  <input
                    type="color"
                    className="cover-maker-colour-pick"
                    aria-label="Another colour"
                    title="Another colour"
                    value={style.colour ?? "#f5f1ea"}
                    onChange={(e) => setStyle(selected, { colour: e.target.value })}
                  />
                </div>
              </div>
              {selected === "title" && (
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
                    onClick={() => set({ background: i, picture: null })}
                  />
                ))}
              </div>
              <span className="cover-maker-picture">
                <button type="button" className="btn btn-quiet btn-small" onClick={() => picking.current?.click()}>
                  {design.picture ? "Change picture" : "Use a picture of my own"}
                </button>
                {design.picture && (
                  <button type="button" className="link-btn" onClick={() => set({ picture: null })}>
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
                  if (file) set({ picture: URL.createObjectURL(file) });
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
