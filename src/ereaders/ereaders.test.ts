import { describe, expect, it } from "vitest";
import type { Ereader, KindleEmailInput } from "../api/types";
import { cableProblem, emailProblem, missingField, serviceOf, summary, targetNote, usualPort, type SendTarget } from "./ereaders";

const kindle: Ereader = {
  kind: "kindle",
  name: "Kindle",
  root: "E:\\",
  booksFolder: "E:\\documents",
  formats: ["mobi", "azw", "azw3", "pdf", "txt"],
};
const drive: Ereader = {
  kind: "other",
  name: "SDCARD",
  root: "/media/me/SDCARD",
  booksFolder: "/media/me/SDCARD/Books",
  formats: [],
};
const byCable: SendTarget = { kind: "cable", reader: kindle };
const byEmail: SendTarget = { kind: "email", kindle: "me@kindle.com" };

describe("what can go where", () => {
  it("sends EPUB to a Kindle by email, not by cable", () => {
    expect(cableProblem(kindle, "epub")).toContain("by email");
    expect(cableProblem(kindle, "AZW3")).toBeNull();
    expect(emailProblem("epub")).toBeNull();
    expect(emailProblem("mobi")).toContain("by cable");
    expect(emailProblem("cbz")).toContain("CBZ");
  });

  it("lets any book go to a drive TBV can't be sure about", () => {
    expect(cableProblem(drive, "fb2")).toBeNull();
  });

  it("says under each choice how many books can't go", () => {
    expect(targetNote(byCable, [{ format: "azw3" }])).toEqual({ text: "By cable · E:\\", blocked: false });
    expect(targetNote(byCable, [{ format: "epub" }]).blocked).toBe(true);
    const mixed = targetNote(byCable, [{ format: "epub" }, { format: "pdf" }]);
    expect(mixed.blocked).toBe(false);
    expect(mixed.text).toContain("1 of these");
    expect(targetNote(byCable, [{ format: "epub" }, { format: "epub" }]).blocked).toBe(true);
    expect(targetNote(byEmail, [{ format: "epub" }]).text).toBe("By email to me@kindle.com");
  });
});

describe("telling how it went", () => {
  it("speaks of one book by name", () => {
    expect(summary(byCable, [{ title: "Carmilla", outcome: "sent" }])).toMatch(/^Copied “Carmilla” to your Kindle\. Eject/);
    expect(summary(byEmail, [{ title: "Carmilla", outcome: "sent" }])).toMatch(/^Sent “Carmilla” to your Kindle\. It arrives/);
    expect(summary(byCable, [{ title: "Carmilla", outcome: "already" }])).toBe("“Carmilla” is already on your Kindle.");
    expect(summary({ kind: "cable", reader: drive }, [{ title: "Carmilla", outcome: "failed", reason: "It's full." }])).toBe(
      "Couldn't send “Carmilla”: It's full.",
    );
  });

  it("counts many books", () => {
    const text = summary(byCable, [
      { title: "A", outcome: "sent" },
      { title: "B", outcome: "sent" },
      { title: "C", outcome: "already" },
      { title: "D", outcome: "failed", reason: "Kindles can't open EPUB books." },
    ]);
    expect(text).toContain("Copied 2 books to your Kindle.");
    expect(text).toContain("1 book was already there.");
    expect(text).toContain("“D” couldn't go: Kindles can't open EPUB books.");
  });
});

describe("Kindle email settings", () => {
  const draft: KindleEmailInput = {
    server: "smtp.gmail.com",
    port: 587,
    security: "starttls",
    username: "me@gmail.com",
    password: "app password",
    from: "me@gmail.com",
    kindle: "me_1@kindle.com",
  };

  it("says what's still missing", () => {
    expect(missingField(draft, false)).toBeNull();
    expect(missingField({ ...draft, kindle: "me@gmail.com" }, false)).toContain("@kindle.com");
    expect(missingField({ ...draft, from: "me" }, false)).toContain("send from");
    expect(missingField({ ...draft, port: 0 }, false)).toContain("port");
    expect(missingField({ ...draft, password: null }, false)).toContain("password");
    // A password saved before is kept.
    expect(missingField({ ...draft, password: null }, true)).toBeNull();
  });

  it("knows the usual services and ports", () => {
    expect(serviceOf("smtp.gmail.com")).toBe("gmail");
    expect(serviceOf(" SMTP.mail.me.com ")).toBe("icloud");
    expect(serviceOf("mail.example.org")).toBe("other");
    expect(usualPort("ssl")).toBe(465);
    expect(usualPort("starttls")).toBe(587);
  });
});
