// Turning a manuscript into a Scribe book: what kind of file it is (before
// anything is made), then the book's sections sorted into Front, Body and
// Back with what each one is, and a report of anything to check. The words
// themselves are never rewritten, reordered or added to: when it's unclear
// what a section is, it stays where the file had it and is flagged.
import { strFromU8, unzipSync } from "fflate";
import { IMPORT_ACCEPT, pageMark, readDocumentBytes, splitChapters } from "./importDoc";
import { ADD_MENUS, KINDS } from "./pages";
import { isTbv } from "./tbvFile";
export const MANUSCRIPT_ACCEPT = `${IMPORT_ACCEPT},.zip,.kcb,.kpf,.pdf,.tbv`;
const LABELS = {
    docx: "Word document",
    odt: "OpenDocument text",
    rtf: "Rich Text",
    txt: "Plain text",
    md: "Markdown",
    markdown: "Markdown",
    html: "Web page",
    htm: "Web page",
    xhtml: "Web page",
    epub: "EPUB",
};
const extensionOf = (name) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
/** Looks at a file without making anything: its kind, and whether Scribe can rebuild a book from it. */
export function inspect(name, bytes) {
    const ext = extensionOf(name);
    // Saved from Scribe: opened as it was, nothing rebuilt (damage is reported when it's read).
    if (ext === "tbv" || isTbv(bytes))
        return { format: "tbv", label: "Scribe book file", supported: true };
    if (LABELS[ext])
        return { format: ext === "markdown" ? "md" : ext === "htm" ? "html" : ext, label: LABELS[ext], supported: true };
    if (ext === "pdf")
        return { format: "pdf", label: "PDF", supported: true };
    if (ext === "kcb")
        return {
            format: "kindle_create",
            label: "Kindle Create project",
            supported: false,
            reason: "A .kcb file is only the cover sheet of a Kindle Create project; the book is in the folder beside it. Zip the whole project folder and choose the zip.",
        };
    if (ext === "kpf" || ext === "zip") {
        const names = [];
        try {
            unzipSync(bytes, {
                filter: (f) => {
                    names.push(f.name);
                    return false;
                },
            });
        }
        catch {
            return { format: ext, label: ext === "kpf" ? "Kindle package" : "Zip file", supported: false, reason: "That file couldn't be opened." };
        }
        const kindle = names.some((n) => /(^|\/)book\.kcb$/i.test(n) || /(^|\/)book\.kdf$/i.test(n) || /(^|\/)resources\/ManifestFile$/i.test(n));
        if (ext === "kpf" || kindle) {
            // Made from a PDF, its words are in that PDF, which Scribe reads.
            if (kindle && fixedLayout(bytes, names))
                return { format: "kindle_create", label: "Kindle Create project (made from a PDF)", supported: true };
            return {
                format: kindle ? "kindle_create" : "kpf",
                label: kindle ? "Kindle Create project" : "Kindle package",
                supported: false,
                reason: "Rebuilding a book from a Kindle Create project made from a Word file comes in a later update. Until then, import the Word file the project was made from.",
            };
        }
        return { format: "zip", label: "Zip file", supported: false, reason: "Choose the manuscript itself: Word, OpenDocument, RTF, text, Markdown, HTML, EPUB or PDF." };
    }
    return { format: ext || "unknown", label: ext ? `.${ext} file` : "File", supported: false, reason: "Scribe can rebuild a book from Word, OpenDocument, RTF, plain text, Markdown, HTML, EPUB and PDF files, and Kindle Create projects made from a PDF." };
}
/** A Kindle Create project made from a PDF keeps it in resources/res. */
function fixedLayout(bytes, names) {
    try {
        const kcb = names.find((n) => /(^|\/)book\.kcb$/i.test(n));
        if (kcb) {
            const read = unzipSync(bytes, { filter: (f) => f.name === kcb })[kcb];
            if (read && /"book_input_type"\s*:\s*1\b/.test(strFromU8(read)))
                return true;
        }
        const resources = unzipSync(bytes, { filter: (f) => /resources\/res\//.test(f.name) && f.originalSize > 4 });
        return Object.values(resources).some((b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46);
    }
    catch {
        return false;
    }
}
/** Section titles, and what each kind of page is called. Checked in order. */
const TITLES = [
    [/^(table of )?contents$|^(poetry|poem|story|stories|poems) (listing|list|index)$|^list of (poems|stories)$/i, "contents_manual"],
    [/^copyright( page)?$/i, "copyright"],
    [/^dedication$/i, "dedication"],
    [/^epigraph$/i, "epigraph"],
    [/^title page$/i, "title_page"],
    [/^half[- ]title$/i, "half_title"],
    [/^foreword\b/i, "foreword"],
    [/^preface\b/i, "preface"],
    [/^introduction\b/i, "introduction"],
    [/^prologue\b/i, "prologue"],
    [/^epilogue\b/i, "epilogue"],
    [/^interlude\b/i, "interlude"],
    [/^afterword\b/i, "afterword"],
    [/^acknowledg(e)?ments?$/i, "acknowledgments"],
    [/^about the author$/i, "about_author"],
    [/^(also by\b|other books by\b|books by\b)|^other\b.*\b(books|novels|anthologies|titles|works)$/i, "also_by"],
    [/^(end ?notes|notes)$/i, "endnotes"],
    [/^glossary$/i, "glossary"],
    [/^appendi(x|ces)\b/i, "appendix"],
    [/^(bibliography|references|works cited|further reading)$/i, "bibliography"],
    [/^(discussion questions|reading group guide|book club questions)$/i, "discussion"],
    [/^(excerpt|a sneak peek|sneak peek|preview)\b/i, "excerpt"],
];
/** What each page mark's name means: every kind's own name and label, and the words writers use. */
const MARK_NAMES = (() => {
    const names = {};
    for (const kind of Object.keys(KINDS)) {
        names[kind.replace(/_/g, " ")] = kind;
        names[KINDS[kind].label.toLowerCase().replace(/\s*\(.*\)$/, "")] = kind;
    }
    Object.assign(names, {
        contents: "contents",
        toc: "contents",
        "table of contents": "contents",
        "contents by hand": "contents_manual",
        "contents manual": "contents_manual",
        "written contents": "contents_manual",
        title: "title_page",
        "half title page": "half_title",
        "copyright page": "copyright",
        "also by": "also_by",
        "other books": "also_by",
        acknowledgements: "acknowledgments",
        acknowledgement: "acknowledgments",
        acknowledgment: "acknowledgments",
        "about author": "about_author",
        "author bio": "about_author",
        bio: "about_author",
        notes: "endnotes",
        endnotes: "endnotes",
        "end notes": "endnotes",
        appendices: "appendix",
        references: "bibliography",
        "reading group guide": "discussion",
        discussion: "discussion",
        "sneak peek": "excerpt",
        sources: "sources",
        page: "custom",
        custom: "custom",
        part: "part",
        section: "part",
        book: "part",
        "end part": "end part",
        "end section": "end part",
        "end book": "end part",
        "end of part": "end part",
        "end of section": "end part",
    });
    return names;
})();
/** What a page mark's name means, or null when it names nothing Scribe knows. */
export function markKind(name) {
    const key = name.toLowerCase().replace(/[’']/g, "'").replace(/[\s_-]+/g, " ").trim();
    return MARK_NAMES[key] ?? null;
}
/** Every page mark's name, in the order a book has its pages, for the help. */
export const MARK_HELP = [
    ...new Set([...ADD_MENUS.front, ...ADD_MENUS.chapter, ...ADD_MENUS.back].map((k) => k === "contents" ? "contents" : k === "contents_manual" ? "contents by hand" : KINDS[k].label.toLowerCase().replace(/\s*\(.*\)$/, ""))),
    "part",
    "end part",
];
const MADE_ONLY = ["contents", "sources"];
/** A page the writer marked: what it is is never guessed, only where it goes when it could go in more than one place. */
function markedSection(c, reached, inBody) {
    const said = markKind(c.mark ?? "");
    if (said === "part")
        return { kind: "custom", area: "chapter", sure: true, isPart: true };
    if (said === "end part")
        return { kind: "custom", area: reached, sure: true, endsPart: true };
    if (!said)
        return { kind: "custom", area: reached, sure: false, why: `“=== ${c.mark}” isn't a kind of page Scribe knows, so it came in as a custom page. Check what it should be.` };
    const areas = KINDS[said].areas;
    let area = areas.length === 1 ? areas[0] : areas.includes(reached) ? reached : areas[0];
    // A poem goes with the poems: in the body, unless the back matter has begun.
    if (said === "poem")
        area = reached === "back" ? "back" : "chapter";
    if (said === "also_by")
        area = inBody ? "back" : "front";
    if (said === "prologue" || said === "epilogue")
        area = "chapter";
    const made = KINDS[said].made && !MADE_ONLY.includes(said);
    return { kind: said, area, sure: true, ...(made && c.words > 0 ? { byHand: true } : {}) };
}
/** epub:type words, and the kind each means. */
const EPUB_TYPES = [
    [/\btoc\b/, "contents_manual"],
    [/\bcopyright-page\b/, "copyright"],
    [/\bdedication\b/, "dedication"],
    [/\bepigraph\b/, "epigraph"],
    [/\btitlepage\b/, "title_page"],
    [/\bhalftitlepage\b/, "half_title"],
    [/\bforeword\b/, "foreword"],
    [/\bpreface\b/, "preface"],
    [/\bintroduction\b/, "introduction"],
    [/\bprologue\b/, "prologue"],
    [/\bepilogue\b/, "epilogue"],
    [/\bafterword\b/, "afterword"],
    [/\backnowledgments\b/, "acknowledgments"],
    [/\bcontributors\b|\babout-author\b/, "about_author"],
    [/\bendnotes\b|\bfootnotes\b/, "endnotes"],
    [/\bglossary\b/, "glossary"],
    [/\bappendix\b/, "appendix"],
    [/\bbibliography\b/, "bibliography"],
    [/\bfrontmatter\b/, "front"],
    [/\bbodymatter\b/, "body"],
    [/\bbackmatter\b/, "back"],
];
const BODY_KINDS = ["chapter", "prologue", "epilogue", "interlude", "poem", "haiku"];
/** Which area a kind of page goes in, when it can only go in one. */
const areaOf = (kind) => {
    // A prologue or epilogue is part of the story (embre, 31 October 2026).
    if (kind === "prologue" || kind === "epilogue")
        return "chapter";
    const areas = KINDS[kind].areas;
    return areas.length === 1 ? areas[0] : null;
};
const ORDER = { front: 0, chapter: 1, back: 2 };
/** Short lines in most paragraphs, or lines broken inside paragraphs: set out like a poem. */
export function looksLikePoem(body) {
    const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
    const paragraphs = [...doc.body.querySelectorAll("p:not([data-blank])")];
    if (paragraphs.length < 3 && !paragraphs.some((p) => p.querySelector("br")))
        return false;
    const lines = paragraphs.flatMap((p) => p.innerHTML.split(/<br\s*\/?>/i).map((l) => l.replace(/<[^>]+>/g, "").trim()));
    // Three short lines set apart in one verse: a haiku, or a poem as short.
    if (lines.length < 4 && !(lines.length === 3 && paragraphs.length === 1 && paragraphs[0].querySelector("br")))
        return false;
    const short = lines.filter((l) => l.length > 0 && l.length <= 60).length;
    const ends = lines.filter((l) => /[.!?]["'”’]?$/.test(l)).length;
    return short / lines.length >= 0.8 && ends / lines.length < 0.6;
}
/** A poem's lines as Scribe keeps them: a paragraph per stanza, a line break per line. Empty paragraphs part stanzas. */
export function asPoem(body) {
    const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
    const out = [];
    let stanza = [];
    const end = () => {
        if (stanza.length)
            out.push(`<p>${stanza.join("<br>")}</p>`);
        stanza = [];
    };
    for (const node of [...doc.body.childNodes]) {
        if (!(node instanceof HTMLElement)) {
            if (node.textContent?.trim())
                stanza.push(node.textContent);
            continue;
        }
        if (node.tagName === "P" && node.hasAttribute("data-blank"))
            end();
        else if (node.tagName === "P" && /<br\s*\/?>/i.test(node.innerHTML)) {
            // Already a stanza, its lines broken as written.
            end();
            out.push(`<p>${node.innerHTML}</p>`);
        }
        else if (node.tagName === "P")
            stanza.push(node.innerHTML);
        else {
            end();
            out.push(node.outerHTML);
        }
    }
    end();
    return out.join("");
}
/** Empty paragraphs in prose: dropped where the file puts one between every paragraph (spacing), else kept as breaks. */
function settleBlanks(body, spacing) {
    const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
    let breaks = 0;
    const blanks = [...doc.body.querySelectorAll("p[data-blank]")];
    for (const p of blanks) {
        const prev = p.previousElementSibling;
        const first = !prev;
        const last = ![...doc.body.children].slice([...doc.body.children].indexOf(p) + 1).some((el) => !el.hasAttribute("data-blank"));
        if (spacing || first || last || prev?.tagName === "HR" || prev?.hasAttribute("data-blank"))
            p.remove();
        else {
            p.replaceWith(doc.createElement("hr"));
            breaks++;
        }
    }
    return { body: doc.body.innerHTML, breaks };
}
const textWords = (html) => (new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body.textContent ?? "").split(/\s+/).filter((w) => /\w/.test(w)).length;
/** The document without its page-mark lines. */
function withoutMarks(html) {
    return html.replace(/<(p|h[1-6])[^>]*>([^<]*)<\/\1>/gi, (whole, _tag, text) => (pageMark(text) ? "" : whole)).replace(/(^|<br\s*\/?>)\s*={3,}[^<]*(?=<br|<\/p>)/gi, (whole, lead) => (pageMark(whole.slice(lead.length)) ? lead : whole));
}
function restoredKind(hint) {
    if (!hint)
        return;
    const authored = /^scribe:([a-z_]+)/.exec(hint)?.[1];
    if (authored && Object.hasOwn(KINDS, authored)) {
        const area = /\bfrontmatter\b/.test(hint) ? "front" : /\bbackmatter\b/.test(hint) ? "back" : areaOf(authored);
        if (!area || KINDS[authored].areas.includes(area))
            return { kind: authored, area };
    }
    for (const [pattern, kind] of EPUB_TYPES) {
        if (!pattern.test(hint))
            continue;
        if (kind === "front" || kind === "back")
            return { kind: "custom", area: kind };
        if (kind === "body")
            return { kind: "chapter", area: "chapter" };
        return { kind, area: areaOf(kind) };
    }
}
/** The kind a section's title, the file's own label, and its words point to. */
function sortSection(title, body, hint, index, bookTitle) {
    const t = title.replace(/[.:]+$/, "").trim();
    for (const [re, kind] of TITLES)
        if (re.test(t))
            return kind === "title_page"
                ? { kind, area: "front", sure: true, include: false, why: "Scribe makes the title page from the book's details, so this one is left out unless you tick it." }
                : kind === "contents_manual"
                    ? { kind, area: "front", sure: true, include: false, why: "Scribe makes the contents from the book's sections, so this list is left out unless you tick it." }
                    : { kind, area: areaOf(kind), sure: true };
    if (hint) {
        for (const [re, said] of EPUB_TYPES) {
            if (!re.test(hint))
                continue;
            if (said === "front" || said === "back")
                return { kind: "custom", area: said, sure: true, why: "The file marks it as " + (said === "front" ? "front matter." : "back matter.") };
            if (said === "body")
                return { kind: "chapter", area: "chapter", sure: true };
            return { kind: said, area: areaOf(said), sure: true };
        }
    }
    if (/^(chapter|book|canto|letter|act|scene)\b|^(\d{1,3}|[IVXLC]{1,7})\.?$/i.test(t) || /^part\b/i.test(t))
        return { kind: "chapter", area: "chapter", sure: true };
    const words = textWords(body);
    const text = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html").body.textContent ?? "";
    if (index === 0) {
        if (/©|\bcopyright\b|all rights reserved/i.test(text) && words < 400)
            return { kind: "copyright", area: "front", sure: false, byHand: true, why: "Its words look like a copyright page, so they're kept as written." };
        if (words < 80 && (bookTitle && text.toLowerCase().includes(bookTitle.toLowerCase())))
            return { kind: "title_page", area: "front", sure: false, include: false, why: "Looks like a title page. Scribe makes one from the book's details, so it's left out unless you tick it." };
        if (t === "Opening")
            return { kind: "custom", area: "front", sure: false, why: "The words before the first chapter. Check whether they belong in the front matter or the story." };
    }
    if (/©|\ball rights reserved\b/i.test(text) && words < 400)
        return { kind: "copyright", area: "front", sure: false, byHand: true, why: "Its words look like a copyright page." };
    if (/^for\b/i.test(text.trim()) && words < 40)
        return { kind: "dedication", area: "front", sure: false, why: "Short and starting with “For”, like a dedication." };
    if (looksLikePoem(body)) {
        const lines = body.split(/<br\s*\/?>/i).length;
        if (lines === 3 && !/<\/p>\s*<p/i.test(body))
            return { kind: "haiku", area: null, sure: true, why: "Three short lines, set out like a haiku, so they're kept as written." };
        // Lines the file itself breaks one by one (a PDF's or Markdown's verse) are surely a poem.
        const marked = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].every((m) => /<br/i.test(m[1]) || !/\S/.test(m[1].replace(/<[^>]+>/g, "")) || m[1].replace(/<[^>]+>/g, "").trim().split(/\s+/).length <= 3);
        return { kind: "poem", area: null, sure: marked, why: "Set out like a poem, so its lines are kept as written." };
    }
    return { kind: "chapter", area: "chapter", sure: true };
}
/** The whole manuscript, sorted, with the report of what to check. */
export function buildManuscript(doc, at) {
    const chapters = splitChapters(doc.html, at, doc.title, true);
    const sourceDoc = new DOMParser().parseFromString(`<body>${doc.html}</body>`, "text/html");
    const sourcePictures = sourceDoc.body.querySelectorAll("img").length;
    const issues = [];
    // Blank lines between nearly every paragraph are only spacing.
    const all = new DOMParser().parseFromString(`<body>${chapters.map((c) => c.body).join("")}</body>`, "text/html").body;
    const blanks = all.querySelectorAll("p[data-blank]").length;
    const paragraphs = all.querySelectorAll("p:not([data-blank])").length;
    const spacing = blanks > paragraphs * 0.3;
    let reached = "front";
    let breaks = 0;
    let inBody = false;
    let part = null;
    const marks = [];
    /** Words left out on purpose: a typed list under "=== contents", words under a part's mark. */
    const dropped = [];
    const sections = [];
    // A restored draft keeps its anthology parts: each part's own pages follow it.
    const tokens = (c) => (c.hint ?? "").split(/\s+/);
    const restoredPart = (c) => at === "spine" && tokens(c).includes("part");
    // Drafts saved before 0.82 don't say which pages are in a part, so only the
    // back matter after the last part is taken to be the whole book's.
    const marksMembers = at === "spine" && chapters.some((c) => tokens(c).includes("in-part"));
    const lastPart = chapters.reduce((last, c, i) => (restoredPart(c) ? i : last), -1);
    for (const [index, c] of chapters.entries()) {
        if (c.mark === undefined) {
            if (restoredPart(c)) {
                part = sections.length;
                reached = "front";
                sections.push({ title: c.title === "Untitled" ? `Part ${sections.filter((s) => s.isPart).length + 1}` : c.title, body: "", words: 0, area: "chapter", kind: "custom", sure: true, include: true, marked: true, isPart: true });
                continue;
            }
            const section = guessed(c, sections.length);
            const member = part !== null && (marksMembers ? tokens(c).includes("in-part") : !(index > lastPart && section.area === "back"));
            if (member && part !== null)
                section.partOf = part;
            // Out of the parts, the book's own back matter follows.
            else
                part = null;
            sections.push(section);
            continue;
        }
        const m = markedSection(c, reached, inBody);
        if (m.endsPart) {
            part = null;
            if (!c.words)
                continue;
        }
        if (m.isPart) {
            // A part starts its own front, body and back, as an anthology's books do.
            part = sections.length;
            reached = "front";
            sections.push({ title: c.title || `Part ${sections.filter((s) => s.isPart).length + 1}`, body: "", words: 0, area: "chapter", kind: "custom", sure: true, include: true, marked: true, isPart: true });
            if (c.words)
                dropped.push(c.body);
            if (c.words)
                marks.push({ kind: "text", section: sections.length - 1, message: "A part holds no words of its own, so the words under its mark were left out. Put them in a page after it." });
            continue;
        }
        let body = c.body;
        if ((m.kind === "contents" || m.kind === "sources") && c.words) {
            dropped.push(body);
            marks.push({ kind: "text", section: sections.length, message: m.kind === "contents" ? "Scribe makes the contents from the book's pages, so the list under this mark was left out. Use “=== contents by hand” to keep a list of your own." : "Scribe makes the Sources page from the sources you cite, so the words under this mark were left out." });
            body = "";
        }
        if (m.kind === "poem" || m.kind === "haiku")
            body = asPoem(body);
        else if (body) {
            const settled = settleBlanks(body, spacing);
            body = settled.body;
            breaks += settled.breaks;
        }
        if (m.area === "chapter")
            inBody = true;
        reached = m.area;
        const unknown = !markKind(c.mark);
        const title = c.title || (unknown ? c.mark.charAt(0).toUpperCase() + c.mark.slice(1) : m.kind === "chapter" || m.kind === "poem" || m.kind === "haiku" ? "" : m.kind === "contents" || m.kind === "contents_manual" ? "Contents" : KINDS[m.kind].label);
        sections.push({
            title,
            body,
            words: body ? c.words : 0,
            area: m.area,
            kind: m.kind,
            sure: m.sure,
            ...(m.why ? { why: m.why } : {}),
            include: true,
            marked: true,
            ...(m.byHand ? { byHand: true } : {}),
            ...(part !== null ? { partOf: part } : {}),
        });
    }
    function guessed(c, i) {
        const explicit = at === "spine" ? restoredKind(c.hint) : undefined;
        const sorted = explicit ? { ...explicit, sure: true } : sortSection(c.title, c.body, c.hint, i, doc.title);
        // A kind that fits more than one area takes the one the book is in by now.
        let area = sorted.area ?? (ORDER[reached] > 0 ? reached : sorted.kind === "poem" || sorted.kind === "haiku" ? "chapter" : "front");
        let why = sorted.why;
        let sure = sorted.sure;
        let kind = sorted.kind;
        if (!explicit && ORDER[area] < ORDER[reached]) {
            // Never moved out of order: it stays where the file has it, as a page of its own.
            why = `Looks like ${KINDS[kind].label.toLowerCase()}, but comes after ${reached === "chapter" ? "the chapters had begun" : "the back matter had begun"}, so it's kept where it is.`;
            area = reached;
            kind = KINDS[kind].areas.includes(reached) ? kind : "custom";
            sure = false;
        }
        if (!BODY_KINDS.includes(kind) && area === "chapter" && kind !== "custom")
            kind = "custom";
        reached = area;
        let body = c.body;
        if (kind === "poem" || kind === "haiku")
            body = asPoem(body);
        else {
            const settled = settleBlanks(body, spacing);
            body = settled.body;
            breaks += settled.breaks;
        }
        const unnamed = c.title === "Untitled";
        const title = unnamed && (kind === "poem" || kind === "haiku") ? "" : unnamed && explicit && kind !== "custom" && kind !== "chapter" ? KINDS[kind].label : c.title;
        return { title, body, words: c.words, area, kind, sure, ...(why ? { why } : {}), include: at === "spine" || (sorted.include ?? true),
            ...(sorted.byHand || at === "spine" && KINDS[kind].made ? { byHand: true } : {}) };
    }
    const poems = sections.filter((s) => s.kind === "poem" || s.kind === "haiku").length;
    sections.forEach((s, i) => {
        if (!s.sure)
            issues.push({ kind: "classification", section: i, message: s.why ?? `Check that “${s.title || "this section"}” is in the right place.` });
        if (!s.marked && (s.title === "Untitled" || !s.title) && s.kind !== "poem" && s.kind !== "haiku")
            issues.push({ kind: "boundary", section: i, message: "No heading was found here. Check where this section starts and what it's called." });
        if (!s.words && !/<img/i.test(s.body) && !s.isPart && !(s.marked && KINDS[s.kind].made))
            issues.push({ kind: "empty", section: i, message: "This section has no words." });
        if ((s.kind === "poem" || s.kind === "haiku") && poems <= 5)
            issues.push({ kind: "poetry", section: i, message: "Check the poem's line breaks, stanzas and indents against the original." });
    });
    issues.push(...marks);
    if (poems > 5)
        issues.push({ kind: "poetry", section: null, message: `${poems} poems were kept line by line. Check their line breaks, stanzas and indents against the original.` });
    const kept = sections.reduce((n, s) => n + (s.body.match(/<img/gi)?.length ?? 0), 0);
    if (kept < sourcePictures)
        issues.push({ kind: "images", section: null, message: `${sourcePictures - kept} of the file's ${sourcePictures} pictures couldn't be brought in.` });
    if (sourceDoc.body.querySelector("table"))
        issues.push({ kind: "formatting", section: null, message: "The file has tables. Scribe doesn't hold tables, so their words became plain paragraphs." });
    // The writer's page marks aren't words of the book.
    const before = textWords(at === "marks" ? withoutMarks(doc.html) : doc.html) - textWords(dropped.join(" "));
    const after = sections.reduce((n, s) => n + textWords(s.body.replace(/<sup[^>]*data-footnote="([^"]*)"[^>]*>.*?<\/sup>/g, " $1 ")), 0) + sections.reduce((n, s) => n + textWords(s.title), 0);
    if (before > 0 && after < before * 0.98)
        issues.push({ kind: "text", section: null, message: `About ${(before - after).toLocaleString()} words in the file weren't recognised. Compare the book with the original before publishing.` });
    for (const w of doc.warnings ?? [])
        issues.push({ kind: w.kind, section: null, message: w.message });
    if (breaks)
        issues.push({ kind: "breaks", section: null, message: `${breaks} blank ${breaks === 1 ? "line was" : "lines were"} kept as ${breaks === 1 ? "a scene break" : "scene breaks"}.` });
    return { title: doc.title, author: doc.author, description: doc.description, language: doc.language ?? null, isbn: doc.isbn ?? null, sections, issues };
}
/** Reads a supported file into a manuscript. */
export async function readManuscript(name, bytes, at) {
    const doc = await readDocumentBytes(name, bytes);
    const { bestSplit } = await import("./importDoc");
    return { doc, manuscript: buildManuscript(doc, at ?? bestSplit(doc.html)) };
}
