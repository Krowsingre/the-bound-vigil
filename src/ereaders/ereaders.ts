// What can go where when sending books to e-readers, and how to say it.
// The core checks again before anything is copied or sent; these are for
// showing it up front.

import type { BookPreview, Ereader, KindleEmailInput, MailSecurity } from "../api/types";

export const DESKTOP_ONLY = "Sending to e-readers works in the desktop app.";

/** What Amazon's Send to Kindle takes by email (it stopped taking MOBI in 2022). Mirrors ereaders/email.rs. */
export const EMAIL_FORMATS = ["epub", "pdf", "doc", "docx", "txt"];
export const EMAIL_LIMIT_MB = 50;

/** Where a book is going: a reader plugged in at `root`, or the Kindle by email. */
export type SendTarget = { kind: "cable"; reader: Ereader } | { kind: "email"; kindle: string };

/** Why this book can't go to this reader by cable, or null when it can. */
export function cableProblem(reader: Ereader, format: string): string | null {
  const f = format.toLowerCase();
  if (!reader.formats.length || reader.formats.includes(f)) return null;
  if (reader.kind === "kindle" && ["epub", "doc", "docx"].includes(f))
    return `Kindles can't open ${f === "epub" ? "EPUB books" : "Word documents"} copied by cable. Send it by email instead: Amazon turns it into a Kindle book for you.`;
  return `${reader.name} can't open ${f.toUpperCase()} books.`;
}

/** Why this book can't go by email, or null when it can. */
export function emailProblem(format: string): string | null {
  const f = format.toLowerCase();
  if (EMAIL_FORMATS.includes(f)) return null;
  if (["mobi", "azw", "azw3"].includes(f))
    return `Amazon no longer takes ${f.toUpperCase()} books by email. Copy it to your Kindle by cable instead.`;
  return `Amazon's Send to Kindle can't take ${f.toUpperCase()} books.`;
}

export function problemFor(target: SendTarget, book: Pick<BookPreview, "format">): string | null {
  return target.kind === "cable" ? cableProblem(target.reader, book.format) : emailProblem(book.format);
}

/** A short line under a choice in the Send dialog: how many of the books can't go, and why. */
export function targetNote(target: SendTarget, books: Pick<BookPreview, "format">[]): { text: string; blocked: boolean } {
  const problems = books.map((b) => problemFor(target, b)).filter((p): p is string => p !== null);
  const how = target.kind === "cable" ? `By cable · ${target.reader.root}` : `By email to ${target.kindle}`;
  if (!problems.length) return { text: how, blocked: false };
  if (books.length === 1) return { text: problems[0], blocked: true };
  const all = problems.length === books.length;
  return {
    text: all
      ? `None of these can go this way. ${problems[0]}`
      : `${how}. ${problems.length} of these can't go this way and will be skipped.`,
    blocked: all,
  };
}

/** The reader's name in a sentence: "your Kindle", "SDCARD". */
export function destination(target: SendTarget): string {
  if (target.kind === "email") return "your Kindle";
  return target.reader.kind === "other" ? target.reader.name : `your ${target.reader.name}`;
}

export type SendResult = { title: string } & (
  | { outcome: "sent" }
  | { outcome: "already" }
  | { outcome: "failed"; reason: string }
);

/** One toast for however many books went. */
export function summary(target: SendTarget, results: SendResult[]): string {
  const where = destination(target);
  const sent = results.filter((r) => r.outcome === "sent");
  const already = results.filter((r) => r.outcome === "already");
  const failed = results.filter((r): r is SendResult & { outcome: "failed"; reason: string } => r.outcome === "failed");
  const after =
    target.kind === "email"
      ? " It arrives once your Kindle is on Wi-Fi, usually within a few minutes."
      : " Eject it safely before you unplug it.";
  if (results.length === 1) {
    const [r] = results;
    if (r.outcome === "sent") return `${target.kind === "email" ? "Sent" : "Copied"} “${r.title}” to ${where}.${after}`;
    if (r.outcome === "already") return `“${r.title}” is already on ${where}.`;
    return `Couldn't send “${r.title}”: ${r.reason}`;
  }
  const books = (n: number) => `${n} ${n === 1 ? "book" : "books"}`;
  const parts: string[] = [];
  if (sent.length) parts.push(`${target.kind === "email" ? "Sent" : "Copied"} ${books(sent.length)} to ${where}.`);
  if (already.length) parts.push(`${books(already.length)} ${already.length === 1 ? "was" : "were"} already there.`);
  if (failed.length)
    parts.push(
      failed.length === 1
        ? `“${failed[0].title}” couldn't go: ${failed[0].reason}`
        : `${books(failed.length)} couldn't go. The first: ${failed[0].reason}`,
    );
  if (sent.length) parts.push(after.trim());
  return parts.join(" ");
}

/** Outgoing (SMTP) settings for the email services most people use. */
export const EMAIL_SERVICES: {
  id: string;
  label: string;
  server: string;
  port: number;
  security: MailSecurity;
  note?: string;
}[] = [
  {
    id: "gmail",
    label: "Gmail",
    server: "smtp.gmail.com",
    port: 587,
    security: "starttls",
    note: "Gmail needs an app password: Google Account › Security › App passwords.",
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    server: "smtp.mail.yahoo.com",
    port: 465,
    security: "ssl",
    note: "Yahoo needs an app password: Account Info › Account security.",
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    server: "smtp.mail.me.com",
    port: 587,
    security: "starttls",
    note: "iCloud needs an app-specific password: account.apple.com › Sign-In and Security.",
  },
];

/** Which service these settings are, or "other". */
export function serviceOf(server: string): string {
  return EMAIL_SERVICES.find((s) => s.server === server.trim().toLowerCase())?.id ?? "other";
}

/** The usual port for each kind of secure connection. */
export function usualPort(security: MailSecurity): number {
  return security === "ssl" ? 465 : 587;
}

/** What's still missing before the settings can be saved, or null. The core checks the same things. */
export function missingField(draft: KindleEmailInput, hasPassword: boolean): string | null {
  const address = (a: string) => /^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(a.trim());
  if (!address(draft.kindle) || !/@kindle\.(com|cn)$/i.test(draft.kindle.trim()))
    return "Your Kindle's address ends in @kindle.com.";
  if (!address(draft.from)) return "Type the email address you send from.";
  if (!draft.server.trim()) return "Type your email service's outgoing server.";
  if (!(draft.port > 0 && draft.port < 65536)) return "Type the outgoing server's port, usually 587 or 465.";
  if (!draft.username.trim()) return "Type the username for your email account.";
  if (!draft.password && !hasPassword) return "Type the password for your email account.";
  return null;
}
