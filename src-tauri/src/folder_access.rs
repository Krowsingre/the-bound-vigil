//! The Mac App Store's sandbox lets TBV into a folder the person chose (the
//! library's cloud folder, a folder of books) only until TBV quits. A
//! bookmark kept for each one lets TBV back in each time it opens, as the
//! iPhone app does for folders chosen in Files. Elsewhere this does nothing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Where the bookmarks are kept: each folder's path, and its bookmark in hex.
fn kept_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("folder-access.json"))
}

fn read(app: &AppHandle) -> BTreeMap<String, String> {
    kept_file(app).and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write(app: &AppHandle, kept: &BTreeMap<String, String>) {
    if let Some(file) = kept_file(app) {
        let _ = file.parent().map(std::fs::create_dir_all);
        let _ = std::fs::write(file, serde_json::to_vec(kept).unwrap_or_default());
    }
}

/// Keeps TBV's way into a folder the person just chose.
#[tauri::command]
pub fn keep_folder_access(app: AppHandle, path: String) -> Result<(), String> {
    let Some(bookmark) = mac::bookmark(Path::new(&path)) else { return Ok(()) };
    let mut kept = read(&app);
    kept.insert(path, hex(&bookmark));
    write(&app, &kept);
    Ok(())
}

/// Lets TBV back into every folder it kept a way into, as it opens.
pub fn reopen(app: &AppHandle) {
    let kept = read(app);
    if kept.is_empty() {
        return;
    }
    let mut still = BTreeMap::new();
    for bookmark in kept.values() {
        let Some(bytes) = unhex(bookmark) else { continue };
        // A folder that's gone, or that TBV may no longer open, is forgotten.
        if let Some((path, fresh)) = mac::reopen(&bytes) {
            still.insert(path, fresh.map(|b| hex(&b)).unwrap_or_else(|| bookmark.clone()));
        }
    }
    write(app, &still);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    (0..text.len()).step_by(2).map(|i| text.get(i..i + 2).and_then(|pair| u8::from_str_radix(pair, 16).ok())).collect()
}

#[cfg(target_os = "macos")]
mod mac {
    use std::path::Path;

    use objc2::runtime::Bool;
    use objc2_foundation::{NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL};

    /// A bookmark that opens the folder again after TBV restarts.
    pub fn bookmark(path: &Path) -> Option<Vec<u8>> {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path.to_str()?));
        url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(NSURLBookmarkCreationOptions::WithSecurityScope, None, None)
            .ok()
            .map(|data| data.to_vec())
    }

    /// Opens the way into a bookmarked folder again: its path, and a fresh
    /// bookmark if the old one has gone stale (the folder moved, say).
    pub fn reopen(bookmark: &[u8]) -> Option<(String, Option<Vec<u8>>)> {
        let data = NSData::with_bytes(bookmark);
        let mut stale = Bool::NO;
        // SAFETY: `stale` is a valid pointer for the call.
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(&data, NSURLBookmarkResolutionOptions::WithSecurityScope, None, &mut stale)
        }
        .ok()?;
        // SAFETY: a file URL from a security-scoped bookmark. Access is kept until TBV quits.
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return None;
        }
        let path = url.path()?.to_string();
        let fresh = if stale.as_bool() { bookmark_of(&url) } else { None };
        Some((path, fresh))
    }

    fn bookmark_of(url: &NSURL) -> Option<Vec<u8>> {
        url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(NSURLBookmarkCreationOptions::WithSecurityScope, None, None)
            .ok()
            .map(|data| data.to_vec())
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    use std::path::Path;

    pub fn bookmark(_path: &Path) -> Option<Vec<u8>> {
        None
    }

    pub fn reopen(_bookmark: &[u8]) -> Option<(String, Option<Vec<u8>>)> {
        None
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn bookmarks_go_to_text_and_back() {
        let bytes = vec![0, 1, 0xab, 0xff, 42];
        assert_eq!(super::unhex(&super::hex(&bytes)), Some(bytes));
        assert_eq!(super::unhex("zz"), None);
    }
}
