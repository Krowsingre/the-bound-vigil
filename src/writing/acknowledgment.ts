// The confirmation every manuscript import into Scribe asks for (embre's
// spec, 31 October 2026, section 6). The words are shown exactly as here,
// and the signed record keeps the SHA-256 of WORDING, so the version agreed
// to can always be told afterwards. Change a word and POLICY_VERSION goes up.
// Books brought into the Archive to read don't ask: only Scribe imports do.

export const POLICY_VERSION = "1";

export const ACK_TITLE = "Content Ownership & Usage Acknowledgment";

export const ACK_PARAGRAPHS = [
  "This feature is intended exclusively to help authors, publishers, and other authorized rights holders import, reconstruct, edit, reformat, publish, or republish content they own or have the legal right to use.",
  "Users must not import, reproduce, modify, or redistribute copyrighted works without the necessary rights or permissions.",
  "Users are solely responsible for ensuring that their use of this feature complies with applicable copyright laws, licensing agreements, distribution agreements, and third-party terms of service.",
  "Krowsingre Publishing LLC does not authorize or endorse copyright infringement, unauthorized reproduction, or unlawful distribution of protected materials.",
  "To the fullest extent permitted by applicable law, Krowsingre Publishing LLC disclaims liability for unauthorized, unlawful, or otherwise improper use of this feature by users.",
];

export const ACK_CONFIRMATION =
  "I confirm that I own this content or have the necessary rights and permissions to import, edit, and republish it. I accept responsibility for my use of this feature.";

/** Everything the person is shown and agrees to, in order: what the record's wordingSha256 is the SHA-256 of. */
export const WORDING = [ACK_TITLE, ...ACK_PARAGRAPHS, ACK_CONFIRMATION].join("\n\n");

/** A file's SHA-256, in hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}
