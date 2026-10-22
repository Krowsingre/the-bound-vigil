//! Where every book is: on this computer, in the main sync place, in the
//! second. Read from each place's own listing, so a file put there by
//! another device counts too.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use super::{ProviderView, Remote};
use crate::error::{Error, Result};
use crate::ids::book_id_hex;
use crate::library::Library;

/// One book and where its file is. A place that isn't set up, or couldn't
/// be reached, is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPlaces {
    pub book_id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub format: String,
    pub here: bool,
    pub main: Option<bool>,
    pub also: Option<bool>,
}

/// A sync place as the page names it, and why it couldn't be checked.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceCheck {
    pub provider: ProviderView,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacesView {
    pub main: Option<PlaceCheck>,
    pub also: Option<PlaceCheck>,
    pub books: Vec<BookPlaces>,
}

/// The books a place holds, by hash.
pub fn held(place: &mut dyn Remote) -> Result<HashSet<String>> {
    let mut out = HashSet::new();
    for name in place.list("books/")? {
        // Some places list what's inside folders too ("<hash>/part 1.mp3").
        let name = name.split('/').next().unwrap_or_default();
        if !name.is_empty() && !name.starts_with('.') {
            out.insert(name.split('.').next().unwrap_or_default().to_string());
        }
    }
    Ok(out)
}

/// Every book in the library, A to Z, with where its file is. `main` and
/// `also` are what each place holds (see `held`), when it was checked.
pub fn book_places(library: &Mutex<Library>, main: Option<&HashSet<String>>, also: Option<&HashSet<String>>) -> Result<Vec<BookPlaces>> {
    let rows = {
        let l = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?;
        let mut stmt = l.conn.prepare(
            "SELECT b.id, b.title, b.authors, b.format, lf.path FROM books b LEFT JOIN local_files lf ON lf.book_id = b.id
             WHERE b.deleted_at IS NULL ORDER BY b.title COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    Ok(rows
        .into_iter()
        .map(|(id, title, authors, format, path)| {
            let hex = book_id_hex(&id).to_string();
            BookPlaces {
                here: path.as_deref().is_some_and(|p| Path::new(p).exists()),
                main: main.map(|m| m.contains(&hex)),
                also: also.map(|a| a.contains(&hex)),
                authors: serde_json::from_str(&authors).unwrap_or_default(),
                book_id: id,
                title,
                format,
            }
        })
        .collect())
}
