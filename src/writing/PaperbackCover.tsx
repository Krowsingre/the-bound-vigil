// The paperback cover maker: back, spine and front together, at the size the
// printer asks for, with the trim, spine and safe area shown while it's made.

import { AuthorLabel } from "./AuthorInfo";
import { useEffect, useRef, useState } from "react";
import { api, isWeb } from "../api";
import type { WritingProject } from "../api/types";
import { useToast } from "../components/Toast";
import { BACKGROUNDS, COVER_FONTS } from "./CoverMaker";
import { imageMime } from "./fonts";
import { estimatePages } from "./printBook";
import { TRIMS, type TrimSize } from "./printSettings";
import { bookFileName } from "./txt";
import { dpiFor, drawWrap, jpegPdf, PAPERS, SPINE_TEXT_PAGES, wrapFor, type Paper, type PaperbackDesign, type Printer } from "./paperbackWrap";

/** How many pages the book's PDF came to when it was last made, kept for the cover. */
export const pagesKey = (projectId: string) => `tbv.print.pages.${projectId}`;

const remembered = (projectId: string): number | null => {
  try {
    const n = Number(localStorage.getItem(pagesKey(projectId)));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

export function PaperbackCover({ project, trim: startTrim, onClose }: { project: WritingProject; trim: TrimSize; onClose: () => void }) {
  const toast = useToast();
  const [trim, setTrim] = useState<TrimSize>(startTrim);
  const lastPages = remembered(project.id);
  const [pages, setPages] = useState(() => lastPages ?? estimatePages(project.words, startTrim));
  const [printer, setPrinter] = useState<Printer>("kdp");
  const [paper, setPaper] = useState<Paper>("cream");
  const [guides, setGuides] = useState(true);
  const [design, setDesign] = useState<PaperbackDesign>({
    title: project.title,
    author: project.author ?? "",
    background: 0,
    font: "Lora",
    front: null,
    frontPicture: null,
    blurb: project.description ?? "",
    bio: "",
    photo: null,
    barcodeBox: true,
  });
  const [ownCover, setOwnCover] = useState<string | null>(null);
  const [frontDpi, setFrontDpi] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const photoPick = useRef<HTMLInputElement>(null);
  const picturePick = useRef<HTMLInputElement>(null);
  const set = (change: Partial<PaperbackDesign>) => setDesign((d) => ({ ...d, ...change }));

  // The book's own cover, for the front.
  useEffect(() => {
    if (!project.cover) return;
    let url: string | null = null;
    let gone = false;
    void api
      .writingCover(project.id)
      .then((bytes) => {
        const mime = bytes.length ? imageMime(bytes) : null;
        if (!mime || gone) return;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        setOwnCover(url);
        setDesign((d) => ({ ...d, front: url }));
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [project.id, project.cover]);

  const usable = PAPERS.filter((p) => p.printers.includes(printer));
  const wrap = wrapFor(trim, pages, printer, usable.some((p) => p.value === paper) ? paper : "cream");

  // The preview is drawn small; the saved file at full size.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let stale = false;
    const small = document.createElement("canvas");
    void drawWrap(small, design, wrap, 60, guides).then(({ frontDpi }) => {
      if (stale) return;
      c.width = small.width;
      c.height = small.height;
      c.getContext("2d")!.drawImage(small, 0, 0);
      setFrontDpi(frontDpi === null ? null : Math.round((frontDpi * 300) / 60));
    });
    return () => void (stale = true);
  }, [design, guides, trim, pages, printer, paper]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const fileName = bookFileName(`${project.title} (paperback cover)`, "pdf");
      const path = isWeb ? null : await api.pickExportPath(fileName, "pdf");
      if (!isWeb && !path) return;
      const dpi = dpiFor(wrap);
      const full = document.createElement("canvas");
      await drawWrap(full, design, wrap, dpi, false);
      const blob = await new Promise<Blob | null>((resolve) => full.toBlob(resolve, "image/jpeg", 0.95));
      if (!blob) throw new Error("The cover couldn't be drawn.");
      const pdf = jpegPdf(new Uint8Array(await blob.arrayBuffer()), { width: full.width, height: full.height }, { width: wrap.width, height: wrap.height });
      await api.saveExportFile(pdf, fileName, path);
      toast(isWeb ? `${fileName} has been downloaded.` : `${fileName} has been saved.`);
      onClose();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };

  const inches = (n: number) => `${n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} in`;
  const lowFront = frontDpi !== null && frontDpi < 300;

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        className="dialog writing-dialog paperback-cover"
        role="dialog"
        aria-label="Paperback cover"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <h2>Paperback cover</h2>
        <p className="muted dialog-lede">The back, spine and front in one file, sized for the printer. The spine's width comes from the page count and the paper.</p>
        <div className="paperback-cover-view">
          <canvas ref={canvas} className="paperback-cover-preview" aria-label="The whole cover: back, spine and front" />
          <div className="paperback-cover-sizes muted">
            <span>
              Whole cover {inches(wrap.width)} × {inches(wrap.height)}
            </span>
            <span>Spine {inches(wrap.spine)}</span>
            {!wrap.spineText && <span>Under {SPINE_TEXT_PAGES} pages, the spine stays plain (KDP's rule)</span>}
          </div>
          <label className="check-row">
            <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
            <span>Show the guides: trim (red), spine (blue) and where words are safe (green). They're never printed.</span>
          </label>
        </div>

        <fieldset className="writing-export-group">
          <legend>Printing</legend>
          <div className="writing-export-styles">
            <label className="field">
              <span>Printer</span>
              <select value={printer} onChange={(e) => setPrinter(e.target.value as Printer)}>
                <option value="kdp">Amazon KDP</option>
                <option value="ingram">IngramSpark</option>
              </select>
            </label>
            <label className="field">
              <span>Paper</span>
              <select value={usable.some((p) => p.value === paper) ? paper : "cream"} onChange={(e) => setPaper(e.target.value as Paper)}>
                {usable.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Trim size</span>
              <select value={trim} onChange={(e) => setTrim(e.target.value as TrimSize)}>
                {TRIMS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Pages</span>
              <input type="number" min={1} max={1200} value={pages} onChange={(e) => setPages(Math.max(1, Math.min(1200, Math.round(Number(e.target.value) || 1))))} />
            </label>
          </div>
          <p className="muted writing-export-note">
            {lastPages ? `${lastPages} pages is what the book's print PDF came to last time.` : "This is a guess from the word count. Make the print PDF first for the exact number."}{" "}
            {printer === "ingram" ? "IngramSpark asks for CMYK colours and converts others, so colours can shift a little. Its own cover template has the final say on the spine." : ""}
          </p>
        </fieldset>

        <fieldset className="writing-export-group">
          <legend>Front</legend>
          {ownCover && (
            <div className="segmented" role="radiogroup" aria-label="The front">
              <button type="button" role="radio" aria-checked={!!design.front} onClick={() => set({ front: ownCover })}>
                The book's cover
              </button>
              <button type="button" role="radio" aria-checked={!design.front} onClick={() => set({ front: null })}>
                Lettering here
              </button>
            </div>
          )}
          {design.front ? (
            lowFront && (
              <p className="form-error">
                The book's cover prints at {frontDpi} dots an inch at this size; printers ask for 300. Lettering it here prints sharp, or use a larger picture.
              </p>
            )
          ) : (
            <span className="cover-maker-picture">
              <button type="button" className="btn btn-quiet btn-small" onClick={() => picturePick.current?.click()}>
                {design.frontPicture ? "Change the picture" : "A picture behind the title"}
              </button>
              {design.frontPicture && (
                <button type="button" className="link-btn" onClick={() => set({ frontPicture: null })}>
                  Remove picture
                </button>
              )}
            </span>
          )}
          <div className="writing-export-styles">
            <label className="field">
              <span>Title</span>
              <input value={design.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
            </label>
            <label className="field">
              <AuthorLabel />
              <input value={design.author} onChange={(e) => set({ author: e.target.value })} maxLength={200} />
            </label>
          </div>
        </fieldset>

        <fieldset className="writing-export-group">
          <legend>Back and spine</legend>
          <div className="field">
            <span>Colour</span>
            <div className="cover-maker-swatches" role="radiogroup" aria-label="Colour">
              {BACKGROUNDS.map((b, i) => (
                <button
                  key={b.name}
                  type="button"
                  role="radio"
                  aria-checked={design.background === i}
                  aria-label={b.name}
                  title={b.name}
                  className="cover-maker-swatch"
                  style={{ background: `linear-gradient(${b.top}, ${b.bottom})` }}
                  onClick={() => set({ background: i })}
                />
              ))}
            </div>
          </div>
          <label className="field">
            <span>Lettering</span>
            <select value={design.font} onChange={(e) => set({ font: e.target.value as PaperbackDesign["font"] })}>
              {COVER_FONTS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>On the back</span>
            <textarea rows={5} value={design.blurb} onChange={(e) => set({ blurb: e.target.value })} placeholder="What the book is about, to make a reader pick it up" />
          </label>
          <label className="field">
            <span>About the author</span>
            <textarea rows={2} value={design.bio} onChange={(e) => set({ bio: e.target.value })} placeholder="A line or two" />
          </label>
          <span className="cover-maker-picture">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => photoPick.current?.click()}>
              {design.photo ? "Change the author's photo" : "Add the author's photo"}
            </button>
            {design.photo && (
              <button type="button" className="link-btn" onClick={() => set({ photo: null })}>
                Remove photo
              </button>
            )}
          </span>
          <label className="check-row">
            <input type="checkbox" checked={design.barcodeBox} onChange={(e) => set({ barcodeBox: e.target.checked })} />
            <span>Keep a white space for the barcode (KDP prints one there if you don't have your own)</span>
          </label>
        </fieldset>

        {(["photo", "frontPicture"] as const).map((key) => (
          <input
            key={key}
            ref={key === "photo" ? photoPick : picturePick}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                if (design[key]) URL.revokeObjectURL(design[key]!);
                set({ [key]: URL.createObjectURL(file) });
              }
              e.target.value = "";
            }}
          />
        ))}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Making the cover…" : "Save the cover PDF"}
          </button>
        </div>
      </form>
    </div>
  );
}
