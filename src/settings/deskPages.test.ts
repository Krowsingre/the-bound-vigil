import { deskPageOf } from "./Settings";

it("puts the phone's sixteen pages on the computer's eight", () => {
  expect(deskPageOf("plan").label).toBe("You & TBV");
  expect(deskPageOf("advanced").label).toBe("You & TBV");
  expect(deskPageOf("collections").label).toBe("Library");
  expect(deskPageOf("activity").label).toBe("Sync & Backup");
  expect(deskPageOf("shortcuts").label).toBe("Accessibility");
  // Sections that moved: Goodreads and Canva are under Connections.
  expect(deskPageOf("library", "goodreads").label).toBe("Connections");
  expect(deskPageOf("notes", "canva").label).toBe("Connections");
  expect(deskPageOf("library", "tags").label).toBe("Library");
});

it("puts Account first, without moving anything off the older pages (embre, 27 November)", () => {
  expect(deskPageOf("account").label).toBe("Account");
  expect(deskPageOf("profile").label).toBe("You & TBV");
});
