// A text box for the book's description with a few formatting buttons
// (bold, italic, heading, bullets, numbered list, quote) and a preview.
// The words are kept as simple Markdown, so they travel anywhere as text.

import { useRef, useState } from "react";
import { blurbHtml } from "./blurb";

interface Props {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}

export function FormattedText({ value, onChange, rows = 5, placeholder }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  // Puts the change in and keeps the selection on the words it touched.
  const apply = (next: string, start: number, end: number) => {
    onChange(next);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  const wrap = (mark: string) => {
    const el = box.current;
    if (!el) return;
    let { selectionStart: a, selectionEnd: b } = el;
    // Spaces picked at either end stay outside the marks, or the formatting wouldn't take.
    while (a < b && /\s/.test(value[a])) a++;
    while (b > a && /\s/.test(value[b - 1])) b--;
    const picked = value.slice(a, b);
    // Already wrapped: take the marks off.
    if (value.slice(a - mark.length, a) === mark && value.slice(b, b + mark.length) === mark) {
      apply(value.slice(0, a - mark.length) + picked + value.slice(b + mark.length), a - mark.length, b - mark.length);
      return;
    }
    const word = picked || "text";
    apply(value.slice(0, a) + mark + word + mark + value.slice(b), a + mark.length, a + mark.length + word.length);
  };

  // Starts each picked line with `prefix` (or takes it off when they all have it).
  const lines = (prefix: (i: number) => string, match: RegExp) => {
    const el = box.current;
    if (!el) return;
    const a = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const endAt = value.indexOf("\n", el.selectionEnd);
    const b = endAt === -1 ? value.length : endAt;
    const picked = value.slice(a, b).split("\n");
    const all = picked.every((l) => match.test(l));
    const changed = picked.map((l, i) => (all ? l.replace(match, "") : prefix(i) + l.replace(/^\s*(?:[-*+•]|\d+[.)]|#{1,6}|>)\s+/, ""))).join("\n");
    apply(value.slice(0, a) + changed + value.slice(b), a, a + changed.length);
  };

  return (
    <div className="formatted-text">
      <div className="formatted-text-bar" role="toolbar" aria-label="Formatting">
        <button type="button" title="Bold" aria-label="Bold" disabled={preview} onClick={() => wrap("**")}>
          <b>B</b>
        </button>
        <button type="button" title="Italic" aria-label="Italic" disabled={preview} onClick={() => wrap("*")}>
          <i>I</i>
        </button>
        <button type="button" title="Heading" aria-label="Heading" disabled={preview} onClick={() => lines(() => "## ", /^\s*#{1,6}\s+/)}>
          H
        </button>
        <button type="button" title="Bullets" aria-label="Bullets" disabled={preview} onClick={() => lines(() => "- ", /^\s*[-*+•]\s+/)}>
          •
        </button>
        <button type="button" title="Numbered list" aria-label="Numbered list" disabled={preview} onClick={() => lines((i) => `${i + 1}. `, /^\s*\d+[.)]\s+/)}>
          1.
        </button>
        <button type="button" title="Quote" aria-label="Quote" disabled={preview} onClick={() => lines(() => "> ", /^\s*>\s?/)}>
          ❝
        </button>
        <span className="formatted-text-gap" />
        <button type="button" className={preview ? "on" : ""} aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        // blurbHtml escapes everything the person typed; only its own tags come through.
        <div className="formatted-text-preview" dangerouslySetInnerHTML={{ __html: blurbHtml(value) || "<p class='muted'>Nothing written yet.</p>" }} />
      ) : (
        <textarea
          ref={box}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === "b") {
              e.preventDefault();
              wrap("**");
            } else if (mod && e.key.toLowerCase() === "i") {
              e.preventDefault();
              wrap("*");
            }
          }}
        />
      )}
      <span className="formatted-text-hint">**bold**, *italic*, - bullets and 1. numbers work too.</span>
    </div>
  );
}
