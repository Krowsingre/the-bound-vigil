//! Where a book in Scribe came from. Importing a manuscript into Scribe asks
//! the person to confirm they own it or may publish it, and that
//! confirmation is kept as a signed record with the book: the exact words
//! they agreed to (by their SHA-256), the original file's SHA-256, when, and
//! on which device. Duplicating a book makes a record of its own pointing
//! back at the original's.
//!
//! Each device signs with its own Ed25519 key, made the first time it's
//! needed and kept on the device. The record is JSON with its keys sorted
//! and no spaces, so every device reads back the very bytes that were
//! signed; the public key travels with it so any device can check it. On
//! iPhone and iPad the app also asks Apple's App Attest to vouch for the
//! record, and that stamp is kept beside it as it came.
//!
//! None of this checks who wrote a book: it records the person's own
//! promise, on the honour system. Records are synced with the book
//! (writing_provenance) and never changed once made. The original file
//! stays on the device that imported it, until the person deletes it.

use std::fs;
use std::path::PathBuf;

use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair, UnparsedPublicKey, ED25519};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::ids::new_record_id;
use crate::library::Library;
use crate::model::IsoUtc;
use crate::time::now_utc;

/// The shape of a record. A later one adds fields; older ones still check.
pub const RECORD_SCHEMA: u32 = 1;
pub const ALGORITHM: &str = "Ed25519";

/// What the person agreed to, as the import dialog showed it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAcknowledgment {
    /// Which wording of the confirmation it was (src/writing/acknowledgment.ts).
    pub policy_version: String,
    /// The warning and the confirmation, word for word. Only its SHA-256 is kept.
    pub wording: String,
    pub source_name: String,
    /// The original file's SHA-256, in hex.
    pub source_sha256: String,
    pub source_bytes: u64,
    /// What kind of file it was: docx, epub, kindle_create…
    pub source_format: String,
    /// How they agreed: a ticked box.
    pub method: String,
}

/// A record as Book details shows it, checked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceRecord {
    pub id: String,
    /// The book it belongs to: this one, or the book it was duplicated from.
    pub project_id: String,
    /// `import` or `duplicate`.
    pub event: String,
    pub created_at: IsoUtc,
    /// The record itself, as signed.
    pub record: Value,
    /// `valid`, `invalid` (the record or its signature doesn't match) or `unreadable`.
    pub signature: String,
    pub key_id: String,
    /// Whether Apple's App Attest vouched for it too.
    pub apple_stamp: bool,
    /// The device that made it, by the name it has now, when known.
    pub device: Option<String>,
}

/// The original file of an import, kept on this device.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingSource {
    pub sha256: String,
    pub name: String,
    pub bytes: u64,
    pub kept_at: IsoUtc,
    pub path: String,
}

/// Book details' Where it came from: the records (the book's own first,
/// then those of the book it was duplicated from), the original file when
/// this device has it, and this device's own history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingProvenance {
    pub records: Vec<ProvenanceRecord>,
    pub sources: Vec<WritingSource>,
    pub history: Vec<ProvenanceEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceEvent {
    pub at: IsoUtc,
    pub event: String,
    pub detail: String,
}

/// JSON with every object's keys in order and no spaces: the bytes that are signed.
pub fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys.iter().map(|k| format!("{}:{}", Value::String((*k).clone()), canonical(&map[*k]))).collect();
            format!("{{{}}}", inner.join(","))
        }
        Value::Array(items) => format!("[{}]", items.iter().map(canonical).collect::<Vec<_>>().join(",")),
        other => other.to_string(),
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// A key's name: the start of its SHA-256.
fn key_id(public_key: &[u8]) -> String {
    sha256_hex(public_key)[..16].to_string()
}

fn is_sha256(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Checks a record's signature, and that it is about the book it's kept with.
pub fn check(record: &str, signature: &str, public_key: &str, key: &str, project_id: &str) -> &'static str {
    let (Ok(sig), Ok(public)) = (hex::decode(signature), hex::decode(public_key)) else {
        return "unreadable";
    };
    let Ok(parsed) = serde_json::from_str::<Value>(record) else {
        return "unreadable";
    };
    let about = parsed.get("projectId").and_then(Value::as_str) == Some(project_id);
    let named = parsed.get("keyId").and_then(Value::as_str) == Some(key) && key_id(&public) == key;
    let signed = UnparsedPublicKey::new(&ED25519, &public).verify(record.as_bytes(), &sig).is_ok();
    if about && named && signed && canonical(&parsed) == record {
        "valid"
    } else {
        "invalid"
    }
}

