// Builds TBV's offline dictionary (crates/tbv-core/assets/wordnet.txt.gz)
// from the WordNet 3.1 files in the wordnet-db npm package:
//   npm pack wordnet-db@3.1.14 && tar xzf wordnet-db-3.1.14.tgz
//   node scripts/build-dictionary.mjs package/dict
// Format (gzip text): one meaning per line ("n|definition|example"), a blank
// line, then one word per line ("word\tmeaning numbers in base 36, by how
// common each sense is").
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Give the WordNet dict folder.");
const POS = { noun: "n", verb: "v", adj: "a", adv: "r" };
const meanings = [];
const ids = new Map(); // "pos:offset" -> meaning number
const lines = (file) => readFileSync(join(dir, file), "utf8").split("\n").filter((l) => l && !l.startsWith("  "));

for (const [name, pos] of Object.entries(POS)) {
  for (const line of lines(`data.${name}`)) {
    const bar = line.indexOf(" | ");
    if (bar < 0) continue;
    const offset = line.slice(0, 8);
    const gloss = line.slice(bar + 3).trim();
    // "definition; "an example"; "another"" — the definition, then the first example.
    const parts = gloss.split(/;\s*(?=")/);
    const definition = parts[0].trim().replace(/\|/g, "/");
    const example = (parts[1] ?? "").trim().replace(/^"|"$/g, "").replace(/\|/g, "/");
    ids.set(`${pos}:${offset}`, meanings.length);
    meanings.push(`${pos}|${definition}|${example}`);
  }
}

const words = new Map();
for (const [name, pos] of Object.entries(POS)) {
  for (const line of lines(`index.${name}`)) {
    const f = line.trim().split(" ");
    const lemma = f[0].replace(/_/g, " ");
    const pointers = Number(f[3]);
    const senses = Number(f[2]);
    const offsets = f.slice(4 + pointers + 2, 4 + pointers + 2 + senses);
    const list = words.get(lemma) ?? [];
    for (const o of offsets) {
      const id = ids.get(`${pos}:${o}`);
      if (id !== undefined) list.push(id.toString(36));
    }
    words.set(lemma, list);
  }
}

const text = meanings.join("\n") + "\n\n" + [...words].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([w, l]) => `${w}\t${l.join(" ")}`).join("\n") + "\n";
const out = new URL("../crates/tbv-core/assets/wordnet.txt.gz", import.meta.url);
writeFileSync(out, gzipSync(text, { level: 9 }));
console.log(`${meanings.length} meanings, ${words.size} words, ${(text.length / 1e6).toFixed(1)} MB → ${out.pathname}`);
