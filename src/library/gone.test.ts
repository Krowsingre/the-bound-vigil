import { describe, expect, it } from "vitest";
import { gone } from "./Library";
import { NO_FILTERS, NO_EXCLUDE, type LibraryView } from "./libraryView";

const view = (change: Partial<LibraryView>): LibraryView => ({ ...(NO_FILTERS as LibraryView), ...change });
const page = { formats: ["epub"], tags: ["Gothic"], genres: ["Horror", "Science fiction"], languages: ["en"] };

describe("filters on names the library no longer has", () => {
  it("drops them, shown or hidden, and keeps the rest", () => {
    const change = gone(view({ genres: ["horror", "Westerns"], exclude: { ...NO_EXCLUDE, tags: ["Gothic", "Old tag"] } }), page);
    expect(change?.genres).toEqual(["horror"]);
    expect(change?.exclude?.tags).toEqual(["Gothic"]);
  });

  it("changes nothing when every name is still there", () => {
    expect(gone(view({ genres: ["Horror"], formats: ["epub"] }), page)).toBeNull();
  });
});
