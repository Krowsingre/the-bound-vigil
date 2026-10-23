// Reader mode: Mozilla's Readability finds the article on a web page; TBV
// shows it in its own reading style and can save it to the library as an
// EPUB, with its pictures.

import readabilitySource from "@mozilla/readability/Readability.js?raw";
import type { ReaderArticle, WritingProject } from "../api/types";
import { buildEpub, DEFAULT_EXPORT, epubFileName } from "../writing/epub";

/** The script the page runs: Readability on a copy of the page, answering the article as JSON text. */
export function readerScript(): string {
  return `(function () {
  try {
    ${readabilitySource}
    var found = new Readability(document.cloneNode(true)).parse();
    if (!found || !found.content) return JSON.stringify(null);
    return JSON.stringify({ title: found.title || document.title || "", byline: found.byline || null, siteName: found.siteName || null, content: found.content, excerpt: found.excerpt || null, lang: found.lang || document.documentElement.lang || null, url: location.href });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
})()`;
}

/** What the page answered, as an article; null when it has none (or something went wrong). */
export function articleFrom(answer: unknown): ReaderArticle | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as Partial<ReaderArticle> & { error?: string };
  if (a.error || typeof a.content !== "string" || !a.content.trim() || typeof a.url !== "string") return null;
  return {
    title: typeof a.title === "string" && a.title.trim() ? a.title.trim() : "Untitled article",
    byline: typeof a.byline === "string" && a.byline.trim() ? a.byline.trim() : null,
    siteName: typeof a.siteName === "string" && a.siteName.trim() ? a.siteName.trim() : null,
    content: a.content,
    excerpt: typeof a.excerpt === "string" ? a.excerpt : null,
    lang: typeof a.lang === "string" && /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(a.lang) ? a.lang : null,
    url: a.url,
  };
}

const DROP = "script,style,iframe,frame,object,embed,form,input,button,select,textarea,link,meta,base,svg,math,noscript,template";

/**
 * The article's HTML made safe to show inside TBV: nothing that runs, no
 * forms or frames, links only to web addresses, pictures only from the web.
 */
export function cleanArticle(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll(DROP).forEach((el) => el.remove());
  doc.body.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const keep = (name === "href" && el.tagName === "A") || ((name === "src" || name === "alt") && el.tagName === "IMG") || name === "colspan" || name === "rowspan";
      if (!keep) el.removeAttribute(attr.name);
    }
    if (el.tagName === "A") {
      const href = el.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) el.removeAttribute("href");
    }
    if (el.tagName === "IMG" && !/^https?:\/\//i.test(el.getAttribute("src") ?? "")) el.remove();
  });
  return doc.body.innerHTML;
}

/** The article as the byline under its title: who wrote it, and where. */
export function articleByline(article: ReaderArticle): string {
  const site = article.siteName ?? siteName(article.url);
  return [article.byline, site].filter(Boolean).join(" · ");
}

function siteName(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const MOST_PICTURES = 40;

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function mimeOf(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/**
 * The article as an EPUB: one chapter with its pictures inside, the site
 * and address it came from in the book's description. Pictures that can't
 * be brought down are left out.
 */
export async function articleEpub(
  article: ReaderArticle,
  fetchPicture: (url: string) => Promise<Uint8Array>,
  now = new Date(),
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const doc = new DOMParser().parseFromString(`<body>${cleanArticle(article.content)}</body>`, "text/html");
  const pictures = [...doc.body.querySelectorAll("img")];
  await Promise.all(
    pictures.map(async (img, i) => {
      const src = img.getAttribute("src") ?? "";
      try {
        if (i >= MOST_PICTURES) throw new Error("enough");
        const bytes = await fetchPicture(src);
        const mime = mimeOf(bytes);
        if (!mime) throw new Error("not a picture");
        img.setAttribute("src", `data:${mime};base64,${base64(bytes)}`);
      } catch {
        img.remove();
      }
    }),
  );
  const site = article.siteName ?? siteName(article.url);
  const saved = now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const project: WritingProject = {
    id: crypto.randomUUID(),
    title: article.title,
    author: article.byline ?? site,
    series: null,
    seriesIndex: null,
    language: article.lang,
    description: `Saved from ${site ?? "the web"} (${article.url}) on ${saved}.`,
    cover: null,
    coverPath: null,
    export: "",
    chapters: 1,
    words: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const source = `<p><em>From <a href="${escapeAttr(article.url)}">${escapeText(site ?? article.url)}</a>, saved ${escapeText(saved)}.</em></p>`;
  const bytes = buildEpub({
    project,
    chapters: [
      { id: "article", projectId: project.id, title: article.title, body: doc.body.innerHTML, position: 0, words: 0, updatedAt: project.updatedAt, role: "chapter" },
      { id: "source", projectId: project.id, title: "Source", body: source, position: 1, words: 0, updatedAt: project.updatedAt, role: "back" },
    ],
    settings: { ...DEFAULT_EXPORT, paragraphs: "space", newPage: true, tocDepth: 2 },
    now,
  });
  return { bytes, fileName: epubFileName(article.title) };
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}
