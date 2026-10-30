//! Paying for TBV (embre, 30 October): two levels, each complete on its own.
//! TBV is $19.99 a year or $59.99 for life; TBV Publisher (everything in TBV
//! plus the publishing tools) is $39.99 a year or $119.99 for life, and a
//! lifetime owner can upgrade for the difference. The prices themselves are
//! set in the stores. Both are sold in the Microsoft Store on a computer (after a 30-day trial) and in the App
//! Store on iPhone and iPad, where the yearly plan's first month is free
//! (Apple's own trial for a subscription, set in App Store Connect).
//! The stores say whether it was bought; this keeps the trial's dates and
//! remembers the last time a store said yes, so TBV stays open offline.

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::Result;
use crate::library::Library;

pub const TRIAL_DAYS: i64 = 30;
/// The iPhone and iPad trial kept by TBV: none, as the App Store gives the
/// yearly plan a free first month itself.
pub const IOS_TRIAL_DAYS: i64 = 0;
const DAY: i64 = 86_400;

pub const STARTED: &str = "license.trial_started";
/// The latest time TBV has seen, so turning the clock back doesn't add days.
pub const SEEN: &str = "license.seen";
/// When a store last said it was bought.
pub const OWNED: &str = "license.owned";
/// Which plan it was bought on, "monthly", "yearly" or "lifetime".
pub const PLAN: &str = "license.plan";
/// Set while the Publisher level is owned.
pub const PUBLISHER: &str = "license.publisher";
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
    /// The lifetime unlock's price as the store shows it, like "$59.99".
    pub price: Option<String>,
    /// The yearly plan's price, like "$19.99".
    pub yearly_price: Option<String>,
    /// The monthly plan's price, like "$2.99".
    pub monthly_price: Option<String>,
    /// The App Store gives this person the yearly plan's first month free.
    pub free_month: bool,
    /// Their subscription is shared with them through Family Sharing, so someone else pays for it.
    pub subscription_shared: bool,
    /// Bought on "monthly", "yearly" or "lifetime" (none when not bought, or unlocked by code).
    pub plan: Option<String>,
    /// The Publisher level is owned (or unlocked by the owner's code).
    pub publisher: bool,
    /// Publisher for life, like "$119.99".
    pub publisher_price: Option<String>,
    /// Publisher yearly, like "$39.99".
    pub publisher_yearly_price: Option<String>,
    /// Publisher monthly, like "$9.99".
    pub publisher_monthly_price: Option<String>,
    /// Publisher for someone who already owns TBV for life: the difference.
    pub upgrade_price: Option<String>,
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
    pub yearly_price: Option<String>,
    pub monthly_price: Option<String>,
    pub free_month: bool,
    pub subscription_shared: bool,
    /// What's owned: "monthly" or "yearly" (a subscription that's running) or "lifetime".
    pub plan: Option<String>,
    /// The Publisher level is owned, on either plan or as an upgrade.
    pub publisher: bool,
    pub publisher_price: Option<String>,
    pub publisher_yearly_price: Option<String>,
    pub publisher_monthly_price: Option<String>,
    pub upgrade_price: Option<String>,
}

