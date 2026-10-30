// The app adds a hash to its security rules for every inline <style> in its
// pages. With a hash there, the rules block all other <style> elements, and
// the reader lays out its pages with those: one inline style in index.html
// left books blank on the computer and stuck on the iPhone (1.34 and 1.35).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TBV's own pages", () => {
  for (const page of ["index.html", "splash.html", "print.html"]) {
    it(`${page} keeps its styles and scripts in files`, () => {
      const html = readFileSync(page, "utf8").replace(/<!--[\s\S]*?-->/g, "");
      expect(html).not.toMatch(/<style[\s>]/i);
      expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    });
  }
});
