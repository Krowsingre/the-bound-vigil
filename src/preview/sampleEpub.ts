// A small EPUB built in the browser, so the reader can be looked at in the
// design preview without shipping a book. Only the preview uses it. The text
// is written for TBV and free to use.

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with every file stored uncompressed, which EPUB readers accept. */
export function storedZip(files: [string, string | Uint8Array][], type = "application/epub+zip"): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const data = typeof text === "string" ? enc.encode(text) : text;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)].map((p) => p.slice().buffer), {
    type,
  });
}

export const PARAGRAPHS = [
  "The lamps along the harbour wall were lit one by one, the way they had been every evening for as long as anyone in the town could remember. Wren walked the length of the wall with her taper held high, and the small flames answered her in a line that bent away into the fog.",
  "Her grandmother had kept the lamps before her, and her grandmother's father before that. The town had long since stopped thanking the family for it. People only noticed the lamps on the nights they were not lit, and there had not been one of those in sixty years.",
  "At the end of the wall the stones were older and darker, and the last lamp hung from an iron hook shaped like a closed hand. Wren reached up to it and paused. Someone had been here before her. The glass was clean, the wick trimmed, and a folded note was tucked behind the bracket.",
  "She did not open it at once. The tide was turning below her, pulling at the weed on the steps, and the boats in the harbour knocked softly against one another like people shifting in their seats before a story begins. She lit the lamp first, because that was the work, and the work came before the wondering.",
  "Only when the flame had settled did she unfold the paper. The handwriting was careful and a little old-fashioned, the letters joined by fine threads of ink. It said: A light is only a promise that someone is still awake. Keep the lamps until I come back.",
  "Wren read it three times. Then she put it in her coat pocket, next to the box of tapers, and walked home along the wall with every light burning behind her.",
];

const CHAPTERS: { part: string; title: string; shift: number }[] = [
  { part: "Part One", title: "The Harbour Wall", shift: 0 },
  { part: "Part One", title: "A Note Behind the Bracket", shift: 2 },
  { part: "Part One", title: "Low Tide", shift: 4 },
  { part: "Part Two", title: "The Keeper's Ledger", shift: 1 },
  { part: "Part Two", title: "Fog Over the Shoals", shift: 3 },
  { part: "Part Two", title: "The Next Step", shift: 5 },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function chapterXhtml(i: number, notice: boolean): string {
  const c = CHAPTERS[i];
  const body: string[] = [];
  if (notice) {
    body.push(
      `<p><em>This is sample text for looking at the reader in a web browser. Your own books open in The Bound Vigil app.</em></p>`,
    );
  }
  for (let round = 0; round < 3; round++) {
    for (let k = 0; k < PARAGRAPHS.length; k++) body.push(`<p>${esc(PARAGRAPHS[(k + c.shift + round) % PARAGRAPHS.length])}</p>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${esc(c.title)}</title>
<style>h1{text-align:center;font-weight:400;margin:1.5em 0 .2em}.part{text-align:center;letter-spacing:.3em;text-transform:uppercase;font-size:.75em;margin-top:2em}.sub{text-align:center;letter-spacing:.25em;text-transform:uppercase;font-size:.85em;margin-bottom:2em}p{text-indent:1.2em;margin:0 0 .6em}</style>
</head>
<body><section epub:type="chapter">
<p class="part">${esc(c.part)}</p>
<h1>Chapter ${i + 1}</h1>
<p class="sub">${esc(c.title)}</p>
${body.join("\n")}
</section></body></html>`;
}

/** Builds the sample book under the given title and author. */
export function sampleEpub(title: string, author: string): Blob {
  const parts = [...new Set(CHAPTERS.map((c) => c.part))];
  const nav = parts
    .map(
      (part) =>
        `<li><a href="ch${CHAPTERS.findIndex((c) => c.part === part) + 1}.xhtml">${esc(part)}</a><ol>${CHAPTERS.map((c, i) =>
          c.part === part ? `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>` : "",
        ).join("")}</ol></li>`,
    )
    .join("");
  const files: [string, string][] = [
    ["mimetype", "application/epub+zip"],
    [
      "META-INF/container.xml",
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ],
    [
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">tbv-preview-sample</dc:identifier><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>en</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${CHAPTERS.map(
        (_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
      ).join("")}</manifest>
<spine>${CHAPTERS.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join("")}</spine>
</package>`,
    ],
    [
      "OEBPS/nav.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`,
    ],
    ...CHAPTERS.map((_, i): [string, string] => [`OEBPS/ch${i + 1}.xhtml`, chapterXhtml(i, i === 0)]),
  ];
  return storedZip(files);
}
