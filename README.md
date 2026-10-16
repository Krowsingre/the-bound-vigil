# The Bound Vigil

A calm eBook reader for your own books. It keeps your library, reading
progress and notes in step across your devices through cloud services you
choose, without a Bound Vigil account. Windows desktop comes first.

## Where things stand

Step 1 is the app's frame and the Home screen:

- The window, with its own title bar and working minimize, maximize and close buttons.
- The sidebar (Home, Library, Collections, Notes, Settings). The **•••** in the
  top-left corner, or **Ctrl+\\**, folds it to a narrow strip. The app remembers
  your choice.
- The header, with search and the sync circle. The circle's menu holds sync,
  importing books and setting up a shared library. Sync itself arrives later.
- Home, built from the books you actually import. Nothing on it is made up:
  sections with nothing to show say so.
- Importing books by menu (**Ctrl+O**), by folder, or by dragging files onto the
  window. EPUB, PDF, MOBI, AZW3, CBZ and FB2 files are accepted. Your original
  files are never changed; TBV keeps its own copy in its library folder.

The Library, Collections, Notes, Settings and the reader are placeholders for now.

## Getting the app

Every pull request and every change to `main` builds a Windows installer. Open
the latest run under **Actions**, then download **the-bound-vigil-windows** at the
bottom of the page. It contains an `.exe` installer and an `.msi`; either works.
Windows may warn that the publisher is unknown because the app is not yet
code-signed.

## Working on it

You need [Node.js](https://nodejs.org) 22 or newer and [Rust](https://rustup.rs).
On Windows, also the Microsoft C++ Build Tools (the Rust installer offers them).

```sh
npm install          # once, to fetch the interface's building blocks
npm run tauri dev    # run the app with live reloading
npm test             # screen tests
cargo test -p tbv-core   # library core tests
npm run tauri build  # make the installers
```

`npm run dev` alone opens the interface in an ordinary browser with a few
sample books, marked **Preview** in the sidebar, for looking at designs. Add
`?empty` to the address to see the empty-library screen. The real app never
uses the sample books.

## How it is put together

| Part | Folder | What it does |
| --- | --- | --- |
| Library core | `crates/tbv-core` | Rust. Imports books, reads their details, keeps the library database (SQLite) and builds what Home shows. No interface code, so it is fully testable. |
| App wrapper | `src-tauri` | Tauri 2. Opens the window and passes requests from the interface to the core. |
| Interface | `src` | React and TypeScript. The shell (`src/shell`), Home (`src/home`), shared pieces (`src/components`) and colours and type (`src/styles/tokens.css`). |

Principles carried over from the design work:

- Book files are never modified. Edits to a book's details are stored
  separately and can be reset.
- A book is identified by a fingerprint of its contents (`sha256:…`), so every
  device agrees which book is which.
- Reading positions are stored independently of screen size and font.
- Each device writes its own append-only change log for sync.
