import { deskPageOf } from "./Settings";

it("puts the phone's pages on the computer's", () => {
  expect(deskPageOf("collections").label).toBe("Library");
  expect(deskPageOf("activity").label).toBe("Sync & Backup");
  expect(deskPageOf("shortcuts").label).toBe("Accessibility");
  // Sections that moved: Goodreads and Canva are under Connections.
  expect(deskPageOf("library", "goodreads").label).toBe("Connections");
  expect(deskPageOf("notes", "canva").label).toBe("Connections");
});

it("splits Library and Management, and moves Visage to Account (embre, 27 November)", () => {
  expect(deskPageOf("account").label).toBe("Account");
  expect(deskPageOf("profile").label).toBe("Account");
  expect(deskPageOf("profile", "oathkin").label).toBe("Account");
  expect(deskPageOf("library", "tags").label).toBe("Management");
  expect(deskPageOf("notes", "view").label).toBe("Management");
  expect(deskPageOf("files", "formats").label).toBe("Management");
  expect(deskPageOf("appearance", "privacy").label).toBe("Library");
  expect(deskPageOf("appearance", "sanctum").label).toBe("Library");
  expect(deskPageOf("reading", "read-along").label).toBe("Library");
  // Same section name, other pages: Discover's history stays in Discover.
  expect(deskPageOf("browser", "history").label).toBe("Discover");
});

it("has no You & TBV page on the computer (embre, 27 November)", () => {
  for (const tab of ["plan", "about", "advanced"] as const) expect(deskPageOf(tab).label).not.toBe("You & TBV");
});
