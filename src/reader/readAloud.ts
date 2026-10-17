// Read aloud: the parts that don't need a voice. The page engine hands over
// each paragraph as SSML with a <mark> before every sentence; here that becomes
// plain sentences to speak, and the voice to speak them is chosen.

export interface Sentence {
  /** The engine's mark for this sentence, used to highlight it. */
  mark: string;
  text: string;
}

export interface SpeechBlock {
  /** All the text, as the engine gave it, with marks at these offsets. */
  text: string;
  marks: { name: string; offset: number }[];
  lang: string | null;
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** Plain text of an SSML block, with where each mark falls in it. */
export function ssmlToText(ssml: string): SpeechBlock {
  const doc = new DOMParser().parseFromString(ssml, "application/xml");
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length) return { text: "", marks: [], lang: null };
  let text = "";
  const marks: SpeechBlock["marks"] = [];
  const walk = (node: Node) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE) text += n.nodeValue ?? "";
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const name = (n as Element).localName;
        if (name === "mark") marks.push({ name: (n as Element).getAttribute("name") ?? "", offset: text.length });
        else if (name === "break") text += " ";
        else walk(n);
      }
    }
  };
  walk(root);
  const lang = root.getAttributeNS(XML_NS, "lang") || root.getAttribute("xml:lang") || null;
  return { text, marks, lang };
}

const speakable = /[\p{L}\p{N}]/u;

/** The block cut into sentences at its marks, leaving out ones with nothing to say. */
export function sentencesOf(block: SpeechBlock): Sentence[] {
  const out: Sentence[] = [];
  block.marks.forEach((m, i) => {
    const end = block.marks[i + 1]?.offset ?? block.text.length;
    const text = block.text.slice(m.offset, end).replace(/\s+/g, " ").trim();
    if (speakable.test(text)) out.push({ mark: m.name, text });
  });
  return out;
}

/** "en-GB", "en_gb" and "EN-gb" all become "en-gb". */
export const normalLang = (lang: string | null | undefined) => (lang ?? "").trim().replace(/_/g, "-").toLowerCase();

/** The main part of a language tag: "en" for "en-GB". Saved voices are kept per language. */
export const primaryLang = (lang: string | null | undefined) => normalLang(lang).split("-")[0];

export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
}

/**
 * The voice to read with: the one chosen for this language if it's still
 * there, otherwise the best match for the book's language, otherwise the
 * system's default.
 */
export function pickVoice<V extends VoiceLike>(voices: V[], chosen: Record<string, string>, bookLang: string | null): V | null {
  if (!voices.length) return null;
  const saved = chosen[primaryLang(bookLang)];
  const found = saved ? voices.find((v) => v.voiceURI === saved) : undefined;
  if (found) return found;
  const lang = normalLang(bookLang);
  if (lang) {
    const exact = voices.filter((v) => normalLang(v.lang) === lang);
    const close = voices.filter((v) => primaryLang(v.lang) === primaryLang(lang));
    // Voices on this device before ones that need the network.
    const best = (list: V[]) => list.find((v) => v.default) ?? list.find((v) => v.localService !== false) ?? list[0];
    const match = best(exact) ?? best(close);
    if (match) return match;
  }
  return voices.find((v) => v.default) ?? voices[0];
}

/** Voices for the book's language first, then the rest, each in name order. */
export function groupVoices<V extends VoiceLike>(voices: V[], bookLang: string | null): { matching: V[]; other: V[] } {
  const p = primaryLang(bookLang);
  const sorted = [...voices].sort((a, b) => a.name.localeCompare(b.name));
  if (!p) return { matching: [], other: sorted };
  return { matching: sorted.filter((v) => primaryLang(v.lang) === p), other: sorted.filter((v) => primaryLang(v.lang) !== p) };
}

export const RATE_RANGE = { min: 0.5, max: 2, step: 0.1 } as const;

export const formatRate = (rate: number) => `${Number(rate.toFixed(2))}×`;
