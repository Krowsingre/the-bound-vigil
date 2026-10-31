//! Checking Apple's App Attest stamp on a Scribe record (provenance.rs).
//!
//! On iPhone, iPad and Mac, TBV asks Apple once to certify a key kept in the
//! device's Secure Enclave, tied to the device's own signing key (the
//! attestation), then has that key sign each record (an assertion). The
//! stamp keeps both as they came. Any device can check them here, offline,
//! against Apple's App Attestation root certificate:
//!
//! - the attestation's certificates lead to Apple's root;
//! - Apple's certificate names exactly this attestation, and this device's
//!   signing key;
//! - it was made for The Bound Vigil (when the build knows TBV's App ID);
//! - the record's assertion is signed by the key Apple certified.
//!
//! Certificate dates aren't checked: Apple's key certificate is short-lived
//! and one attestation serves every later record from that device.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ring::signature::{UnparsedPublicKey, ECDSA_P256_SHA256_ASN1};
use serde_json::Value;
use sha2::{Digest, Sha256};
use x509_parser::prelude::*;

/// Apple App Attestation Root CA (valid 2020 to 2045), from Apple's
/// Private PKI page. SHA-256 1C:B9:82:3B:…:62:42:C9:32.
const ROOT_PEM: &str = include_str!("apple_app_attestation_root.pem");

/// The OID of Apple's extension holding the attestation's nonce.
const NONCE_OID: &str = "1.2.840.113635.100.8.2";

/// TBV's App ID (Team ID + bundle), when the build was given the Team ID.
pub fn app_id() -> Option<String> {
    option_env!("TBV_APPLE_TEAM_ID").map(str::trim).filter(|t| !t.is_empty()).map(|team| format!("{team}.com.krowsingre.theboundvigil"))
}

/// What a stamp's check found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppleCheck {
    /// Apple certified the key, for TBV, and it signed this record.
    Valid,
    /// The same, from a development build of TBV.
    Development,
    /// Something doesn't match.
    Invalid,
    /// The stamp can't be read.
    Unreadable,
}

impl AppleCheck {
    pub fn as_str(self) -> &'static str {
        match self {
            AppleCheck::Valid => "valid",
            AppleCheck::Development => "development",
            AppleCheck::Invalid => "invalid",
            AppleCheck::Unreadable => "unreadable",
        }
    }
}

/// Checks a stamp (`{"keyId","attestation","assertion"}`, base64 as Apple
/// gave them) for a record and the device key (hex) that signed it.
pub fn check(stamp: &str, public_key_hex: &str, record: &str) -> AppleCheck {
    let root = match pem_der(ROOT_PEM) {
        Some(der) => der,
        None => return AppleCheck::Unreadable,
    };
    check_with(stamp, public_key_hex, record, &root, app_id().as_deref())
}

fn pem_der(pem: &str) -> Option<Vec<u8>> {
    let body: String = pem.lines().filter(|l| !l.starts_with("-----")).collect();
    BASE64.decode(body.trim()).ok()
}

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

/// The check itself, with the root and App ID given (tests use their own).
pub fn check_with(stamp: &str, public_key_hex: &str, record: &str, root_der: &[u8], app_id: Option<&str>) -> AppleCheck {
    let Some(parts) = Parts::read(stamp) else { return AppleCheck::Unreadable };
    match parts.verify(public_key_hex, record, root_der, app_id) {
        Ok(development) if development => AppleCheck::Development,
        Ok(_) => AppleCheck::Valid,
        Err(()) => AppleCheck::Invalid,
    }
}

struct Parts {
    key_id: Vec<u8>,
    certificates: Vec<Vec<u8>>,
    auth_data: Vec<u8>,
    signature: Vec<u8>,
    assertion_data: Vec<u8>,
}

impl Parts {
    fn read(stamp: &str) -> Option<Parts> {
        let stamp: Value = serde_json::from_str(stamp).ok()?;
        let text = |name: &str| stamp.get(name).and_then(Value::as_str).and_then(|t| BASE64.decode(t).ok());
        let key_id = text("keyId")?;
        let attestation = cbor::read(&text("attestation")?)?;
        let assertion = cbor::read(&text("assertion")?)?;
        if attestation.get("fmt")?.text()? != "apple-appattest" {
            return None;
        }
        let certificates = attestation.get("attStmt")?.get("x5c")?.array()?.iter().map(|c| c.bytes().map(<[u8]>::to_vec)).collect::<Option<Vec<_>>>()?;
        Some(Parts {
            key_id,
            certificates,
            auth_data: attestation.get("authData")?.bytes()?.to_vec(),
            signature: assertion.get("signature")?.bytes()?.to_vec(),
            assertion_data: assertion.get("authenticatorData")?.bytes()?.to_vec(),
        })
    }

