import { appLinkAsk } from "./Browser";
import { desktopHosts, readBrowserPrefs, resetSite, setSiteSettings, sitesWithSettings, lowerFor } from "./browserPrefs";

beforeEach(() => localStorage.clear());

test("a site's own choices are kept, and forgotten once back to normal", () => {
  setSiteSettings("example.org", { zoom: 1.25, desktop: true });
  expect(readBrowserPrefs().sites["example.org"]).toEqual({ zoom: 1.25, desktop: true });
  expect(desktopHosts()).toEqual(["example.org", "www.example.org"]);
  setSiteSettings("example.org", { zoom: 1, desktop: false });
  expect(readBrowserPrefs().sites).toEqual({});
});

test("reset puts protection back too", () => {
  lowerFor("a.org", true);
  setSiteSettings("b.org", { zoom: 0.8 });
  expect(sitesWithSettings()).toEqual(["a.org", "b.org"]);
  resetSite("a.org");
  expect(readBrowserPrefs().lowered).toEqual([]);
  expect(sitesWithSettings()).toEqual(["b.org"]);
});

test("links for other apps say what they'll do", () => {
  expect(appLinkAsk("mailto:someone@example.org?subject=Hi")).toBe("This page wants to open your mail app to write to someone@example.org.");
  expect(appLinkAsk("tel:+15551234")).toBe("This page wants to call +15551234.");
  expect(appLinkAsk("zoommtg://join")).toBe('This page wants to open another app with a "zoommtg:" link.');
});