impl StoreAnswer {
    /// Nothing owned, nothing known about prices.
    pub fn nothing() -> Self {
        StoreAnswer {
            owned: false,
            price: None,
            yearly_price: None,
            monthly_price: None,
            free_month: false,
            subscription_shared: false,
            plan: None,
            publisher: false,
            publisher_price: None,
            publisher_yearly_price: None,
            publisher_monthly_price: None,
            upgrade_price: None,
        }
    }
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
                self.set_setting(PLAN, a.plan.as_deref().unwrap_or("lifetime"))?;
                if a.publisher {
                    self.set_setting(PUBLISHER, "1")?;
                } else {
                    self.conn.execute("DELETE FROM device_settings WHERE key = ?1", [PUBLISHER])?;
                }
                true
            }
            // The store says it isn't (refunded, or a yearly plan that ended).
            Some(_) => {
                self.conn.execute("DELETE FROM device_settings WHERE key IN (?1, ?2, ?3)", [OWNED, PLAN, PUBLISHER])?;
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
            yearly_price: answer.and_then(|a| a.yearly_price.clone()),
            monthly_price: answer.and_then(|a| a.monthly_price.clone()),
            free_month: answer.is_some_and(|a| a.free_month),
            subscription_shared: answer.is_some_and(|a| a.subscription_shared),
            plan: if bought { self.setting(PLAN)? } else { None },
            publisher: coded || (bought && self.setting(PUBLISHER)?.is_some()),
            publisher_price: answer.and_then(|a| a.publisher_price.clone()),
            publisher_yearly_price: answer.and_then(|a| a.publisher_yearly_price.clone()),
            publisher_monthly_price: answer.and_then(|a| a.publisher_monthly_price.clone()),
            upgrade_price: answer.and_then(|a| a.upgrade_price.clone()),
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
        let yes = StoreAnswer { owned: true, price: Some("$59.99".into()), plan: Some("lifetime".into()), ..StoreAnswer::nothing() };
        assert_eq!(library.license(start + 32 * DAY, None, Shop::Microsoft, Some(&yes)).unwrap().state, LicenseState::Owned);
        assert_eq!(library.license(start + 40 * DAY, None, Shop::Microsoft, None).unwrap().state, LicenseState::Owned);
        let no = StoreAnswer::nothing();
        assert_eq!(library.license(start + 41 * DAY, None, Shop::Microsoft, Some(&no)).unwrap().state, LicenseState::Expired);
    }

    #[test]
    fn an_app_store_copy_has_no_trial_until_one_is_given() {
        let (_dir, library) = crate::library::tests::open_temp_library();
        let start = 1_800_000_000;
        let view = library.license(start, None, Shop::Apple, None).unwrap();
        assert_eq!((view.state, view.days_left, view.trial_ends), (LicenseState::Expired, 0, start + IOS_TRIAL_DAYS * DAY));
        let yearly = StoreAnswer { owned: true, yearly_price: Some("$19.99".into()), plan: Some("yearly".into()), ..StoreAnswer::nothing() };
        let view = library.license(start + DAY, None, Shop::Apple, Some(&yearly)).unwrap();
        assert_eq!((view.state, view.plan.as_deref()), (LicenseState::Owned, Some("yearly")));
        // Offline, it stays open on the plan last seen; once the year ends unrenewed, the store says so.
        assert_eq!(library.license(start + 2 * DAY, None, Shop::Apple, None).unwrap().plan.as_deref(), Some("yearly"));
        let monthly = StoreAnswer { owned: true, monthly_price: Some("$2.99".into()), plan: Some("monthly".into()), ..StoreAnswer::nothing() };
        let view = library.license(start + 3 * DAY, None, Shop::Apple, Some(&monthly)).unwrap();
        assert_eq!((view.plan.as_deref(), view.monthly_price.as_deref()), (Some("monthly"), Some("$2.99")));
        let ended = library.license(start + 400 * DAY, None, Shop::Apple, Some(&StoreAnswer { free_month: true, ..StoreAnswer::nothing() })).unwrap();
        assert_eq!((ended.state, ended.plan, ended.free_month), (LicenseState::Expired, None, true));
    }

    #[test]
    fn publisher_is_owned_only_while_the_store_says_so() {
        let (_dir, library) = crate::library::tests::open_temp_library();
        let now = 1_800_000_000;
        let base = StoreAnswer { owned: true, plan: Some("lifetime".into()), ..StoreAnswer::nothing() };
        assert!(!library.license(now, None, Shop::Microsoft, Some(&base)).unwrap().publisher);
        let upgraded = StoreAnswer { publisher: true, ..base.clone() };
        assert!(library.license(now + DAY, None, Shop::Microsoft, Some(&upgraded)).unwrap().publisher);
        // Remembered offline; dropped when the store stops saying so.
        assert!(library.license(now + 2 * DAY, None, Shop::Microsoft, None).unwrap().publisher);
        assert!(!library.license(now + 3 * DAY, None, Shop::Microsoft, Some(&base)).unwrap().publisher);
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