    /// Ok(true) for a development attestation, Ok(false) for production.
    fn verify(&self, public_key_hex: &str, record: &str, root_der: &[u8], app_id: Option<&str>) -> Result<bool, ()> {
        let [leaf_der, intermediate_der, ..] = self.certificates.as_slice() else { return Err(()) };
        let (_, root) = X509Certificate::from_der(root_der).map_err(|_| ())?;
        let (_, intermediate) = X509Certificate::from_der(intermediate_der).map_err(|_| ())?;
        let (_, leaf) = X509Certificate::from_der(leaf_der).map_err(|_| ())?;
        // The chain: leaf ← intermediate ← Apple's root.
        intermediate.verify_signature(Some(root.public_key())).map_err(|_| ())?;
        leaf.verify_signature(Some(intermediate.public_key())).map_err(|_| ())?;
        if intermediate.issuer() != root.subject() || leaf.issuer() != intermediate.subject() {
            return Err(());
        }

        // Apple's certificate names this attestation: nonce = SHA-256(authData ‖ SHA-256(device key)).
        let key_hash = sha256(&[public_key_hex.as_bytes()]);
        let nonce = sha256(&[&self.auth_data, &key_hash]);
        let extension = leaf.extensions().iter().find(|e| e.oid.to_id_string() == NONCE_OID).ok_or(())?;
        // SEQUENCE { [1] { OCTET STRING (32 bytes) } }
        let value = extension.value;
        if value.len() != 38 || value[..6] != [0x30, 0x24, 0xa1, 0x22, 0x04, 0x20] || value[6..] != nonce {
            return Err(());
        }

        // The certified key is the one the stamp names.
        let point = leaf.public_key().subject_public_key.data.to_vec();
        let credential = sha256(&[&point]);
        if credential[..] != self.key_id[..] {
            return Err(());
        }

        // authData: rpIdHash(32) flags(1) counter(4) aaguid(16) credIdLen(2) credId.
        let auth = &self.auth_data;
        if auth.len() < 55 {
            return Err(());
        }
        let rp_id = &auth[..32];
        if let Some(app) = app_id {
            if rp_id != sha256(&[app.as_bytes()]) {
                return Err(());
            }
        }
        if auth[33..37] != [0, 0, 0, 0] {
            return Err(());
        }
        let development = match &auth[37..53] {
            b"appattestdevelop" => true,
            b"appattest\0\0\0\0\0\0\0" => false,
            _ => return Err(()),
        };
        let id_len = u16::from_be_bytes([auth[53], auth[54]]) as usize;
        if auth.get(55..55 + id_len) != Some(&credential[..]) {
            return Err(());
        }

        // The record's assertion: signed by the certified key over SHA-256(authenticatorData ‖ SHA-256(record)).
        if self.assertion_data.len() < 37 || &self.assertion_data[..32] != rp_id {
            return Err(());
        }
        let message = sha256(&[&self.assertion_data, &sha256(&[record.as_bytes()])]);
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_ASN1, &point).verify(&message, &self.signature).map_err(|_| ())?;
        Ok(development)
    }
}

/// Just enough CBOR to read Apple's two answers: maps, arrays, text,
/// byte strings and whole numbers.
mod cbor {
    pub enum Item {
        Uint,
        Bytes(Vec<u8>),
        Text(String),
        Array(Vec<Item>),
        Map(Vec<(Item, Item)>),
    }

    impl Item {
        pub fn get(&self, key: &str) -> Option<&Item> {
            let Item::Map(pairs) = self else { return None };
            pairs.iter().find(|(k, _)| matches!(k, Item::Text(t) if t == key)).map(|(_, v)| v)
        }
        pub fn bytes(&self) -> Option<&[u8]> {
            if let Item::Bytes(b) = self {
                Some(b)
            } else {
                None
            }
        }
        pub fn text(&self) -> Option<&str> {
            if let Item::Text(t) = self {
                Some(t)
            } else {
                None
            }
        }
        pub fn array(&self) -> Option<&[Item]> {
            if let Item::Array(a) = self {
                Some(a)
            } else {
                None
            }
        }
    }

