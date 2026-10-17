# foliate-js (vendored)

The reader's page engine: https://github.com/johnfactotum/foliate-js, MIT licence
(see `LICENSE`). Its README recommends copying it into the project rather than
installing a package, since it has no stable releases.

- Copied from commit `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01).
- Files are unchanged except `pdf.js`, whose top now loads PDF.js from the
  `pdfjs-dist` package (and its assets from `/pdfjs/`, served by a plugin in
  `vite.config.ts`) instead of a copy in `vendor/pdfjs/`. Only PDF.js's two
  layer style sheets are copied, into `vendor/pdfjs/` (Apache 2.0, Mozilla).
  `book.destroy` closes the document through `pdf.loadingTask`, as PDF.js 6
  needs.
- Left out: the demo reader (`reader.js`, `ui/`), OPDS, dictionaries, tests.
- `vendor/zip.js` is a build of zip.js (BSD-3-Clause, Gildas Lormeau) and
  `vendor/fflate.js` a build of fflate (MIT, Arjun Barrett), both as shipped
  in foliate-js.

To update: copy the same files from a newer commit and note it above.
