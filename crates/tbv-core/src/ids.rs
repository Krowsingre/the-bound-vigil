//! Stable identifiers. Books are identified by a hash of their bytes so every
//! device agrees on the id; everything else that syncs gets a UUIDv7.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::model::BookId;

pub const BOOK_ID_PREFIX: &str = "sha256:";

/// Why a book stopped part way through being read.
pub const CANCELLED: &str = "Cancelled";

/// Hashes the whole file, streaming, so large PDFs never sit in memory.
pub fn book_id_for_file(path: &Path) -> Result<BookId> {
    book_id_for_file_with_progress(path, &mut |_| true)
}

/// As `book_id_for_file`, telling `read_so_far` how many bytes are done.
/// Reading a file a cloud app hasn't downloaded yet brings it down first,
/// so this is where a slow import spends its time. `read_so_far` returns
/// false to stop (the import was cancelled).
pub fn book_id_for_file_with_progress(path: &Path, read_so_far: &mut dyn FnMut(u64) -> bool) -> Result<BookId> {
    let mut reader = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut done = 0u64;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        done += read as u64;
        if !read_so_far(done) {
            return Err(Error::Unsuitable(CANCELLED.into()));
        }
    }
    Ok(format!(
        "{BOOK_ID_PREFIX}{}",
        hex::encode(hasher.finalize())
    ))
}

/// The hex part of a book id, safe to use in file names.
pub fn book_id_hex(id: &str) -> &str {
    id.strip_prefix(BOOK_ID_PREFIX).unwrap_or(id)
}

pub fn new_record_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reading_stops_when_asked() {
        let dir = tempfile::tempdir().unwrap();
        let big = dir.path().join("big.pdf");
        File::create(&big).unwrap().write_all(&vec![7u8; 3 << 20]).unwrap();
        let mut seen = 0;
        let stopped = book_id_for_file_with_progress(&big, &mut |_| {
            seen += 1;
            false
        });
        assert!(matches!(stopped, Err(Error::Unsuitable(reason)) if reason == CANCELLED));
        assert_eq!(seen, 1, "stops after the first part");
    }

    #[test]
    fn same_bytes_give_same_id_regardless_of_path() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.epub");
        let b = dir.path().join("nested-b.epub");
        File::create(&a)
            .unwrap()
            .write_all(b"identical bytes")
            .unwrap();
        File::create(&b)
            .unwrap()
            .write_all(b"identical bytes")
            .unwrap();
        assert_eq!(book_id_for_file(&a).unwrap(), book_id_for_file(&b).unwrap());
    }

    #[test]
    fn id_is_prefixed_sha256() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.pdf");
        File::create(&a).unwrap().write_all(b"abc").unwrap();
        assert_eq!(
            book_id_for_file(&a).unwrap(),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
