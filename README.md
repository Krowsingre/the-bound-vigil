# The Bound Vigil

A calm eBook reader for your own books. It keeps your library, reading
progress, notes and collections in step across your devices through a cloud
service you choose, without a Bound Vigil account. Windows desktop comes first.

> **Not free software.** The Bound Vigil is proprietary. The code is public
> to read, but you may not use, run, copy, modify or distribute any part of
> it without a paid license from Krowsingre Publishing LLC. See
> [LICENSE](LICENSE).

## What it does

- **Library.** Import books by menu, folder or drag and drop: EPUB, PDF,
  MOBI, AZW/AZW3, FB2, CBZ, TXT, DOCX and DOC. Big imports run in the
  background, and the Imports page shows each book's progress. Your
  original files are never changed.
- **Reader.** Paged or scrolling, a focus mode, fixed page numbers that
  match across devices and text sizes, four highlight colours, and a jump
  back to where you were.
- **Collections.** Your own collections and reading lists, collections that
  fill themselves from rules (author, series, rating, format and more),
  smart collections, series found in your books, badges and gallery
  pictures.
- **Notes.** Highlights, annotations, notes on whole books and personal notes.
- **Ratings.** Star ratings, Goodreads import and export, and optional rating
  sync with Hardcover.
- **Sync.** Through Supabase, or through the folder of iCloud Drive, Dropbox,
  Google Drive, OneDrive or MEGA, or any WebDAV server. Book files can sync
  too, and books that are only in the cloud download when you open them.

## Getting the app

The Bound Vigil is sold under license and isn't publicly available yet. To
ask about a license, contact Krowsingre Publishing LLC through the
repository owner's profile; see [LICENSE](LICENSE).

## How it is put together

| Part | Folder | What it does |
| --- | --- | --- |
| Library core | `crates/tbv-core` | Rust. Imports and reads books, keeps the library database (SQLite), and runs sync. No interface code, so it is fully testable. |
| App wrapper | `src-tauri` | Tauri 2. Opens the window and passes requests from the interface to the core. |
| Interface | `src` | React and TypeScript. |

Principles:

- Book files are never modified. Edits to a book's details are stored
  separately and can be reset.
- A book is identified by a fingerprint of its contents (`sha256:…`), so every
  device agrees which book is which.
- Reading positions are stored independently of screen size and font.
- Each device writes its own change log for sync.

## Building (licensed developers)

You need [Node.js](https://nodejs.org) 22 or newer and [Rust](https://rustup.rs).
On Windows, also the Microsoft C++ Build Tools.

```sh
npm install              # once
npm run tauri dev        # run the app with live reloading
npm test                 # screen tests
cargo test -p tbv-core   # library core tests
npm run tauri build      # make the installers
```

`npm run dev` alone opens the interface in a browser with sample books,
marked **Preview** in the sidebar, for looking at designs.

## Third-party parts

foliate-js (MIT), PDF.js (Apache 2.0) and the packages in `package.json` and
`Cargo.toml` keep their own licenses. Echolume, the gallery paintings and the
badges belong to Krowsingre Publishing LLC.

Copyright (c) 2026 Krowsingre Publishing LLC. All rights reserved.
