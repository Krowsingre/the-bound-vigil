//! Printing a book written in Scribe as a PDF. The page lays the book out
//! with Paged.js in a window of its own (print.html), out of sight, so the
//! app's own styles never touch it. On Windows the web view then saves it
//! straight to a PDF at the place chosen, at the book's exact page size; on
//! a Mac the window shows the pages and the system's print dialog opens,
//! where "Save as PDF" is.

use std::sync::mpsc::Sender;
use std::sync::Mutex;
#[cfg(desktop)]
use std::{sync::mpsc::channel, time::Duration};

use crate::CommandResult;

/// The book waiting to be laid out, and where to say it's done.
struct Job {
    html: String,
    done: Sender<Result<u32, String>>,
}

static JOB: Mutex<Option<Job>> = Mutex::new(None);

#[cfg(desktop)]
const LABEL: &str = "print";

/// How long a long book may take to lay out.
#[cfg(desktop)]
const LAYING_OUT: Duration = Duration::from_secs(15 * 60);

/// The print window asks for the book it's to lay out.
#[tauri::command]
pub fn print_job() -> CommandResult<String> {
    JOB.lock().map_err(|e| e.to_string())?.as_ref().map(|j| j.html.clone()).ok_or_else(|| "There's no book waiting to print.".into())
}

/// The print window has laid the book out (or couldn't).
#[tauri::command]
pub fn print_laid_out(pages: u32, error: Option<String>) {
    if let Ok(job) = JOB.lock() {
        if let Some(job) = job.as_ref() {
            let _ = job.done.send(error.map_or(Ok(pages), Err));
        }
    }
}

/// Lays the book out and saves it as a PDF at `path` (Windows), or opens
/// the print dialog with it (Mac). Answers with the number of pages.
#[tauri::command]
pub async fn print_book(app: tauri::AppHandle, html: String, path: Option<String>) -> CommandResult<u32> {
    #[cfg(not(desktop))]
    {
        let _ = (app, html, path);
        Err("Making a PDF works on the computer for now.".into())
    }
    #[cfg(desktop)]
    {
        use tauri::Manager;
        if let Some(old) = app.get_webview_window(LABEL) {
            let _ = old.close();
        }
        let (send, receive) = channel();
        *JOB.lock().map_err(|e| e.to_string())? = Some(Job { html, done: send });
        let shown = cfg!(target_os = "macos");
        let window = tauri::WebviewWindowBuilder::new(&app, LABEL, tauri::WebviewUrl::App("print.html".into()))
            .title("Print")
            .inner_size(820.0, 1000.0)
            .visible(shown)
            .build()
            .map_err(|e| e.to_string())?;
        let pages = tauri::async_runtime::spawn_blocking(move || receive.recv_timeout(LAYING_OUT).map_err(|_| "Laying the pages out took too long.".to_string()))
            .await
            .map_err(|e| e.to_string())??;
        *JOB.lock().map_err(|e| e.to_string())? = None;
        let pages = match pages {
            Ok(pages) => pages,
            Err(e) => {
                let _ = window.close();
                return Err(format!("The pages couldn't be laid out ({e})."));
            }
        };
        let saved = save(&window, path).await;
        if !shown {
            let _ = window.close();
        }
        saved.map(|_| pages)
    }
}

/// Windows: the web view prints the laid-out pages to a PDF file itself.
#[cfg(windows)]
async fn save(window: &tauri::WebviewWindow, path: Option<String>) -> CommandResult<()> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    let path = path.ok_or("Choose where to save the PDF.")?;
    let (send, receive) = channel::<String>();
    window
        .with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else { return };
            let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |_, answer| {
                let _ = send.send(answer);
                Ok(())
            }));
            let options = windows_core::HSTRING::from(
                r#"{"printBackground":true,"preferCSSPageSize":true,"marginTop":0,"marginBottom":0,"marginLeft":0,"marginRight":0,"displayHeaderFooter":false,"generateTaggedPDF":true,"generateDocumentOutline":true}"#,
            );
            let _ = core.CallDevToolsProtocolMethod(windows_core::w!("Page.printToPDF"), &options, &done);
        })
        .map_err(|e| e.to_string())?;
    let answer = tauri::async_runtime::spawn_blocking(move || receive.recv_timeout(Duration::from_secs(600)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "Saving the PDF took too long.".to_string())?;
    #[derive(serde::Deserialize)]
    struct Printed {
        data: String,
    }
    let printed: Printed = serde_json::from_str(&answer).map_err(|_| format!("The PDF couldn't be made ({answer})."))?;
    let bytes = decode_base64(&printed.data).ok_or("The PDF came back unreadable.")?;
    std::fs::write(&path, bytes).map_err(|e| format!("The PDF couldn't be saved there ({e})."))
}

/// The Mac (and others): the pages show in their window, and the print dialog opens over them.
#[cfg(all(desktop, not(windows)))]
async fn save(window: &tauri::WebviewWindow, _path: Option<String>) -> CommandResult<()> {
    let _ = window.set_focus();
    window.print().map_err(|e| e.to_string())
}

#[cfg(windows)]
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0);
    for c in text.bytes() {
        if c == b'=' {
            break;
        }
        buffer = (buffer << 6) | u32::from(value(c)?);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}
