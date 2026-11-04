//! Speech recognition on this device, for lining up read-along: whisper.cpp,
//! English only. It hears half a minute of an audiobook at a time and gives
//! back its words, each with when it was said (see `tbv_core::lineup::Ear`).

#[cfg(target_os = "android")]
use std::path::Path;

#[cfg(target_os = "android")]
use tbv_core::lineup::Ear;

#[cfg(not(target_os = "android"))]
mod whisper;
#[cfg(not(target_os = "android"))]
pub use whisper::Whisper;

/// Android's test version doesn't hear audiobooks; other devices line them up.
#[cfg(target_os = "android")]
pub struct Whisper;

#[cfg(target_os = "android")]
impl Whisper {
    pub fn open(_path: &Path) -> Result<Whisper, String> {
        Err("Lining up read-along isn't on Android yet. Your computer or iPhone does it, and the result syncs here.".into())
    }

    pub fn set_threads(&mut self, _threads: i32) {}
}

#[cfg(target_os = "android")]
impl Ear for Whisper {
    fn hear(&mut self, _samples: &[f32]) -> tbv_core::Result<Vec<(String, i64)>> {
        Ok(Vec::new())
    }
}
