//! Short stretches of an audiobook as 16 kHz mono samples, which is what
//! speech recognition listens to. Read-along timing hears a stretch every
//! so often and finds the words the narrator said in the book.

use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_OPUS};
use symphonia::core::errors::Error as AudioError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::TimeBase;

use crate::audio::{open_part, Part, Slice, BUNDLE};
use crate::error::{Error, Result};

/// Samples a second, as speech recognition wants them.
pub const RATE: u32 = 16_000;

impl MediaSource for Slice {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.len())
    }
}

fn unreadable(e: AudioError) -> Error {
    Error::Unsuitable(format!("TBV couldn't read this audiobook's sound: {e}"))
}

/// Up to `len_ms` of sound from `start_ms` into the book, as 16 kHz mono.
pub fn clip(path: &Path, format: &str, parts: &[Part], start_ms: u64, len_ms: u64) -> Result<Vec<f32>> {
    Listener::open(path, format, parts)?.clip(start_ms, len_ms)
}

/// One file of an audiobook, open for reading stretches from it in order.
struct Open {
    index: usize,
    /// Where the file starts in the whole book.
    start_ms: u64,
    reader: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    rate: u32,
    time_base: TimeBase,
    /// Where reading has got to in this file, in seconds.
    at: f64,
}

/// Reads stretches of an audiobook front to back. Moving on skips the
/// sound between without decoding it, so hearing a stretch every few
/// minutes through a long book stays quick; going back starts the file again.
pub struct Listener {
    path: std::path::PathBuf,
    format: String,
    parts: Vec<Part>,
    open: Option<Open>,
}

/// Decoded just before a stretch, so the decoder has settled when it starts.
const WARM_UP_SECS: f64 = 1.0;

impl Listener {
    pub fn open(path: &Path, format: &str, parts: &[Part]) -> Result<Self> {
        let mut listener = Listener { path: path.to_path_buf(), format: format.to_string(), parts: parts.to_vec(), open: None };
        listener.open_file(0)?;
        Ok(listener)
    }

    fn open_file(&mut self, index: usize) -> Result<&mut Open> {
        let (slice, ext) = open_part(&self.path, &self.format, index)?;
        let mut hint = Hint::new();
        hint.with_extension(&ext);
        let stream = MediaSourceStream::new(Box::new(slice), Default::default());
        let probed = symphonia::default::get_probe()
            .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
            .map_err(unreadable)?;
        let reader = probed.format;
        let track = reader.default_track().ok_or_else(|| Error::Unsuitable("This audiobook has no sound TBV can read.".into()))?;
        let track_id = track.id;
        let rate = track.codec_params.sample_rate.ok_or_else(|| Error::Unsuitable("This audiobook doesn't say its sample rate.".into()))?;
        let time_base = track.codec_params.time_base.unwrap_or_else(|| TimeBase::new(1, rate));
        if track.codec_params.codec == CODEC_TYPE_OPUS {
            return Err(Error::Unsuitable("TBV can't time Opus audiobooks yet. MP3, M4B, FLAC and Ogg Vorbis work.".into()));
        }
        let decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()).map_err(unreadable)?;
        let start_ms = if self.format == BUNDLE { self.parts.get(index).map_or(0, |p| p.start_ms) } else { 0 };
        Ok(self.open.insert(Open { index, start_ms, reader, decoder, track_id, rate, time_base, at: 0.0 }))
    }

    /// Up to `len_ms` of sound from `start_ms` into the book, as 16 kHz mono.
    /// A stretch stops at the end of the file it starts in.
    pub fn clip(&mut self, start_ms: u64, len_ms: u64) -> Result<Vec<f32>> {
        let index = if self.format == BUNDLE { self.parts.iter().rposition(|p| p.start_ms <= start_ms).unwrap_or(0) } else { 0 };
        let from = |open: &Open| (start_ms.saturating_sub(open.start_ms)) as f64 / 1000.0;
        let reopen = match &self.open {
            Some(open) => open.index != index || from(open) < open.at,
            None => true,
        };
        if reopen {
            self.open_file(index)?;
        }
        let open = self.open.as_mut().expect("opened above");
        let from = from(open);
        let rate = open.rate;
        let want = (len_ms * rate as u64 / 1000) as usize;
        let mut mono: Vec<f32> = Vec::with_capacity(want);
        let mut buffer: Option<SampleBuffer<f32>> = None;
        while mono.len() < want {
            let packet = match open.reader.next_packet() {
                Ok(p) => p,
                Err(AudioError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(AudioError::ResetRequired) => break,
                Err(e) => return Err(unreadable(e)),
            };
            if packet.track_id() != open.track_id {
                continue;
            }
            let time = open.time_base.calc_time(packet.ts());
            let begins = time.seconds as f64 + time.frac;
            let end = open.time_base.calc_time(packet.ts() + packet.dur());
            open.at = end.seconds as f64 + end.frac;
            // Well before the stretch: skipped without decoding.
            if open.at < from - WARM_UP_SECS {
                continue;
            }
            let decoded = match open.decoder.decode(&packet) {
                Ok(d) => d,
                // A damaged frame: carry on with the next.
                Err(AudioError::DecodeError(_)) => continue,
                Err(e) => return Err(unreadable(e)),
            };
            let spec = *decoded.spec();
            let channels = spec.channels.count().max(1);
            let samples = buffer.get_or_insert_with(|| SampleBuffer::new(decoded.capacity() as u64, spec));
            if samples.capacity() < decoded.capacity() * channels {
                *samples = SampleBuffer::new(decoded.capacity() as u64, spec);
            }
            samples.copy_interleaved_ref(decoded);
            // Frames from before the stretch (the warm-up) are dropped.
            let early = (((from - begins) * rate as f64).round().max(0.0)) as usize;
            for frame in samples.samples().chunks(channels).skip(early) {
                mono.push(frame.iter().sum::<f32>() / channels as f32);
            }
        }
        mono.truncate(want);
        Ok(resample(&mono, rate))
    }
}

