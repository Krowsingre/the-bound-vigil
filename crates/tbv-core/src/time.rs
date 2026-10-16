use chrono::{SecondsFormat, Utc};

use crate::model::IsoUtc;

/// Current time in UTC. All stored timestamps go through here.
pub fn now_utc() -> IsoUtc {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
