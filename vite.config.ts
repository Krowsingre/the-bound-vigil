import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// PDF.js runs its work in a separate script and loads fonts, character maps
// and image decoders as it needs them. This serves them at /pdfjs/ while
// developing and copies them into the build.
function pdfjsAssets(): Plugin {
  const root = join(process.cwd(), "node_modules/pdfjs-dist");
  const files = new Map<string, string>([["pdf.worker.min.mjs", join(root, "legacy/build/pdf.worker.min.mjs")]]);
  for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    for (const name of readdirSync(join(root, dir))) {
      // The script sandbox is for PDF.js's own viewer; TBV never runs a book's scripts.
      if (!name.startsWith("quickjs") && statSync(join(root, dir, name)).isFile()) files.set(`${dir}/${name}`, join(root, dir, name));
    }
  }
  const types: Record<string, string> = { mjs: "text/javascript", js: "text/javascript", wasm: "application/wasm" };
  return {
    name: "tbv-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs/", (req, res, next) => {
        const file = files.get(decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\//, "")));
        if (!file) return next();
        res.setHeader("Content-Type", types[file.split(".").pop() ?? ""] ?? "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of files) this.emitFile({ type: "asset", fileName: `pdfjs/${name}`, source: readFileSync(file) });
    },
  };
}

// iPhones fetch the home screen icon on their own when "Add to Home Screen"
// is tapped, and some keep showing a letter instead. The icon is written into
// the page itself, so there's nothing left to fetch.
function inlineTouchIcon(): Plugin {
  return {
    name: "tbv-inline-touch-icon",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const png = readFileSync(join(process.cwd(), "public/bound-vigil-180.png")).toString("base64");
        return html.replace(/(<link rel="apple-touch-icon"[^>]*href=")[^"]*(")/, `$1data:image/png;base64,${png}$2`);
      },
    },
  };
}

// Tauri expects a fixed dev port and serves the built files from dist/. The
// web version (`--mode web`) is built into dist-web/ for GitHub Pages, which
// serves it from /the-bound-vigil/.
export default defineConfig(({ mode }) => ({
  base: mode === "web" ? "/the-bound-vigil/" : "/",
  plugins: [react(), pdfjsAssets(), inlineTouchIcon()],
  // Workers load what they need as modules (speech recognition, for one).
  worker: { format: "es" },
  // Left as they are while developing, so ONNX Runtime finds its WebAssembly beside it.
  optimizeDeps: { exclude: ["@huggingface/transformers", "onnxruntime-web"] },
  clearScreen: false,
  server: mode === "web" ? { port: 1421 } : { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  // PDF.js (about 500 kB) loads only when a PDF is opened.
  build: { target: "es2022", outDir: mode === "web" ? "dist-web" : "dist", chunkSizeWarningLimit: 600 },
  test: { environment: "jsdom", globals: true, setupFiles: ["src/test/setup.ts"] },
}));
