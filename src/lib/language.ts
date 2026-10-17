// Languages as books spell them ("en-US", "eng", "English") turned into one
// short code each, the same way the core's `language_code` does, and back
// into a name for menus.

const CODES: Record<string, string> = {
  eng: "en", english: "en",
  fre: "fr", fra: "fr", french: "fr", français: "fr", francais: "fr",
  ger: "de", deu: "de", german: "de", deutsch: "de",
  spa: "es", spanish: "es", español: "es", espanol: "es",
  ita: "it", italian: "it", italiano: "it",
  por: "pt", portuguese: "pt", português: "pt", portugues: "pt",
  dut: "nl", nld: "nl", dutch: "nl", nederlands: "nl",
  rus: "ru", russian: "ru",
  jpn: "ja", japanese: "ja",
  chi: "zh", zho: "zh", chinese: "zh",
  kor: "ko", korean: "ko",
  ara: "ar", arabic: "ar",
  pol: "pl", polish: "pl", polski: "pl",
  swe: "sv", swedish: "sv", svenska: "sv",
  dan: "da", danish: "da", dansk: "da",
  nor: "no", nob: "no", norwegian: "no", norsk: "no",
  fin: "fi", finnish: "fi", suomi: "fi",
  gre: "el", ell: "el", greek: "el",
  tur: "tr", turkish: "tr",
  heb: "he", hebrew: "he",
  hin: "hi", hindi: "hi",
  lat: "la", latin: "la",
};
const NONE = new Set(["und", "unknown", "mul", "zxx"]);

export function languageCode(raw: string | null | undefined): string | null {
  const first = (raw ?? "").trim().toLowerCase().split(/[-_ ,;]/).find(Boolean);
  if (!first || NONE.has(first)) return null;
  return CODES[first] ?? first;
}

let names: Intl.DisplayNames | null | undefined;

/** "en" → "English". Falls back to the code itself. */
export function languageName(code: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["en"], { type: "language" });
    } catch {
      names = null;
    }
  }
  try {
    const name = names?.of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {
    /* not a code it knows */
  }
  return code.toUpperCase();
}
