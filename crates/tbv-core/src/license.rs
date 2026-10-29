//! Paying for TBV: 30 days to try it in full on a computer, then a one-time
//! unlock bought in the Microsoft Store. On iPhone and iPad the same unlock
//! is bought in the App Store, with no trial for now (IOS_TRIAL_DAYS can
//! give one, for a holiday say).
//! The stores say whether it was bought; this keeps the trial's dates and
//! remembers the last time a store said yes, so TBV stays open offline.

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::Result;
use crate::library::Library;

pub const TRIAL_DAYS: i64 = 30;
/// The iPhone and iPad trial: none for now.
pub const IOS_TRIAL_DAYS: i64 = 0;
const DAY: i64 = 86_400;

pub const STARTED: &str = "license.trial_started";
/// The latest time TBV has seen, so turning the clock back doesn't add days.
pub const SEEN: &str = "license.seen";
/// When a store last said it was bought.
pub const OWNED: &str = "license.owned";
/// Set when the owner's code was entered, for copies that can't be bought in.
pub const CODE: &str = "license.code";
/// The owner's code, kept only as a fingerprint so the code itself isn't public.
const CODE_HASH: &str = "8132f096cbb4223ed9038be1d17c4f8c9701d8c5406cbdc1b8eb691a035f5b7e";

/// Tidies a typed code: capitals, and dashes between groups of five.
fn tidy_code(code: &str) -> String {
    let letters: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect();
    letters.as_bytes().chunks(5).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("-")
}

fn code_matches(code: &str) -> bool {
    let digest = Sha256::digest(tidy_code(code).as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect::<String>() == CODE_HASH
}

/// Where it's bought.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Shop {
    Microsoft,
    Apple,
    /// A copy from outside a store (a test build): it can't be bought in.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LicenseState {
    Trial,
    Expired,
    Owned,
}

/// What the app shows about paying.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseView {
    pub state: LicenseState,
    /// Whole days of the trial left (0 once it's over).
    pub days_left: i64,
    /// When the trial ends, as seconds since 1970.
    pub trial_ends: i64,
    /// How long the trial is here (0: none, bought before use).
    pub trial_days: i64,
    pub shop: Shop,
    /// The price as the store shows it, like "$14.99".
    pub price: Option<String>,
}

/// How long the trial runs where the copy is bought.
pub fn trial_days(shop: Shop) -> i64 {
    if shop == Shop::Apple {
        IOS_TRIAL_DAYS
    } else {
        TRIAL_DAYS
    }
}

/// What a store says, when it could be asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreAnswer {
    pub owned: bool,
    pub price: Option<String>,
}

impl Library {
    fn seconds(&self, key: &str) -> Result<Option<i64>> {
        Ok(self.setting(key)?.and_then(|s| s.parse().ok()))
    }

    /// When the trial started: the first time TBV opened here, or `outside`
    /// (a note kept outside the library) if that's earlier.
    pub fn trial_started(&self, now: i64, outside: Option<i64>) -> Result<i64> {
        let saved = self.seconds(STARTED)?;
        let start = [saved, outside, Some(now)].into_iter().flatten().min().unwrap_or(now);
        if saved != Some(start) {
            self.set_setting(STARTED, &start.to_string())?;
        }
        Ok(start)
    }

    /// Unlocks this device with the owner's code. False if the code is wrong.
    pub fn unlock_with_code(&self, code: &str) -> Result<bool> {
        if !code_matches(code) {
            return Ok(false);
        }
        self.set_setting(CODE, "1")?;
        Ok(true)
    }

