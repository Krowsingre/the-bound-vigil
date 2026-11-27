import { RememberedDetails } from "../components/RememberedDetails";
// Designing in Canva (embre, 3 November 2026). With Canva connected (a
// Scribe Publisher feature, on computers), "Design in Canva" makes a design
// of exactly the right size, or opens the one made before, and "Bring it
// back" fetches the finished file. Without it, the box says how to make one
// by hand at the right size, and the finished file comes back through the
// button beside it.

import { useEffect, useState, type ReactNode } from "react";
import { api, isApp, openExternal } from "../api";
import type { CanvaDesign, CanvaStatus, WritingProject } from "../api/types";
import { useToast } from "../components/Toast";
import { usePublisher } from "../license/Publisher";
import { canvaHere } from "../settings/CanvaSection";
import { readCanva, type CanvaDesignRecord, type CanvaFor } from "./canvaDesigns";
import { readExport } from "./epub";

export const CANVA_URL = "https://www.canva.com/";

let known: Promise<CanvaStatus> | null = null;
const listeners = new Set<(s: CanvaStatus) => void>();
/** Whether Canva is connected, asked once and shared. */
export function canvaStatus(fresh = false): Promise<CanvaStatus> {
  if (!known || fresh) {
    known = api.canvaStatus().catch(() => ({ available: false, name: null }));
    void known.then((s) => listeners.forEach((l) => l(s)));
  }
  return known;
}

/** Connected or disconnected somewhere: everything showing Canva changes with it. */
export function setCanvaStatus(s: CanvaStatus) {
  known = Promise.resolve(s);
  listeners.forEach((l) => l(s));
}

export function useCanvaStatus(): [CanvaStatus | null, (s: CanvaStatus) => void] {
  const [status, setStatus] = useState<CanvaStatus | null>(null);
  useEffect(() => {
    let live = true;
    void canvaStatus().then((s) => live && setStatus(s));
    const heard = (s: CanvaStatus) => live && setStatus(s);
    listeners.add(heard);
    return () => {
      live = false;
      listeners.delete(heard);
    };
  }, []);
  return [status, setCanvaStatus];
}

/** The design kept with a book for `what`, read fresh so another window's change isn't lost. */
export async function keptCanvaDesign(projectId: string, what: CanvaFor): Promise<CanvaDesignRecord | null> {
  const view = await api.writingProject(projectId);
  return readCanva(readExport(view.project.export).canva)[what] ?? null;
}

/** Keeps (or with null, forgets) the design for `what` in the book's settings. */
export async function keepCanvaDesign(projectId: string, what: CanvaFor, record: CanvaDesignRecord | null): Promise<void> {
  const view = await api.writingProject(projectId);
  const settings = readExport(view.project.export);
  const canva = { ...settings.canva };
  if (record) canva[what] = record;
  else delete canva[what];
  const json = JSON.stringify({ ...settings, canva });
  await api.setWritingExport(projectId, json);
  // The open book keeps its settings in memory; this keeps them in step, so its next change doesn't drop the design.
  window.dispatchEvent(new CustomEvent(EXPORT_CHANGED, { detail: { projectId, json } }));
}

/** Sent when a book's export settings were changed from outside the book's own page. */
export const EXPORT_CHANGED = "tbv-writing-export-changed";

export interface CanvaConnection {
  project: Pick<WritingProject, "id">;
  for: CanvaFor;
  /** The design's name in Canva. */
  title: string;
  /** In pixels. */
  width: number;
  height: number;
  format: "png" | "jpg" | "pdf";
  /** Makes the design some other way than an empty page, such as sending the book's pages. */
  make?: () => Promise<CanvaDesign>;
  /** Extra details to keep with the design when it's made. */
  record?: () => Promise<Partial<CanvaDesignRecord>>;
  /** The finished file. */
  onBack: (bytes: Uint8Array, design: CanvaDesignRecord) => Promise<void> | void;
  /** Words for the buttons. */
  designLabel?: string;
  backLabel?: string;
}

