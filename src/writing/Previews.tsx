// Side-by-side previews: the book as a Kindle, Apple Books, a Kobo and a
// phone would lay it out, page by page, and the paperback as two-page
// spreads (laid out by the print page, src/print). Each e-reader's page
// size, margins and usual font are close to the real thing's; the book's own
// fonts and look come with it, as they would.

import { useEffect, useMemo, useRef, useState } from "react";
import type { WritingChapter, WritingProject } from "../api/types";
import { Icon } from "../components/Icon";
import { bookSheets, bookOrder, escapeXml, inlineStyles, sheetHtml, type ExportSettings } from "./epub";
import { printHtml } from "./printBook";
import { TRIMS } from "./printSettings";
import { bookInput } from "./WritingDialogs";

type DeviceId = "kindle" | "apple" | "kobo" | "phone" | "paperback";

interface Device {
  id: DeviceId;
  label: string;
  /** The screen, in CSS pixels. */
  width: number;
  height: number;
  /** Margins round the words. */
  side: number;
  top: number;
  paper: string;
  ink: string;
  /** The reader's own font, used when the book carries none. */
  font: string;
  size: number;
  frame: "eink" | "phone" | "tablet";
}

const DEVICES: Device[] = [
  { id: "kindle", label: "Kindle", width: 316, height: 422, side: 22, top: 26, paper: "#f5f3ec", ink: "#151515", font: "Bookerly, Georgia, serif", size: 15, frame: "eink" },
  { id: "apple", label: "Apple Books", width: 340, height: 520, side: 28, top: 34, paper: "#ffffff", ink: "#1c1c1e", font: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif', size: 16, frame: "tablet" },
  { id: "kobo", label: "Kobo", width: 300, height: 400, side: 20, top: 24, paper: "#f1efe8", ink: "#1a1a1a", font: "Georgia, serif", size: 15, frame: "eink" },
  { id: "phone", label: "Phone", width: 270, height: 560, side: 18, top: 30, paper: "#fbfaf7", ink: "#202124", font: "Literata, Georgia, serif", size: 15, frame: "phone" },
];

const PAPERBACK = { id: "paperback" as const, label: "Paperback spread" };

/** One e-reader's page: the book flowed into columns a screen wide, turned by scrolling sideways. */
function deviceDoc(css: string, sheets: string, d: Device, scale: number, lang: string): string {
  const inner = d.height - 2 * d.top;
  return `<!DOCTYPE html>
<html lang="${escapeXml(lang)}">
<head>
<meta charset="UTF-8"/>
<style>
body { font-family: ${d.font}; }
${css}
html { height: 100%; overflow: hidden; background: ${d.paper}; color: ${d.ink}; }
body { margin: 0 !important; height: 100%; box-sizing: border-box; padding: ${d.top}px ${d.side}px; column-width: ${d.width - 2 * d.side}px; column-gap: ${2 * d.side}px; column-fill: auto; font-size: ${d.size * scale}px; }
img { max-height: ${inner}px; }
.sheet.cover { height: ${inner}px; display: flex; align-items: center; justify-content: center; }
.sheet.cover img { max-height: ${inner}px; max-width: 100%; }
figure.full-page { height: ${inner}px; margin: 0; }
.page-fill { margin: 0; padding: 0; }
figure.full-page img { max-height: ${inner - 40}px; }
a { color: inherit; }
</style>
</head>
<body>
${sheets}
</body>
</html>`;
}

/**
 * Starts each of the book's pages (and each picture with a page of its own)
 * at the top of a screen, as e-readers do, by filling the rest of the screen
 * before it. Done by measuring, since a browser's columns don't always break
 * where they're asked to.
 */
function startPagesOnNewScreens(doc: Document, d: Device) {
  const height = d.height - 2 * d.top;
  doc.querySelectorAll(".page-fill").forEach((el) => el.remove());
  const starts = [...doc.querySelectorAll<HTMLElement>(".sheet:not(:first-child), figure.full-page")];
  for (const el of starts) {
    const margin = parseFloat(doc.defaultView?.getComputedStyle(el).marginTop ?? "0") || 0;
    // The first piece of it, where it starts (a page running over several screens has a box on each).
    const start = el.getClientRects()[0] ?? el.getBoundingClientRect();
    const down = start.top - margin - d.top;
    if (down < 2 || down >= height) continue;
    const fill = doc.createElement("div");
    fill.className = "page-fill";
    fill.style.height = `${height - down}px`;
    el.before(fill);
  }
}

export function PreviewsDialog({
  project,
  chapters,
  settings,
  showing,
  onClose,
}: {
  project: WritingProject;
  chapters: WritingChapter[];
  settings: ExportSettings;
  /** The section open in the editor, which the previews start at. */
  showing: string | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<DeviceId[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("tbv.previews.devices") ?? "null") as unknown;
      if (Array.isArray(saved) && saved.length) return saved.filter((d): d is DeviceId => [...DEVICES.map((x) => x.id), PAPERBACK.id].includes(d));
    } catch {
      // All of them, then.
    }
    return ["kindle", "apple", "kobo", "phone", "paperback"];
  });
  const [scale, setScale] = useState(1);
  const [book, setBook] = useState<{ css: string; sheets: string; print: string } | null>(null);
  const [section, setSection] = useState<string | null>(showing);
  const [pages, setPages] = useState<Record<string, { at: number; of: number }>>({});
  const frames = useRef<Record<string, HTMLIFrameElement | null>>({});
  const lang = project.language?.trim() || "en";

  const sections = useMemo(
    () =>
      bookOrder(chapters)
        .map((c, i) => ({ id: c.id, n: i + 1, title: c.title.trim() || (c.role === "part" ? "Part" : "Untitled") }))
        .filter((s) => s.title),
    [chapters],
  );

  useEffect(() => {
    try {
      localStorage.setItem("tbv.previews.devices", JSON.stringify(shown));
    } catch {
      // Chosen for this time only.
    }
  }, [shown]);

  useEffect(() => {
    let current = true;
    void (async () => {
      const input = await bookInput(project, chapters, settings);
      const { sheets, files } = bookSheets(input);
      const html = sheets.map((s) => `<article class="sheet ${s.cls}">${sheetHtml(files, s)}</article>`).join("\n");
      // The paperback carries its own font, as a printed page has to.
      const printed = settings.font === "none" ? { ...settings, font: "lora" as const } : settings;
      const print = printHtml(await bookInput(project, chapters, printed), settings.print);
      if (current) setBook({ css: inlineStyles(files), sheets: html, print });
    })();
    return () => {
      current = false;
    };
  }, [project, chapters, settings]);

  const docs = useMemo(() => (book ? Object.fromEntries(DEVICES.map((d) => [d.id, deviceDoc(book.css, book.sheets, d, scale, lang)])) : {}), [book, scale, lang]);

  /** Shows page `at` of one e-reader, and notes where it is. */
  const turnTo = (id: DeviceId, at: number) => {
    const frame = frames.current[id];
    const win = frame?.contentWindow;
    const doc = frame?.contentDocument;
    if (!win || !doc?.scrollingElement) return;
    const width = win.innerWidth;
    const of = Math.max(1, Math.round(doc.scrollingElement.scrollWidth / width));
    const page = Math.max(0, Math.min(of - 1, at));
    doc.scrollingElement.scrollLeft = page * width;
    setPages((p) => ({ ...p, [id]: { at: page, of } }));
  };
  const turn = (by: number) => {
    for (const d of DEVICES) if (shown.includes(d.id)) turnTo(d.id, (pages[d.id]?.at ?? 0) + by);
    if (shown.includes("paperback")) {
      const win = frames.current.paperback?.contentWindow;
      win?.scrollBy({ top: by * (win.innerHeight - 40), behavior: "smooth" });
    }
  };
  /** Every preview to the start of a section. */
  const goTo = (id: string | null) => {
    const n = id ? (sections.find((s) => s.id === id)?.n ?? 0) : 0;
    for (const d of DEVICES) {
      if (!shown.includes(d.id)) continue;
      const frame = frames.current[d.id];
      const doc = frame?.contentDocument;
      const target = n ? doc?.getElementById(`c${n}`) : null;
      if (!doc?.scrollingElement || !frame?.contentWindow) continue;
      const left = target ? target.getBoundingClientRect().left + doc.scrollingElement.scrollLeft : 0;
      turnTo(d.id, Math.floor((left + 2) / frame.contentWindow.innerWidth));
    }
    // Scrolled within its own frame, so the row of devices stays where it is.
    const paperWin = frames.current.paperback?.contentWindow;
    const page = (n ? paperWin?.document.getElementById(`c${n}`) : null)?.closest(".pagedjs_page");
    if (paperWin) paperWin.scrollTo({ top: page ? page.getBoundingClientRect().top + paperWin.scrollY - 16 : 0 });
  };

  // The paperback: the print page lays it out in its frame once it says it's ready.
  useEffect(() => {
    if (!book || !shown.includes("paperback")) return;
    const heard = (e: MessageEvent<{ kind?: string }>) => {
      const win = frames.current.paperback?.contentWindow;
      if (e.source !== win || e.origin !== location.origin) return;
      if (e.data?.kind === "tbv-print-ready") win?.postMessage({ kind: "tbv-print-job", html: book.print }, location.origin);
      if (e.data?.kind === "tbv-print-done") {
        // Two pages side by side, made small enough to fit the space.
        const doc = frames.current.paperback?.contentDocument;
        const first = doc?.querySelector<HTMLElement>(".pagedjs_page");
        const frame = frames.current.paperback;
        if (doc && first && frame?.clientWidth) {
          const fit = Math.min(1, (frame.clientWidth - 48) / (2 * first.offsetWidth), (frame.clientHeight - 48) / first.offsetHeight);
          doc.documentElement.style.setProperty("zoom", String(Math.max(0.3, fit)));
        }
        if (section) setTimeout(() => goTo(section), 50);
      }
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
    // goTo reads the frames as they are when the layout finishes.
  }, [book, shown]);

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") turn(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") turn(-1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  const toggle = (id: DeviceId) => setShown((list) => (list.includes(id) ? (list.length > 1 ? list.filter((x) => x !== id) : list) : [...list, id]));

  return (
    <div className="previews" role="dialog" aria-label="Previews on each device">
      <header className="previews-head">
        <h2>Previews</h2>
        <div className="previews-devices" role="group" aria-label="Devices">
          {[...DEVICES, PAPERBACK].map((d) => (
            <button key={d.id} type="button" className={`chip${shown.includes(d.id) ? " is-active" : ""}`} aria-pressed={shown.includes(d.id)} onClick={() => toggle(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
        <label className="field previews-section">
          <span className="visually-hidden">Go to</span>
          <select
            value={section ?? ""}
            onChange={(e) => {
              setSection(e.target.value || null);
              goTo(e.target.value || null);
            }}
          >
            <option value="">The start</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented previews-size" role="group" aria-label="Text size">
          <button type="button" aria-label="Smaller text" disabled={scale <= 0.8} onClick={() => setScale((s) => Math.round((s - 0.1) * 10) / 10)}>
            A−
          </button>
          <button type="button" aria-label="Larger text" disabled={scale >= 1.6} onClick={() => setScale((s) => Math.round((s + 0.1) * 10) / 10)}>
            A+
          </button>
        </div>
        <div className="previews-turn">
          <button type="button" className="btn btn-quiet btn-icon" aria-label="Previous page" onClick={() => turn(-1)}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <button type="button" className="btn btn-quiet btn-icon" aria-label="Next page" onClick={() => turn(1)}>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          <Icon name="edit" size={16} /> Back to writing
        </button>
      </header>
      <div className="previews-stage">
        {!book && <div className="library-loading" aria-busy="true" aria-label="Making the previews" />}
        {book &&
          DEVICES.filter((d) => shown.includes(d.id)).map((d) => (
            <figure key={d.id} className={`previews-device is-${d.frame} device-${d.id}`}>
              <div className="previews-screen" style={{ width: d.width, height: d.height }}>
                <iframe
                  ref={(el) => {
                    frames.current[d.id] = el;
                  }}
                  title={`The book on ${d.label}`}
                  srcDoc={docs[d.id]}
                  sandbox="allow-same-origin"
                  onLoad={(e) => {
                    const doc = e.currentTarget.contentDocument;
                    if (doc) startPagesOnNewScreens(doc, d);
                    if (section) goTo(section);
                    else turnTo(d.id, pages[d.id]?.at ?? 0);
                  }}
                />
                <button type="button" className="previews-tap is-back" aria-label={`Previous page on ${d.label}`} onClick={() => turnTo(d.id, (pages[d.id]?.at ?? 0) - 1)} />
                <button type="button" className="previews-tap is-next" aria-label={`Next page on ${d.label}`} onClick={() => turnTo(d.id, (pages[d.id]?.at ?? 0) + 1)} />
              </div>
              <figcaption>
                <b>{d.label}</b>
                <span className="muted">{pages[d.id] ? `${pages[d.id].at + 1} of ${pages[d.id].of}` : ""}</span>
              </figcaption>
            </figure>
          ))}
        {book && shown.includes("paperback") && (
          <figure className="previews-device is-paperback">
            <div className="previews-paper">
              <iframe
                ref={(el) => {
                  frames.current.paperback = el;
                }}
                title="The paperback, two pages at a time"
                src="/print.html?spread"
              />
            </div>
            <figcaption>
              <b>Paperback</b>
              <span className="muted">{(TRIMS.find((t) => t.value === settings.print.trim)?.label ?? "").replace(/ \(.*\)$/, "")}, as laid out for print</span>
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
