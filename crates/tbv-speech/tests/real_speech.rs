//! Lines up real speech with its text: a short story read aloud by a
//! speech synthesiser, heard by Whisper. Needs the speech model and the
//! recording, so it runs only when asked (CI does, see ci.yml):
//!
//!   TBV_SPEECH_MODEL=ggml-small.en-q5_1.bin TBV_SPEECH_RAW=lantern.raw \
//!     cargo test -p tbv-speech --release -- --ignored
//!
//! where lantern.raw is tests/fixtures/lantern.txt spoken, as 16 kHz mono
//! 16-bit samples.

use std::sync::Mutex;
use std::time::Instant;

use tbv_core::library::{Library, LibraryPaths};
use tbv_core::lineup::{line_up, words_in, BookWords, Ended, LineUp, Me};

#[test]
#[ignore = "needs a speech model and a recording"]
fn real_speech_is_lined_up_with_its_text() {
    let model = std::env::var("TBV_SPEECH_MODEL").expect("TBV_SPEECH_MODEL");
    let raw = std::fs::read(std::env::var("TBV_SPEECH_RAW").expect("TBV_SPEECH_RAW")).unwrap();
    let samples: Vec<f32> = raw.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b) as f32 / 32768.0).collect();
    let duration_ms = samples.len() as u64 * 1000 / 16_000;
    let text = include_str!("fixtures/lantern.txt");
    let words: Vec<String> = words_in(text).into_iter().map(|(w, _)| w).collect();
    let book = BookWords { sections: vec![words.len() as u64], words: words.clone(), language: Some("en".into()) };

    let dir = std::env::temp_dir().join(format!("tbv-speech-test-{}", std::process::id()));
    let library = Mutex::new(Library::open(LibraryPaths::new(&dir.join("data"), &dir.join("cache"))).unwrap());
    let mut ear = tbv_speech::Whisper::open(std::path::Path::new(&model)).unwrap();
    ear.set_threads(std::thread::available_parallelism().map(|n| n.get() as i32).unwrap_or(2));
    let mut clip = |start: u64, len: u64| {
        let from = (start * 16) as usize;
        let to = ((start + len) * 16) as usize;
        Ok(samples.get(from.min(samples.len())..to.min(samples.len())).unwrap_or(&[]).to_vec())
    };
    let me = Me { device: "test".into(), computer: true };
    let began = Instant::now();
    let ended = line_up(&library, "e", "a", duration_ms, &book, &mut ear, &mut clip, &me, &|| false, &mut |done, of| {
        println!("piece {done} of {of}");
    })
    .unwrap();
    let took = began.elapsed().as_secs_f64();
    println!("{:.0} s of speech lined up in {took:.1} s ({:.1}x real time)", duration_ms as f64 / 1000.0, duration_ms as f64 / 1000.0 / took);
    assert_eq!(ended, Ended::Done);

    let l = library.lock().unwrap();
    assert!(LineUp::read(l.read_along_timing("e", "a").unwrap().as_deref()).unwrap().done);
    let mut anchors: Vec<(i64, i64)> = Vec::new();
    for (_, json) in l.read_along_pieces("e", "a").unwrap() {
        anchors.extend(serde_json::from_str::<Vec<(i64, i64)>>(&json).unwrap());
    }
    anchors.sort();
    println!("{} of {} words placed", anchors.len(), words.len());
    assert!(anchors.len() * 10 >= words.len() * 6, "only {} of {} words placed", anchors.len(), words.len());
    // The synthesiser reads at an even pace, so each word is said about as
    // far into the recording as it is into the text.
    let mut off: Vec<f64> = anchors
        .iter()
        .map(|&(t, w)| (t as f64 / duration_ms as f64 - w as f64 / words.len() as f64).abs())
        .collect();
    off.sort_by(f64::total_cmp);
    println!("median distance from an even pace: {:.3}", off[off.len() / 2]);
    assert!(off[off.len() / 2] < 0.05);
    assert!(anchors.windows(2).all(|p| p[0].0 < p[1].0 && p[0].1 < p[1].1));
    let _ = std::fs::remove_dir_all(dir);
}
