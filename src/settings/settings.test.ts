import { describe, expect, it } from "vitest";
import { adaptiveColors, DEFAULT_APP_SETTINGS, isDark, parseAppSettings } from "./appSettings";
import { searchSettings } from "./settingsIndex";

describe("app settings", () => {
  it("falls back to the defaults for anything missing or odd", () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings("not json")).toEqual(DEFAULT_APP_SETTINGS);
    const s = parseAppSettings(
      JSON.stringify({ theme: "purple", scale: "large", adaptiveStrength: 7, sync: { bookFiles: true, conflicts: "nope" } }),
    );
    expect(s.theme).toBe("system");
    expect(s.scale).toBe("large");
    expect(s.adaptiveStrength).toBe(1);
    expect(s.sync.bookFiles).toBe(true);
    expect(s.sync.conflicts).toBe("recent");
    expect(s.sync.progress).toBe(true);
  });

  it("sync starts with everything but book files, and the newest change wins", () => {
    const { sync } = DEFAULT_APP_SETTINGS;
    expect([sync.progress, sync.notes, sync.collections, sync.metadata, sync.bookFiles]).toEqual([true, true, true, true, false]);
    expect(sync.conflicts).toBe("recent");
    expect(DEFAULT_APP_SETTINGS.theme).not.toBe("adaptive");
  });

  it("works out light or dark", () => {
    expect(isDark({ theme: "dark", adaptiveBase: "system" }, false)).toBe(true);
    expect(isDark({ theme: "light", adaptiveBase: "system" }, true)).toBe(false);
    expect(isDark({ theme: "system", adaptiveBase: "light" }, true)).toBe(true);
    expect(isDark({ theme: "adaptive", adaptiveBase: "light" }, true)).toBe(false);
    expect(isDark({ theme: "adaptive", adaptiveBase: "system" }, true)).toBe(true);
  });

  it("makes an accent dark on light pages and light on dark ones", () => {
    const lightness = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
    };
    const onLight = adaptiveColors("#8a5a44", false, 1)!;
    const onDark = adaptiveColors("#8a5a44", true, 1)!;
    expect(lightness(onLight.accent)).toBeLessThan(0.4);
    expect(lightness(onDark.accent)).toBeGreaterThan(0.6);
    expect(adaptiveColors("not a colour", false, 1)).toBeNull();
  });

  it("finds settings by any of their words", () => {
    expect(searchSettings("backup").map((e) => e.section)).toContain("backup");
    expect(searchSettings("supabase")[0].tab).toBe("sync");
    expect(searchSettings("dark mode")[0].section).toBe("theme");
    expect(searchSettings("   ")).toEqual([]);
  });
});
