// The phone version served by TBV on the computer, at home on the same
// Wi-Fi. The pages are the computer's own; each request the desktop app
// would make inside TBV goes to the computer over the network instead.

const KEY = "tbv.homeKey";

export function homeKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setHomeKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {
    /* pairs again next time */
  }
}

/** Pairs this phone with the code TBV shows on the computer. */
export async function pairHome(code: string): Promise<void> {
  const answer = await fetch("/tbv/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim() }),
  });
  const reply = (await answer.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!answer.ok || !reply.key) throw new Error(reply.error ?? "The computer didn't answer. Is TBV open there?");
  setHomeKey(reply.key);
}

/** Stands in for Tauri's `invoke` and `convertFileSrc`. */
export const homeCore = {
  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!homeKey()) throw new Error("Pair this phone first.");
    let answer: Response;
    try {
      answer = await fetch(`/tbv/invoke/${command}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${homeKey() ?? ""}` },
        body: JSON.stringify(args ?? {}),
      });
    } catch {
      throw new Error("The computer can't be reached. Is TBV open there, on the same Wi-Fi?");
    }
    if (answer.status === 401) {
      // Forgotten on the computer: pair again.
      setHomeKey(null);
      location.reload();
    }
    if ((answer.headers.get("Content-Type") ?? "").startsWith("application/octet-stream")) {
      if (!answer.ok) throw new Error("The book couldn't be read.");
      return (await answer.arrayBuffer()) as T;
    }
    const reply = (await answer.json().catch(() => null)) as unknown;
    if (!answer.ok) throw new Error((reply as { error?: string } | null)?.error ?? `The computer answered ${answer.status}.`);
    return reply as T;
  },
  convertFileSrc(path: string): string {
    return `/tbv/file?path=${encodeURIComponent(path)}&t=${encodeURIComponent(homeKey() ?? "")}`;
  },
};

export const homeAudioUrl = (bookId: string, part: number) =>
  `/tbv/audio/${encodeURIComponent(bookId)}/${part}?t=${encodeURIComponent(homeKey() ?? "")}`;

/** Events come from the desktop app's window only; the phone asks again instead. */
export const homeEvents = {
  listen: async () => () => undefined,
};