    pub fn read(bytes: &[u8]) -> Option<Item> {
        let mut at = 0;
        let item = next(bytes, &mut at, 0)?;
        Some(item)
    }

    fn length(bytes: &[u8], at: &mut usize, info: u8) -> Option<u64> {
        let take = |at: &mut usize, n: usize| -> Option<u64> {
            let part = bytes.get(*at..*at + n)?;
            *at += n;
            Some(part.iter().fold(0u64, |v, b| (v << 8) | u64::from(*b)))
        };
        match info {
            0..=23 => Some(u64::from(info)),
            24 => take(at, 1),
            25 => take(at, 2),
            26 => take(at, 4),
            27 => take(at, 8),
            _ => None,
        }
    }

    fn next(bytes: &[u8], at: &mut usize, depth: u32) -> Option<Item> {
        if depth > 16 {
            return None;
        }
        let head = *bytes.get(*at)?;
        *at += 1;
        let n = length(bytes, at, head & 0x1f)?;
        let size = usize::try_from(n).ok()?;
        let slice = |at: &mut usize| -> Option<Vec<u8>> {
            let part = bytes.get(*at..at.checked_add(size)?)?.to_vec();
            *at += size;
            Some(part)
        };
        match head >> 5 {
            0 => Some(Item::Uint),
            2 => slice(at).map(Item::Bytes),
            3 => slice(at).and_then(|b| String::from_utf8(b).ok()).map(Item::Text),
            4 => {
                let mut items = Vec::new();
                for _ in 0..size.min(1024) {
                    items.push(next(bytes, at, depth + 1)?);
                }
                Some(Item::Array(items))
            }
            5 => {
                let mut pairs = Vec::new();
                for _ in 0..size.min(1024) {
                    let k = next(bytes, at, depth + 1)?;
                    let v = next(bytes, at, depth + 1)?;
                    pairs.push((k, v));
                }
                Some(Item::Map(pairs))
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Made by scripts/make_attest_fixture.py: a stand-in root, intermediate
    /// and key certificate shaped like Apple's, an attestation and an
    /// assertion for one record.
    const FIXTURE: &str = include_str!("../tests/fixtures/app_attest.json");

    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).unwrap()
    }

    fn run(f: &Value, stamp: &str, key: &str, record: &str, app: Option<&str>) -> AppleCheck {
        let root = BASE64.decode(f["root"].as_str().unwrap()).unwrap();
        check_with(stamp, key, record, &root, app)
    }

    #[test]
    fn a_genuine_stamp_checks() {
        let f = fixture();
        let (stamp, key, record, app) = (f["stamp"].as_str().unwrap(), f["publicKey"].as_str().unwrap(), f["record"].as_str().unwrap(), f["appId"].as_str().unwrap());
        assert_eq!(run(&f, stamp, key, record, Some(app)), AppleCheck::Valid);
        assert_eq!(run(&f, stamp, key, record, None), AppleCheck::Valid);
    }

    #[test]
    fn anything_changed_fails() {
        let f = fixture();
        let (stamp, key, record, app) = (f["stamp"].as_str().unwrap(), f["publicKey"].as_str().unwrap(), f["record"].as_str().unwrap(), f["appId"].as_str().unwrap());
        // Another record, another device key, another app.
        assert_eq!(run(&f, stamp, key, &record.replace("import", "imp0rt"), Some(app)), AppleCheck::Invalid);
        assert_eq!(run(&f, stamp, &key.replace('a', "b"), record, Some(app)), AppleCheck::Invalid);
        assert_eq!(run(&f, stamp, key, record, Some("ABCDE12345.com.example.other")), AppleCheck::Invalid);
        // A chain that doesn't lead to the root given.
        let apple_root = pem_der(ROOT_PEM).unwrap();
        assert_eq!(check_with(stamp, key, record, &apple_root, Some(app)), AppleCheck::Invalid);
        assert_eq!(run(&f, "{}", key, record, Some(app)), AppleCheck::Unreadable);
    }

    #[test]
    fn apples_root_is_the_one_kept() {
        let der = pem_der(ROOT_PEM).unwrap();
        let (_, root) = X509Certificate::from_der(&der).unwrap();
        assert!(root.subject().to_string().contains("Apple App Attestation Root CA"));
        assert_eq!(hex::encode(sha256(&[&der])), "1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932");
    }
}