/// To 16 kHz, each new sample the average of the old ones it covers: enough
/// to keep speech clear without a proper filter.
pub fn resample(samples: &[f32], rate: u32) -> Vec<f32> {
    if rate == RATE || samples.is_empty() {
        return samples.to_vec();
    }
    let step = rate as f64 / RATE as f64;
    let count = (samples.len() as f64 / step).floor() as usize;
    (0..count)
        .map(|i| {
            let from = (i as f64 * step) as usize;
            let to = (((i + 1) as f64 * step) as usize).clamp(from + 1, samples.len());
            samples[from..to].iter().sum::<f32>() / (to - from) as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A WAV of a tone, `seconds` long, at 44.1 kHz stereo.
    fn tone_wav(seconds: u32) -> Vec<u8> {
        let rate = 44_100u32;
        let frames = rate * seconds;
        let mut out = Vec::new();
        let data = frames * 4;
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 4).to_le_bytes());
        out.extend_from_slice(&4u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data.to_le_bytes());
        for i in 0..frames {
            // Louder as it goes, so where a clip came from can be told.
            let level = (i as f32 / frames as f32 * 20_000.0) as i16;
            out.extend_from_slice(&level.to_le_bytes());
            out.extend_from_slice(&level.to_le_bytes());
        }
        out
    }

    #[test]
    fn a_stretch_comes_back_as_16khz_mono_from_where_it_was_asked() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("tone.wav");
        std::fs::write(&path, tone_wav(4)).unwrap();
        let start = clip(&path, "wav", &[], 0, 1000).unwrap();
        assert_eq!(start.len(), RATE as usize);
        let later = clip(&path, "wav", &[], 2000, 1000).unwrap();
        assert_eq!(later.len(), RATE as usize);
        // Two seconds in, the tone is half as loud as it gets.
        let level = later[0] * 32_768.0 / 20_000.0;
        assert!((level - 0.5).abs() < 0.02, "{level}");
        // Past the end, only what's there.
        assert_eq!(clip(&path, "wav", &[], 3500, 1000).unwrap().len(), RATE as usize / 2);
        // One listener, on through the book and back again.
        let mut listener = Listener::open(&path, "wav", &[]).unwrap();
        let first = listener.clip(500, 500).unwrap();
        let on = listener.clip(2000, 1000).unwrap();
        let back = listener.clip(500, 500).unwrap();
        assert_eq!(on, later);
        assert_eq!(first, back);
    }

    #[test]
    fn resampling_keeps_the_length_in_time() {
        assert_eq!(resample(&vec![1.0; 44_100], 44_100).len(), 16_000);
        assert_eq!(resample(&vec![1.0; 16_000], 16_000).len(), 16_000);
        assert!(resample(&vec![0.5; 48_000], 48_000).iter().all(|s| (*s - 0.5).abs() < 1e-6));
    }
}
