//! Speech recognition on this device, for lining up read-along: whisper.cpp,
//! English only. It hears half a minute of an audiobook at a time and gives
//! back its words, each with when it was said (see `tbv_core::lineup::Ear`).

use std::path::Path;

use tbv_core::lineup::Ear;

pub struct Whisper {
    context: whisper_rs::WhisperContext,
    state: whisper_rs::WhisperState,
    threads: i32,
}

impl Whisper {
    /// Loads a speech model (a whisper.cpp `ggml-*.bin` file). One that won't
    /// load is removed, so it's downloaded again next time.
    pub fn open(path: &Path) -> Result<Whisper, String> {
        whisper_rs::install_logging_hooks();
        let mut params = whisper_rs::WhisperContextParameters::default();
        // The phone's graphics chip (Metal); computers use the processor.
        params.use_gpu(cfg!(target_os = "ios"));
        let context = whisper_rs::WhisperContext::new_with_params(path, params).map_err(|e| {
            let _ = std::fs::remove_file(path);
            format!("The speech model couldn't be loaded: {e}")
        })?;
        let state = context.create_state().map_err(|e| e.to_string())?;
        Ok(Whisper { context, state, threads: 2 })
    }

    /// How many of the processor's cores it uses.
    pub fn set_threads(&mut self, threads: i32) {
        self.threads = threads.max(1);
    }
}

impl Ear for Whisper {
    fn hear(&mut self, samples: &[f32]) -> tbv_core::Result<Vec<(String, i64)>> {
        let mut params = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_n_threads(self.threads);
        params.set_token_timestamps(true);
        params.set_no_context(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        self.state
            .full(params, samples)
            .map_err(|e| tbv_core::Error::Unsuitable(format!("Speech recognition failed: {e}")))?;
        let eot = self.context.token_eot();
        let mut words: Vec<(String, i64)> = Vec::new();
        for segment in self.state.as_iter() {
            for t in 0..segment.n_tokens() {
                let Some(token) = segment.get_token(t) else { continue };
                // Timestamps and other special tokens aren't words.
                if token.token_id() >= eot {
                    continue;
                }
                let Ok(text) = token.to_str_lossy() else { continue };
                // Times come in hundredths of a second.
                let ms = token.token_data().t0 * 10;
                // A token starting with a space starts a new word; others carry the last one on.
                match words.last_mut() {
                    Some(last) if !text.starts_with(' ') => last.0.push_str(&text),
                    _ => words.push((text.trim_start().to_string(), ms)),
                }
            }
        }
        Ok(words)
    }
}
