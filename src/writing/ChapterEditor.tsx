// Writing one chapter: a ProseMirror editor (through Tiptap) with the
// formatting an EPUB can carry. Words are saved a moment after typing stops,
// and straight away when the chapter is left.

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { isApp } from "../api";
import type { WritingChapter } from "../api/types";
import { Icon, type IconName } from "../components/Icon";
import { onBeforeQuit } from "../lib/beforeQuit";
import { countWords } from "./records";
import { BlockLookExtension, Footnote, Highlight, PageBreak, Picture, pictureAddress, Subscript, Superscript, TextLookMark, type BlockLook, type TextLook } from "./extensions";
import { useToast } from "../components/Toast";
import { Menu, type MenuEntry } from "../components/Menu";

const SAVE_AFTER_MS = 800;

export type SaveState = "saved" | "saving" | "unsaved" | "failed";

function Tool({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  icon,
  text,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: IconName;
  text?: string;
}) {
  return (
    <button
      type="button"
      className={`writing-tool${active ? " is-on" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      // Keeps the words selected while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={17} /> : <span className="writing-tool-text">{text}</span>}
    </button>
  );
}

/** Fonts a passage can be set in: ones TBV can put inside the book, and the reader's own kinds. */
const FONTS: { label: string; value: string | null }[] = [
  { label: "The book's font", value: null },
  { label: "Lora", value: "Lora, serif" },
  { label: "Echolume", value: "Echolume, serif" },
  { label: "Serif", value: "serif" },
  { label: "Sans serif", value: "sans-serif" },
  { label: "Typewriter", value: "monospace" },
];
const SIZES: { label: string; value: string | null }[] = [
  { label: "Small", value: "0.85em" },
  { label: "Normal", value: null },
  { label: "Large", value: "1.2em" },
  { label: "Larger", value: "1.5em" },
  { label: "Largest", value: "2em" },
];
const LETTERS: { label: string; value: string | null }[] = [
  { label: "Tight", value: "-0.02em" },
  { label: "Normal", value: null },
  { label: "Wide", value: "0.05em" },
  { label: "Wider", value: "0.12em" },
  { label: "Widest", value: "0.25em" },
];
const WORDS: { label: string; value: string | null }[] = [
  { label: "Normal", value: null },
  { label: "Wide", value: "0.2em" },
  { label: "Wider", value: "0.5em" },
];
const LINES: { label: string; value: string | null }[] = [
  { label: "The book's own", value: null },
  { label: "Single", value: "1.2" },
  { label: "1.5 lines", value: "1.5" },
  { label: "Double", value: "2" },
];
const ALIGNS: { label: string; value: BlockLook["textAlign"] }[] = [
  { label: "The book's own", value: null },
  { label: "Left", value: "left" },
  { label: "Centre", value: "center" },
  { label: "Right", value: "right" },
  { label: "Justified", value: "justify" },
];

/** A toolbar button that opens a short list of choices. */
function ToolMenu({ label, text, icon, active, items }: { label: string; text?: string; icon?: IconName; active?: boolean; items: MenuEntry[] }) {
  return (
    <Menu
      label={label}
      align="start"
      className={`writing-tool writing-tool-menu${active ? " is-on" : ""}`}
      trigger={
        <>
          {icon ? <Icon name={icon} size={17} /> : <span className="writing-tool-text">{text}</span>}
          <Icon name="chevronDown" size={11} />
        </>
      }
      items={items}
    />
  );
}

function Toolbar({ editor }: { editor: Editor }) {
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
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linking, setLinking] = useState<string | null>(null);
  const [noting, setNoting] = useState<string | null>(null);
  const picking = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const run = () => editor.chain().focus();
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
  // Choosing a footnote in the text opens its words to change.
  useEffect(() => {
    if (state.footnote !== null) setNoting(state.footnote);
  }, [state.footnote]);
  const look = (change: Partial<TextLook>) => run().setTextLook(change).run();
  const choose = <T,>(list: { label: string; value: T }[], current: T | undefined, pick: (value: T) => void): MenuEntry[] =>
    list.map((o) => ({ label: o.label, checked: (current ?? null) === o.value, onSelect: () => pick(o.value) }));
  const caps = state.look.textTransform === "uppercase" ? "all" : state.look.fontVariant === "small-caps" ? "small" : null;
  const saveLink = () => {
    const url = (linking ?? "").trim();
    if (!url) run().extendMarkRange("link").unsetLink().run();
    else run().extendMarkRange("link").setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run();
    setLinking(null);
  };
  return (
    <div className="writing-toolbar" role="toolbar" aria-label="Formatting">
      <Tool label="Bold" shortcut="Ctrl+B" text="B" active={state.bold} onClick={() => run().toggleBold().run()} />
      <Tool label="Italic" shortcut="Ctrl+I" text="I" active={state.italic} onClick={() => run().toggleItalic().run()} />
      <Tool label="Underline" shortcut="Ctrl+U" text="U" active={state.underline} onClick={() => run().toggleUnderline().run()} />
      <Tool label="Strikethrough" text="S" active={state.strike} onClick={() => run().toggleStrike().run()} />
      <Tool label="Highlight" icon="highlight" active={state.highlight} onClick={() => run().toggleMark("highlight").run()} />
      <Tool label="Superscript" text="x²" active={state.sup} onClick={() => run().toggleMark("superscript").run()} />
      <Tool label="Subscript" text="x₂" active={state.sub} onClick={() => run().toggleMark("subscript").run()} />
      <ToolMenu
        label="Capitals"
        text="Aa"
        active={caps !== null}
        items={[
          { label: "As written", checked: caps === null, onSelect: () => look({ textTransform: null, fontVariant: null }) },
          { label: "ALL CAPS", checked: caps === "all", onSelect: () => look({ textTransform: "uppercase", fontVariant: null }) },
          { label: "Small Caps", checked: caps === "small", onSelect: () => look({ textTransform: null, fontVariant: "small-caps" }) },
          "divider",
          { label: "Change to Title Case", hint: "Retypes the letters", onSelect: () => run().titleCase().run() },
        ]}
      />
      <span className="writing-tool-gap" />
      <ToolMenu
        label="Font"
        icon="readingA"
        active={!!state.look.fontFamily}
        items={[
          ...choose(FONTS, state.look.fontFamily, (fontFamily) => look({ fontFamily })),
          "divider",
          { heading: <span className="writing-tool-note">Many e-readers let readers choose their own font, which can replace this.</span> },
        ]}
      />
      <ToolMenu label="Text size" icon="textSize" active={!!state.look.fontSize} items={choose(SIZES, state.look.fontSize, (fontSize) => look({ fontSize }))} />
      <ToolMenu
        label="Spacing"
        icon="sliders"
        active={!!(state.look.letterSpacing || state.look.wordSpacing || state.block.lineHeight)}
        items={[
          { heading: "Between letters" },
          ...choose(LETTERS, state.look.letterSpacing, (letterSpacing) => look({ letterSpacing })),
          { heading: "Between words" },
          ...choose(WORDS, state.look.wordSpacing, (wordSpacing) => look({ wordSpacing })),
          { heading: "Between lines" },
          ...choose(LINES, state.block.lineHeight, (lineHeight) => run().setBlockLook({ lineHeight }).run()),
        ]}
      />
      <ToolMenu
        label="Alignment"
        text={{ left: "⇤", center: "↔", right: "⇥", justify: "☰" }[state.block.textAlign ?? "left"] ?? "⇤"}
        active={!!state.block.textAlign}
        items={choose(ALIGNS, state.block.textAlign, (textAlign) => run().setBlockLook({ textAlign }).run())}
      />
      <span className="writing-tool-gap" />
      <Tool label="Heading" text="H" active={state.h2} onClick={() => run().toggleHeading({ level: 2 }).run()} />
      <Tool label="Smaller heading" text="h" active={state.h3} onClick={() => run().toggleHeading({ level: 3 }).run()} />
      <Tool label="Quote" icon="quote" active={state.quote} onClick={() => run().toggleBlockquote().run()} />
      <Tool label="List" icon="listBullet" active={state.bullets} onClick={() => run().toggleBulletList().run()} />
      <Tool label="Numbered list" icon="listNumber" active={state.numbers} onClick={() => run().toggleOrderedList().run()} />
      {(state.bullets || state.numbers) && (
        <>
          <Tool label="Move out" shortcut="Shift+Tab" text="⇠" disabled={!state.canOutdent} onClick={() => run().liftListItem("listItem").run()} />
          <Tool label="Move in" shortcut="Tab" text="⇢" disabled={!state.canIndent} onClick={() => run().sinkListItem("listItem").run()} />
        </>
      )}
      <Tool label="Scene break" text="⁂" onClick={() => run().setHorizontalRule().run()} />
      <Tool label="Page break" icon="pageBreak" onClick={() => run().setPageBreak().run()} />
      <Tool label="Picture" icon="image" onClick={() => picking.current?.click()} />
      <Tool
        label={state.footnote !== null ? "Change footnote" : "Footnote"}
        text="¹"
        active={state.footnote !== null || noting !== null}
        onClick={() => setNoting(noting === null ? (state.footnote ?? "") : null)}
      />
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
      <Tool
        label={state.link ? "Change link" : "Link"}
        icon="link"
        active={state.link || linking !== null}
        onClick={() => setLinking(linking === null ? ((editor.getAttributes("link").href as string | undefined) ?? "") : null)}
      />
      <span className="writing-tool-gap" />
      <Tool label="Undo" shortcut="Ctrl+Z" icon="undo" disabled={!state.canUndo} onClick={() => run().undo().run()} />
      <Tool label="Redo" shortcut="Ctrl+Y" icon="redo" disabled={!state.canRedo} onClick={() => run().redo().run()} />
      {noting !== null && (
        <form
          className="writing-link writing-note"
          onSubmit={(e) => {
            e.preventDefault();
            saveNote();
          }}
        >
          <input
            autoFocus
            value={noting}
            placeholder="The footnote's words"
            aria-label="Footnote words"
            maxLength={2000}
            onChange={(e) => setNoting(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setNoting(null)}
          />
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
          <input
            autoFocus
            value={linking}
            placeholder="https://…"
            aria-label="Link address"
            onChange={(e) => setLinking(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinking(null)}
          />
          <button type="submit" className="btn btn-primary btn-small">
            {linking.trim() ? "Link" : "Remove link"}
          </button>
        </form>
      )}
    </div>
  );
}

export function ChapterEditor({
  chapter,
  onSave,
  onSaveState,
  flushRef,
  insertRef,
}: {
  chapter: WritingChapter;
  onSave: (title: string, body: string) => Promise<void>;
  onSaveState: (state: SaveState, words: number) => void;
  /** Set to a function that saves what's waiting now, and resolves once it's saved. */
  flushRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Set to a function that puts HTML in where the cursor is (a quote from your notes). */
  insertRef?: MutableRefObject<((html: string) => void) | null>;
}) {
  const [title, setTitle] = useState(chapter.title);
  const pending = useRef<{ title: string; body: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: chapter.title, body: chapter.body });
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const stateRef = useRef(onSaveState);
  stateRef.current = onSaveState;

  const inFlight = useRef<Promise<void>>(Promise.resolve());

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    // Nothing new waiting: a save already on its way is still waited for.
    if (!next) return inFlight.current;
    pending.current = null;
    const run = (async () => {
      stateRef.current("saving", countWords(next.body));
      try {
        await saveRef.current(next.title, next.body);
        stateRef.current(pending.current ? "unsaved" : "saved", countWords(next.body));
      } catch {
        // Kept to try again with the next change, or when the chapter is left.
        pending.current = pending.current ?? next;
        stateRef.current("failed", countWords(next.body));
      }
    })();
    inFlight.current = run;
    return run;
  };
  if (flushRef) flushRef.current = flush;

  const change = (part: Partial<{ title: string; body: string }>) => {
    latest.current = { ...latest.current, ...part };
    pending.current = latest.current;
    stateRef.current("unsaved", countWords(latest.current.body));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, protocols: ["mailto"] },
      }),
      Picture,
      Footnote,
      PageBreak,
      Highlight,
      Superscript,
      Subscript,
      TextLookMark,
      BlockLookExtension,
    ],
    content: chapter.body || "<p></p>",
    editorProps: { attributes: { class: "writing-page", spellcheck: "true", "aria-label": "Chapter text" } },
    onUpdate: ({ editor: e }) => change({ body: e.getHTML() }),
  });
  if (insertRef) insertRef.current = editor ? (html) => void editor.chain().focus().insertContent(html).run() : null;

  // Leaving the chapter saves what's waiting. Quitting the app waits for it;
  // a browser tab asks before closing while words are unsaved.
  useEffect(() => {
    stateRef.current("saved", countWords(chapter.body));
    const unregister = onBeforeQuit(flush);
    const beforeClose = (e: BeforeUnloadEvent) => {
      if (!pending.current || isApp) return;
      void flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeClose);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", beforeClose);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="writing-editor">
      {editor && <Toolbar editor={editor} />}
      <div className="writing-sheet" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <input
          className="writing-chapter-title"
          value={title}
          placeholder="Chapter title"
          aria-label="Chapter title"
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            change({ title: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor?.commands.focus("start");
            }
          }}
        />
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
