import { describe, expect, it } from "vitest";
import { linkEditions } from "./LinkBooks";
const book = (id, edition) => ({
    id,
    createdAt: "2025-01-01T00:00:00Z",
    export: edition ? JSON.stringify({ edition: { year: "2025", note: "", isbns: {}, earlier: [], name: edition.name ?? "", ...edition } }) : null,
});
describe("linking two books", () => {
    it("puts the other book after this one", () => {
        const a = book("a");
        const b = book("b");
        const plan = linkEditions(a, b, [a, b], "after");
        expect(plan.get("a").number).toBe(1);
        expect(plan.get("b").number).toBe(2);
        expect(plan.get("b").name).toBe("Second edition");
        expect(plan.get("a").group).toBe(plan.get("b").group);
    });
    it("brings the other book's own editions along, before this one", () => {
        const a = book("a", { group: "g1", number: 1 });
        const b1 = book("b1", { group: "g2", number: 1 });
        const b2 = book("b2", { group: "g2", number: 2, name: "Revised" });
        const plan = linkEditions(a, b2, [a, b1, b2], "before");
        expect([...plan.entries()].map(([id, e]) => [id, e.number, e.group])).toEqual([
            ["b1", 1, "g1"],
            ["b2", 2, "g1"],
            ["a", 3, "g1"],
        ]);
        expect(plan.get("b2").name).toBe("Revised");
        expect(plan.get("a").name).toBe("Third edition");
    });
    it("changes nothing for books already linked", () => {
        const a = book("a", { group: "g", number: 1 });
        const b = book("b", { group: "g", number: 2 });
        const plan = linkEditions(a, b, [a, b], "before");
        expect(plan.get("a").number).toBe(1);
        expect(plan.get("b").number).toBe(2);
    });
});
