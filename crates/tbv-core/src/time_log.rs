//! Time spent reading and listening: seconds per day, per device, synced so
//! every device shows the same totals.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::time::now_utc;
use crate::{Error, Library, Result};

/// The most one report may add. The reader and player report every half a
/// minute or so; anything far bigger is a clock jump, not reading.
const MOST_AT_ONCE: u32 = 15 * 60;

/// Seconds spent on one day, added up across devices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSpent {
    /// `YYYY-MM-DD`, the date where the time was spent.
    pub day: String,
    pub read: u64,
    pub listen: u64,
}

impl Library {
    /// Adds time spent reading (`read`) or listening (`listen`) on `day`
    /// (`YYYY-MM-DD`, this device's own date).
    pub fn add_time(&self, day: &str, kind: &str, seconds: u32) -> Result<()> {
        if !matches!(kind, "read" | "listen") {
            return Err(Error::Unsuitable("time is spent reading or listening".into()));
        }
        let well_formed = day.len() == 10 && chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").is_ok();
        if !well_formed {
            return Err(Error::Unsuitable("a day is written YYYY-MM-DD".into()));
        }
        if seconds == 0 {
            return Ok(());
        }
        let device = self.device_id()?;
        self.conn.execute(
            "INSERT INTO time_log (device_id, day, kind, seconds, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(device_id, day, kind) DO UPDATE SET seconds = seconds + excluded.seconds, updated_at = excluded.updated_at",
            params![device, day, kind, seconds.min(MOST_AT_ONCE), now_utc()],
        )?;
        Ok(())
    }

    /// Every day with time spent, oldest first.
    pub fn time_spent(&self) -> Result<Vec<TimeSpent>> {
        let mut statement = self.conn.prepare(
            "SELECT day,
                    SUM(CASE WHEN kind = 'read' THEN seconds ELSE 0 END),
                    SUM(CASE WHEN kind = 'listen' THEN seconds ELSE 0 END)
             FROM time_log GROUP BY day ORDER BY day",
        )?;
        let rows = statement.query_map([], |r| Ok(TimeSpent { day: r.get(0)?, read: r.get(1)?, listen: r.get(2)? }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;

    #[test]
    fn time_adds_up_by_day_and_kind() {
        let (_dir, library) = open_temp_library();
        library.add_time("2026-10-20", "read", 30).unwrap();
        library.add_time("2026-10-20", "read", 45).unwrap();
        library.add_time("2026-10-20", "listen", 60).unwrap();
        library.add_time("2026-10-21", "listen", 100_000).unwrap();
        let spent = library.time_spent().unwrap();
        assert_eq!(spent.len(), 2);
        assert_eq!((spent[0].read, spent[0].listen), (75, 60));
        // A clock jump isn't counted as hours of listening.
        assert_eq!((spent[1].read, spent[1].listen), (0, 15 * 60));
        assert!(library.add_time("yesterday", "read", 5).is_err());
        assert!(library.add_time("2026-10-21", "skim", 5).is_err());
    }
}
