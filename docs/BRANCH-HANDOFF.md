# TBV branch handoff for a coding model

## Revision and scope

This handoff compares GitHub's `refs/heads/main` at `b4ad478049bca12c9af1315decf6bff818e3df95` with the code in `codex/phase-2-discover-reader` after Phase 3. Despite the branch name, it carries work from several earlier update cycles. The current phase numbering starts with the later library and notes audit. Prior work and approved remaining work are identified separately below. The baseline was fetched from GitHub. It is the merge base and contributes zero main-only commits to this comparison.

Start with `git diff b4ad478 2ff59457b42d` for the authoritative net patch. The inventory below lists every changed code, configuration, test and workflow path, with diff statistics and hunks as navigation aids. Use the commit ledger for the intent and sequence behind those changes. A reverted commit appears in the ledger because it remains in history. The net diff is authoritative for current behavior. Recalculate the merge base if main advances.

## Current Phase 3 code

- **Saved Discover sessions**. `BrowserNav` puts **Sessions** between **Bookmarks** and **Reader view** in the desktop OS toolbar. Narrow Discover exposes it in its own toolbar and the More menu also opens it. `SessionsPanel.tsx` saves the current regular tabs to device-local `tbv.browser.sessions`. A record stores a name, tab URLs, display titles, pin flags, and selected-tab index. Save, rename, edit addresses, add/remove/reorder tabs, change pins, load, and delete are supported. Loading confirms replacement of the current pane's tabs, allocates fresh tab IDs, keeps pinned tabs before ordinary tabs, and preserves the saved selection when possible. Replaced ordinary pages can still be reopened through the existing closed-tab flow. Private tabs and addresses with embedded username/password credentials are excluded. Full addresses can contain site-issued tokens. There is no cookie, browser storage, login-state, history stack, or sync serialization.
- **Search open tabs**. Desktop **Every tab** retains its dropdown and individual close actions. The search uses titles and site hints, Enter opens the first result, and the existing arrow-key navigation can focus another result. The narrow tab grid searches title, site and address, supports Enter, and keeps each result's close button. Both surfaces limit a search to open tabs.
- **Bookmarks HTML**. The bookmark manager accepts Netscape-style bookmarks HTML and exports the same format. It parses inert markup, accepts HTTP(S) URLs, escapes exported text and attributes, and skips exact URLs already present or repeated in the input. Nested folders map to the existing single folder field using ` / ` as a path separator and export as nested lists. The core's existing 120-character folder and 200-character title limits still apply. Empty folders and browser-specific bookmark metadata have no corresponding TBV records. Export reuses the native save picker and generic byte writer, with browser download behavior in preview. Native file-picker behavior on iPhone remains unverified, and the Android test app has the existing save-picker limitation.
- **Refresh shortcut and split control**. Removed the header refresh icon. **Ctrl+Shift+R** still calls the workspace refresh, including from the secondary TBV pane and Windows' native Discover page accelerator. Refresh runs the existing save callbacks, clears native pane placement, and reloads the workspace. Discover hides **Split screen** while inside a split TBV workspace. A Discover-only two-tab split shows **Close tab split** in its place. The workspace's **Close split** remains available. The sidebar context menu remains available for selecting a section for the other pane.

## Net behavior since main

