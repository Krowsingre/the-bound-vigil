import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "./extensions";
import { describe, expect, it } from "vitest";
import { citationLabel, citationProblems, citedIds, emptySource, makeCiter, readSources } from "./sources";
const morrison = { ...emptySource("s1"), title: "Beloved", authors: "Morrison, Toni", publisher: "Knopf", place: "New York", date: "1987" };
const article = {
    ...emptySource("s2", "article-journal"),
    title: "The poetics of space",
    authors: "Lee, Ana\nOkafor, Chidi",
    container: "Journal of Verse",
    volume: "12",
    issue: "3",
    pages: "45-67",
    date: "2021-05",
};
const chapter = (body) => ({ id: "c1", body });
const cites = chapter('<p>One <cite data-source="s2" data-locator="50">x</cite> and <cite data-source="s1" data-locator="">y</cite>.</p>');
describe("sources and citations", () => {
    it("finds what's cited, in order, and labels it in the editor", () => {
        expect(citedIds([cites])).toEqual(["s2", "s1"]);
        expect(citationLabel(morrison, "12")).toBe("(Morrison 1987, p. 12)");
        expect(readSources([{ id: "a", type: "nope", title: 5 }, null])).toEqual([{ ...emptySource("a"), title: "" }]);
    });
    it("writes APA in the text and in the list", async () => {
        const citer = (await makeCiter("apa", [morrison, article], [cites]));
        expect(citer.cite("s1", "12").text).toBe("(Morrison, 1987, p. 12)");
        expect(citer.cite("s2", "").text).toBe("(Lee &#38; Okafor, 2021)");
        const list = citer.bibliography();
        expect(list[0].html).toContain("Lee, A., &#38; Okafor, C. (2021). The poetics of space. <i>Journal of Verse</i>, <i>12</i>(3), 45–67.");
        expect(list[1].html).toContain("Morrison, T. (1987). <i>Beloved</i>. Knopf.");
    });
    it("numbers IEEE by first citation, and puts Chicago notes in footnotes", async () => {
        const ieee = (await makeCiter("ieee", [morrison, article], [cites]));
        expect(ieee.cite("s2", "").text).toBe("[1]");
        expect(ieee.cite("s1", "").text).toBe("[2]");
        const chicago = (await makeCiter("chicago-notes", [morrison, article], [cites]));
        // With a bibliography at the back, Chicago's notes are the short form.
        expect(chicago.cite("s2", "50").note).toBe("Lee and Okafor, “The Poetics of Space,” 50.");
        expect(chicago.cite("s1", "").note).toBe("Morrison, <i>Beloved</i>.");
        chicago.restart();
        expect(chicago.cite("s2", "50").note).toBe("Lee and Okafor, “The Poetics of Space,” 50.");
        expect(chicago.bibliography()[1].html).toContain("Morrison, Toni. <i>Beloved</i>. New York: Knopf, 1987.");
    });
    it("renumbers by first appearance and keeps the source ID across repeated citations", async () => {
        const earlier = chapter("<p>Manual [12] <cite data-source='s1'>old label</cite></p>");
        const sources = [morrison, article, emptySource("unused")];
        const first = (await makeCiter("numbered", sources, [earlier, cites]));
        expect(first.cite("s1", "")).toMatchObject({ text: "[1]", reference: 1 });
        expect(first.cite("s2", "50")).toMatchObject({ text: "[2]", reference: 2, locator: "50" });
        expect(first.cite("s1", "7").text).toBe("[1]");
        expect(first.bibliography()).toHaveLength(2);
        expect(first.bibliography()[0].html).toContain("Beloved");
        const reordered = (await makeCiter("numbered", sources, [cites, earlier]));
        expect(reordered.cite("s1", "").text).toBe("[2]");
        expect(reordered.bibliography()[0].html).toContain("The poetics of space");
        const removed = (await makeCiter("numbered", sources, [earlier]));
        expect(removed.bibliography()).toHaveLength(1);
        expect(removed.cite("s1", "").text).toBe("[1]");
    });
    it("updates editor numbers after changes without storing the displayed numbers", () => {
        let previous = ["s1"];
        const known = new Set(["s1", "s2"]);
        const editor = new Editor({
            extensions: [StarterKit, Citation.configure({ numbering: () => ({ previous, known }) })],
            content: '<p><cite data-source="s2">saved label</cite></p>',
        });
        try {
            expect(editor.view.dom.textContent).toBe("[2]");
            previous = [];
            editor.view.dispatch(editor.state.tr);
            expect(editor.view.dom.textContent).toBe("[1]");
            expect(editor.getHTML()).toContain("saved label");
            expect(editor.getHTML()).not.toContain("[1]");
            known.delete("s2");
            editor.view.dispatch(editor.state.tr);
            expect(editor.view.dom.textContent).toBe("(source removed)");
        }
        finally {
            editor.destroy();
        }
    });
    it("reports duplicate IDs and broken managed citations while ignoring typed brackets", () => {
        expect(citationProblems([morrison, morrison], [{ ...cites, title: "First" }])).toEqual([
            "Sources contain a missing or duplicate internal ID.",
            "Restore or replace the missing source cited in “First”.",
        ]);
        expect(citationProblems([], [chapter("<p>Manual [12]</p><!-- <cite data-source='fake'> -->")])).toEqual([]);
    });
    it.each(["numbered", "apa", "ap", "ieee", "bluebook"])("includes manually added uncited sources in a %s bibliography", async (style) => {
        const bibliography = { ...chapter(""), role: "back", page: '{"kind":"sources"}' };
        const extra = { ...article, includeInBibliography: true };
        const sources = readSources([morrison, extra, emptySource("unused")]);
        const cited = chapter('<p><cite data-source="s1">x</cite></p>');
        const citer = (await makeCiter(style, sources, [cited, bibliography]));
        expect(citer.bibliography().map((entry) => entry.sourceId).sort()).toEqual(["s1", "s2"]);
        const onlyAdditional = (await makeCiter(style, sources, [bibliography]));
        expect(onlyAdditional.bibliography().map((entry) => entry.sourceId)).toEqual(["s2"]);
        const withoutPage = (await makeCiter(style, sources, [cited]));
        expect(withoutPage.bibliography().map((entry) => entry.sourceId)).toEqual(style === "bluebook" ? [] : ["s1"]);
    });
    it("applies a custom format to every entry and escapes template and source text", async () => {
        const sources = [{ ...morrison, title: "<Beloved>" }, article];
        const citer = (await makeCiter("custom", sources, [cites], "{title} — {date} <end>"));
        expect(citer.bibliography().map((entry) => entry.html)).toEqual([
            "[1] The poetics of space — 2021-05 &lt;end&gt;",
            "[2] &lt;Beloved&gt; — 1987 &lt;end&gt;",
        ]);
        expect(citer.cite("s1", "").text).toBe("[2]");
    });
    it("has nothing to do when nothing is cited", async () => {
        expect(await makeCiter("mla", [morrison], [chapter("<p>none</p>")])).toBeNull();
    });
});