export function CanvaLink({ what, size, extra, canva }: { what: string; size: string; extra?: ReactNode; canva?: CanvaConnection }) {
  const toast = useToast();
  const publisher = usePublisher();
  const [status, setStatus] = useCanvaStatus();
  const [kept, setKept] = useState<CanvaDesignRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const connected = !!canva && canvaHere && !!status?.available && !!status.name;
  const projectId = canva?.project.id;
  const what_ = canva?.for;

  useEffect(() => {
    if (!connected || !projectId || !what_) return;
    let live = true;
    void keptCanvaDesign(projectId, what_).then((r) => live && setKept(r), () => undefined);
    return () => void (live = false);
  }, [connected, projectId, what_]);

  const run = (label: string, work: () => Promise<void>) =>
    publisher.check("Canva", () => {
      setBusy(label);
      void work()
        .catch((e: unknown) => {
          const message = String(e).replace(/^Error: /, "");
          toast(message);
          // Signed out in Canva: show the connect button again.
          if (/signed TBV out|Connect Canva first/.test(message)) void canvaStatus(true).then(setStatus);
        })
        .finally(() => setBusy(null));
    });

  const make = async (c: CanvaConnection): Promise<CanvaDesignRecord> => {
    const design = c.make ? await c.make() : await api.canvaNewDesign(c.title, c.width, c.height);
    const record: CanvaDesignRecord = { id: design.id, made: new Date().toISOString(), ...(await c.record?.()) };
    await keepCanvaDesign(c.project.id, c.for, record);
    setKept(record);
    await api.canvaOpen(design.editUrl);
    return record;
  };

  const design = (c: CanvaConnection, again: boolean) =>
    run("design", async () => {
      if (kept && !again) {
        const found = await api.canvaDesign(kept.id);
        if (found) return api.canvaOpen(found.editUrl);
        toast("That design isn't in Canva any more, so here's a new one.");
      }
      await make(c);
    });

  const bringBack = (c: CanvaConnection) =>
    run("back", async () => {
      if (!kept) throw new Error("Make the design in Canva first.");
      const bytes = await api.canvaExport(kept.id, c.format);
      await c.onBack(bytes, kept);
    });

  const connect = () =>
    run("connect", async () => {
      if (!isApp && !import.meta.env.DEV) throw new Error("Connecting Canva works in the desktop app.");
      const next = await api.canvaSignIn();
      setStatus(next);
      toast(`Canva is connected${next.name ? ` as ${next.name}` : ""}.`);
    });

  const byHand = (
    <>
      <p className="settings-row-hint">
        Open Canva, choose Create a design › Custom size, and make {what} at <strong>{size}</strong>. Download it when it's done
        {extra ? ", then bring it back here." : "."}
      </p>
      <span className="canva-link-buttons">
        <button type="button" className="btn btn-quiet btn-small" onClick={() => void openExternal(CANVA_URL)}>
          Open Canva
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={() => void navigator.clipboard?.writeText(size).then(() => toast(`Copied ${size}.`), () => toast(`The size is ${size}.`))}
        >
          Copy the size
        </button>
        {extra}
      </span>
    </>
  );

  if (connected && canva)
    return (
      <div className="canva-link is-connected">
        <span className="canva-link-head">Design it in Canva</span>
        <p className="settings-row-hint">
          {kept
            ? `Your design is kept with the book. Change it in Canva, then bring it back here.`
            : `Makes ${what} in your Canva account at exactly ${size}, and opens it in your browser. When it's done, bring it back here.`}
        </p>
        <span className="canva-link-buttons">
          <button type="button" className="btn btn-quiet btn-small" disabled={!!busy} onClick={() => design(canva, false)}>
            {busy === "design" ? "Opening Canva…" : kept ? "Open it in Canva" : (canva.designLabel ?? "Design in Canva")}
          </button>
          <button type="button" className="btn btn-primary btn-small" disabled={!!busy || !kept} onClick={() => bringBack(canva)}>
            {busy === "back" ? "Bringing it back…" : (canva.backLabel ?? "Bring it back")}
          </button>
          {kept && (
            <button type="button" className="link-btn" disabled={!!busy} onClick={() => design(canva, true)}>
              Start a new design
            </button>
          )}
        </span>
        <RememberedDetails disclosure="writing.canvaManual" className="canva-link-hand">
          <summary>Or make it by hand</summary>
          {byHand}
        </RememberedDetails>
      </div>
    );

  return (
    <div className="canva-link">
      <span className="canva-link-head">Rather design it in Canva?</span>
      {byHand}
      {canva && canvaHere && status?.available && !status.name && (
        <p className="settings-row-hint canva-link-connect">
          <button type="button" className="link-btn" disabled={!!busy} onClick={connect}>
            {busy === "connect" ? "Waiting for Canva in your browser…" : "Connect Canva"}
          </button>{" "}
          to make it there at the right size and bring it back in one click.
        </p>
      )}
    </div>
  );
}

const PICTURE_SHAPES = [
  { label: "Tall", width: 1600, height: 2400 },
  { label: "Wide", width: 2400, height: 1600 },
  { label: "Square", width: 2000, height: 2000 },
  { label: "A whole page", width: 1800, height: 2700 },
];

/** Designing a picture for a chapter in Canva, then putting it in where the cursor was. */
export function CanvaPictureDialog({ projectId, chapterId, onPicture, onClose }: { projectId: string; chapterId: string; onPicture: (file: File) => Promise<void>; onClose: () => void }) {
  const [shape, setShape] = useState(0);
  const s = PICTURE_SHAPES[shape];
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog writing-dialog canva-picture" role="dialog" aria-label="A picture from Canva" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>A picture from Canva</h2>
        <div className="segmented" role="radiogroup" aria-label="Its shape">
          {PICTURE_SHAPES.map((p, i) => (
            <button key={p.label} type="button" role="radio" aria-checked={shape === i} onClick={() => setShape(i)}>
              {p.label}
            </button>
          ))}
        </div>
        <CanvaLink
          what="a picture"
          size={`${s.width} × ${s.height} px`}
          canva={{
            project: { id: projectId },
            for: `picture:${chapterId}`,
            title: "Picture",
            width: s.width,
            height: s.height,
            format: "png",
            designLabel: "Design it in Canva",
            backLabel: "Put it in the chapter",
            onBack: async (bytes) => {
              await onPicture(new File([bytes as BlobPart], "Picture from Canva.png", { type: "image/png" }));
              onClose();
            },
          }}
        />
        <p className="muted writing-export-note">It goes in where the cursor was. A design you've already made opens again, whichever shape is picked; choose Start a new design for another.</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
