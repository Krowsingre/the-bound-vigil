//! Activating the Android test version, one phone at a time. Each install
//! makes its own device code; a key for it is signed with embre's private
//! activation key (kept in GitHub's secrets, used by the "Activate an
//! Android phone" workflow), and only the public half is here. A key opens
//! only the phone whose code it was made for.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{UnparsedPublicKey, ED25519};

/// The public half of the activation key (Ed25519, raw, base64).
const PUBLIC_KEY: &str = "2RBRexaz7xbDZVtIu7AkD76lXIEmxOT20o2eV5MqMlI=";

/// Letters and digits that can't be mistaken for each other (no I, O, 0 or 1).
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// What a key signs: the device code, tidied.
const PREFIX: &str = "tbv-android-activation:";

/// A new device code, like "K7QFM-2XHRA".
pub fn new_device_code() -> String {
    let mut bytes = [0u8; 10];
    let _ = SystemRandom::new().fill(&mut bytes);
    let letters: String = bytes.iter().map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char).collect();
    format!("{}-{}", &letters[..5], &letters[5..])
}

/// A code as typed: capitals, without dashes or spaces.
pub fn tidy_code(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

/// Whether a code looks like one TBV makes.
pub fn is_device_code(code: &str) -> bool {
    let tidy = tidy_code(code);
    tidy.len() == 10 && tidy.bytes().all(|b| ALPHABET.contains(&b))
}

fn signed_text(code: &str) -> String {
    format!("{PREFIX}{}", tidy_code(code))
}

fn verify_with(public: &[u8], code: &str, key: &str) -> bool {
    let key: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    let Ok(signature) = URL_SAFE_NO_PAD.decode(key.trim_end_matches('=')) else { return false };
    is_device_code(code) && UnparsedPublicKey::new(&ED25519, public).verify(signed_text(code).as_bytes(), &signature).is_ok()
}

/// Whether `key` was made for this device's `code`.
pub fn key_fits(code: &str, key: &str) -> bool {
    let Ok(public) = base64::engine::general_purpose::STANDARD.decode(PUBLIC_KEY) else { return false };
    verify_with(&public, code, key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    #[test]
    fn a_key_opens_only_the_phone_it_was_made_for() {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let code = new_device_code();
        assert!(is_device_code(&code), "{code}");
        assert_eq!(code.len(), 11);
        let key = URL_SAFE_NO_PAD.encode(pair.sign(signed_text(&code).as_bytes()).as_ref());
        let public = pair.public_key().as_ref();
        assert!(verify_with(public, &code, &key));
        // Typed in lower case, without the dash, or pasted with a line break.
        assert!(verify_with(public, &code.to_lowercase().replace('-', ""), &format!("{}\n{}", &key[..40], &key[40..])));
        let mut other = new_device_code();
        while other == code {
            other = new_device_code();
        }
        assert!(!verify_with(public, &other, &key));
        assert!(!verify_with(public, &code, "not a key"));
        // Not signed with TBV's own key.
        assert!(!key_fits(&code, &key));
    }

    #[test]
    fn the_public_key_is_whole() {
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(PUBLIC_KEY).unwrap().len(), 32);
        // Made by the activation workflow's script with the private half.
        assert!(key_fits("ABCDE-FGHJK", "HkE8pfmDbkSOeusTPkDkQ74xKCMIMwMg5fSmany3-CW9yeY-Tx2Ry6MFMS8Ka2lfmVQP71vUL8r49wOqgpgiBQ"));
        assert!(!key_fits("ABCDE-FGHJL", "HkE8pfmDbkSOeusTPkDkQ74xKCMIMwMg5fSmany3-CW9yeY-Tx2Ry6MFMS8Ka2lfmVQP71vUL8r49wOqgpgiBQ"));
    }
}