impl Library {
    /// This device's signing key, made the first time.
    fn signing_key(&self) -> Result<Ed25519KeyPair> {
        let saved: Option<Vec<u8>> = self.conn.query_row("SELECT pkcs8 FROM signing_key WHERE id = 1", [], |r| r.get(0)).optional()?;
        let pkcs8 = match saved {
            Some(bytes) => bytes,
            None => {
                let made = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).map_err(|_| Error::Unsuitable("this device couldn't make a signing key".into()))?;
                let bytes = made.as_ref().to_vec();
                self.conn.execute("INSERT INTO signing_key (id, pkcs8, created_at) VALUES (1, ?1, ?2)", params![bytes, now_utc()])?;
                bytes
            }
        };
        Ed25519KeyPair::from_pkcs8(&pkcs8).map_err(|_| Error::Unsuitable("this device's signing key can't be read".into()))
    }

    /// This device's public key, in hex, for App Attest to vouch for.
    pub fn signing_public_key(&self) -> Result<String> {
        Ok(hex::encode(self.signing_key()?.public_key().as_ref()))
    }

    fn log_provenance(&self, event: &str, project_id: &str, record_id: Option<&str>, detail: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO provenance_log (at, event, project_id, record_id, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![now_utc(), event, project_id, record_id, detail],
        )?;
        Ok(())
    }

    /// Signs and keeps a record. `stamp` is given the signed bytes and may
    /// answer Apple's stamp for them (iPhone and iPad), kept as it came.
    fn sign_record(&self, project_id: &str, event: &str, mut fields: Map<String, Value>, stamp: impl FnOnce(&str) -> Option<String>) -> Result<ProvenanceRecord> {
        let key = self.signing_key()?;
        let public = key.public_key().as_ref().to_vec();
        let id = new_record_id();
        let now = now_utc();
        fields.insert("schema".into(), json!(RECORD_SCHEMA));
        fields.insert("event".into(), json!(event));
        fields.insert("recordId".into(), json!(id));
        fields.insert("projectId".into(), json!(project_id));
        fields.insert("at".into(), json!(now));
        fields.insert("installation".into(), json!(self.device_id()?));
        fields.insert("algorithm".into(), json!(ALGORITHM));
        fields.insert("keyId".into(), json!(key_id(&public)));
        let record = canonical(&Value::Object(fields));
        let signature = hex::encode(key.sign(record.as_bytes()).as_ref());
        let apple = stamp(&record).filter(|s| !s.trim().is_empty());
        self.conn.execute(
            "INSERT INTO writing_provenance (id, project_id, event, record, signature, public_key, key_id, apple_stamp, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, project_id, event, record, signature, hex::encode(&public), key_id(&public), apple, now],
        )?;
        self.log_provenance(event, project_id, Some(&id), if apple.is_some() { "Signed on this device, with Apple's stamp" } else { "Signed on this device" })?;
        self.provenance_record(&id)
    }

    /// Records that the person confirmed they may import and publish this
    /// manuscript, for the Scribe book made from it.
    pub fn record_writing_import(&self, project_id: &str, ack: &ImportAcknowledgment, stamp: impl FnOnce(&str) -> Option<String>) -> Result<ProvenanceRecord> {
        if ack.wording.trim().is_empty() || ack.policy_version.trim().is_empty() {
            return Err(Error::Unsuitable("the confirmation's wording is missing".into()));
        }
        if !is_sha256(&ack.source_sha256) {
            return Err(Error::Unsuitable("the original file's fingerprint is missing".into()));
        }
        self.conn.query_row("SELECT 1 FROM writing_projects WHERE id = ?1", params![project_id], |_| Ok(())).optional()?.ok_or_else(|| Error::Unsuitable("that book isn't in Scribe".into()))?;
        let mut fields = Map::new();
        fields.insert("policyVersion".into(), json!(ack.policy_version));
        fields.insert("wordingSha256".into(), json!(sha256_hex(ack.wording.as_bytes())));
        fields.insert("method".into(), json!(ack.method));
        fields.insert(
            "source".into(),
            json!({ "name": ack.source_name, "sha256": ack.source_sha256.to_ascii_lowercase(), "bytes": ack.source_bytes, "format": ack.source_format }),
        );
        self.sign_record(project_id, "import", fields, stamp)
    }

    fn provenance_record(&self, id: &str) -> Result<ProvenanceRecord> {
        let row = self.conn.query_row(
            "SELECT p.id, p.project_id, p.event, p.created_at, p.record, p.signature, p.public_key, p.key_id, p.apple_stamp
             FROM writing_provenance p WHERE p.id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, Option<String>>(8)?,
                ))
            },
        )?;
        let (id, project_id, event, created_at, record, signature, public_key, key, apple) = row;
        let status = check(&record, &signature, &public_key, &key, &project_id);
        let parsed: Value = serde_json::from_str(&record).unwrap_or(Value::Null);
        let device = parsed
            .get("installation")
            .and_then(Value::as_str)
            .and_then(|d| self.conn.query_row("SELECT name FROM devices WHERE device_id = ?1", params![d], |r| r.get::<_, String>(0)).optional().ok().flatten());
        Ok(ProvenanceRecord { id, project_id, event, created_at, record: parsed, signature: status.into(), key_id: key, apple_stamp: apple.is_some(), device })
    }

    /// Adds Apple's stamp to a record made a moment ago, once: a record
    /// that has one keeps it.
    pub fn attach_apple_stamp(&self, id: &str, stamp: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE writing_provenance SET apple_stamp = ?2, updated_at = ?3 WHERE id = ?1 AND apple_stamp IS NULL",
            params![id, stamp, now_utc()],
        )?;
        Ok(())
    }

    /// The record as signed, for Apple's stamp.
    pub fn provenance_text(&self, id: &str) -> Result<String> {
        Ok(self.conn.query_row("SELECT record FROM writing_provenance WHERE id = ?1", params![id], |r| r.get(0))?)
    }

    /// Everything known about where a book came from, checked now. A record
    /// that fails its check is noted in this device's history.
    pub fn writing_provenance(&self, project_id: &str) -> Result<WritingProvenance> {
        let mut records = Vec::new();
        let mut books = vec![project_id.to_string()];
        let mut seen = std::collections::HashSet::new();
        while let Some(book) = books.pop() {
            if !seen.insert(book.clone()) {
                continue;
            }
            let ids = self
                .conn
                .prepare("SELECT id FROM writing_provenance WHERE project_id = ?1 ORDER BY created_at, id")?
                .query_map(params![book], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for id in ids {
                let record = self.provenance_record(&id)?;
                if record.signature != "valid" {
                    let noted: bool = self.conn.query_row(
                        "SELECT EXISTS (SELECT 1 FROM provenance_log WHERE record_id = ?1 AND event = 'check_failed')",
                        params![record.id],
                        |r| r.get(0),
                    )?;
                    if !noted {
                        self.log_provenance("check_failed", project_id, Some(&record.id), "A record didn't match its signature")?;
                    }
                }
                if let Some(from) = record.record.get("duplicatedFrom").and_then(Value::as_str) {
                    books.push(from.to_string());
                }
                records.push(record);
            }
        }
        let sources = self.writing_sources(project_id)?;
        let history = self
            .conn
            .prepare("SELECT at, event, detail FROM provenance_log WHERE project_id = ?1 ORDER BY id")?
            .query_map(params![project_id], |r| Ok(ProvenanceEvent { at: r.get(0)?, event: r.get(1)?, detail: r.get(2)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(WritingProvenance { records, sources, history })
    }

    /// Where originals are kept: next to the pictures, on this device only.
    fn scribe_originals_dir(&self) -> PathBuf {
        self.paths.pictures_dir.with_file_name("Scribe originals")
    }

    /// Keeps the original file of an import, named by its SHA-256.
    pub fn keep_writing_source(&self, project_id: &str, name: &str, bytes: &[u8]) -> Result<WritingSource> {
        let sha = sha256_hex(bytes);
        let extension = std::path::Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .filter(|e| e.len() <= 10 && e.chars().all(|c| c.is_ascii_alphanumeric()))
            .map(|e| format!(".{}", e.to_ascii_lowercase()))
            .unwrap_or_default();
        let file = format!("{sha}{extension}");
        let dir = self.scribe_originals_dir();
        fs::create_dir_all(&dir)?;
        let path = dir.join(&file);
        if !path.exists() {
            fs::write(&path, bytes)?;
        }
        let name: String = name.trim().chars().take(200).collect();
        self.conn.execute(
            "INSERT OR REPLACE INTO writing_sources (project_id, sha256, name, bytes, file, kept_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![project_id, sha, name, bytes.len() as i64, file, now_utc()],
        )?;
        self.log_provenance("source_kept", project_id, None, &format!("Kept the original, {name}"))?;
        self.writing_sources(project_id)?.into_iter().find(|s| s.sha256 == sha).ok_or_else(|| Error::Unsuitable("the original couldn't be kept".into()))
    }

    pub fn writing_sources(&self, project_id: &str) -> Result<Vec<WritingSource>> {
        let dir = self.scribe_originals_dir();
        let rows = self
            .conn
            .prepare("SELECT sha256, name, bytes, kept_at, file FROM writing_sources WHERE project_id = ?1 ORDER BY kept_at")?
            .query_map(params![project_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .into_iter()
            .filter(|(.., file)| dir.join(file).exists())
            .map(|(sha256, name, bytes, kept_at, file)| WritingSource { sha256, name, bytes: bytes.max(0) as u64, kept_at, path: dir.join(file).to_string_lossy().into_owned() })
            .collect())
    }

    /// Deletes a kept original. Its SHA-256 stays in the signed record.
    pub fn delete_writing_source(&self, project_id: &str, sha256: &str) -> Result<()> {
        let file: Option<(String, String)> = self
            .conn
            .query_row("SELECT file, name FROM writing_sources WHERE project_id = ?1 AND sha256 = ?2", params![project_id, sha256], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        let Some((file, name)) = file else { return Ok(()) };
        self.conn.execute("DELETE FROM writing_sources WHERE project_id = ?1 AND sha256 = ?2", params![project_id, sha256])?;
        let others: bool = self.conn.query_row("SELECT EXISTS (SELECT 1 FROM writing_sources WHERE file = ?1)", params![file], |r| r.get(0))?;
        if !others {
            let _ = fs::remove_file(self.scribe_originals_dir().join(&file));
        }
        self.log_provenance("source_deleted", project_id, None, &format!("Deleted the original, {name}"))?;
        Ok(())
    }

    /// A copy of a book with its own identity: its sections and settings,
    /// not its drafts. The copy gets a record pointing back at the book it
    /// came from, whose own records stay as they are.
    pub fn duplicate_writing_project(&self, id: &str, stamp: impl FnOnce(&str) -> Option<String>) -> Result<crate::writing::WritingProjectView> {
        let original = self.writing_project(id)?;
        let copy = new_record_id();
        let now = now_utc();
        let title: String = format!("{} (copy)", original.project.title).chars().take(200).collect();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO writing_projects (id, title, author, series, series_index, language, description, cover, export, cover_page, created_at, updated_at)
             SELECT ?2, ?3, author, series, series_index, language, description, cover, export, cover_page, ?4, ?4 FROM writing_projects WHERE id = ?1",
            params![id, copy, title, now],
        )?;
        let mut new_ids = std::collections::HashMap::new();
        for c in &original.chapters {
            new_ids.insert(c.id.clone(), new_record_id());
        }
        for c in &original.chapters {
            let part = c.part.as_ref().and_then(|p| new_ids.get(p)).cloned();
            tx.execute(
                "INSERT INTO writing_chapters (id, project_id, title, body, position, role, part, page, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![new_ids[&c.id], copy, c.title, c.body, c.position, c.role, part, c.page, now],
            )?;
        }
        tx.execute(
            "INSERT OR IGNORE INTO writing_sources (project_id, sha256, name, bytes, file, kept_at)
             SELECT ?2, sha256, name, bytes, file, kept_at FROM writing_sources WHERE project_id = ?1",
            params![id, copy],
        )?;
        tx.commit()?;
        let earlier: Vec<String> = self
            .conn
            .prepare("SELECT id FROM writing_provenance WHERE project_id = ?1 ORDER BY created_at, id")?
            .query_map(params![id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut fields = Map::new();
        fields.insert("duplicatedFrom".into(), json!(id));
        fields.insert("duplicatedRecords".into(), json!(earlier));
        self.sign_record(&copy, "duplicate", fields, stamp)?;
        self.writing_project(&copy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::open_temp_library as temp_library;

    fn ack(sha: &str) -> ImportAcknowledgment {
        ImportAcknowledgment {
            policy_version: "1".into(),
            wording: "I confirm that I own this content.".into(),
            source_name: "My Book.docx".into(),
            source_sha256: sha.into(),
            source_bytes: 5,
            source_format: "docx".into(),
            method: "checkbox".into(),
        }
    }

    #[test]
    fn keys_are_sorted_and_spaces_left_out() {
        assert_eq!(canonical(&json!({ "b": 1, "a": { "d": [1, "x"], "c": null } })), r#"{"a":{"c":null,"d":[1,"x"]},"b":1}"#);
    }

    #[test]
    fn an_import_is_signed_and_checks() {
        let (_dir, lib) = temp_library();
        let book = lib.create_writing_project("Night", Some("A. Pen")).unwrap();
        let sha = sha256_hex(b"hello");
        let mut signed = String::new();
        let made = lib
            .record_writing_import(&book.project.id, &ack(&sha), |record| {
                signed = record.to_string();
                Some("{\"assertion\":\"x\"}".into())
            })
            .unwrap();
        assert_eq!(made.signature, "valid");
        assert!(made.apple_stamp);
        assert_eq!(made.record["source"]["sha256"], json!(sha));
        assert_eq!(made.record["wordingSha256"], json!(sha256_hex(b"I confirm that I own this content.")));
        assert_eq!(made.record["projectId"], json!(book.project.id));
        let stored: String = lib.conn.query_row("SELECT record FROM writing_provenance WHERE id = ?1", params![made.id], |r| r.get(0)).unwrap();
        assert_eq!(stored, signed);
        assert!(lib.record_writing_import(&book.project.id, &ack("not a hash"), |_| None).is_err());
    }

    #[test]
    fn a_changed_record_fails_its_check_and_is_noted() {
        let (_dir, lib) = temp_library();
        let book = lib.create_writing_project("Night", None).unwrap();
        let made = lib.record_writing_import(&book.project.id, &ack(&sha256_hex(b"x")), |_| None).unwrap();
        lib.conn
            .execute("UPDATE writing_provenance SET record = replace(record, 'My Book', 'Their Book') WHERE id = ?1", params![made.id])
            .unwrap();
        let seen = lib.writing_provenance(&book.project.id).unwrap();
        assert_eq!(seen.records[0].signature, "invalid");
        assert!(seen.history.iter().any(|e| e.event == "check_failed"));
        // Moved to another book, it no longer checks either.
        let other = lib.create_writing_project("Day", None).unwrap();
        let made = lib.record_writing_import(&book.project.id, &ack(&sha256_hex(b"y")), |_| None).unwrap();
        lib.conn.execute("UPDATE writing_provenance SET project_id = ?2 WHERE id = ?1", params![made.id, other.project.id]).unwrap();
        assert_eq!(lib.writing_provenance(&other.project.id).unwrap().records[0].signature, "invalid");
    }

    #[test]
    fn a_duplicate_has_its_own_record_and_keeps_the_originals() {
        let (_dir, lib) = temp_library();
        let book = lib.create_writing_project("Night", None).unwrap();
        lib.save_writing_chapter(&book.chapters[0].id, "One", "<p>Dark.</p>").unwrap();
        let source = lib.keep_writing_source(&book.project.id, "Night.docx", b"hello").unwrap();
        let import = lib.record_writing_import(&book.project.id, &ack(&source.sha256), |_| None).unwrap();
        let copy = lib.duplicate_writing_project(&book.project.id, |_| None).unwrap();
        assert_ne!(copy.project.id, book.project.id);
        assert_eq!(copy.project.title, "Night (copy)");
        assert_eq!(copy.chapters[0].body, "<p>Dark.</p>");
        assert_ne!(copy.chapters[0].id, book.chapters[0].id);
        let seen = lib.writing_provenance(&copy.project.id).unwrap();
        assert_eq!(seen.records.len(), 2);
        assert_eq!(seen.records[0].event, "duplicate");
        assert_eq!(seen.records[0].record["duplicatedRecords"], json!([import.id]));
        assert_eq!(seen.records[1].id, import.id);
        assert!(seen.records.iter().all(|r| r.signature == "valid"));
        assert_eq!(seen.sources.len(), 1);
        // The original's records are untouched.
        assert_eq!(lib.writing_provenance(&book.project.id).unwrap().records.len(), 1);
    }

    #[test]
    fn an_original_is_kept_until_deleted_and_its_record_stays() {
        let (_dir, lib) = temp_library();
        let book = lib.create_writing_project("Night", None).unwrap();
        let kept = lib.keep_writing_source(&book.project.id, "Night.kpf", b"bytes").unwrap();
        assert!(kept.path.ends_with(".kpf"));
        assert_eq!(std::fs::read(&kept.path).unwrap(), b"bytes");
        lib.record_writing_import(&book.project.id, &ack(&kept.sha256), |_| None).unwrap();
        lib.delete_writing_source(&book.project.id, &kept.sha256).unwrap();
        assert!(!std::path::Path::new(&kept.path).exists());
        let seen = lib.writing_provenance(&book.project.id).unwrap();
        assert!(seen.sources.is_empty());
        assert_eq!(seen.records[0].record["source"]["sha256"], json!(kept.sha256));
        assert!(seen.history.iter().any(|e| e.event == "source_deleted"));
    }
}