| Area | Code in the branch and how to trace it |
| --- | --- |
| Workspace and navigation | `App.tsx`, `shell/Workspace.tsx`, `workspaceFrame.ts`, `Sidebar.tsx`, and `browse/workspaceBrowser.ts` coordinate independently navigable TBV panes and native view bounds. The secondary pane is a same-origin document with separate route and reader UI, collapsed sidebar, and its own Discover tab key. The main document owns native layout and quit/refresh. Sidebar right-click can split into sections, same-section clicks return to that section's home, and Back/Forward use **Alt+Shift+Left/Right**. Discover uses **Alt+Left/Right** for page history. Reader link/exit Back follows the app shortcut. Header code also handles Ctrl+K focus and Ctrl+X clear while preserving ordinary Cut in editable text. |
| Discover tabs and address | `Browser.tsx`, `browserTabs.ts`, `AddressSuggestions.tsx`, and `Header.tsx` keep browser address entry distinct from library search, support background/contextual tabs and pinned boundaries, and keep the active tab visible without changing logical order. Closed-tab undo/reopen avoids shifting the tab strip. Individual close actions are available in the extended list. Suggestions keep typed text editable, offer fresh navigation and rank bookmarks/history/open tabs, and support the clipboard cue on desktop. Windows native shortcut forwarding is in `src-tauri/src/browser.rs`. The selected-tab strip shows indeterminate activity and clears on completion, failure, stop, and download handoff. |
| Discover bookmarks, history and menus | `StartPanels.tsx`, `browser_history.rs`, `bookmarks.rs`, and the API/preview adapters cover bookmark create/edit/remove/order/folder, a stronger saved-page affordance, Ctrl+D bookmark options, consolidated page and tab menus, and clearing filtered browsing history. The tab context menu has Pin/Unpin, Close, Duplicate, Close to the right, and Close other tabs. Tab creation and reopening are available in More. Phase 3 adds transfer of HTML bookmarks, tab search and saved sessions. |
| Discover transfers and web tools | `browserDownloads.ts`, `Browser.tsx`, `pageTools.ts`, `src-tauri/src/browser.rs`, `imports.rs` and the iOS browser plugin separate active, transfer-failed, downloaded and import states, reconcile native transfers across navigation, retain explicit import actions, track known source pages, and manage download destinations and staged files. Import validates ebook file content, clears the staged copy after successful managed import, and preserves separately saved files. Audio downloads retain explicit library import. Controls include individual and bulk history removal, cleanup preferences, and temporary file cleanup. Redirect settings and allowlist are wired through protection settings and native paths, with dedicated macOS WebKit handling. Browser tools include Open source page, save selected text/title/URL as a Scribe note, and YouTube PiP. Native download reproduction and PiP platform coverage remain separate checks. |
| Archive and Resonance browsing | `library/Library.tsx`, `LibraryToolbar.tsx`, `BookViews.tsx`, `libraryView.ts`, `audio/Audiobooks.tsx` and core `browse.rs` share series grouping, sorting, filters and stack cover logic. Dedicated Series keeps identified stacks first. Other layouts can mix stacks with individual books using the selected sort. Pinned series remain stacks across layouts. The shelf allows ten Archive pins total including series, and Up Next allows fifteen with a replacement prompt. Starting a book clears its Up Next entry. Pins use active sort, appear across library pages, and the pinned section remembers collapsed state. Paged and scrolling list modes are available. Resonance includes Audiobooks/Podcasts/Music categories with audiobook default and a separate Pairing filter. Hide finished and Books on device precede other filters. |
| Series membership and covers | `browse.rs`, `series_sources.rs`, `libraryView.ts`, `BookViews.tsx`, `SeriesCoverPicker.tsx`, `RecentlyAdded.tsx`, and preview/web adapters cover owned counts and same-member filters. A filtered stack remains when any member satisfies the combined filters, retains the owned-count badge, and can show all members in its details. A distinct badge treatment requires verified evidence of more published books. Covers default to the earliest eligible unfinished member in reading order and can be manually selected or reset. Recently Added groups recognized series when multiple entries match. |
| Library actions and Book Details | `BatchDownloads.tsx`, `bookActions.ts`, and `FinishedDownloadPrompt.tsx` implement group Download, retry failed titles, stack Remove download for local copies with cloud backups, and status-change removal prompts. Undo covers status, Up Next removal and unpinning. Book Details includes cover expansion, tag suggestions, metadata precedence and review of editable found values before approval. Navigation avoids creating a new Archive history entry when returning to the existing series/list. Context menus expose existing actions on right-click and keep edit actions separated from deletion. Save-to-device export uses the selected edition and compares file contents before reusing a destination. |
| Compendium and Kindle | `Collections.tsx`, `KindleList.tsx`, `KindleArchivePicker.tsx`, `KindleReview.tsx` and core `kindle.rs` implement one top Kindle search, matching to existing Archive books and box-set members, related series suggestions, and missing-member reconciliation. Read and Dropped are the reading-history choices. The picker and review layouts handle narrower windows. |
| Reader | `Reader.tsx`, `ReaderBars.tsx`, `ReaderPanels.tsx`, `useReaderEngine.ts`, `useKeyboardScroll.ts` and Foliate changes cover active Contents visibility, footer chapter access, display font-size overrides, adjustable smooth manual scrolling, Ctrl+Space auto-scroll, a fresh default of 10%, and Vesper. Continuous EPUB scroll emits periodic position checkpoints and reports again at stop, reader exit or normal quit. `StructuredViewer.tsx` and `structuredContent.ts` support user-expanded existing tables, preformatted content and supported local figures. Conversion/view handling includes MOBI/AZW3; the display overlay is separate from the source book. |
| Notes and Scribe | `PersonalNoteEditor.tsx`, `NewNoteDialog.tsx`, `Notes.tsx`, `QuoteDrawer.tsx` and core `notes.rs` use a shared formatted editor for create/edit, tags and chapter notes, and preserve available reading locations in Markdown export. Draft restoration in `ImportBook.tsx`, `importDoc.ts`, core and Tauri `writing.rs` restores editable manuscript content while retaining the saved snapshot. Imported front matter is recognized and editable page roles can be changed. `BookPreview.tsx`, `sources.ts`, `SourcesDialog.tsx`, and `epub.ts` implement citation/source editing, a manually included auto-populated bibliography, distinct display for standalone sources while editing, and export/print inclusion only when the page is present. Citation formats include MLA, APA and Custom; prior saved styles remain readable. |
| Shared persistence and infrastructure | `data.rs`, `model.rs`, `manage.rs`, `sync/mod.rs` and the API layers carry the storage and sync changes supporting the above. Preview/web adapters implement or stub their corresponding interfaces as appropriate. `RememberedDetails.tsx` and settings controls persist disclosure state. `Menu.tsx` stabilizes submenu geometry, and shared dialogs/toasts support the newer library workflows. `windows_quit.rs` hides the Windows app while pending saves flush. Two branch-scoped workflows build Windows installers for previous bibliography and current Discover/Reader branches. |

## Private profile and public exit IP design for review

This is planning only. Saved sessions are a list of pages. A fresh browser profile resets site state, and an egress route determines the public IP a server sees. The existing Windows/macOS Tauri tab builder uses an incognito setting. The iOS plugin uses a nonpersistent WebKit store for private browsing. Neither code path establishes a new verified public exit address. A site that applies per-IP limits will still see the same address through a fresh profile on the same network. A different verified exit can still be shared, already rate-limited, or subject to other site checks.

Proposed Sessions action **New private session** should create one ephemeral profile shared only by its tabs. A separate configured **New private session with new exit** action should do both in one click. Keep regular tabs and account sync on their existing routes. Before loading the first destination, create the isolated profile, install the chosen route, and verify IPv4/IPv6 egress from the exact browsing context against a controlled HTTPS endpoint. If the requested address change cannot be verified, hold the private session on a status page with Retry and Close. On rotation start a new profile and route, show in-flight download impact before closing the previous one, and destroy the previous private store on close. Show whether the current private session has a verified exit. Ordinary private mode remains usable with the current network.

