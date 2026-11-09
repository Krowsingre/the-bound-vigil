// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { describeStructuredContent } from "./structuredContent";

const parse = (html: string) => describeStructuredContent(new DOMParser().parseFromString(html, "text/html").body.firstElementChild!);

describe("structured reader snapshots", () => {
  it("preserves table semantics and takes only inert text from cells", () => {
    const table = parse('<table><caption>Results</caption><tr><th id="total" scope="col" colspan="2">Total</th></tr><tr><td headers="total" rowspan="0"><a href="https://example.com">42</a><script>unsafe()</script><img src="remote"></td></tr></table>');
    expect(table).toMatchObject({
      kind: "table", label: "Results",
      table: { children: [
        { tag: "caption", text: "Results" },
        { tag: "tbody", children: [
          { children: [{ tag: "th", id: "total", scope: "col", colSpan: 2, text: "Total" }] },
          { children: [{ tag: "td", headers: "total", rowSpan: 0, text: "42" }] },
        ] },
      ] },
    });
    expect(JSON.stringify(table)).not.toMatch(/https|unsafe|remote/);
  });

  it("preserves whitespace in preformatted text", () => {
    expect(parse("<pre> A &lt; B\n   C</pre>")).toMatchObject({ kind: "pre", text: " A < B\n   C" });
  });

  it("leaves unsupported and oversized elements in the ordinary reader", () => {
    expect(parse("<table><tr><td><table><tr><td>Nested</td></tr></table></td></tr></table>")).toBeNull();
    expect(parse("<table><tr><td colspan='999'>Wide</td></tr></table>")).toBeNull();
    expect(parse("<pre>" + "x".repeat(64_001) + "</pre>")).toBeNull();
    expect(parse("<figure><img src='figure.png'></figure>")).toBeNull();
  });
});
