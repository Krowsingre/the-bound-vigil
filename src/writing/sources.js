// Research sources for a book written in Scribe: each added once (a book, an
// article, a website…), then cited anywhere in the text. The EPUB writes the
// citations and a Sources page in the style chosen, using citeproc-js and the
// open citation style files (CSL) that Zotero and Mendeley use, so every style
// follows its rules exactly. AP has no reference-list rules of its own, so
// for AP Scribe writes a plain list and names sources in the text.
// Sources and the style are kept in the book's export settings, so they sync
// with the book.
import { isMade, readPage } from "./pages";
export const STYLES = [
    { value: "custom", label: "Custom", hint: "Numbered citations with your own bibliography format", heading: "Bibliography" },
    { value: "numbered", label: "Numbered", hint: "Numbered in order of first citation", heading: "References" },
    { value: "apa", label: "APA", hint: "7th edition · psychology, education, social sciences", heading: "References" },
    { value: "mla", label: "MLA", hint: "9th edition · literature and the humanities", heading: "Works Cited" },
    { value: "chicago-notes", label: "Chicago (notes)", hint: "17th edition · footnotes and a bibliography", heading: "Bibliography" },
    { value: "chicago-author-date", label: "Chicago (author-date)", hint: "17th edition · names and years in the text", heading: "References" },
    { value: "harvard", label: "Harvard", hint: "Cite Them Right", heading: "Reference list" },
    { value: "ieee", label: "IEEE", hint: "Numbered, for engineering and computing", heading: "References" },
    { value: "bluebook", label: "Bluebook / ALWD", hint: "Legal citations, in footnotes", heading: "Table of Authorities" },
    { value: "cse", label: "CSE", hint: "Citation-sequence, for the sciences", heading: "References" },
    { value: "ama", label: "AMA", hint: "11th edition · medicine", heading: "References" },
    { value: "ap", label: "AP", hint: "News writing: sources named in the text, a plain list at the end", heading: "Sources" },
];
const STYLE_FILES = {
    apa: () => import("./csl/apa.csl?raw"),
    mla: () => import("./csl/modern-language-association.csl?raw"),
    "chicago-notes": () => import("./csl/chicago-note-bibliography.csl?raw"),
    "chicago-author-date": () => import("./csl/chicago-author-date.csl?raw"),
    harvard: () => import("./csl/harvard-cite-them-right.csl?raw"),
    ieee: () => import("./csl/ieee.csl?raw"),
    bluebook: () => import("./csl/bluebook-law-review.csl?raw"),
    cse: () => import("./csl/council-of-science-editors.csl?raw"),
    ama: () => import("./csl/american-medical-association.csl?raw"),
};
export const SOURCE_TYPES = [
    { value: "book", label: "Book", fields: ["authors", "editors", "title", "edition", "publisher", "place", "date", "url", "doi"] },
    { value: "chapter", label: "Chapter in a book", container: "Book title", fields: ["authors", "title", "editors", "container", "edition", "publisher", "place", "date", "pages", "doi"] },
    { value: "article-journal", label: "Journal article", container: "Journal", fields: ["authors", "title", "container", "volume", "issue", "pages", "date", "doi", "url"] },
    { value: "article-magazine", label: "Magazine article", container: "Magazine", fields: ["authors", "title", "container", "date", "pages", "url"] },
    { value: "article-newspaper", label: "Newspaper article", container: "Newspaper", fields: ["authors", "title", "container", "place", "date", "pages", "url"] },
    { value: "webpage", label: "Web page", container: "Website", fields: ["authors", "title", "container", "date", "url", "accessed"] },
    { value: "report", label: "Report", fields: ["authors", "title", "publisher", "place", "date", "url", "doi"] },
    { value: "thesis", label: "Thesis", fields: ["authors", "title", "publisher", "place", "date", "url"] },
    { value: "legal_case", label: "Court case", container: "Court", fields: ["title", "container", "volume", "pages", "date", "url"] },
];
export const FIELD_LABELS = {
    id: "",
    type: "Kind",
    title: "Title",
    authors: "Authors",
    editors: "Editors",
    container: "Part of",
    publisher: "Publisher",
    place: "Place",
    date: "Date",
    volume: "Volume",
    issue: "Issue",
    pages: "Pages",
    edition: "Edition",
    url: "Web address",
    doi: "DOI",
    accessed: "Read on",
};
const TEXT_FIELDS = ["title", "authors", "editors", "container", "publisher", "place", "date", "volume", "issue", "pages", "edition", "url", "doi", "accessed"];
export function emptySource(id, type = "book") {
    return { id, type, title: "", authors: "", editors: "", container: "", publisher: "", place: "", date: "", volume: "", issue: "", pages: "", edition: "", url: "", doi: "", accessed: "" };
}
/** Sources as saved, with anything broken dropped. */
export function readSources(value) {
    if (!Array.isArray(value))
        return [];
    const types = SOURCE_TYPES.map((t) => t.value);
    return value
        .filter((s) => !!s && typeof s === "object" && typeof s.id === "string")
        .slice(0, 2000)
        .map((s) => {
        const out = emptySource(String(s.id).slice(0, 80), types.includes(s.type) ? s.type : "book");
        for (const key of TEXT_FIELDS)
            if (typeof s[key] === "string")
                out[key] = s[key].slice(0, 2000);
        if (s.includeInBibliography === true)
            out.includeInBibliography = true;
        return out;
    });
}
export const isNumberedStyle = (style) => style === "numbered" || style === "custom";
export const citationFormats = (current) => STYLES.filter(({ value }) => value === current || value === "mla" || value === "apa" || value === "custom");
export const readStyle = (value) => (STYLES.some((s) => s.value === value) ? value : "chicago-notes");
const people = (text) => text
    .split(/\n|;/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
    // "Family, Given" is a person; anything else is kept whole (an organisation).
    const comma = p.indexOf(",");
    return comma > 0 ? { family: p.slice(0, comma).trim(), given: p.slice(comma + 1).trim() } : p.includes(" ") && !/\b(inc|ltd|llc|association|society|university|institute|press|department|court)\b/i.test(p) ? splitName(p) : { literal: p };
});
function splitName(name) {
    const parts = name.split(/\s+/);
    return { family: parts.pop(), given: parts.join(" ") };
}
const dateParts = (text) => {
    const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(text.trim());
    return m ? { "date-parts": [[Number(m[1]), ...(m[2] ? [Number(m[2])] : []), ...(m[3] ? [Number(m[3])] : [])]] } : text.trim() ? { literal: text.trim() } : undefined;
};
/** A source as citeproc-js reads it (CSL-JSON). */
export function toCsl(s) {
    const item = { id: s.id, type: s.type, title: s.title.trim() || "Untitled" };
    const authors = people(s.authors);
    const editors = people(s.editors);
    if (authors.length)
        item.author = authors;
    if (editors.length)
        item.editor = editors;
    const set = (key, value) => value.trim() && (item[key] = value.trim());
    set("container-title", s.container);
    if (s.type === "legal_case")
        set("authority", s.container);
    set("publisher", s.publisher);
    set("publisher-place", s.place);
    set("volume", s.volume);
    set("issue", s.issue);
    set("page", s.pages);
    set("edition", s.edition);
    set("URL", s.url);
    set("DOI", s.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""));
    const issued = dateParts(s.date);
    if (issued)
        item.issued = issued;
    const accessed = dateParts(s.accessed);
    if (accessed)
        item.accessed = accessed;
    return item;
}
/** A short label for a citation in the editor, such as "(Morrison 1987, p. 12)". The book itself gets the chosen style. */
export function citationLabel(s, locator) {
    if (!s)
        return "(source removed)";
    const first = people(s.authors)[0];
    const name = first ? ("family" in first ? first.family : first.literal) : s.title.trim() || "Untitled";
    const year = /^\d{4}/.exec(s.date)?.[0];
    return `(${[name, year].filter(Boolean).join(" ")}${locator.trim() ? `, p. ${locator.trim()}` : ""})`;
}
/** Every citation in the chapters given (in the book's order), in the order they appear. */
export function citations(chapters) {
    const found = [];
    for (const c of chapters) {
        if (isMade(readPage(c.page, c.role)) || !/<cite\b/i.test(c.body))
            continue;
        const doc = new DOMParser().parseFromString(c.body, "text/html");
        for (const cite of doc.body.querySelectorAll("cite[data-source]")) {
            found.push({ id: cite.getAttribute("data-source"), locator: cite.getAttribute("data-locator") ?? "" });
        }
    }
    return found;
}
/** Each source cited in the book, in the order the citations first appear. */
export function citedIds(chapters) {
    return [...new Set(citations(chapters).map((c) => c.id))];
}
/** The engine set up for this book, loaded only when a book has citations. */
export async function makeCiter(style, sources, chapters, customFormat = "") {
    const byId = new Map(sources.map((s) => [s.id, s]));
    const cited = citedIds(chapters).filter((id) => byId.has(id));
    const hasBibliography = chapters.some((chapter) => {
        const page = readPage(chapter.page, chapter.role);
        return page.kind === "sources" && isMade(page);
    });
    const additional = hasBibliography ? sources.filter((s) => s.includeInBibliography && !cited.includes(s.id)).map((s) => s.id) : [];
    const ids = [...cited, ...additional];
    if (!ids.length)
        return null;
    const heading = STYLES.find((s) => s.value === style).heading;
    if (style === "numbered" || style === "custom")
        return numberedCiter(ids, byId, heading, style, customFormat);
    if (style === "ap")
        return apCiter(ids, byId, heading);
    const [{ default: CSL }, { default: xml }, { default: locale }] = await Promise.all([import("citeproc"), STYLE_FILES[style](), import("./csl/locales-en-US.xml?raw")]);
    const items = Object.fromEntries(ids.map((id) => [id, toCsl(byId.get(id))]));
    const engine = new CSL.Engine({ retrieveLocale: () => locale, retrieveItem: (id) => items[id] }, xml, "en-US");
    engine.setOutputFormat("html");
    const note = engine.opt.xclass === "note";
    // Every citation is written once, in the book's order, so numbered styles
    // number sources as they're first cited and note styles shorten the ones
    // cited before. Each answer may also change earlier ones (telling two
    // authors of one name apart, say), so all are kept by id.
    const cluster = (c) => [{ id: c.id, ...(c.locator.trim() ? { locator: c.locator.trim(), label: "page" } : {}) }];
    const known = citations(chapters).filter((c) => byId.has(c.id));
    const written = new Map();
    const order = [];
    known.forEach((c, i) => {
        const citation = { citationItems: cluster(c), properties: { noteIndex: note ? i + 1 : 0 } };
        const [, changed] = engine.processCitationCluster(citation, order.map((id, n) => [id, note ? n + 1 : 0]), []);
        for (const [, html, citationId] of changed)
            written.set(citationId, html);
        order.push(citation.citationID);
    });
    if (additional.length)
        engine.updateUncitedItems(additional);
    let next = 0;
    return {
        style,
        heading,
        cite(id, locator) {
            if (!byId.has(id))
                return { text: "" };
            const at = next++;
            // Asked in the same order as found; anything else is written on its own.
            const html = known[at]?.id === id && known[at].locator === locator ? (written.get(order[at]) ?? "") : engine.makeCitationCluster(cluster({ id, locator }));
            return note ? { note: html } : { text: html };
        },
        restart() {
            next = 0;
        },
        bibliography() {
            const made = engine.makeBibliography();
            if (made)
                return made[1].map((entry, index) => ({ sourceId: made[0].entry_ids[index][0], html: entry.trim() }));
            // Some note styles have no bibliography format. An explicitly added page still lists its sources.
            return hasBibliography ? apCiter(ids, byId, heading).bibliography() : [];
        },
    };
}
const escape = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function citationProblems(sources, chapters) {
    const ids = new Set();
    const problems = new Set();
    for (const source of sources) {
        if (!source.id.trim() || ids.has(source.id))
            problems.add("Sources contain a missing or duplicate internal ID.");
        ids.add(source.id);
    }
    for (const chapter of chapters) {
        if (citedIds([chapter]).some((id) => !ids.has(id))) {
            problems.add(`Restore or replace the missing source cited in “${chapter.title.trim() || "Untitled"}”.`);
        }
    }
    return [...problems];
}
function numberedCiter(ids, byId, heading, style, customFormat) {
    const numbers = new Map(ids.map((id, index) => [id, index + 1]));
    return {
        style,
        heading,
        cite(id, locator) {
            const reference = numbers.get(id);
            return reference ? { text: `[${reference}]`, reference, locator: locator.trim() } : {};
        },
        restart() { },
        bibliography() {
            return ids.map((id, index) => {
                const source = byId.get(id);
                const details = [source.authors.trim().replace(/\s*\n\s*/g, "; "), source.title, source.container, source.publisher, source.date]
                    .map((value) => value.trim()).filter(Boolean);
                const links = [source.url.trim(), source.doi.trim()].filter(Boolean);
                if (links[1] && links[1] === links[0])
                    links.pop();
                const locatorHtml = (value) => {
                    const target = /^10\.\d+\//.test(value) ? `https://doi.org/${value}` : value;
                    return /^https?:\/\//i.test(target)
                        ? `<a href="${escape(target).replace(/"/g, "&quot;")}">${escape(value)}</a>`
                        : escape(value);
                };
                const values = { author: escape(source.authors.trim().replace(/\s*\n\s*/g, ", ")), title: escape(source.title), publication: escape(source.container || source.publisher), publisher: escape(source.publisher), date: escape(source.date), url: locatorHtml(source.url.trim()), doi: locatorHtml(source.doi.trim()) };
                const formatted = style === "custom" && customFormat.trim()
                    ? escape(customFormat.trim()).replace(/\{([a-z]+)\}/g, (token, field) => Object.hasOwn(values, field) ? values[field] : token)
                    : [details.map(escape).join(". "), ...links.map(locatorHtml)].filter(Boolean).join(" ");
                return { sourceId: id, html: `[${index + 1}] ${formatted}` };
            });
        },
    };
}
/** AP style: the source named in the text, and a plain list. */
function apCiter(ids, byId, heading) {
    const name = (s) => {
        const first = people(s.authors)[0];
        return first ? ("family" in first ? first.family : first.literal) : s.container.trim() || s.title.trim();
    };
    return {
        style: "ap",
        heading,
        restart() { },
        cite(id) {
            const s = byId.get(id);
            return { text: s ? escape(`(${name(s)}${/^\d{4}/.exec(s.date) ? `, ${s.date.slice(0, 4)}` : ""})`) : "" };
        },
        bibliography() {
            return ids
                .map((id) => byId.get(id))
                .sort((a, b) => name(a).localeCompare(name(b)))
                .map((s) => {
                const who = people(s.authors)
                    .map((p) => ("family" in p ? `${p.given} ${p.family}`.trim() : p.literal))
                    .join(", ");
                const parts = [escape(who), `<i>${escape(s.title.trim() || "Untitled")}</i>`, ...[s.container, s.publisher, s.date].map((p) => escape(p.trim()))].filter(Boolean);
                return { sourceId: s.id, html: `<div class="csl-entry">${parts.join(". ")}.${s.url ? ` ${escape(s.url)}` : ""}</div>` };
            });
        },
    };
}
