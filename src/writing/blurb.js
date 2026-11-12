// The book's description (the words on the back) is written in simple Markdown:
// **bold**, *italic*, # headings, - bullets, 1. numbered lists and > quotes.
// The same words show on the paperback's back cover, in the EPUB and in store copy.
import { markdownToHtml } from "./importDoc";
const LIST = /^\s*([-*+•]|\d+[.)])\s+/;
/** Splits inline **bold** and *italic* into runs; stray markers stay as written. */
export function inlineRuns(text) {
    const runs = [];
    let bold = false;
    let italic = false;
    let buf = "";
    const push = () => {
        if (buf)
            runs.push({ text: buf, bold, italic });
        buf = "";
    };
    // Only treat a marker as formatting when it has a partner later on.
    const closes = (from, marker) => text.indexOf(marker, from) > from;
    for (let i = 0; i < text.length; i++) {
        const two = text.slice(i, i + 2);
        if ((two === "**" || two === "__") && (bold || (closes(i + 2, two) && /\S/.test(text[i + 2] ?? "")))) {
            push();
            bold = !bold;
            i++;
            continue;
        }
        const c = text[i];
        if ((c === "*" || c === "_") && (italic || (closes(i + 1, c) && /\S/.test(text[i + 1] ?? "")))) {
            // An underscore inside a word (snake_case) isn't formatting.
            if (c === "_" && !italic && /\w/.test(text[i - 1] ?? "")) {
                buf += c;
                continue;
            }
            push();
            italic = !italic;
            continue;
        }
        if (c === "\\" && /[*_\\]/.test(text[i + 1] ?? "")) {
            buf += text[++i];
            continue;
        }
        buf += c;
    }
    push();
    return runs;
}
/** The description as blocks ready to draw. Lines written together stay one paragraph unless they're list items. */
export function parseBlurb(md) {
    const out = [];
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    let para = [];
    let quote = false;
    const flush = () => {
        if (para.length)
            out.push({ kind: quote ? "quote" : "p", number: null, runs: inlineRuns(para.join(" ")) });
        para = [];
        quote = false;
    };
    let count = 0;
    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) {
            flush();
            count = 0;
            continue;
        }
        const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
        if (heading) {
            flush();
            out.push({ kind: "h", number: null, runs: inlineRuns(heading[1].replace(/\s#+$/, "")) });
            continue;
        }
        const item = LIST.exec(line);
        if (item) {
            flush();
            const numbered = /\d/.test(item[1]);
            count = numbered ? (count ? count + 1 : parseInt(item[1], 10)) : 0;
            out.push({ kind: "li", number: numbered ? count : null, runs: inlineRuns(line.slice(item[0].length)) });
            continue;
        }
        const q = /^\s*>\s?(.*)$/.exec(line);
        if (q) {
            if (!quote)
                flush();
            quote = true;
            para.push(q[1]);
            continue;
        }
        // A line under a list item carries on that item.
        const last = out[out.length - 1];
        if (!para.length && last?.kind === "li" && /^\s{2,}/.test(raw)) {
            last.runs.push(...inlineRuns(" " + line.trim()));
            continue;
        }
        if (quote)
            flush();
        para.push(line.trim());
    }
    flush();
    return out;
}
/** True when the description uses any formatting at all. */
export function hasFormatting(md) {
    return parseBlurb(md).some((b) => b.kind !== "p" || b.runs.some((r) => r.bold || r.italic));
}
/** The description without its Markdown marks, for counting characters and for places that take plain text. */
export function blurbPlain(md) {
    return parseBlurb(md)
        .map((b) => (b.kind === "li" ? (b.number != null ? `${b.number}. ` : "• ") : "") + b.runs.map((r) => r.text).join(""))
        .join("\n")
        .trim();
}
/** The description as HTML (escaped, so safe to show), for the EPUB and stores that take HTML. */
export function blurbHtml(md) {
    // A list straight under a paragraph (no blank line) is still a list, and a paragraph after a list is its own.
    const out = [];
    let prev = "blank";
    for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
        const line = raw.replace(/^(\s*)•(\s)/, "$1-$2");
        const kind = !line.trim() ? "blank" : LIST.test(line) ? "list" : "text";
        if (kind !== "blank" && prev !== "blank" && kind !== prev && !(prev === "list" && /^\s{2,}/.test(line)))
            out.push("");
        out.push(line);
        prev = kind === "text" && prev === "list" && /^\s{2,}/.test(line) ? "list" : kind;
    }
    return markdownToHtml(out.join("\n"));
}
/** Draws the description, wrapped to `width`, starting with its first line's baseline below `top`. Returns where it ended. */
export function drawBlurb(ctx, md, x, top, width, size, family) {
    const font = (r, scale = 1) => `${r.italic ? "italic " : ""}${r.bold ? 600 : 400} ${Math.round(size * scale)}px ${family}`;
    let y = top;
    const blocks = parseBlurb(md);
    blocks.forEach((block, bi) => {
        const scale = block.kind === "h" ? 1.25 : 1;
        const lead = size * scale * 1.45;
        const indent = block.kind === "li" || block.kind === "quote" ? size * 1.4 : 0;
        // A little room between paragraphs; list items sit close together.
        if (bi > 0)
            y += block.kind === "li" && blocks[bi - 1].kind === "li" ? 0 : size * 0.5;
        const runs = block.kind === "h" ? block.runs.map((r) => ({ ...r, bold: true })) : block.runs;
        // Words with their own style, so a line can mix bold and plain.
        // Words with their own style, so a line can mix bold and plain. A word has a space before it when the text did.
        const words = [];
        let gap = false;
        for (const run of runs) {
            for (const p of run.text.split(/(\s+)/)) {
                if (!p)
                    continue;
                if (/^\s+$/.test(p))
                    gap = true;
                else {
                    words.push({ text: p, run, space: gap });
                    gap = false;
                }
            }
        }
        const lines = [[]];
        let lineW = 0;
        const room = width - indent;
        for (const w of words) {
            ctx.font = font(w.run, scale);
            const wordW = ctx.measureText(w.text).width;
            const spaceW = lines[lines.length - 1].length && w.space ? ctx.measureText(" ").width : 0;
            if (lineW + spaceW + wordW > room && lines[lines.length - 1].length) {
                lines.push([]);
                lineW = 0;
                lines[lines.length - 1].push({ ...w, space: false });
                lineW = wordW;
            }
            else {
                lines[lines.length - 1].push(w);
                lineW += spaceW + wordW;
            }
        }
        lines.forEach((line, li) => {
            y += lead;
            if (li === 0 && block.kind === "li") {
                ctx.font = font({ bold: false, italic: false }, scale);
                const mark = block.number != null ? `${block.number}.` : "•";
                ctx.fillText(mark, x + indent - size * 0.5 - ctx.measureText(mark).width, y);
            }
            let lx = x + indent;
            for (const w of line) {
                ctx.font = font(w.run, scale);
                if (w.space && lx > x + indent)
                    lx += ctx.measureText(" ").width;
                ctx.fillText(w.text, lx, y);
                lx += ctx.measureText(w.text).width;
            }
        });
        if (block.kind === "quote" && lines.length) {
            const save = ctx.fillStyle;
            ctx.globalAlpha = 0.5;
            ctx.fillRect(x + size * 0.3, y - lines.length * lead + size * 0.3, Math.max(1, size * 0.12), lines.length * lead);
            ctx.globalAlpha = 1;
            ctx.fillStyle = save;
        }
    });
    return y;
}