| Option | Platform investigation and decision |
| --- | --- |
| User-provided or user-operated route | First prototype, because it can be evaluated without TBV operating infrastructure. On Windows, separate WebView2 profiles isolate storage. Probe whether a dedicated browser environment and independent data folder provide strict per-session routing with the bundled runtime. Browser arguments affect shared processes and are insufficient evidence of isolation. On macOS and iPhone, test WebKit's per-data-store proxy API with a nonpersistent store on supported deployment targets. Hide the routed action on targets that fail the isolation check. Document trust, availability, setup, and latency. [Microsoft WebView2 profiles](https://learn.microsoft.com/en-in/microsoft-edge/webview2/concepts/multi-profile-support), [WebView2 flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags?tabs=win32cpp), [Apple WebKit data store](https://developer.apple.com/documentation/webkit/wkwebsitedatastore?changes=lat_3_5) |
| Tor-based route | Separate optional research path. Test process lifecycle, circuit isolation and platform distribution before considering adoption. Tor Browser distinguishes fresh identity from replacing a site's circuit. Routing an embedded WebView through Tor would retain that engine's fingerprint and needs its own leak tests. [Tor Browser identity controls](https://support.torproject.org/tor-browser/features/managing-identities/) |
| Computer-wide VPN | Useful as a benchmark for exit checks. The current approved proposal is scoped to Discover, so computer-wide routing remains a separate decision. |

Use Windows, Mac and iPhone with a controlled test site and DNS/egress logging. Acceptance requires all of the following before implementation approval.

1. Normal and private windows have different cookie, local/session storage, IndexedDB, cache, service worker and authentication state where expected. Two fresh private sessions cannot see one another's state. Regular profile data survives.
2. First navigation, redirects, embedded frames, WebSocket/QUIC if supported, DNS and WebRTC cannot silently escape the assigned route. Exercise loss of route, IPv4/IPv6 differences, unchanged exit, and endpoint verification failure. Keep discovered platform gaps explicit.
3. Test **Download now** and copied-link navigation, background tabs and popups, manual Add to library, native staging and any direct Rust download path. Route-aware code must use the same exit or visibly stop. Test private cleanup and explicit file retention without altering regular downloads.
4. Compare observable UA, language, timezone, canvas and WebGL across normal and private sessions. Report residual fingerprint linkage and distinguish route changes from identity guarantees. Record whether a controlled IP-quota endpoint sees the expected new address and whether a shared exit is rate-limited.

## Remaining approved phases and open checks

| Phase | Scope and decision gate |
| --- | --- |
| 4. Resonance audio | Establish a Windows/Mac/iPhone direct-play matrix for existing accepted extensions and codecs. Check import, duration, seeking and resume with known samples. Evaluate WAV/PCM first, then AIFF and ALAC. Distinguish embedded cover art from a real video stream. Prefer in-app playback/decoding and preserve originals if a playback copy is proposed. Report evidence and settle format additions before coding. Local video stays outside Resonance. |
| 5. Native Synod | Settle threat model, library eligibility, room membership, relay operations and key recovery first. Use synced library profile plus a per-device display name/key as the speaking identity, such as **Earth _ Batman**, without a separate native Synod login. A relay operated by a user or community can store encrypted envelopes for offline recipients. TBV operates no relay. Decide enrollment, revocation, retention, metadata visibility, delivery receipts, attachment limits and recovery before implementation. Then build Synod between Discover and Preferences, separators after Compendium and Synod, conversation tabs, direct messages, invite-only rooms, and explicit EPUB import into Archive. Require proof of device separation, authorization, offline delivery and no title/inventory disclosure in library eligibility. Audio and local video attachments stay outside the first version. |
| 6. Telegram in Synod | After native Synod passes its checks, settle the Telegram integration approach. Add joining and participating in existing Telegram groups in Synod tabs, using Telegram account and group membership rules. Verify join and participation while keeping native Synod identities independent. |

- **Phase 2 device coverage remains open.** Reproduce the intermittent same-tab download failure against the copied-link/new-tab path if a public example is available. Track download completion and import as separate events. The site mention was Anna's Archive, with no exact URL or alert text. Verify YouTube PiP survives navigation between TBV sections on supported installed platforms. The branch contains the implementation, but those platform and site claims require hands-on evidence.
- **Split and Reader coverage remains open on devices.** An earlier browser preview confirmed native layout requests drop the secondary view. The installed Windows floating-window symptom still needs reproduction. An earlier two-reader preview smoke test timed out opening the secondary reader, so that run did not verify concurrent reading. Windows build success is compile/package evidence. iPhone TestFlight and macOS checks require their own results.
- **Suggested reading is planning-only from the earlier request.** Current Sanctum suggestions use unread/unopened owned books, prefer Up Next, and mix remaining picks daily. A future design should make Dropped and Read under three stars negative signals, three neutral, four positive, and five the strongest positive. Keep the scoring design separate from implementation approval. `crates/tbv-core/src/home.rs` is the current behavior reference.
- **Private profile with rotated exit remains design only.** The plan above requires user review and platform proof before a routing implementation.

## Verification and audit

Audited code revision `2ff59457b42d2ee34864e7cbbfbd6cf7a1d576a0`. The subsequent handoff commit contains documentation only.

1. **Net patch audit.** Compared fetched main directly with the Phase 3 code revision. Cross-checked path status, line counts, and patch hunks. Result is 172 files changed, 8845 insertions(+), 1574 deletions(-). Patch SHA-256 (`git diff --no-ext-diff --no-renames --binary BASE CODE`) is `7c855b44914c17d860f1f2c7ead7049094b63e312fb4461c37110f92ac1d930b`.
2. **Tree and history audit.** Independently compared modes and object IDs for every tracked path with `git ls-tree -r`. The two inventories agreed on 172 changed paths (33 added, 139 modified, 0 deleted). Walked all 64 branch-only commits from main and accounted for paths with net-zero changes. Phase 3 itself changed 12 code/test paths, with no library core, Resonance, or workflow changes.
3. **Patch replay, behavior, and scope audit.** Replayed the binary-capable patch into an isolated index initialized from main and matched all 668 tracked paths to the audited branch tree by mode and object ID. Read the net diff by subsystem and checked Phase 3 entry points and data fields in the committed tree. Reconciled Phases 4–6 and the private-routing decision gate against the approved audit plan. TypeScript passed. The full frontend suite passed 339 tests with two EPUBCheck cases skipped. The earlier targeted run passed 30 tests. The desktop browser preview verified session save, editing, load with pins and order, delete, open-tab search and individual close, bookmark duplicate handling and HTML export, split controls in both panes, and keyboard refresh from either pane. Search selected tab 110 with three pinned tabs present. Native file pickers, native focus/cleanup, and iPhone/macOS verification are device checks. The library core CI job passed. The same run builds the Windows installer for the audited code revision. [Phase 3 GitHub Actions run](https://github.com/Krowsingre/the-bound-vigil/actions/runs/43023579483)

## Commit ledger and exact file inventory

### Branch-only commits (64, oldest first)

- `f5386cf8e3bc` Separate app and webpage history and improve reader Contents
- `c75b7f466d31` Improve Discover tabs, downloads, and bookmarks
- `b34ab4b0addb` Consolidate Discover bookmark and page menus
- `2aca61a8c4a0` Group Archive series and enforce shelf limits
- `916ad9aa4829` Keep Archive pins visible and clear Up Next when reading starts
- `92636388eeaf` Clarify online metadata approval and series reading status
- `88233b39e454` Add Kindle Archive matching and improve Discover navigation and downloads
- `9c2786de924f` Suggest related Kindle series and preserve browser history navigation
- `d908b59fc452` Keep Kindle match controls within the viewport
- `ede9038cf7ca` Improve Archive and Resonance series, filters, pins, and menus
- `a2080068dbe2` Preserve duplicate lookup and polish library filter navigation
- `25217001812a` Return from Book Details to the existing series history entry
- `f26ae195821b` Put audio type tabs in the Resonance header
- `7dee91021996` Improve Discover downloads and library browsing preferences
- `d5b16235ad7e` Fix reader and notes disclosure bindings
- `f60ebeee7da0` Coalesce library searches and improve stack covers and filters
- `0f89c02482df` Use shared shelf counts and refresh changed cover images
- `070dd5a1828e` Focus Discover address bar and insert contextual tabs beside their source
- `3f51560ec1fe` Use one formatted editor for creating and editing personal notes
- `6868725e0833` Reuse personal note editor from the Scribe chapter drawer
- `0ee4d9b07617` Keep chapter-note edit and unlink controls separate
- `4ea2eb6ae08f` Prevent Keep editing from submitting the note
- `42139c0d76d7` Bring the Tauri webview lookup trait into Windows shortcut code
- `e2fee7da9166` Keep Scribe drafts in Archive without deleting their books
- `e971b4335859` Revert "Keep Scribe drafts in Archive without deleting their books"
- `99daac289c59` Restore a Scribe draft to the editable manuscript
- `4bfaaf5a7229` Give browser preview drafts readable EPUB snapshots
- `ef57de24ba08` Keep draft restore review wording specific to restoration
- `9995bf122ee3` Add Discover split screen and item context menus
- `16b53619f384` Keep the companion address field usable in narrow panes
- `bd022624228d` Keep the full browser actions available in the companion pane
- `0601585c9eec` Separate library layout from grouping and unify Kindle search
- `fa4afac9c7e8` Verify mixed ordering and keep grouping available with series filters
- `becd644bc023` Expand existing EPUB tables and preformatted text in the reader
- `7b384f9fe7d7` Expand structured content in MOBI and AZW3 and support local figures
- `055c58ab2b28` Save the open book edition without replacing different files
- `ae798cb2aed7` Reconcile Discover downloads with native transfer state
- `81be8407b8a0` Track downloads in native Discover popups
- `cd2d2efea366` Keep redirect prompts accessible and honor explicit navigation
- `9829190f661c` Wait for WebView2 to acknowledge download cancellation
- `780a948c21a8` Apply Discover redirect policy to macOS WebKit tabs
- `2542b4c13cfe` Import the WebKit delegate class trait
- `20eb397af79f` Smooth Reader keyboard scrolling and restore editable Scribe front matter
- `89bb23077b74` Hide the Windows app before flushing saves on close
- `2287dcf572c4` Split the TBV workspace into independently navigable panes
- `555d0bff1ed0` Close the phone sidebar when opening the second pane
- `671fc7d6b69a` Keep Reader controls and text visible in a narrow split pane
- `a213c77dbd2d` Improve Discover tabs and address editing, sidebar navigation and series stacks
- `b699b9493157` Pass the selected series cover into Archive compact rows
- `cc0eefeefea6` Use the shared series cover rule and keep cover badges distinct
- `1c88953647f5` Keep the tab list open when a close adjusts the tab strip
- `f979de8444fd` Refine reading status, split rails, tags and Book Details navigation
- `04f3e515f0a1` Add editable Scribe bibliography and stable menus
- `189d051c4e37` Build the bibliography update for Windows
- `5d07b1cfc1a4` Simplify Discover tab menus and add keyboard shortcuts
- `b70df88c1aa5` Improve series, library actions and metadata review
- `dcc4074c57c9` Verify published series counts and Phase 1 workflows
- `3aa0f5857280` Match catalogued series names with Unicode case folding
- `6826f2fd7c1f` Add Vesper and Reader auto-scroll
- `2e4ef4c982a8` Improve Discover downloads and add web reading tools
- `1be89dad5658` Add download removal to series stacks
- `a5225c2c5c6d` Save auto-scroll progress and recover split browser panes
- `0e7f1ddbf337` End tab loading indicators on failed or stopped loads
- `2ff59457b42d` Add Discover session management and bookmark transfer

Paths touched in history with no net change against main: none.

### Net file changes (172)

**A** added, **M** modified, **D** deleted. A plus sign marks paths changed by Phase 3 itself. The changed-region column shows up to three Git hunk contexts and is a lookup aid. Exact hunks remain in the patch.

| Change | Path | Added | Removed | Changed regions |
| --- | --- | ---: | ---: | --- |
| A | `.github/workflows/build-phase-2-discover-reader.yml` | 51 | 0 |  |
| A | `.github/workflows/build-scribe-bibliography.yml` | 51 | 0 |  |
| M | `Cargo.lock` | 2 | 0 | `dependencies = [` |
| M | `crates/tauri-plugin-tbv-ios/ios/Sources/Browser.swift` | 109 | 12 | `struct BrowserFrameArgs: Decodable {`<br>`class BrowserArgs: Decodable {`<br>`class TbvBrowser: NSObject, WKNavigationDelegate, WKUIDelegate {` |
| M | `crates/tauri-plugin-tbv-ios/ios/Sources/TbvPlugin.swift` | 1 | 1 | `class TbvPlugin: Plugin, UIDocumentPickerDelegate, PHPickerViewControllerDelegat` |
| M | `crates/tauri-plugin-tbv-ios/src/lib.rs` | 6 | 0 | `pub fn browser_event() -> Option<serde_json::Value> {` |
| M | `crates/tbv-core/Cargo.toml` | 1 | 1 | `serde_json.workspace = true`<br>`tungstenite = { version = "0.26", default-features = false, features = ["handsha` |
| M | `crates/tbv-core/src/audiobookshelf.rs` | 1 | 0 | `fn remote_book_from(id: &str, item: &str, body: &Value, seconds: f64) -> Result<` |
| M | `crates/tbv-core/src/bookmarks.rs` | 80 | 11 | `pub struct Bookmark {`<br>`pub(crate) fn web_address(url: &str) -> Result<String> {`<br>`impl Library {` |
| M | `crates/tbv-core/src/browse.rs` | 432 | 36 | `use crate::model::*;`<br>`pub(crate) fn kind_condition(kind: ItemKind) -> String {`<br>`impl Filters<'_> {` |
| M | `crates/tbv-core/src/browser_history.rs` | 4 | 4 | `impl Library {`<br>`mod tests {` |
| M | `crates/tbv-core/src/collections.rs` | 1 | 1 | `impl Library {` |
| M | `crates/tbv-core/src/data.rs` | 26 | 13 | `impl Library {`<br>`mod tests {` |
| M | `crates/tbv-core/src/details.rs` | 18 | 0 | `impl Library {`<br>`mod tests {` |
| M | `crates/tbv-core/src/ereaders/mod.rs` | 97 | 22 | `pub mod email;`<br>`pub fn save_copy(book: &Outgoing, folder: &Path) -> Result<Copied> {`<br>`mod tests {` |
| M | `crates/tbv-core/src/formats/mod.rs` | 11 | 0 | `pub fn read_metadata(path: &Path, format: &str) -> Result<BookMetadata> {` |
| M | `crates/tbv-core/src/goodreads.rs` | 15 | 2 | `pub struct GoodreadsImport {`<br>`impl Library {` |
| M | `crates/tbv-core/src/home.rs` | 2 | 1 | `pub(crate) const BOOK_COLUMNS: &str = r#"`<br>`pub(crate) fn book_from_row(r: &Row) -> rusqlite::Result<BookPreview> {` |
| M | `crates/tbv-core/src/kindle.rs` | 80 | 12 | `pub struct KindlePurchase {`<br>`impl Matcher {`<br>`impl Library {` |
| M | `crates/tbv-core/src/library.rs` | 15 | 0 | `const MIGRATIONS: &[&str] = &[`<br>`fn register_functions(conn: &Connection, sync_live: &Arc<AtomicBool>) -> Result<` |
| M | `crates/tbv-core/src/manage.rs` | 8 | 8 | `impl Library {` |
| M | `crates/tbv-core/src/model.rs` | 21 | 1 | `pub struct RemotePosition {`<br>`pub enum Location {`<br>`pub struct LibraryQuery {` |
| M | `crates/tbv-core/src/notes.rs` | 30 | 5 | `impl Library {`<br>`mod tests {` |
| M | `crates/tbv-core/src/reader.rs` | 3 | 1 | `impl Library {`<br>`mod tests {` |
| M | `crates/tbv-core/src/series.rs` | 10 | 4 | `pub struct SeriesEntry {`<br>`pub fn audible_series_from(data: &Value, name: &str) -> Vec<SeriesEntry> {`<br>`pub fn hardcover_series_from(data: &Value) -> Vec<SeriesEntry> {` |
| M | `crates/tbv-core/src/series_sources.rs` | 2 | 2 | `pub fn isfdb_series_from(html: &str, author: &str) -> Vec<SeriesEntry> {`<br>`pub fn google_series_from(volumes: &[Value], series_id: &str, author: &str) -> V` |
| M | `crates/tbv-core/src/sync/mod.rs` | 18 | 2 | `pub(crate) const KINDS: &[Kind] = &[` |
| M | `crates/tbv-core/src/writing.rs` | 68 | 0 | `pub struct NewWritingSection {`<br>`impl Library {`<br>`mod tests {` |
| M | `src-tauri/Cargo.toml` | 2 | 0 | `security-framework = "3"` |
| M + | `src-tauri/src/browser.rs` | 625 | 165 | `pub struct Frame {`<br>`pub(crate) enum Event {`<br>`fn link_menu(url: &str) -> Vec<(&'static str, &'static str)> {` |
| A | `src-tauri/src/browser_mac_redirects.rs` | 175 | 0 |  |
| M | `src-tauri/src/home.rs` | 5 | 2 | `async fn dispatch(app: &AppHandle, command: &str, a: Value) -> Result<Answer, St` |
| M | `src-tauri/src/imports.rs` | 36 | 0 | `struct Queue {`<br>`impl Imports {` |
| M | `src-tauri/src/lib.rs` | 71 | 19 | `mod servers;`<br>`async fn get_collections(state: State<'_, AppLibrary>) -> CommandResult<Vec<Coll`<br>`async fn kindle_summary(state: State<'_, AppLibrary>) -> CommandResult<tbv_core:` |
| M | `src-tauri/src/protection.rs` | 29 | 5 | `pub enum Level {`<br>`fn under(host: &str, domain: &str) -> bool {`<br>`mod tests {` |
| A | `src-tauri/src/windows_quit.rs` | 53 | 0 |  |
| M | `src-tauri/src/writing.rs` | 8 | 0 | `pub async fn writing_drafts(state: State<'_, AppLibrary>, project_id: String) ->` |
| M + | `src/App.tsx` | 262 | 99 | `import { BookDetailsPage } from "./details/BookDetailsPage";`<br>`import { BookPlacesPage } from "./sync/BookPlaces";`<br>`function readCollapsed(): boolean {` |
| M + | `src/api/index.ts` | 41 | 19 | `export interface Api {`<br>`function appApi(): Api {` |
| M | `src/api/preview.ts` | 32 | 6 | `function home(): HomeViewModel {`<br>`export function previewApi(): Api {` |
| M | `src/api/types.ts` | 27 | 3 | `export interface RemotePosition {`<br>`export type ItemKind = "books" &#124; "documents" &#124; "audiobooks";`<br>`export interface LibraryQuery {` |
| M | `src/audio/Audiobooks.tsx` | 44 | 18 | `import { ProgressBar } from "../components/ProgressBar";`<br>`function timeLeft(book: BookPreview): string &#124; null {`<br>`export function Audiobooks({` |
| M | `src/audio/player.tsx` | 5 | 1 | `export function PlayerProvider({ children, onChanged }: { children: React.ReactN` |
| M | `src/browse/AddressSuggestions.test.ts` | 3 | 3 | `const from: Suggestion[] = [` |
| M | `src/browse/AddressSuggestions.tsx` | 60 | 22 | `import { useEffect, useMemo, useState } from "react";`<br>`export function suggestionsFor(typed: string, from: Suggestion[]): Suggestion[]`<br>`export function AddressSuggestions({ typed, current, onGo, onTab }: { typed: str` |
| M | `src/browse/Bible.tsx` | 2 | 2 | `async function findInLibrary(t: Translation): Promise<string &#124; null> {` |
| M | `src/browse/Browse.tsx` | 7 | 2 | `import { Catalogs } from "../catalogs/Catalogs";`<br>`export function Browse({` |
| M + | `src/browse/Browser.tsx` | 581 | 270 | `import { useToast } from "../components/Toast";`<br>`import {`<br>`export const SUGGESTED_SITES: { title: string; url: string }[] = [` |
| M | `src/browse/HistoryPanel.tsx` | 13 | 3 | `export function HistoryPanel({ onGo, onClose }: { onGo: (url: string) => void; o` |
| A + | `src/browse/SessionsPanel.tsx` | 147 | 0 |  |
| A | `src/browse/SplitDivider.tsx` | 41 | 0 |  |
| M | `src/browse/StartPage.tsx` | 2 | 1 | `export function StartPage({` |
| M + | `src/browse/StartPanels.tsx` | 131 | 54 | `function Panel({ title, onClose, children }: { title: string; onClose: () => voi` |
| A + | `src/browse/bookmarkHtml.ts` | 83 | 0 |  |
| M | `src/browse/browserAsk.ts` | 1 | 1 |  |
| A | `src/browse/browserDownloads.test.ts` | 111 | 0 |  |
| M | `src/browse/browserDownloads.ts` | 246 | 5 | `export interface Fetched {`<br>`export function readDownloads(): Fetched[] {` |
| M | `src/browse/browserHistory.test.ts` | 9 | 0 | `describe("Discover's history", () => {` |
| M | `src/browse/browserHistory.ts` | 3 | 3 | `export function removeFromHistory(ids: string[]) {` |
| M | `src/browse/browserPrefs.ts` | 29 | 2 | `export const SEARCH_ENGINES: { value: SearchEngine; label: string; url: string }`<br>`export interface BrowserPrefs {`<br>`export function readBrowserPrefs(): BrowserPrefs {` |
| M | `src/browse/browserTabs.test.ts` | 37 | 5 | `test("tabs come back as they were left", () => {`<br>`describe("moving tabs", () => {` |
| M | `src/browse/browserTabs.ts` | 37 | 21 | `export interface TabsState {`<br>`export function readTabs(home: string): TabsState {`<br>`export function writeTabs(state: TabsState): void {` |
| A + | `src/browse/discoverOrganization.test.ts` | 37 | 0 |  |
| A | `src/browse/pageTools.ts` | 62 | 0 |  |
| A | `src/browse/workspaceBrowser.ts` | 47 | 0 |  |
| M | `src/catalogs/Catalogs.tsx` | 1 | 1 | `export function Catalogs({` |
| M | `src/collections/CollectionPanel.tsx` | 1 | 1 | `export function CollectionPanel({` |
| M | `src/collections/CollectionView.tsx` | 12 | 7 | `import { ProgressBar } from "../components/ProgressBar";`<br>`export function CollectionView({` |
| M | `src/collections/Collections.tsx` | 9 | 3 | `export function Collections({` |
| A | `src/collections/KindleArchivePicker.tsx` | 114 | 0 |  |
| M | `src/collections/KindleList.tsx` | 34 | 32 | `export function KindleCard({ summary, layout, onOpen }: { summary: KindleSummary`<br>`export function KindleView({ onBack, onChanged }: { onBack: () => void; onChange`<br>`function KindleBook({ book, removed, onChange }: { book: KindlePurchase; removed` |
| M | `src/components/BookCover.tsx` | 5 | 1 | `const CLOTH = ["#2f3a44", "#3d3a33", "#33403a", "#41323a", "#2e3540", "#463c2e"]`<br>`export function BookCover({ book, size = "m" }: { book: CoverBook; size?: "s" &#124;` |
| M | `src/components/ConfirmDialog.tsx` | 9 | 5 | `export function ConfirmDialog({` |
| M | `src/components/ContextMenu.tsx` | 45 | 8 | `export function holdForMenu(label: string, items: () => MenuEntry[]) {`<br>`export function ContextMenuHost() {` |
| A | `src/components/Menu.test.tsx` | 43 | 0 |  |
| M + | `src/components/Menu.tsx` | 139 | 60 | `import { Icon, type IconName } from "./Icon";`<br>`export interface MenuItem {`<br>`export function Menu({` |
| A | `src/components/RememberedDetails.tsx` | 22 | 0 |  |
| M | `src/components/Toast.tsx` | 10 | 5 | `export function useToast() {`<br>`export function ToastProvider({ children }: { children: ReactNode }) {` |
| M | `src/details/BookDetailsPage.tsx` | 15 | 2 | `import { useEffect, useMemo, useState } from "react";`<br>`export function BookDetailsPage({` |
| M | `src/details/DetailsEditor.tsx` | 49 | 4 | `import { AddOrReplace, joined, type ListMode } from "../components/AddOrReplace"`<br>`export function DetailsEditor({ books, onClose }: { books: BookPreview[]; onClos` |
| A | `src/details/FetchDetails.test.tsx` | 39 | 0 |  |
| M | `src/details/FetchDetails.tsx` | 26 | 9 | `import type { BookDetails, BookPreview, DetailFieldName } from "../api/types";`<br>`export function FetchDetails({ book, onClose }: { book: BookPreview; onClose: (c` |
| M | `src/home/Home.tsx` | 4 | 1 | `export function Home({` |
| M | `src/home/RecentlyAdded.tsx` | 47 | 3 | `export function RecentlyAdded({ books, actions, onViewAll, menus = false }: { bo` |
| M | `src/home/bookActions.ts` | 77 | 52 | `import { askDeleteBook, askEditTags, askRemoveBook } from "../library/BookDialog`<br>`export interface BookActions {`<br>`export function bookMenu(book: BookPreview, actions: BookActions): MenuEntry[] {` |
| M | `src/imports/KindleReview.tsx` | 3 | 2 | `export function KindleReviewDialog({ review, imported, onClose }: { review: Kind` |
| M | `src/lib/queryBooks.ts` | 57 | 11 | `const byTitle = (a: BookPreview, b: BookPreview) => sortTitle(a).localeCompare(s`<br>`export function queryBooks(everything: BookPreview[], q: LibraryQuery, collectio` |
| A | `src/library/BatchDownloads.tsx` | 57 | 0 |  |
| M | `src/library/BookDialogs.tsx` | 9 | 2 | `export function TagsDialog({ books, onClose }: { books: BookPreview[]; onClose:` |
| M | `src/library/BookViews.tsx` | 58 | 4 | `export interface Selection {`<br>`function Progress({ book }: { book: BookPreview }) {`<br>`export function BookGrid({ books, actions, selection }: Props) {` |
| A | `src/library/FinishedDownloadPrompt.tsx` | 57 | 0 |  |
| M | `src/library/Library.test.tsx` | 106 | 5 | `vi.mock("../api", () => ({`<br>`const book = (n: number, extra: Partial<BookPreview> = {}): BookPreview => ({`<br>`function renderLibrary(props: Partial<React.ComponentProps<typeof Library>> = {}` |
| M | `src/library/Library.tsx` | 293 | 87 | `export function Library({` |
| M | `src/library/LibraryToolbar.tsx` | 114 | 63 | `const LAYOUTS: { layout: Layout; label: string; icon: "grid" &#124; "list" &#124; "rows" }`<br>`export function LibraryToolbar({` |
| A | `src/library/SeriesCoverPicker.tsx` | 40 | 0 |  |
| A | `src/library/UpNextReplacement.tsx` | 72 | 0 |  |
| M | `src/library/libraryView.test.ts` | 11 | 1 | `test("long page lists keep the ends and the neighbours, with gaps", () => {` |
| M | `src/library/libraryView.ts` | 12 | 4 | `export interface LibraryView {`<br>`export const NO_FILTERS: Partial<LibraryView> = {`<br>`const keyOf = (kind: ItemKind) => (kind === "books" ? KEY : 'tbv.${kind}View');` |
| A | `src/library/shelfLimits.ts` | 19 | 0 |  |
| M | `src/main.tsx` | 13 | 7 | `restorePrivacy();`<br>`if (isWeb && import.meta.env.PROD && "serviceWorker" in navigator) {` |
| M | `src/notes/NewNoteDialog.tsx` | 10 | 25 | `import { BookCover } from "../components/BookCover";`<br>`export function NewNoteDialog({` |
| M | `src/notes/Notes.tsx` | 21 | 7 | `import { useToast } from "../components/Toast";`<br>`function readPrefs(): { sort: NotesSort; layout: NotesLayout } {`<br>`export function Notes({` |
| A | `src/notes/PersonalNoteEditor.tsx` | 141 | 0 |  |
| M | `src/preview/browse.ts` | 29 | 5 | `type Calls = Pick<`<br>`export function browseStub(): Calls {` |
| M | `src/preview/collections.ts` | 1 | 1 | `export function previewCollections(books: () => BookPreview[], empty: boolean) {` |
| M | `src/preview/kindle.ts` | 15 | 3 | `export function previewKindle(library: () => BookPreview[], tag: (ids: string[])` |
| M | `src/preview/notes.ts` | 2 | 1 | `export function previewNotes(` |
| M | `src/preview/writing.ts` | 26 | 3 | `type Calls = Pick<`<br>`const progress = new Set<(p: { done: number; total: number }) => void>();`<br>`export function previewWriting(): Calls {` |
| A | `src/reader/Contents.test.tsx` | 110 | 0 |  |
| M | `src/reader/Reader.tsx` | 133 | 23 | `import { noteReading, recordReading } from "../lib/recordTime";`<br>`async function setWindowFullscreen(on: boolean) {`<br>`export function Reader({` |
| M | `src/reader/ReaderBars.tsx` | 5 | 3 | `export function ReaderBottomBar({` |
| M | `src/reader/ReaderPanels.tsx` | 62 | 17 | `function EmptyList({ children }: { children: React.ReactNode }) {`<br>`export function LeftPanel({` |
| M | `src/reader/ReaderPopovers.tsx` | 20 | 0 | `const THEME_OPTIONS: { value: ReadingTheme; label: string; style?: React.CSSProp`<br>`export function TextSettings({ settings, onChange }: { settings: ReaderSettings;`<br>`export function PageSettings({` |
| A | `src/reader/StructuredViewer.tsx` | 119 | 0 |  |
| M | `src/reader/reader.test.ts` | 3 | 0 | `describe("reading settings", () => {` |
| M | `src/reader/settings.ts` | 14 | 4 | `import { RATE_RANGE } from "./readAloud";`<br>`export interface ReaderSettings {`<br>`export const DEFAULT_SETTINGS: ReaderSettings = {` |
| A | `src/reader/structuredContent.test.ts` | 33 | 0 |  |
| A | `src/reader/structuredContent.ts` | 117 | 0 |  |
| A | `src/reader/useKeyboardScroll.ts` | 55 | 0 |  |
| M | `src/reader/useReaderEngine.ts` | 76 | 0 | `import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } fro`<br>`export interface EngineEvents {`<br>`export interface ReaderEngine {` |
| M | `src/settings/BrowserTab.tsx` | 64 | 0 | `import {`<br>`export function BrowserTab() {` |
| M | `src/settings/ContentsSection.tsx` | 3 | 2 | `export function ContentsSection({ overview }: { overview: SyncOverview }) {` |
| M | `src/settings/OtherTabs.tsx` | 8 | 3 | `export function LibraryTab({`<br>`function GoodreadsReport({ report, onClose }: { report: GoodreadsImport; onClose`<br>`export function AccessibilityTab() {` |
| M | `src/settings/ReadingHistory.tsx` | 1 | 0 | `export function ReadingHistorySection() {` |
| M | `src/settings/controls.tsx` | 7 | 5 | `export function Section({`<br>`function SectionPart({ id, title, lede, aside, children }: { id: string; title:`<br>`function FoldingSection({ id, title, lede, aside, children }: { id: string; titl` |
| M | `src/settings/updates.ts` | 3 | 3 | `const LOOK_WAIT = 3000;`<br>`export function useStartupUpdateCheck() {` |
| A | `src/shell/Header.test.tsx` | 41 | 0 |  |
| M + | `src/shell/Header.tsx` | 68 | 9 | `export const Header = forwardRef<` |
| M | `src/shell/Sidebar.tsx` | 13 | 1 | `const INNER_ARCH = "M16 42V22.5a8 8 0 0 1 16 0V42";`<br>`export function Sidebar({` |
| M | `src/shell/WindowControls.tsx` | 2 | 6 | `import { useEffect, useState } from "react";`<br>`export function WindowControls() {` |
| A + | `src/shell/Workspace.tsx` | 146 | 0 |  |
| A | `src/shell/navigation.test.tsx` | 103 | 0 |  |
| A | `src/shell/navigationKeys.ts` | 13 | 0 |  |
| A | `src/shell/useNavigationHistory.ts` | 29 | 0 |  |
| A | `src/shell/useNavigationShortcuts.ts` | 48 | 0 |  |
| A | `src/shell/workspaceFrame.ts` | 26 | 0 |  |
| M | `src/splash/startup.ts` | 3 | 2 | `const AT_LEAST = 1_100;`<br>`if (onComputer) {` |
| M + | `src/styles/browse.css` | 207 | 10 |  |
| M | `src/styles/collections.css` | 14 | 0 |  |
| M | `src/styles/details.css` | 2 | 0 |  |
| M | `src/styles/library.css` | 104 | 12 | `button.tag-chip-add:hover {` |
| M | `src/styles/notes.css` | 56 | 0 |  |
| M | `src/styles/reader.css` | 114 | 0 |  |
| M | `src/styles/shell.css` | 43 | 0 |  |
| M | `src/styles/web.css` | 40 | 5 |  |
| M | `src/styles/writing.css` | 27 | 25 |  |
| M | `src/vendor/foliate-js/fixed-layout.js` | 3 | 0 | `export class FixedLayout extends HTMLElement {` |
| M | `src/vendor/foliate-js/scroller.js` | 11 | 0 | `export class Scroller extends HTMLElement {` |
| M | `src/vendor/foliate-js/view.d.ts` | 2 | 0 | `export interface Paginator extends HTMLElement {` |
| M | `src/web/library.ts` | 10 | 1 | `interface Kind {`<br>`export const KINDS: Kind[] = [`<br>`export interface BookRow {` |
| M | `src/web/webApi.ts` | 32 | 8 | `export async function webApi(): Promise<Api> {` |
| M | `src/writing/BookPreview.tsx` | 112 | 11 | `import type { WritingChapter, WritingProject } from "../api/types";`<br>`export function BookPreview({`<br>`const field = (label: string, value: string, onChange: (v: string) => void, plac` |
| M | `src/writing/CanvaLink.tsx` | 3 | 2 | `export function CanvaLink({ what, size, extra, canva }: { what: string; size: st` |
| M | `src/writing/ChapterEditor.tsx` | 19 | 3 | `function PictureLook({ editor, look }: { editor: Editor; look: { caption: string`<br>`export function ChapterEditor({` |
| M | `src/writing/FormattedText.tsx` | 3 | 1 | `interface Props {`<br>`export function FormattedText({ value, onChange, rows = 5, placeholder }: Props)` |
| M | `src/writing/ImportBook.tsx` | 88 | 16 | `import { ACK_CONFIRMATION, ACK_PARAGRAPHS, ACK_TITLE, POLICY_VERSION, sha256Hex,`<br>`export function ImportBookDialog({` |
| M | `src/writing/IsbnGuide.tsx` | 3 | 2 | `export function IsbnGuide({ open = false }: { open?: boolean }) {` |
| M | `src/writing/QuoteDrawer.tsx` | 20 | 27 | `import type { NoteItem } from "../api/types";`<br>`export function QuoteDrawer({` |
| M | `src/writing/SourcesDialog.tsx` | 4 | 4 | `const HINTS: Partial<Record<keyof Source, string>> = {`<br>`export function SourcesDialog({` |
| M | `src/writing/WhereItCameFrom.tsx` | 5 | 4 | `function RecordRow({ record, own }: { record: ProvenanceRecord; own: boolean })`<br>`export function WhereItCameFrom({ projectId }: { projectId: string }) {` |
| M | `src/writing/Writing.tsx` | 84 | 10 | `import { ChapterEditor, type SaveState } from "./ChapterEditor";`<br>`import { PreviewsDialog } from "./Previews";`<br>`export function Writing({` |
| M | `src/writing/WritingDialogs.tsx` | 12 | 6 | `import { usePublisher } from "../license/Publisher";`<br>`import { readPage, startingTitle, TEMPLATES, templateSections, type Template } f`<br>`export function NewBookDialog({` |
| M | `src/writing/citeproc.d.ts` | 2 | 1 | `declare module "citeproc" {` |
| M | `src/writing/epub.test.ts` | 48 | 2 | `import { bookOrder, buildEpub, chapterXhtml, copyrightHtml, epubFileName, epubFi`<br>`describe("citations", () => {` |
| M | `src/writing/epub.ts` | 24 | 19 | `import { blurbHtml, hasFormatting } from "./blurb";`<br>`export interface ExportSettings {`<br>`export const DEFAULT_EXPORT: ExportSettings = {` |
| M | `src/writing/extensions.ts` | 42 | 1 | `export const PoemLines = Extension.create({` |
| M | `src/writing/importDoc.test.ts` | 27 | 1 | `import { describe, expect, it } from "vitest";`<br>`describe("Paperback cover", () => {` |
| M | `src/writing/importDoc.ts` | 34 | 4 | `export interface ImportedChapter {`<br>`export function textToHtml(text: string): string {`<br>`function fromEpub(bytes: Uint8Array, fallback: string): ImportedDocument {` |
| M | `src/writing/manuscript.ts` | 21 | 3 | `function withoutMarks(html: string): string {`<br>`export function buildManuscript(doc: ImportedDocument, at: SplitAt): Manuscript` |
| M | `src/writing/pages.ts` | 2 | 2 | `export const KINDS: Record<PageKind, KindInfo> = {` |
| M | `src/writing/sources.test.ts` | 79 | 4 | `describe("sources and citations", () => {` |
| M | `src/writing/sources.ts` | 89 | 17 | `export interface Source {`<br>`export const STYLES: { value: CitationStyle; label: string; hint: string; headin`<br>`const STYLE_FILES: Record<Exclude<CitationStyle, "ap">, () => Promise<{ default:` |
