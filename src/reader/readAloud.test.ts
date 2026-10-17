import { describe, expect, it } from "vitest";
import { formatRate, groupVoices, normalLang, pickVoice, primaryLang, sentencesOf, ssmlToText, type VoiceLike } from "./readAloud";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

const SSML = `<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><mark name="0"/>The rain had stopped. <mark name="1"/>She <emphasis>waited</emphasis>,<break/>listening. <mark name="2"/>* * * <mark name="3"/>Then &amp; only then, <lang xml:lang="fr">voilà</lang>.</speak>`;

describe("read aloud text", () => {
  it("turns SSML into text with the marks' offsets", () => {
    const block = ssmlToText(SSML);
    expect(block.lang).toBe("en-GB");
    expect(block.text).toBe("The rain had stopped. She waited, listening. * * * Then & only then, voilà.");
    expect(block.marks).toEqual([
      { name: "0", offset: 0 },
      { name: "1", offset: 22 },
      { name: "2", offset: 45 },
      { name: "3", offset: 51 },
    ]);
    expect(block.text.slice(22, 45)).toBe("She waited, listening. ");
  });

  it("cuts the text into sentences, skipping ones with nothing to say", () => {
    expect(sentencesOf(ssmlToText(SSML))).toEqual([
      { mark: "0", text: "The rain had stopped." },
      { mark: "1", text: "She waited, listening." },
      { mark: "3", text: "Then & only then, voilà." },
    ]);
  });

  it("starts at the first mark when the engine trimmed the block to the page", () => {
    const block = ssmlToText(`<speak xmlns="http://www.w3.org/2001/10/synthesis"><p>  <mark name="4"/>Last   one.\n</p></speak>`);
    expect(block.lang).toBeNull();
    expect(sentencesOf(block)).toEqual([{ mark: "4", text: "Last one." }]);
  });

  it("copes with SSML it can't read", () => {
    expect(ssmlToText("<speak><mark")).toEqual({ text: "", marks: [], lang: null });
    expect(sentencesOf(ssmlToText("<speak xmlns='http://www.w3.org/2001/10/synthesis'>No marks.</speak>"))).toEqual([]);
  });
});

const voice = (name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({ voiceURI: `uri:${name}`, name, lang, ...extra });

describe("choosing a voice", () => {
  const george = voice("George", "en-GB");
  const zira = voice("Zira", "en-US", { default: true });
  const online = voice("Online", "en-GB", { localService: false });
  const hortense = voice("Hortense", "fr_FR");
  const voices = [zira, online, george, hortense];

  it("reads language tags written either way", () => {
    expect(normalLang("en_GB")).toBe("en-gb");
    expect(primaryLang("EN-gb")).toBe("en");
    expect(primaryLang(null)).toBe("");
  });

  it("keeps the voice chosen for the book's language", () => {
    expect(pickVoice(voices, { en: "uri:Zira" }, "en-GB")).toBe(zira);
    // A choice for another language, or a voice that has gone, is passed over.
    expect(pickVoice(voices, { fr: "uri:Hortense" }, "en-GB")).toBe(george);
    expect(pickVoice(voices, { en: "uri:Gone" }, "en-GB")).toBe(george);
  });

  it("matches the book's language, preferring voices on this device", () => {
    expect(pickVoice(voices, {}, "en-GB")).toBe(george);
    expect(pickVoice(voices, {}, "en-AU")).toBe(zira);
    expect(pickVoice(voices, {}, "fr")).toBe(hortense);
    expect(pickVoice([online, zira], {}, "en-GB")).toBe(online);
  });

  it("falls back to the default voice", () => {
    expect(pickVoice(voices, {}, "de")).toBe(zira);
    expect(pickVoice(voices, {}, null)).toBe(zira);
    expect(pickVoice([george, hortense], {}, "ja")).toBe(george);
    expect(pickVoice([], {}, "en")).toBeNull();
  });

  it("lists the book's language first", () => {
    const { matching, other } = groupVoices(voices, "en-US");
    expect(matching.map((v) => v.name)).toEqual(["George", "Online", "Zira"]);
    expect(other.map((v) => v.name)).toEqual(["Hortense"]);
    expect(groupVoices(voices, null).matching).toEqual([]);
  });

  it("writes speeds plainly", () => {
    expect(formatRate(1)).toBe("1×");
    expect(formatRate(1.25)).toBe("1.25×");
    expect(formatRate(0.7000000001)).toBe("0.7×");
  });
});

describe("read aloud settings", () => {
  it("keeps the voice and speed, within limits", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings(JSON.stringify({ voices: { en: "uri:George", fr: 3 }, rate: 1.333 }));
    expect(s.voices).toEqual({ en: "uri:George" });
    expect(s.rate).toBe(1.33);
    expect(parseSettings(JSON.stringify({ rate: 9, voices: ["x"] }))).toMatchObject({ rate: 2, voices: {} });
    expect(parseSettings(JSON.stringify({ rate: "fast" })).rate).toBe(1);
  });
});
