import { articleByline, articleFrom, cleanArticle } from "./readerArticle";

test("an article's HTML keeps words, links and web pictures, and nothing that runs", () => {
  const html = cleanArticle(
    '<p onclick="x()" style="color:red">Hello <a href="https://example.com/a">there</a> <a href="javascript:alert(1)">bad</a></p>' +
      '<script>alert(1)</script><iframe src="https://x"></iframe><img src="https://example.com/p.jpg" alt="A"><img src="data:image/png;base64,AA">',
  );
  expect(html).toBe('<p>Hello <a href="https://example.com/a">there</a> <a>bad</a></p><img src="https://example.com/p.jpg" alt="A">');
});

test("a page's answer becomes an article only when it has one", () => {
  expect(articleFrom(null)).toBeNull();
  expect(articleFrom({ error: "no" })).toBeNull();
  expect(articleFrom({ content: "  ", url: "https://a.org" })).toBeNull();
  const found = articleFrom({ title: " ", content: "<p>Words</p>", url: "https://www.a.org/x", lang: "en-GB", byline: "Ann" });
  expect(found).toMatchObject({ title: "Untitled article", lang: "en-GB", byline: "Ann", siteName: null });
  expect(articleByline(found!)).toBe("Ann · a.org");
});
