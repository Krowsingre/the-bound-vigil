// Speech recognition in its own worker (see asrWorker.ts), one stretch at a time.

import type { FromWorker, ToWorker } from "./asrWorker";

export class Recogniser {
  private readonly worker = new Worker(new URL("./asrWorker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private readonly waiting = new Map<number, { done: (m: FromWorker) => void }>();

  constructor(onLoading: (loaded: number, total: number) => void) {
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data;
      if (m.type === "loading") return onLoading(m.loaded, m.total);
      this.waiting.get(m.id)?.done(m);
      this.waiting.delete(m.id);
    };
    // A worker that fails to start or crashes sends no answer, so everything waiting is let go.
    const failAll = (message: string) => {
      for (const [id, w] of this.waiting) w.done({ type: "failed", id, message });
      this.waiting.clear();
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      failAll(event.message || "Speech recognition stopped working.");
    };
    this.worker.onmessageerror = () => failAll("Speech recognition sent something TBV couldn't read.");
  }

  hear(samples: Float32Array): Promise<{ text: string; timestamp: [number, number | null] }[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, {
        done: (m) => (m.type === "heard" ? resolve(m.pieces) : m.type === "failed" ? reject(new Error(m.message)) : undefined),
      });
      const message: ToWorker = { type: "hear", id, samples };
      this.worker.postMessage(message, [samples.buffer]);
    });
  }

  close() {
    this.worker.terminate();
  }
}
