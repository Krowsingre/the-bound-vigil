//! The Bound Vigil core: library storage, stable identities and view models.
//! No UI code lives here, so all of it is testable with `cargo test`.

pub mod audio;
pub mod browse;
pub mod collections;
pub mod data;
pub mod epub;
pub mod ereaders;
pub mod error;
pub mod formats;
pub mod goodreads;
pub mod hardcover;
pub mod home;
pub mod http;
pub mod ids;
pub mod library;
pub mod localsend;
pub mod listen;
pub mod lookup;
pub mod details;
pub mod manage;
pub mod model;
pub mod notes;
pub mod opds;
pub mod profile;
pub mod reader;
pub mod rules;
pub mod series;
pub mod series_sources;
pub mod servers;
pub mod sync;
pub mod time;
pub mod time_log;
pub mod writing;

pub use error::{Error, Result};
pub use library::{Library, LibraryPaths, SUPPORTED_FORMATS};
