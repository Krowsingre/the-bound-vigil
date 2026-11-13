// A sigil for a stream (on Sanctum) asks Scry to play it: the stream waits
// here until Scry is showing.

/** `stream:<server address>|<item>|<video or audio>`, as a sigil keeps it. */
export interface StreamAsk {
  server: string;
  item: string;
  audio: boolean;
  title: string;
}

let waiting: StreamAsk | null = null;
const listeners = new Set<() => void>();

export function streamTarget(server: string, item: string, audio: boolean): string {
  return `stream:${encodeURIComponent(server)}|${encodeURIComponent(item)}|${audio ? "audio" : "video"}`;
}

export function parseStream(target: string, title: string): StreamAsk | null {
  if (!target.startsWith("stream:")) return null;
  const [server, item, kind] = target.slice(7).split("|");
  if (!server || !item) return null;
  try {
    return { server: decodeURIComponent(server), item: decodeURIComponent(item), audio: kind === "audio", title };
  } catch {
    return null;
  }
}

export function askScry(ask: StreamAsk) {
  waiting = ask;
  listeners.forEach((l) => l());
}

/** The stream waiting to play, taken so it plays once. */
export function takeScryAsk(): StreamAsk | null {
  const ask = waiting;
  waiting = null;
  return ask;
}

export function onScryAsk(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
