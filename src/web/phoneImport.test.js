import { formatOf, PhoneImports, sha256Hex, textOf, titleFromName } from "./phoneImport";
describe("adding books on the phone", () => {
    it("reads names the way foliate-js gives them", () => {
        expect(textOf("Dracula")).toBe("Dracula");
        expect(textOf({ en: "Carmilla", de: "Carmilla (de)" })).toBe("Carmilla");
        expect(textOf([{ name: "Bram Stoker" }])).toBe("Bram Stoker");
        expect(textOf({ name: { en: "Mary Shelley" } })).toBe("Mary Shelley");
        expect(textOf("  ")).toBeNull();
        expect(titleFromName("the_vampyre.EPUB")).toBe("the vampyre");
        expect(formatOf("Book.AZW3")).toBe("azw3");
    });
    it("works out the same id as the computer", async () => {
        // sha256 of "abc".
        expect(await sha256Hex(new TextEncoder().encode("abc").buffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });
    it("adds books one at a time and skips files that aren't books", async () => {
        const added = [];
        let release = () => undefined;
        const imports = new PhoneImports(async (file) => {
            added.push(file.name);
            if (added.length === 1)
                await new Promise((done) => (release = done));
            return { outcome: "imported", path: file.name, bookId: `sha256:${file.name}`, title: file.name };
        });
        const keys = ["a.epub", "cover.jpg", "b.pdf"].map((name) => {
            const key = `phone:${name}`;
            imports.picked.set(key, new File(["x"], name));
            return key;
        });
        expect(imports.queue(keys)).toBe(2);
        await Promise.resolve();
        expect(added).toEqual(["a.epub"]);
        expect(imports.view().current.length).toBe(1);
        release();
        await new Promise((done) => setTimeout(done, 0));
        await new Promise((done) => setTimeout(done, 0));
        expect(added).toEqual(["a.epub", "b.pdf"]);
        expect(imports.view()).toMatchObject({ total: 2, done: 2, added: 2 });
        imports.clearFinished();
        expect(imports.view().total).toBe(0);
    });
});
