// A simple cover maker: the book's title and author over a colour or a
// picture of your own, drawn at the size stores ask for (1600 × 2560) and
// kept as the book's cover.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { WritingProject } from "../api/types";

export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 2560;

const BACKGROUNDS = [
  { name: "Ink", top: "#1f2731", bottom: "#33414f", light: true },
  { name: "Ash", top: "#e9e4dc", bottom: "#cfc6b8", light: false },
  { name: "Ember", top: "#5a1f1b", bottom: "#a2412c", light: true },
  { name: "Forest", top: "#1d3128", bottom: "#3f5d46", light: true },
  { name: "Dusk", top: "#2b2346", bottom: "#7a4d6e", light: true },
  { name: "Sea", top: "#123544", bottom: "#3f7d8c", light: true },
  { name: "Sand", top: "#f2e3c4", bottom: "#d8b98a", light: false },
  { name: "Night", top: "#08090c", bottom: "#1a1d24", light: true },
] as const;

const FONTS = [
  { value: "Lora", label: "Lora" },
  { value: "Echolume", label: "Echolume" },
  { value: "Georgia", label: "Georgia" },
  { value: "sans-serif", label: "Plain" },
] as const;

type Layout = "top" | "middle" | "bottom";

export interface CoverDesign {
  title: string;
  author: string;
  background: number;
  /** A picture of your own behind the words, as an object URL. */
  picture: string | null;
  font: (typeof FONTS)[number]["value"];
  layout: Layout;
}

/** Breaks text into lines no wider than `width`. */
function lines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Draws the cover onto `canvas`. */
export async function drawCover(canvas: HTMLCanvasElement, design: CoverDesign): Promise<void> {
  const ctx = canvas.getContext("2d")!;
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;
  const bg = BACKGROUNDS[design.background] ?? BACKGROUNDS[0];
  const gradient = ctx.createLinearGradient(0, 0, 0, COVER_HEIGHT);
  gradient.addColorStop(0, bg.top);
  gradient.addColorStop(1, bg.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);

  let light: boolean = bg.light;
  if (design.picture) {
    const img = new Image();
    img.src = design.picture;
    await img.decode().catch(() => undefined);
    if (img.naturalWidth) {
      // Fills the cover, cropping what doesn't fit.
      const scale = Math.max(COVER_WIDTH / img.naturalWidth, COVER_HEIGHT / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (COVER_WIDTH - w) / 2, (COVER_HEIGHT - h) / 2, w, h);
      // A shade behind the words so they read over any picture.
      const shade = ctx.createLinearGradient(0, 0, 0, COVER_HEIGHT);
      const dark = "rgba(0,0,0,0.55)";
      const clear = "rgba(0,0,0,0)";
      const [a, b, c] = design.layout === "top" ? [dark, clear, clear] : design.layout === "bottom" ? [clear, clear, dark] : [clear, dark, clear];
      shade.addColorStop(0, a);
      shade.addColorStop(0.5, b);
      shade.addColorStop(1, c);
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
      light = true;
    }
  }

  const family = design.font === "sans-serif" ? "system-ui, sans-serif" : `"${design.font}", Georgia, serif`;
  await Promise.all([document.fonts?.load(`600 160px ${family}`), document.fonts?.load(`400 80px ${family}`)].filter(Boolean)).catch(() => undefined);
  ctx.fillStyle = light ? "#f5f1ea" : "#1c1f24";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const margin = 160;
  const width = COVER_WIDTH - margin * 2;

  // The title shrinks until it fits in four lines.
  let size = 200;
  let titleLines: string[] = [];
  for (; size >= 90; size -= 10) {
    ctx.font = `600 ${size}px ${family}`;
    titleLines = lines(ctx, design.title.trim() || "Untitled", width);
    if (titleLines.length <= 4 && titleLines.every((l) => ctx.measureText(l).width <= width)) break;
  }
  const lineHeight = size * 1.15;
  const titleHeight = titleLines.length * lineHeight;
  const authorSize = Math.round(size * 0.42);
  const top = design.layout === "top" ? 380 : design.layout === "bottom" ? COVER_HEIGHT - 520 - titleHeight : (COVER_HEIGHT - titleHeight) / 2;
  ctx.font = `600 ${size}px ${family}`;
  titleLines.forEach((l, i) => ctx.fillText(l, COVER_WIDTH / 2, top + size + i * lineHeight));

  // A short rule between title and author.
  const ruleY = top + titleHeight + 70;
  ctx.fillRect(COVER_WIDTH / 2 - 90, ruleY, 180, 6);

  const author = design.author.trim();
  if (author) {
    ctx.font = `400 ${authorSize}px ${family}`;
    ctx.fillText(author.toUpperCase(), COVER_WIDTH / 2, ruleY + 70 + authorSize, width);
  }
}

/** The cover maker. The made cover replaces any cover the book has. */
export function CoverMaker({ project, onMade, onCancel }: { project: WritingProject; onMade: (project: WritingProject) => void; onCancel: () => void }) {
  const [design, setDesign] = useState<CoverDesign>({
    title: project.title,
    author: project.author ?? "",
    background: 0,
    picture: null,
    font: "Lora",
    layout: "middle",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const picking = useRef<HTMLInputElement>(null);
  const set = (change: Partial<CoverDesign>) => setDesign((d) => ({ ...d, ...change }));

  useEffect(() => {
    if (canvas.current) void drawCover(canvas.current, design);
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
      onMade(await api.setWritingCoverPicture(project.id, new Uint8Array(await blob.arrayBuffer()), "jpg"));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
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
        <div className="cover-maker-grid">
          <canvas ref={canvas} className="cover-maker-preview" aria-label="The cover as it will look" />
          <div className="cover-maker-fields">
            <label className="field">
              <span>Title</span>
              <input value={design.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
            </label>
            <label className="field">
              <span>Author</span>
              <input value={design.author} onChange={(e) => set({ author: e.target.value })} maxLength={200} />
            </label>
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
              <span>Lettering</span>
              <select value={design.font} onChange={(e) => set({ font: e.target.value as CoverDesign["font"] })}>
                {FONTS.map((f) => (
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
                  <button key={value} type="button" role="radio" aria-checked={design.layout === value} onClick={() => set({ layout: value })}>
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
