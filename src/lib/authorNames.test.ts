import { afterEach, describe, expect, it } from "vitest";
import { authorName, firstLast, lastFirst, personKey, setAuthorStyle } from "./authorNames";
import { authorLine } from "./format";

afterEach(() => setAuthorStyle("asBook"));

describe("author names", () => {
  it("turns names round either way", () => {
    expect(firstLast("Primo, Jaz")).toBe("Jaz Primo");
    expect(firstLast("King, Martin Luther, Jr.")).toBe("Martin Luther King Jr.");
    expect(firstLast("Jaz Primo")).toBe("Jaz Primo");
    expect(lastFirst("Jaz Primo")).toBe("Primo, Jaz");
    expect(lastFirst("Ursula K. Le Guin")).toBe("Le Guin, Ursula K.");
    expect(lastFirst("Ludwig van Beethoven")).toBe("van Beethoven, Ludwig");
    expect(lastFirst("Homer")).toBe("Homer");
    expect(lastFirst("The Ash Choir")).toBe("The Ash Choir");
    expect(lastFirst("Primo, Jaz")).toBe("Primo, Jaz");
  });

  it("counts both spellings as one person", () => {
    expect(personKey("Primo, Jaz")).toBe(personKey("Jaz Primo"));
    expect(personKey("Le Guin, Ursula K.")).toBe(personKey("Ursula K Le Guin"));
  });

  it("follows the choice in Preferences, and leaves music artists alone", () => {
    expect(authorLine(["Primo, Jaz"])).toBe("Primo, Jaz");
    setAuthorStyle("firstLast");
    expect(authorLine(["Primo, Jaz", "Ann Lee"])).toBe("Jaz Primo & Ann Lee");
    setAuthorStyle("lastFirst");
    expect(authorLine(["Jaz Primo"])).toBe("Primo, Jaz");
    expect(authorName("Ash Choir", "music")).toBe("Ash Choir");
  });
});
