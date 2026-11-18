// The Format tab beside the page (a computer or tablet): the editor's tools,
// laid out as embre's concept has them (18 November). Text: style, font, size
// in points and the marks. Paragraph: alignment, lists, spacing and indents
// for the paragraphs chosen (the book's own settings live in Layout). Insert:
// links, notes, citations, pictures and breaks. Phones keep the toolbar.

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WritingChapter } from "../api/types";
import { Icon, type IconName } from "../components/Icon";
import { useToast } from "../components/Toast";
import { usePublisher } from "../license/Publisher";
import { useShortcuts } from "../lib/shortcuts";
import { canvaHere } from "../settings/CanvaSection";
import { CanvaPictureDialog, useCanvaStatus } from "./CanvaLink";
import { pictureAddress, type BlockLook, type TextLook } from "./extensions";
import { citationLabel, type CitationStyle, type Source } from "./sources";
import { SourcesDialog } from "./SourcesDialog";

export interface SourcesProps {
  sources: Source[];
  citationStyle: CitationStyle;
  onSources: (sources: Source[], style: CitationStyle) => void;
}

/**
 * What a page looks like when nothing is set on it: the font, line spacing and
 * alignment the whole book uses. The menus tick these, so they always show the
 * setting actually in use.
 */
export interface BookLook {
  /** As in FONTS, or null when readers' own font is used. */
  font: string | null;
  lineHeight: string;
  align: NonNullable<BlockLook["textAlign"]>;
  /** Paragraphs indented, or spaced apart (Layout): what Paragraph Spacing and Indentation show when a paragraph sets neither. */
  paragraphs?: "indent" | "space";
}

/** Fonts a passage can be set in: ones TBV can put inside the book, and the reader's own kinds. */
export const FONTS: { label: string; value: string | null }[] = [
  { label: "Lora", value: "Lora, serif" },
  { label: "Crimson Pro", value: "Crimson Pro, serif" },
  { label: "Echolume", value: "Echolume, serif" },
  { label: "Serif", value: "serif" },
  { label: "Sans serif", value: "sans-serif" },
  { label: "Typewriter", value: "monospace" },
];

/** Text sizes are shown in points, with the book's own size as 12. */
const BASE_POINTS = 12;
const LINE_SPACINGS = ["1", "1.15", "1.5", "2"];
const PARAGRAPH_SPACINGS: { label: string; value: string }[] = [
  { label: "None", value: "0" },
  { label: "Small", value: "0.4em" },
  { label: "Medium", value: "0.9em" },
  { label: "Large", value: "1.5em" },
];
const LETTERS: { label: string; value: string | null }[] = [
  { label: "Tight", value: "-0.02em" },
  { label: "Normal", value: null },
  { label: "Wide", value: "0.05em" },
  { label: "Wider", value: "0.12em" },
  { label: "Widest", value: "0.25em" },
];
/** An inch, in the editor's em at 12 points. */
const EM_PER_INCH = 6;
type Indent = "none" | "first" | "hanging";

const emOf = (value: string | null | undefined) => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) && (value ?? "").trim().endsWith("em") ? n : value === "0" ? 0 : null;
};
const ems = (n: number) => `${+n.toFixed(3)}em`;

