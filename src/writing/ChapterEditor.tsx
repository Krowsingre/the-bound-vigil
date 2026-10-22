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
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linking, setLinking] = useState<string | null>(null);
  const run = () => editor.chain().focus();
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
      <span className="writing-tool-gap" />
      <Tool label="Heading" text="H" active={state.h2} onClick={() => run().toggleHeading({ level: 2 }).run()} />
      <Tool label="Smaller heading" text="h" active={state.h3} onClick={() => run().toggleHeading({ level: 3 }).run()} />
      <Tool label="Quote" icon="quote" active={state.quote} onClick={() => run().toggleBlockquote().run()} />
      <Tool label="List" icon="listBullet" active={state.bullets} onClick={() => run().toggleBulletList().run()} />
      <Tool label="Numbered list" icon="listNumber" active={state.numbers} onClick={() => run().toggleOrderedList().run()} />
      <Tool label="Scene break" text="⁂" onClick={() => run().setHorizontalRule().run()} />
      <Tool
        label={state.link ? "Change link" : "Link"}
        icon="link"
        active={state.link || linking !== null}
        onClick={() => setLinking(linking === null ? ((editor.getAttributes("link").href as string | undefined) ?? "") : null)}
      />
      <span className="writing-tool-gap" />
      <Tool label="Undo" shortcut="Ctrl+Z" icon="undo" disabled={!state.canUndo} onClick={() => run().undo().run()} />
      <Tool label="Redo" shortcut="Ctrl+Y" icon="redo" disabled={!state.canRedo} onClick={() => run().redo().run()} />
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
}: {
  chapter: WritingChapter;
  onSave: (title: string, body: string) => Promise<void>;
  onSaveState: (state: SaveState, words: number) => void;
  /** Set to a function that saves what's waiting now, and resolves once it's saved. */
  flushRef?: MutableRefObject<(() => Promise<void>) | null>;
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
    ],
    content: chapter.body || "<p></p>",
    editorProps: { attributes: { class: "writing-page", spellcheck: "true", "aria-label": "Chapter text" } },
    onUpdate: ({ editor: e }) => change({ body: e.getHTML() }),
  });

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
