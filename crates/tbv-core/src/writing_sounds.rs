//! Sound files kept with poems in Scribe books: a recording or a song made
//! from the poem. Each file is named by its SHA-256 and kept on this device;
//! the poem's page settings name it ({"sound":{"file":"<sha>.mp3",...}}), so
//! the name travels with the book and the file itself goes to the cloud at
//! sounds/<file>, from where other devices fetch it.

use std::fs;
use std::path::PathBuf;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};
use crate::library::Library;
use crate::provenance::sha256_hex;

pub(crate) const SOUNDS: &str = "sounds/";

/// The kinds of sound file a poem can have.
const EXTENSIONS: &[&str] = &["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"];

/// The largest sound file kept with a poem.
const MAX_BYTES: usize = 200 * 1024 * 1024;

/// A sound kept with a poem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingSound {
    /// The name it's kept under (its SHA-256 and kind), which the page names.
    pub file: String,
    pub bytes: u64,
    /// Where it is on this device.
    pub path: String,
}

fn extension_of(name: &str) -> Option<String> {
    let e = std::path::Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    EXTENSIONS.contains(&e.as_str()).then_some(e)
}

/// A kept sound's name: 64 hex digits, a dot and one of the kinds.
fn is_sound_file(file: &str) -> bool {
    let Some((sha, extension)) = file.split_once('.') else { return false };
    sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) && EXTENSIONS.contains(&extension)
}

/// The sound files named in page settings, the poems' own JSON.
pub(crate) fn sound_in_page(page: &str) -> Option<String> {
    let page: Value = serde_json::from_str(page).ok()?;
    let file = page.get("sound")?.get("file")?.as_str()?;
    is_sound_file(file).then(|| file.to_string())
}

impl Library {
    fn sounds_dir(&self) -> PathBuf {
        self.paths.pictures_dir.with_file_name("Scribe sounds")
    }

    /// Keeps a sound file for a poem and says what the page should name.
    pub fn keep_writing_sound(&self, name: &str, bytes: &[u8]) -> Result<WritingSound> {
        let Some(extension) = extension_of(name) else {
            return Err(Error::Unsuitable("That isn't a sound file Scribe can keep. Choose an MP3, M4A, AAC, WAV, OGG, Opus or FLAC file.".into()));
        };
        if bytes.is_empty() {
            return Err(Error::Unsuitable("That sound file is empty.".into()));
        }
        if bytes.len() > MAX_BYTES {
            return Err(Error::Unsuitable("That sound file is over 200 MB. Choose a smaller one.".into()));
        }
        let file = format!("{}.{extension}", sha256_hex(bytes));
        let dir = self.sounds_dir();
        fs::create_dir_all(&dir)?;
        let path = dir.join(&file);
        if !path.exists() {
            fs::write(&path, bytes)?;
        }
        Ok(WritingSound { file, bytes: bytes.len() as u64, path: path.to_string_lossy().into_owned() })
    }

    /// A kept sound, if this device has it.
    pub fn writing_sound(&self, file: &str) -> Result<Option<WritingSound>> {
        if !is_sound_file(file) {
            return Ok(None);
        }
        let path = self.sounds_dir().join(file);
        Ok(fs::metadata(&path).ok().map(|m| WritingSound { file: file.to_string(), bytes: m.len(), path: path.to_string_lossy().into_owned() }))
    }

    /// Every sound named by a poem in a book that's still here.
    fn sounds_named(&self) -> Result<Vec<String>> {
        let pages = self
            .conn
            .prepare(
                "SELECT c.page FROM writing_chapters c JOIN writing_projects p ON p.id = c.project_id
                 WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL AND c.page LIKE '%\"sound\"%'",
            )?
            .query_map(params![], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut files: Vec<String> = pages.iter().filter_map(|p| sound_in_page(p)).collect();
        files.sort();
        files.dedup();
        Ok(files)
    }

    /// The sounds this device has for poems here, for sync to copy to the
    /// cloud, as (cloud path, file).
    pub(crate) fn sounds_kept(&self) -> Result<Vec<(String, PathBuf)>> {
        let dir = self.sounds_dir();
        Ok(self.sounds_named()?.into_iter().map(|f| (format!("{SOUNDS}{f}"), dir.join(&f))).filter(|(_, p)| p.exists()).collect())
    }

    /// The sounds poems here name that this device hasn't got, as (cloud path, file).
    pub(crate) fn sounds_to_fetch(&self) -> Result<Vec<(String, PathBuf)>> {
        let dir = self.sounds_dir();
        Ok(self.sounds_named()?.into_iter().map(|f| (format!("{SOUNDS}{f}"), dir.join(&f))).filter(|(_, p)| !p.exists()).collect())
    }

    /// A sound came down from the cloud: kept only if it's the file its name says.
    pub(crate) fn sound_fetched(&self, cloud_path: &str) -> Result<()> {
        let Some(file) = cloud_path.strip_prefix(SOUNDS) else { return Ok(()) };
        let local = self.sounds_dir().join(file);
        let Ok(bytes) = fs::read(&local) else { return Ok(()) };
        if !file.starts_with(&sha256_hex(&bytes)) {
            let _ = fs::remove_file(&local);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::open_temp_library;
    use crate::writing::NewWritingSection;

    #[test]
    fn a_poems_sound_is_kept_by_its_contents_and_offered_to_the_cloud() {
        let (_dir, lib) = open_temp_library();
        let sound = lib.keep_writing_sound("Night song.MP3", b"ID3 sound").unwrap();
        assert!(is_sound_file(&sound.file));
        assert!(sound.file.ends_with(".mp3"));
        assert_eq!(lib.keep_writing_sound("copy.mp3", b"ID3 sound").unwrap().file, sound.file);
        assert!(lib.keep_writing_sound("notes.txt", b"words").is_err());
        assert!(lib.keep_writing_sound("empty.mp3", b"").is_err());

        // Nothing is sent until a poem names it.
        assert!(lib.sounds_kept().unwrap().is_empty());
        let book = lib.create_writing_project("Night", None).unwrap();
        let page = format!(r#"{{"kind":"poem","sound":{{"file":"{}","name":"Night song.MP3","link":null}}}}"#, sound.file);
        lib.add_writing_section(&book.project.id, &NewWritingSection { title: "Night".into(), body: String::new(), role: "chapter".into(), part: None, page: page.clone(), after: None })
            .unwrap();
        let kept = lib.sounds_kept().unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].0, format!("sounds/{}", sound.file));
        assert!(lib.sounds_to_fetch().unwrap().is_empty());

        // Another device's copy, without the file, asks for it; a wrong file is thrown away.
        fs::remove_file(&sound.path).unwrap();
        assert_eq!(lib.sounds_to_fetch().unwrap().len(), 1);
        fs::write(&sound.path, b"something else").unwrap();
        lib.sound_fetched(&format!("sounds/{}", sound.file)).unwrap();
        assert!(lib.writing_sound(&sound.file).unwrap().is_none());
        assert!(lib.writing_sound("../secret.mp3").unwrap().is_none());
    }

    #[test]
    fn only_a_kept_sounds_own_name_is_read_from_a_page() {
        let sha = "a".repeat(64);
        assert_eq!(sound_in_page(&format!(r#"{{"sound":{{"file":"{sha}.m4a"}}}}"#)), Some(format!("{sha}.m4a")));
        assert_eq!(sound_in_page(r#"{"sound":{"file":"../../etc/passwd"}}"#), None);
        assert_eq!(sound_in_page(&format!(r#"{{"sound":{{"file":"{sha}.exe"}}}}"#)), None);
        assert_eq!(sound_in_page("{}"), None);
    }
}
