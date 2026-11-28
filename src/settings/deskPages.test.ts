import { deskPageOf } from "./Settings";

it("puts the phone's pages on the computer's", () => {
  expect(deskPageOf("collections").label).toBe("Library");
  expect(deskPageOf("activity").label).toBe("Activity");
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
  // Same section name, other pages: Discover's history is on Web Security.
  expect(deskPageOf("browser", "history").label).toBe("Web Security");
});

it("splits Discover and Sync & Backup, and brings About back (embre, 28 November)", () => {
  expect(deskPageOf("browser").label).toBe("Nexus");
  expect(deskPageOf("browser", "downloads").label).toBe("Nexus");
  expect(deskPageOf("browser", "protection").label).toBe("Web Security");
  expect(deskPageOf("browser", "sites").label).toBe("Web Security");
  expect(deskPageOf("sync").label).toBe("Sync");
  expect(deskPageOf("sync", "options").label).toBe("Sync");
  expect(deskPageOf("sync", "move").label).toBe("Storage & Backup");
  expect(deskPageOf("sync", "backup").label).toBe("Storage & Backup");
  expect(deskPageOf("sync", "contents").label).toBe("Storage & Backup");
  expect(deskPageOf("about").label).toBe("About");
  expect(deskPageOf("advanced", "reset").label).toBe("About");
});

it("has no You & TBV page on the computer (embre, 27 November)", () => {
  for (const tab of ["plan", "about", "advanced"] as const) expect(deskPageOf(tab).label).not.toBe("You & TBV");
});