function Button({ label, shortcut, active, disabled, onClick, icon, text }: { label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick: () => void; icon?: IconName; text?: string }) {
  const keys = useShortcuts();
  return (
    <button
      type="button"
      className={`format-button${active ? " is-on" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={shortcut && keys ? `${label} (${shortcut})` : label}
      disabled={disabled}
      // Keeps the words selected while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={18} /> : <span className="format-button-text">{text}</span>}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="format-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

function InsertButton({ label, icon, text, active, onClick }: { label: string; icon?: IconName; text?: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`format-insert${active ? " is-on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon ? <Icon name={icon} size={16} /> : <span className="format-insert-mark">{text}</span>}
      <span>{label}</span>
    </button>
  );
}

/** The picture selected: its caption, its description for readers who can't see it, and whether it has a page of its own. */
export function PictureLook({ editor, look }: { editor: Editor; look: { caption: string; alt: string; size: string } }) {
  const publisher = usePublisher();
  const set = (change: Partial<{ caption: string; alt: string; size: "inline" | "full" }>) => editor.commands.setPictureLook(change);
  return (
    <div className="writing-link writing-picture-look">
      <input
        value={look.caption ?? ""}
        placeholder="Caption under the picture"
        aria-label="Caption"
        maxLength={400}
        onChange={(e) => {
          const caption = e.target.value;
          if (!look.caption && caption && !publisher.allowed) return publisher.check("Captions", () => undefined);
          set({ caption });
        }}
      />
      <input value={look.alt ?? ""} placeholder="What it shows, for readers who can't see it" aria-label="Description" maxLength={400} onChange={(e) => set({ alt: e.target.value })} />
      <label className="check-row">
        <input
          type="checkbox"
          checked={look.size === "full"}
          onChange={(e) => {
            const full = e.target.checked;
            if (full) publisher.check("Full-page pictures", () => set({ size: "full" }));
            else set({ size: "inline" });
          }}
        />
        <span>A page of its own</span>
      </label>
    </div>
  );
}

export function FormatPanel({ editor, poem, cites, chapter, book }: { editor: Editor; poem: boolean; cites?: SourcesProps; chapter?: WritingChapter; book: BookLook }) {
  const [canva] = useCanvaStatus();
  const canvaOn = canvaHere && !!canva?.available && !!canva.name;
  const [canvaPicture, setCanvaPicture] = useState(false);
  const [pictureMenu, setPictureMenu] = useState(false);
  const publisher = usePublisher();
  const toast = useToast();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      quote: e.isActive("blockquote"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      link: e.isActive("link"),
      highlight: e.isActive("highlight"),
      sup: e.isActive("superscript"),
      sub: e.isActive("subscript"),
      look: e.getAttributes("textLook") as Partial<TextLook>,
      block: (e.isActive("heading") ? e.getAttributes("heading") : e.getAttributes("paragraph")) as Partial<BlockLook>,
      canIndent: e.can().sinkListItem("listItem"),
      canOutdent: e.can().liftListItem("listItem"),
      footnote: e.isActive("footnote") ? ((e.getAttributes("footnote").text as string) ?? "") : null,
      citation: e.isActive("citation") ? (e.getAttributes("citation") as { source: string; locator: string }) : null,
      picture: e.isActive("picture") ? (e.getAttributes("picture") as { caption: string; alt: string; size: string }) : null,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linking, setLinking] = useState<string | null>(null);
  const [noting, setNoting] = useState<string | null>(null);
  const [citing, setCiting] = useState(false);
  const picking = useRef<HTMLInputElement>(null);
  const run = () => editor.chain().focus();
  const look = (change: Partial<TextLook>) => run().setTextLook(change).run();
  const block = (change: Partial<BlockLook>) => run().setBlockLook(change).run();

  // Choosing a footnote in the text opens its words to change.
  useEffect(() => {
    if (state.footnote !== null) setNoting(state.footnote);
  }, [state.footnote]);

  const addPicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      run().insertPicture(await pictureAddress(file), file.name.replace(/\.[^.]+$/, "")).run();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  const saveNote = () => {
    const text = (noting ?? "").trim();
    if (text) run().setFootnote(text).run();
    else if (state.footnote !== null) run().deleteSelection().run();
    setNoting(null);
  };
  const saveLink = () => {
    const url = (linking ?? "").trim();
    if (!url) run().extendMarkRange("link").unsetLink().run();
    else run().extendMarkRange("link").setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run();
    setLinking(null);
  };

  // Style: what kind of paragraph this is.
  const style = state.h2 ? "heading" : state.h3 ? "subheading" : state.quote ? "quote" : "normal";
  const setStyle = (next: string) => {
    if (state.quote && next !== "quote") run().unsetBlockquote().run();
    if (next === "heading") run().setHeading({ level: 2 }).run();
    else if (next === "subheading") run().setHeading({ level: 3 }).run();
    else if (next === "quote") run().setParagraph().setBlockquote().run();
    else run().setParagraph().run();
  };

  // Font: the one in use is shown, the book's own when the passage sets none.
  // Picking the book's own keeps nothing on the passage, so it follows the book.
  const fonts = book.font ? FONTS : [{ label: "Reader's choice", value: null }, ...FONTS];
  const fontInUse = state.look.fontFamily ?? book.font ?? "";

  // Size, in points: the book's own size is 12.
  const points = Math.round((emOf(state.look.fontSize) ?? 1) * BASE_POINTS * 2) / 2;
  const [typedSize, setTypedSize] = useState<string | null>(null);
  const setPoints = (pt: number) => {
    if (!Number.isFinite(pt)) return;
    const size = Math.min(96, Math.max(6, Math.round(pt * 2) / 2));
    look({ fontSize: size === BASE_POINTS ? null : ems(size / BASE_POINTS) });
  };

  const caps = state.look.textTransform === "uppercase" ? "all" : state.look.fontVariant === "small-caps" ? "small" : "none";

  // Paragraph spacing and indents: the book's own (Layout) while a paragraph sets none.
  const indented = (book.paragraphs ?? "indent") === "indent";
  const lineInUse = state.block.lineHeight ?? book.lineHeight;
  const lines = LINE_SPACINGS.includes(lineInUse) ? LINE_SPACINGS : [...LINE_SPACINGS, lineInUse].sort((a, b) => +a - +b);
  const spacingInUse = state.block.marginBottom ?? (indented ? "0" : "0.9em");
  const spacings = PARAGRAPH_SPACINGS.some((s) => s.value === spacingInUse) ? PARAGRAPH_SPACINGS : [...PARAGRAPH_SPACINGS, { label: spacingInUse, value: spacingInUse }];
  const indentEm = emOf(state.block.textIndent) ?? (indented ? 1.5 : 0);
  const indent: Indent = indentEm < 0 ? "hanging" : indentEm > 0 ? "first" : "none";
  const inches = +(Math.abs(indentEm) / EM_PER_INCH).toFixed(2);
  const [typedInches, setTypedInches] = useState<string | null>(null);
  const setIndent = (kind: Indent, amount: number) => {
    const em = Math.max(0, Math.min(3, amount)) * EM_PER_INCH;
    const change: Partial<BlockLook> =
      kind === "none" ? { textIndent: "0", marginLeft: null } : kind === "first" ? { textIndent: ems(em), marginLeft: null } : { textIndent: ems(-em), marginLeft: ems(em) };
    // The book's own indent keeps nothing on the paragraph.
    const bookOwn = indented ? kind === "first" && Math.abs(em - 1.5) < 0.01 : kind === "none";
    block(bookOwn ? { textIndent: null, marginLeft: null } : change);
  };
  const inList = state.bullets || state.numbers;
  const leftEm = emOf(state.block.marginLeft) ?? 0;
  const moveIn = () => (inList ? run().sinkListItem("listItem").run() : block({ marginLeft: ems(leftEm + EM_PER_INCH / 2) }));
  const moveOut = () => (inList ? run().liftListItem("listItem").run() : block({ marginLeft: leftEm - EM_PER_INCH / 2 > 0 ? ems(leftEm - EM_PER_INCH / 2) : null }));

  const clearFormatting = () =>
    run().unsetAllMarks().clearNodes().setBlockLook({ lineHeight: null, textAlign: null, marginBottom: null, textIndent: null, marginLeft: null }).run();
  const align = state.block.textAlign ?? book.align;

  return (
    <div className="format-panel" role="toolbar" aria-label="Formatting" aria-orientation="vertical">
      <section className="format-section">
        <h3>Text</h3>
        {!poem && (
          <Row label="Style">
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="normal">Normal text</option>
              <option value="heading">Heading</option>
              <option value="subheading">Subheading</option>
              <option value="quote">Quote</option>
            </select>
          </Row>
        )}
        <Row label="Font">
          <select
            value={fontInUse}
            onChange={(e) => {
              const value = e.target.value || null;
              look({ fontFamily: value === book.font ? null : value });
            }}
          >
            {fonts.map((f) => (
              <option key={f.label} value={f.value ?? ""}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>
        <div className="format-row">
          <span>Size</span>
          <div className="format-stepper">
            <button type="button" aria-label="Smaller" onMouseDown={(e) => e.preventDefault()} onClick={() => setPoints(points - 1)}>
              <Icon name="minus" size={16} />
            </button>
            <input
              aria-label="Text size in points"
              inputMode="decimal"
              value={typedSize ?? String(points)}
              onChange={(e) => setTypedSize(e.target.value)}
              onBlur={() => {
                if (typedSize !== null) setPoints(parseFloat(typedSize));
                setTypedSize(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (typedSize !== null) setPoints(parseFloat(typedSize));
                  setTypedSize(null);
                }
              }}
            />
            <button type="button" aria-label="Larger" onMouseDown={(e) => e.preventDefault()} onClick={() => setPoints(points + 1)}>
              <Icon name="plus" size={16} />
            </button>
          </div>
        </div>
        <div className="format-buttons is-seven">
          <Button label="Bold" shortcut="Ctrl+B" text="B" active={state.bold} onClick={() => run().toggleBold().run()} />
          <Button label="Italic" shortcut="Ctrl+I" text="I" active={state.italic} onClick={() => run().toggleItalic().run()} />
          <Button label="Underline" shortcut="Ctrl+U" text="U" active={state.underline} onClick={() => run().toggleUnderline().run()} />
          <Button label="Strikethrough" text="S" active={state.strike} onClick={() => run().toggleStrike().run()} />
          <Button label="Superscript" text="x²" active={state.sup} onClick={() => run().toggleMark("superscript").run()} />
          <Button label="Subscript" text="x₂" active={state.sub} onClick={() => run().toggleMark("subscript").run()} />
          <Button label="Highlight" icon="highlight" active={state.highlight} onClick={() => run().toggleMark("highlight").run()} />
        </div>
        <Row label="Capitals">
          <select
            value={caps}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "title") run().titleCase().run();
              else look(v === "all" ? { textTransform: "uppercase", fontVariant: null } : v === "small" ? { textTransform: null, fontVariant: "small-caps" } : { textTransform: null, fontVariant: null });
            }}
          >
            <option value="none">As written</option>
            <option value="all">ALL CAPS</option>
            <option value="small">Small Caps</option>
            <option value="title">Change to Title Case</option>
          </select>
        </Row>
        <Row label="Letter Spacing">
          <select value={state.look.letterSpacing ?? ""} onChange={(e) => look({ letterSpacing: e.target.value || null })}>
            {LETTERS.map((l) => (
              <option key={l.label} value={l.value ?? ""}>
                {l.label}
              </option>
            ))}
          </select>
        </Row>
      </section>

      <section className="format-section">
        <h3>Paragraph</h3>
        <div className="format-buttons is-four" role="radiogroup" aria-label="Alignment">
          {(
            [
              ["left", "Align left", "alignLeft"],
              ["center", "Centre", "alignCenter"],
              ["right", "Align right", "alignRight"],
              ["justify", "Justify", "alignJustify"],
            ] as const
          ).map(([value, label, icon]) => (
            <Button key={value} label={label} icon={icon} active={align === value} onClick={() => block({ textAlign: value === book.align ? null : value })} />
          ))}
        </div>
        <div className="format-buttons is-five">
          {!poem && <Button label="Bulleted list" icon="listBullet" active={state.bullets} onClick={() => run().toggleBulletList().run()} />}
          {!poem && <Button label="Numbered list" icon="listNumber" active={state.numbers} onClick={() => run().toggleOrderedList().run()} />}
          {!poem && <Button label="Quote" icon="quote" active={state.quote} onClick={() => run().toggleBlockquote().run()} />}
          <Button label="Move out" shortcut={inList ? "Shift+Tab" : undefined} icon="indentLess" disabled={inList ? !state.canOutdent : leftEm <= 0} onClick={moveOut} />
          <Button label="Move in" shortcut={inList ? "Tab" : undefined} icon="indentMore" disabled={inList && !state.canIndent} onClick={moveIn} />
        </div>
        <Row label="Line Spacing">
          <select value={lineInUse} onChange={(e) => block({ lineHeight: e.target.value === book.lineHeight ? null : e.target.value })}>
            {lines.map((l) => (
              <option key={l} value={l}>
                {(+l).toFixed(l.length > 3 ? 2 : 1)}
              </option>
            ))}
          </select>
        </Row>
        {!poem && (
          <>
            <Row label="Paragraph Spacing">
              <select value={spacingInUse} onChange={(e) => block({ marginBottom: e.target.value === (indented ? "0" : "0.9em") ? null : e.target.value })}>
                {spacings.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Row>
            <div className="format-row">
              <span>Indentation</span>
              <div className="format-indent">
                <select aria-label="Indentation" value={indent} onChange={(e) => setIndent(e.target.value as Indent, inches || 0.5)}>
                  <option value="none">None</option>
                  <option value="first">First Line</option>
                  <option value="hanging">Hanging</option>
                </select>
                <label className="format-inches">
                  <input
                    aria-label="Indent in inches"
                    type="number"
                    min={0}
                    max={3}
                    step={0.05}
                    disabled={indent === "none"}
                    value={typedInches ?? String(inches)}
                    onChange={(e) => {
                      setTypedInches(e.target.value);
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n) && n > 0) setIndent(indent, n);
                    }}
                    onBlur={() => setTypedInches(null)}
                  />
                  <span>in</span>
                </label>
              </div>
            </div>
          </>
        )}
        <p className="format-note muted">For the paragraphs you've chosen. The whole book's paragraphs are set in Layout.</p>
      </section>

      <section className="format-section">
        <h3>Insert</h3>
        <div className="format-inserts">
          <InsertButton label={state.link ? "Change Link" : "Link"} icon="link" active={state.link || linking !== null} onClick={() => setLinking(linking === null ? ((editor.getAttributes("link").href as string | undefined) ?? "") : null)} />
          <InsertButton label="Footnote" text="¹" active={state.footnote !== null || noting !== null} onClick={() => setNoting(noting === null ? (state.footnote ?? "") : null)} />
          {cites && <InsertButton label="Citation" icon="quote" active={!!state.citation || citing} onClick={() => setCiting(true)} />}
          <InsertButton label="Image" icon="image" active={pictureMenu} onClick={() => (canvaOn ? setPictureMenu((o) => !o) : picking.current?.click())} />
          <InsertButton label="Scene Break" icon="sceneBreak" onClick={() => run().setHorizontalRule().run()} />
          <InsertButton label="Page Break" icon="pageBreak" onClick={() => run().setPageBreak().run()} />
        </div>
        {pictureMenu && (
          <div className="format-choices">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => (setPictureMenu(false), picking.current?.click())}>
              <Icon name="image" size={15} /> From a file…
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => (setPictureMenu(false), publisher.check("Canva", () => setCanvaPicture(true)))}>
              <Icon name="palette" size={15} /> Design one in Canva…
            </button>
          </div>
        )}
        {noting !== null && (
          <form
            className="writing-link writing-note"
            onSubmit={(e) => {
              e.preventDefault();
              saveNote();
            }}
          >
            <input autoFocus value={noting} placeholder="The footnote's words" aria-label="Footnote words" maxLength={2000} onChange={(e) => setNoting(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNoting(null)} />
            <button type="submit" className="btn btn-primary btn-small">
              {noting.trim() ? (state.footnote !== null ? "Change" : "Add footnote") : state.footnote !== null ? "Remove footnote" : "Cancel"}
            </button>
          </form>
        )}
        {linking !== null && (
          <form
            className="writing-link"
            onSubmit={(e) => {
              e.preventDefault();
              saveLink();
            }}
          >
            <input autoFocus value={linking} placeholder="https://…" aria-label="Link address" onChange={(e) => setLinking(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setLinking(null)} />
            <button type="submit" className="btn btn-primary btn-small">
              {linking.trim() ? "Link" : "Remove link"}
            </button>
          </form>
        )}
      </section>

      {state.picture && (
        <section className="format-section">
          <h3>Picture</h3>
          <PictureLook editor={editor} look={state.picture} />
        </section>
      )}

      <div className="format-foot">
        <Button label="Undo" shortcut="Ctrl+Z" icon="undo" disabled={!state.canUndo} onClick={() => run().undo().run()} />
        <Button label="Redo" shortcut="Ctrl+Y" icon="redo" disabled={!state.canRedo} onClick={() => run().redo().run()} />
        <button type="button" className="format-clear" onMouseDown={(e) => e.preventDefault()} onClick={clearFormatting}>
          <Icon name="eraser" size={16} /> Clear Formatting
        </button>
      </div>

      {canvaPicture && chapter && <CanvaPictureDialog projectId={chapter.projectId} chapterId={chapter.id} onPicture={addPicture} onClose={() => setCanvaPicture(false)} />}
      {cites && citing && (
        <SourcesDialog
          sources={cites.sources}
          style={cites.citationStyle}
          onChange={cites.onSources}
          current={state.citation}
          onCite={(source, locator) => {
            run().setCitation(source.id, locator, citationLabel(source, locator)).run();
            setCiting(false);
          }}
          onClose={() => setCiting(false)}
        />
      )}
      <input
        ref={picking}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          void addPicture(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
