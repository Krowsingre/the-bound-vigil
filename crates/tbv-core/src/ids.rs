//! Stable identifiers. Books are identified by a hash of their bytes so every
//! device agrees on the id; everything else that syncs gets a UUIDv7.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::error::Result;
use crate::model::BookId;

pub const BOOK_ID_PREFIX: &str = "sha256:";

/// Hashes the whole file, streaming, so large PDFs never sit in memory.
pub fn book_id_for_file(path: &Path) -> Result<BookId> {
    let mut reader = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
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
