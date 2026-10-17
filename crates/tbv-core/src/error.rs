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
}

pub type Result<T> = std::result::Result<T, Error>;
