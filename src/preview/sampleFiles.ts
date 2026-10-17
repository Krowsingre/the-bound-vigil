// Small books in the other formats TBV reads, built in the browser so each
// kind can be looked at in the design preview. Only the preview uses them.

import { PARAGRAPHS, storedZip } from "./sampleEpub";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sampleText(title: string): Blob {
  // Wrapped at a fixed width, like most plain text books.
  const wrap = (p: string) => p.replace(/(.{1,68})(\s|$)/g, "$1\n").trim();
  const text = [title.toUpperCase(), "", "Chapter 1", "", ...PARAGRAPHS.slice(0, 3).map(wrap).flatMap((p) => [p, ""]), "Chapter 2", "", ...PARAGRAPHS.slice(3).map(wrap).flatMap((p) => [p, ""])].join("\n");
  return new Blob([text], { type: "text/plain" });
}

export function sampleDocx(title: string, author: string): Blob {
  const para = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const body = [
    para("Chapter One", "Heading1"),
    ...PARAGRAPHS.slice(0, 3).map((p) => para(p)),
    `<w:p><w:r><w:t xml:space="preserve">Some words are </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>in italics</w:t></w:r><w:r><w:t xml:space="preserve"> and some are </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>`,
    para("Chapter Two", "Heading1"),
    ...PARAGRAPHS.slice(3).map((p) => para(p)),
  ].join("");
  return storedZip(
    [
      [
        "[Content_Types].xml",
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ],
      [
        "_rels/.rels",
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ],
      [
        "word/document.xml",
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ],
      ["docProps/core.xml", `<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator></cp:coreProperties>`],
    ],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
}

/** A three-page PDF with real text, so selecting and highlighting work. */
export function samplePdf(title: string, author: string): Blob {
  const pdfText = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const lines = (p: string) => p.match(/.{1,60}(\s|$)/g)!.map((l) => l.trim());
  const pages = [
    [title, `by ${author}`],
    lines(PARAGRAPHS[0]).concat("", lines(PARAGRAPHS[1])),
    lines(PARAGRAPHS[2]).concat("", lines(PARAGRAPHS[3])),
  ];
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>";
  pages.forEach((page, i) => {
    const first = i === 0;
    const stream = `BT /F1 ${first ? 26 : 13} Tf ${first ? "72 600" : "72 720"} Td ${first ? 34 : 19} TL ${page.map((l) => `(${pdfText(l)}) '`).join(" ")} ET`;
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 468 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  const info = objects.length;
  objects[info] = `<< /Title (${pdfText(title)}) /Author (${pdfText(author)}) >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: "application/pdf" });
}

/** A short comic: four drawn panels-as-pages. */
export async function sampleComic(title: string): Promise<Blob> {
  const pages: [string, Uint8Array][] = [];
  const tones = ["#2f3a44", "#5f84ad", "#6f9a6a", "#d9a03f"];
  for (let i = 0; i < tones.length; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 900;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#f1ebdf";
    g.fillRect(0, 0, 600, 900);
    g.fillStyle = tones[i];
    g.fillRect(40, 40, 520, 600);
    g.fillStyle = "#1a1c1e";
    g.font = "bold 40px Georgia";
    g.fillText(i === 0 ? title : `Page ${i + 1}`, 60, 740);
    const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), "image/png"));
    pages.push([`page${String(i + 1).padStart(2, "0")}.png`, new Uint8Array(await blob.arrayBuffer())]);
  }
  return storedZip(pages, "application/vnd.comicbook+zip");
}

export function sampleFb2(title: string, author: string): Blob {
  const [first, ...rest] = author.split(" ");
  const section = (name: string, paragraphs: string[]) =>
    `<section><title><p>${esc(name)}</p></title>${paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><author><first-name>${esc(first)}</first-name><last-name>${esc(rest.join(" "))}</last-name></author><book-title>${esc(title)}</book-title><lang>en</lang></title-info></description>
<body>${section("Part One", PARAGRAPHS.slice(0, 3))}${section("Part Two", PARAGRAPHS.slice(3))}</body></FictionBook>`;
  return new Blob([xml], { type: "application/x-fictionbook+xml" });
}