    /// The paying state now. `answer` is what the store said, or None when
    /// it couldn't be asked (offline, or a copy from outside a store).
    pub fn license(&self, now: i64, outside_start: Option<i64>, shop: Shop, answer: Option<&StoreAnswer>) -> Result<LicenseView> {
        let start = self.trial_started(now, outside_start)?;
        let seen = self.seconds(SEEN)?.unwrap_or(now).max(now);
        self.set_setting(SEEN, &seen.to_string())?;
        let coded = self.setting(CODE)?.is_some();
        let bought = match answer {
            Some(a) if a.owned => {
                self.set_setting(OWNED, &now.to_string())?;
                true
            }
            // The store says it isn't (refunded, say).
            Some(_) => {
                self.conn.execute("DELETE FROM device_settings WHERE key = ?1", [OWNED])?;
                false
            }
            None => self.seconds(OWNED)?.is_some(),
        };
        let owned = bought || coded;
        let ends = start + trial_days(shop) * DAY;
        let left = ((ends - seen) as f64 / DAY as f64).ceil().max(0.0) as i64;
        let state = if owned {
            LicenseState::Owned
        } else if seen < ends {
            LicenseState::Trial
        } else {
            LicenseState::Expired
        };
        Ok(LicenseView {
            state,
            days_left: if owned { 0 } else { left },
            trial_ends: ends,
            trial_days: trial_days(shop),
            shop,
            price: answer.and_then(|a| a.price.clone()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_trial_runs_thirty_days_and_a_purchase_is_remembered() {
        let (_dir, library) = crate::library::tests::open_temp_library();
        let start = 1_800_000_000;
        let day1 = library.license(start, None, Shop::Microsoft, None).unwrap();
        assert_eq!((day1.state, day1.days_left), (LicenseState::Trial, 30));
        let later = library.license(start + 29 * DAY + 3600, None, Shop::Microsoft, None).unwrap();
        assert_eq!((later.state, later.days_left), (LicenseState::Trial, 1));
        // Turning the clock back doesn't give days back.
        assert_eq!(library.license(start + DAY, None, Shop::Microsoft, None).unwrap().days_left, 1);
        let over = library.license(start + 31 * DAY, None, Shop::Microsoft, None).unwrap();
        assert_eq!((over.state, over.days_left), (LicenseState::Expired, 0));
        // Bought: kept while the store can't be asked; gone if it says no.
        let yes = StoreAnswer { owned: true, price: Some("$14.99".into()) };
        assert_eq!(library.license(start + 32 * DAY, None, Shop::Microsoft, Some(&yes)).unwrap().state, LicenseState::Owned);
        assert_eq!(library.license(start + 40 * DAY, None, Shop::Microsoft, None).unwrap().state, LicenseState::Owned);
        let no = StoreAnswer { owned: false, price: None };
        assert_eq!(library.license(start + 41 * DAY, None, Shop::Microsoft, Some(&no)).unwrap().state, LicenseState::Expired);
    }

    #[test]
    fn an_app_store_copy_has_no_trial_until_one_is_given() {
        let (_dir, library) = crate::library::tests::open_temp_library();
        let start = 1_800_000_000;
        let view = library.license(start, None, Shop::Apple, None).unwrap();
        assert_eq!((view.state, view.days_left, view.trial_ends), (LicenseState::Expired, 0, start + IOS_TRIAL_DAYS * DAY));
        let yes = StoreAnswer { owned: true, price: None };
        assert_eq!(library.license(start + DAY, None, Shop::Apple, Some(&yes)).unwrap().state, LicenseState::Owned);
    }

    #[test]
    fn the_owners_code_unlocks_and_others_dont() {
        let (_dir, library) = crate::library::tests::open_temp_library();
        let now = 1_800_000_000;
        assert_eq!(tidy_code("abcde fghij-k"), "ABCDE-FGHIJ-K");
        assert!(!library.unlock_with_code("AAAAA-AAAAA-AAAAA-AAAAA").unwrap());
        assert_eq!(library.license(now + 40 * DAY, Some(now), Shop::None, None).unwrap().state, LicenseState::Expired);
        library.set_setting(CODE, "1").unwrap();
        assert_eq!(library.license(now + 40 * DAY, Some(now), Shop::None, None).unwrap().state, LicenseState::Owned);
    }

    #[test]
    fn an_earlier_start_kept_elsewhere_counts() {
        let (_dir, library) = crate::library::tests::open_temp_library();
        let now = 1_800_000_000;
        let view = library.license(now, Some(now - 40 * DAY), Shop::None, None).unwrap();
        assert_eq!(view.state, LicenseState::Expired);
        assert_eq!(library.trial_started(now, None).unwrap(), now - 40 * DAY);
    }
}
