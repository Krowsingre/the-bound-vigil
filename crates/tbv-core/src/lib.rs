//! The Bound Vigil core: library storage, stable identities and view models.
//! No UI code lives here, so all of it is testable with `cargo test`.

pub mod browse;
pub mod epub;
pub mod error;
pub mod home;
pub mod ids;
pub mod library;
pub mod model;
pub mod profile;
pub mod reader;
pub mod time;

pub use error::{Error, Result};
pub use library::{Library, LibraryPaths, SUPPORTED_FORMATS};
