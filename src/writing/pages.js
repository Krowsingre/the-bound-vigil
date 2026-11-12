// The kinds of page a book written in Scribe can have: ready-made ones for
// the front matter (title page, copyright, contents…), the body (chapters,
// interludes) and the back matter (acknowledgements, about the author…),
// plus pages of your own. A section's kind and how it's set out are kept as
// JSON in its `page` (writing_chapters.page in the core).
const SOUND_FILE = /^[0-9a-f]{64}\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/;
/** A listening link, if it's a web address. */
export function webLink(text) {
    const t = (text ?? "").trim();
    if (!t)
        return null;
    try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    }
    catch {
        return null;
    }
}
function readSound(saved) {
    if (!saved || typeof saved !== "object")
        return null;
    const s = saved;
    const file = typeof s.file === "string" && SOUND_FILE.test(s.file) ? s.file : null;
    const link = webLink(typeof s.link === "string" ? s.link : null);
    if (!file && !link)
        return null;
    return { file, name: typeof s.name === "string" ? s.name.slice(0, 200) : "", link };
}
export const KINDS = {
    chapter: { label: "Chapter", areas: ["chapter"] },
    custom: { label: "Custom page", hint: "A page of your own, named as you like", areas: ["front", "chapter", "back"] },
    half_title: { label: "Half title", hint: "Just the book's title, before the title page", areas: ["front"], made: true, unlisted: true, untitled: true },
    title_page: { label: "Title page", hint: "Title, author and series, from the book's details", areas: ["front"], made: true, unlisted: true, untitled: true },
    copyright: { label: "Copyright", hint: "Rights, ISBN and edition, filled in for you", areas: ["front"], made: true, unlisted: true, untitled: true },
    dedication: { label: "Dedication", areas: ["front"], unlisted: true, untitled: true },
    epigraph: { label: "Epigraph", hint: "A quotation that opens the book", areas: ["front"], unlisted: true, untitled: true },
    contents: { label: "Contents (automatic)", hint: "Kept up to date with your sections", areas: ["front"], made: true, unlisted: true, title: () => "Contents" },
    contents_manual: { label: "Contents (written by hand)", hint: "Starts as a list of your sections to edit", areas: ["front"], unlisted: true, title: () => "Contents" },
    also_by: { label: "Also by the author", areas: ["front", "back"], title: (p) => (p.author ? `Also by ${p.author}` : "Also by the author") },
    foreword: { label: "Foreword", hint: "Written by someone else", areas: ["front"] },
    preface: { label: "Preface", hint: "The author on how the book came to be", areas: ["front"] },
    introduction: { label: "Introduction", areas: ["front"] },
    // Part of the story, so in the body (embre, 31 October 2026). Front and back still hold ones made before.
    prologue: { label: "Prologue", areas: ["chapter", "front"] },
    interlude: { label: "Interlude", hint: "Between chapters, not numbered", areas: ["chapter"] },
    poem: { label: "Poem", hint: "Each line kept as written; a blank line starts a stanza", areas: ["front", "chapter", "back"], title: () => "" },
    haiku: { label: "Haiku", hint: "Three short lines, no title", areas: ["chapter"], untitled: true, title: () => "" },
    epilogue: { label: "Epilogue", areas: ["chapter", "back"] },
    afterword: { label: "Afterword", areas: ["back"] },
    acknowledgments: { label: "Acknowledgments", areas: ["back"] },
    about_author: { label: "About the author", areas: ["back"] },
    endnotes: { label: "Notes", hint: "Endnotes", areas: ["back"] },
    glossary: { label: "Glossary", areas: ["back"] },
    appendix: { label: "Appendix", areas: ["back"] },
    bibliography: { label: "Bibliography (written by hand)", hint: "Written by hand", areas: ["back"] },
    sources: { label: "Bibliography", hint: "Fills in cited sources and lets you edit or add entries", areas: ["back"], made: true, title: () => "" },
    discussion: { label: "Discussion questions", hint: "For reading groups", areas: ["back"] },
    excerpt: { label: "Excerpt from your next book", areas: ["back"], title: () => "A sneak peek" },
};
/** The Add menu of each area, in the order a book usually has them. */
export const ADD_MENUS = {
    front: ["half_title", "title_page", "copyright", "dedication", "epigraph", "contents", "contents_manual", "also_by", "foreword", "preface", "introduction", "poem", "custom"],
    chapter: ["chapter", "prologue", "epilogue", "poem", "haiku", "interlude", "custom"],
    back: ["afterword", "acknowledgments", "about_author", "also_by", "endnotes", "glossary", "appendix", "sources", "bibliography", "discussion", "excerpt", "custom"],
};
const KIND_NAMES = Object.keys(KINDS);
/** A section's page settings, from its JSON, with what its kind starts with filling the gaps. */
export function readPage(json, role = "chapter") {
    let saved = {};
    try {
        const parsed = JSON.parse(json || "{}");
        if (parsed && typeof parsed === "object")
            saved = parsed;
    }
    catch {
        // Broken settings fall back to the kind's own.
    }
    const fallback = role === "chapter" ? "chapter" : "custom";
    const kind = KIND_NAMES.includes(saved.kind) ? saved.kind : fallback;
    const info = KINDS[kind];
    return {
        kind,
        inContents: typeof saved.inContents === "boolean" ? saved.inContents : !info.unlisted,
        newPage: typeof saved.newPage === "boolean" ? saved.newPage : null,
        showTitle: typeof saved.showTitle === "boolean" ? saved.showTitle : !info.untitled,
        byHand: saved.byHand === true,
        centred: saved.centred === true,
        sound: readSound(saved.sound),
    };
}
/** Only what differs from the kind's own settings is kept. */
export function writePage(page) {
    const info = KINDS[page.kind];
    const out = { kind: page.kind };
    if (page.inContents === !!info.unlisted)
        out.inContents = page.inContents;
    if (page.newPage !== null)
        out.newPage = page.newPage;
    if (page.showTitle === !!info.untitled)
        out.showTitle = page.showTitle;
    if (page.byHand)
        out.byHand = true;
    if (page.centred)
        out.centred = true;
    if (page.sound && (page.sound.file || page.sound.link))
        out.sound = page.sound;
    return JSON.stringify(out);
}
/** Whether Scribe makes this page itself from the book's details. */
export const isMade = (page) => !!KINDS[page.kind].made && !page.byHand;
/** A page set line by line, as poems are. */
export const isPoem = (page) => page.kind === "poem" || page.kind === "haiku";
/** Whether the section counts as a numbered chapter. */
export const isNumbered = (c) => c.role === "chapter" && readPage(c.page, c.role).kind === "chapter";
/** The title a new page of this kind starts with. */
export function startingTitle(kind, project) {
    const info = KINDS[kind];
    return info.title ? info.title(project) : kind === "custom" ? "Untitled page" : info.label;
}
/** A poem's first line, as plain words: what names an untitled poem. */
export function firstLine(html) {
    const first = html.split(/<br\s*\/?>|<\/p>|<\/h\d>/i).find((l) => l.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()) ?? "";
    const doc = new DOMParser().parseFromString(first, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
/** How long a stanza can be before e-readers are likely to break it across screens. */
export const LONG_STANZA = 16;
/** What a poem may lose on some e-readers, found in its HTML: stanzas too long to keep on one screen, and lines that rely on exact spacing. */
export function poemWarnings(html) {
    const warnings = [];
    const stanzas = html.split(/<\/p>/i).map((p) => p.split(/<br\s*\/?>/i).length);
    if (stanzas.some((lines) => lines > LONG_STANZA))
        warnings.push(`A stanza here is over ${LONG_STANZA} lines. On small screens it may have to carry on to the next page.`);
    // Wide gaps inside a line (not at its start) are how shape poems are placed.
    const lines = html.replace(/<p[^>]*>/gi, "<br>").split(/<br\s*\/?>|<\/p>/i);
    if (lines.some((l) => /[^\s\u00a0][\s\u00a0]{3,}[^\s\u00a0]/.test(l.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "\u00a0"))))
        warnings.push("Some lines rely on exact spacing inside them. E-readers keep the spaces, but can't promise where wrapped lines fall, so a shaped poem may not hold its shape on every screen.");
    return warnings;
}
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
/** A number as words, as chapter headings write it: 21 is "Twenty-One". Past 999, the digits. */
export function numberInWords(n) {
    if (n < 1 || n > 999 || !Number.isInteger(n))
        return String(n);
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const under = rest < 20 ? ONES[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ""}`;
    return [hundreds ? `${ONES[hundreds]} Hundred` : "", under].filter(Boolean).join(" ");
}
/** Parts (body sections) are numbered I, II, III… */
export function romanOf(n) {
    const marks = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [value, mark] of marks)
        while (n >= value) {
            out += mark;
            n -= value;
        }
    return out;
}
export const DEFAULT_RIGHTS = "All rights reserved. No part of this book may be reproduced in any form or by any means without written permission from the copyright holder, except for brief quotations in reviews.";
export const DEFAULT_COPYRIGHT = { year: "", holder: "", rights: DEFAULT_RIGHTS, notice: "", isbn: "", edition: "", publisher: "", credit: true };
export const TEMPLATES = [
    { value: "blank", label: "Blank", hint: "Just a first chapter", about: "Begin with a single chapter and shape your book as you write." },
    {
        value: "novel",
        label: "Novel",
        hint: "Title page, copyright, dedication, contents, chapters, acknowledgments, about the author",
        about: "Begin with the essential pages of a novel, from title and copyright to acknowledgments and author biography.",
    },
    {
        value: "collection",
        label: "Short Story Collection",
        hint: "Title page, copyright, contents, a story to start, about the author",
        about: "Bring individual stories together in one volume, with the opening and closing pages already prepared.",
    },
    {
        value: "nonfiction",
        label: "Non-fiction",
        hint: "Title page, copyright, contents, introduction, Part One, notes, bibliography, about the author",
        about: "Organize your work into parts, with an introduction, notes, bibliography, and supporting pages.",
    },
];
/** A template's sections after the first chapter, which every book starts with: front matter before it, the rest after. */
export function templateSections(template) {
    switch (template) {
        case "novel":
            return [
                { kind: "title_page", role: "front" },
                { kind: "copyright", role: "front" },
                { kind: "dedication", role: "front" },
                { kind: "contents", role: "front" },
                { kind: "acknowledgments", role: "back" },
                { kind: "about_author", role: "back" },
            ];
        case "collection":
            return [
                { kind: "title_page", role: "front" },
                { kind: "copyright", role: "front" },
                { kind: "contents", role: "front" },
                { kind: "about_author", role: "back" },
            ];
        case "nonfiction":
            return [
                { kind: "title_page", role: "front" },
                { kind: "copyright", role: "front" },
                { kind: "contents", role: "front" },
                { kind: "introduction", role: "front" },
                { kind: "custom", role: "part", title: "Part One" },
                { kind: "endnotes", role: "back" },
                { kind: "bibliography", role: "back" },
                { kind: "about_author", role: "back" },
            ];
        default:
            return [];
    }
}
