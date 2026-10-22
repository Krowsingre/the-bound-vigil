// Speech recognition for read-along timing, off the main thread so the app
// stays responsive. Whisper (tiny, English) runs here through ONNX Runtime;
// the model comes from Hugging Face the first time and is kept by the
// browser engine after that.

import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export const MODEL = "Xenova/whisper-tiny.en";

export type ToWorker = { type: "hear"; id: number; samples: Float32Array };
export type FromWorker =
  | { type: "loading"; loaded: number; total: number }
  | { type: "heard"; id: number; pieces: { text: string; timestamp: [number, number | null] }[] }
  | { type: "failed"; id: number; message: string };

env.allowLocalModels = false;
// transformers.js points ONNX Runtime at a CDN for its WebAssembly. Cleared,
// ONNX Runtime uses the copy built into the app instead.
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = undefined;
  onnx.wasm.numThreads = 1;
}

const post = (message: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
const sizes = new Map<string, { loaded: number; total: number }>();

// Typed loosely: transformers.js's overloads are too many for TypeScript here.
const load = pipeline as unknown as (task: string, model: string, options: object) => Promise<AutomaticSpeechRecognitionPipeline>;

function recogniser() {
  loading ??= load("automatic-speech-recognition", MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file) return;
      sizes.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const s of sizes.values()) {
        loaded += s.loaded;
        total += s.total;
      }
      post({ type: "loading", loaded, total });
    },
  });
  loading.catch(() => (loading = null));
  return loading;
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const { id, samples } = event.data;
  try {
    const asr = await recogniser();
    const out = (await asr(samples, { return_timestamps: true })) as {
      chunks?: { text: string; timestamp: [number, number | null] }[];
      text: string;
    };
    post({ type: "heard", id, pieces: out.chunks ?? [{ text: out.text, timestamp: [0, null] }] });
  } catch (e) {
    post({ type: "failed", id, message: e instanceof Error ? e.message : String(e) });
  }
};
