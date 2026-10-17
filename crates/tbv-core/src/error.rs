use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("data error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("this book file could not be read: {0}")]
    BadBook(String),
    /// Something the user picked that TBV can't use; the text says why.
    #[error("{0}")]
    Unsuitable(String),
    /// The cloud couldn't be reached; changes wait here until it can.
    #[error("TBV can't reach the cloud right now ({0})")]
    Offline(String),
    /// The cloud turned one file away (too big, say). Others still sync.
    #[error("{0}")]
    Rejected(String),
    /// The sign-in ran out or was withdrawn.
    #[error("Sign in again to keep syncing")]
    SignedOut,
    /// Anything else the cloud said went wrong.
    #[error("the cloud said: {0}")]
    Cloud(String),
}

pub type Result<T> = std::result::Result<T, Error>;
