# foliate-js (vendored)

The reader's page engine: https://github.com/johnfactotum/foliate-js, MIT licence
(see `LICENSE`). Its README recommends copying it into the project rather than
installing a package, since it has no stable releases.

- Copied from commit `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01).
- Files are unchanged except `pdf.js`, replaced by a stub so PDF.js (13 MB)
  isn't bundled.
- Left out: the demo reader (`reader.js`, `ui/`), OPDS, dictionaries, tests.
- `vendor/zip.js` is a build of zip.js (BSD-3-Clause, Gildas Lormeau) and
  `vendor/fflate.js` a build of fflate (MIT, Arjun Barrett), both as shipped
  in foliate-js.

To update: copy the same files from a newer commit and note it above.
