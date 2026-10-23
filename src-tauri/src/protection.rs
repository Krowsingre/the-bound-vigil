//! Discover's protection levels: which addresses the browser refuses to load.
//!
//! Strict (the default) blocks trackers, advertising and cryptocurrency
//! miners, and on iPhone also every third-party cookie. Balanced blocks
//! trackers and miners but lets advertising load. Off blocks nothing. A site
//! whose protection was lowered loads everything, whatever the level.
//!
//! The lists are TBV's own: well-known tracking, advertising and mining
//! hosts. A host matches when it is one of these or ends in "." and one of
//! these, so "stats.g.doubleclick.net" counts as "doubleclick.net".

use serde::Deserialize;

/// Hosts that follow people from site to site, or record what they do.
const TRACKERS: &[&str] = &[
    "google-analytics.com",
    "analytics.google.com",
    "googletagmanager.com",
    "googletagservices.com",
    "doubleclick.net",
    "connect.facebook.net",
    "pixel.facebook.com",
    "analytics.twitter.com",
    "static.ads-twitter.com",
    "bat.bing.com",
    "clarity.ms",
    "scorecardresearch.com",
    "quantserve.com",
    "quantcount.com",
    "chartbeat.com",
    "chartbeat.net",
    "hotjar.com",
    "hotjar.io",
    "mouseflow.com",
    "fullstory.com",
    "crazyegg.com",
    "luckyorange.com",
    "inspectlet.com",
    "mixpanel.com",
    "segment.io",
    "segment.com",
    "cdn.segment.com",
    "amplitude.com",
    "heap.io",
    "heapanalytics.com",
    "kissmetrics.com",
    "newrelic.com",
    "nr-data.net",
    "optimizely.com",
    "parsely.com",
    "parse.ly",
    "comscore.com",
    "omtrdc.net",
    "demdex.net",
    "everesttech.net",
    "2o7.net",
    "krxd.net",
    "bluekai.com",
    "exelator.com",
    "agkn.com",
    "rlcdn.com",
    "tapad.com",
    "adsrvr.org",
    "mathtag.com",
    "bidswitch.net",
    "crwdcntrl.net",
    "eyeota.net",
    "liadm.com",
    "id5-sync.com",
    "tiqcdn.com",
    "tealiumiq.com",
    "branch.io",
    "app-measurement.com",
    "appsflyer.com",
    "adjust.com",
    "kochava.com",
    "statcounter.com",
    "histats.com",
    "yandex.ru/metrika",
    "mc.yandex.ru",
    "cdn.mxpnl.com",
    "snap.licdn.com",
    "px.ads.linkedin.com",
    "ct.pinterest.com",
    "analytics.tiktok.com",
    "sc-static.net",
    "fingerprintjs.com",
    "fpjs.io",
    "iovation.com",
    "threatmetrix.com",
];

/// Hosts that serve advertising.
const ADS: &[&str] = &[
    "googlesyndication.com",
    "googleadservices.com",
    "adservice.google.com",
    "pagead2.googlesyndication.com",
    "2mdn.net",
    "amazon-adsystem.com",
    "adnxs.com",
    "adsafeprotected.com",
    "moatads.com",
    "criteo.com",
    "criteo.net",
    "taboola.com",
    "outbrain.com",
    "revcontent.com",
    "mgid.com",
    "pubmatic.com",
    "rubiconproject.com",
    "openx.net",
    "casalemedia.com",
    "indexww.com",
    "smartadserver.com",
    "yieldmo.com",
    "sharethrough.com",
    "teads.tv",
    "33across.com",
    "triplelift.com",
    "contextweb.com",
    "lijit.com",
    "sovrn.com",
    "media.net",
    "adform.net",
    "advertising.com",
    "zedo.com",
    "popads.net",
    "popcash.net",
    "propellerads.com",
    "adsterra.com",
    "exoclick.com",
    "juicyads.com",
    "trafficjunky.net",
    "adcash.com",
    "hilltopads.net",
    "clickadu.com",
    "admaven.com",
    "ad-maven.com",
    "onclickads.net",
    "yieldlove.com",
    "adition.com",
    "serving-sys.com",
    "flashtalking.com",
    "doubleverify.com",
    "innovid.com",
    "spotxchange.com",
    "springserve.com",
    "undertone.com",
    "gumgum.com",
    "kargo.com",
    "nativo.com",
    "zemanta.com",
    "bidr.io",
    "adroll.com",
    "perfectaudience.com",
    "quantcast.com",
];

/// Hosts that use the visitor's computer to mine cryptocurrency.
const MINERS: &[&str] = &[
    "coinhive.com",
    "coin-hive.com",
    "authedmine.com",
    "crypto-loot.com",
    "cryptoloot.pro",
    "coinimp.com",
    "minero.cc",
    "webmine.cz",
    "jsecoin.com",
    "monerominer.rocks",
    "ppoi.org",
    "coinhave.com",
    "minr.pw",
];

/// How much the browser blocks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    #[default]
    Strict,
    Balanced,
    Off,
}

/// The chosen level, and the sites (hosts) it's lowered for.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Protection {
    #[serde(default)]
    pub level: Level,
    #[serde(default)]
    pub lowered: Vec<String>,
}

fn lists(level: Level) -> Vec<&'static [&'static str]> {
    match level {
        Level::Strict => vec![TRACKERS, ADS, MINERS],
        Level::Balanced => vec![TRACKERS, MINERS],
        Level::Off => vec![],
    }
}

/// Whether `host` is `domain` or one of its subdomains.
#[cfg_attr(not(windows), allow(dead_code))]
fn under(host: &str, domain: &str) -> bool {
    host == domain || (host.len() > domain.len() && host.ends_with(domain) && host.as_bytes()[host.len() - domain.len() - 1] == b'.')
}

impl Protection {
    /// Whether the page on `site` (the host of the page showing) has protection lowered.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn lowered_for(&self, site: &str) -> bool {
        let site = site.trim_start_matches("www.");
        self.lowered.iter().any(|h| under(site, h.trim_start_matches("www.")))
    }

    /// The level for a page on `site`: off where protection was lowered for it.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn level_for(&self, site: &str) -> Level {
        if self.lowered_for(site) {
            Level::Off
        } else {
            self.level
        }
    }

    /// Whether a request to `url`, made by a page on `site`, is refused.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn blocks(&self, url: &str, site: &str) -> bool {
        if self.level == Level::Off || self.lowered_for(site) {
            return false;
        }
        let Ok(parsed) = tauri::Url::parse(url) else { return false };
        if !matches!(parsed.scheme(), "http" | "https" | "ws" | "wss") {
            return false;
        }
        let Some(host) = parsed.host_str() else { return false };
        let host = host.to_ascii_lowercase();
        // A site's own addresses always load, even when the site is on a list.
        if !site.is_empty() && (under(&host, site) || under(site, &host)) {
            return false;
        }
        let path = parsed.path();
        lists(self.level).iter().flat_map(|l| l.iter()).any(|entry| match entry.split_once('/') {
            Some((domain, prefix)) => under(&host, domain) && path.trim_start_matches('/').starts_with(prefix),
            None => under(&host, entry),
        })
    }

    /// "strict", "balanced" or "off", for Apple's web view.
    #[cfg_attr(not(mobile), allow(dead_code))]
    pub fn level_name(&self) -> &'static str {
        match self.level {
            Level::Strict => "strict",
            Level::Balanced => "balanced",
            Level::Off => "off",
        }
    }

    /// The same blocking as rules for Apple's web view (WKContentRuleList JSON).
    #[cfg_attr(not(mobile), allow(dead_code))]
    pub fn apple_rules(&self) -> String {
        let unless: Vec<serde_json::Value> = self.lowered.iter().map(|h| format!("*{}", h.trim_start_matches("www.")).into()).collect();
        let trigger = |filter: String| {
            let mut t = serde_json::json!({ "url-filter": filter, "load-type": ["third-party"] });
            if !unless.is_empty() {
                t["unless-domain"] = serde_json::Value::Array(unless.clone());
            }
            t
        };
        let mut rules: Vec<serde_json::Value> = lists(self.level)
            .iter()
            .flat_map(|l| l.iter())
            .map(|entry| {
                let domain = entry.split('/').next().unwrap_or(entry);
                let filter = format!("^[^:]+://+([^:/]+\\.)?{}[/:]", regex_escape(domain));
                serde_json::json!({ "trigger": trigger(filter), "action": { "type": "block" } })
            })
            .collect();
        if self.level == Level::Strict {
            rules.push(serde_json::json!({ "trigger": trigger(".*".into()), "action": { "type": "block-cookies" } }));
        }
        // An empty list isn't allowed: one rule that never matches.
        if rules.is_empty() {
            rules.push(serde_json::json!({ "trigger": { "url-filter": "^tbv-never:" }, "action": { "type": "block" } }));
        }
        serde_json::Value::Array(rules).to_string()
    }
}

fn regex_escape(text: &str) -> String {
    text.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c.to_string() } else { format!("\\{c}") }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strict() -> Protection {
        Protection { level: Level::Strict, lowered: vec![] }
    }

    #[test]
    fn trackers_and_their_subdomains_are_blocked() {
        let p = strict();
        assert!(p.blocks("https://www.google-analytics.com/analytics.js", "example.org"));
        assert!(p.blocks("https://stats.g.doubleclick.net/x", "example.org"));
        assert!(!p.blocks("https://notdoubleclick.net/x", "example.org"));
        assert!(p.blocks("https://mc.yandex.ru/watch", "example.org"));
    }

    #[test]
    fn balanced_lets_advertising_through() {
        let p = Protection { level: Level::Balanced, lowered: vec![] };
        assert!(!p.blocks("https://cdn.taboola.com/x.js", "example.org"));
        assert!(p.blocks("https://www.googletagmanager.com/gtm.js", "example.org"));
        assert!(p.blocks("https://coinhive.com/lib.js", "example.org"));
    }

    #[test]
    fn off_and_lowered_sites_block_nothing() {
        assert!(!Protection { level: Level::Off, lowered: vec![] }.blocks("https://doubleclick.net/", "example.org"));
        let p = Protection { level: Level::Strict, lowered: vec!["example.org".into()] };
        assert!(!p.blocks("https://doubleclick.net/", "www.example.org"));
        assert!(p.blocks("https://doubleclick.net/", "other.org"));
    }

    #[test]
    fn a_site_on_a_list_still_loads_its_own_pages() {
        assert!(!strict().blocks("https://www.criteo.com/careers", "www.criteo.com"));
    }

    #[test]
    fn apple_rules_are_json_with_cookies_blocked_when_strict() {
        let rules: serde_json::Value = serde_json::from_str(&strict().apple_rules()).unwrap();
        let list = rules.as_array().unwrap();
        assert!(list.iter().any(|r| r["action"]["type"] == "block-cookies"));
        assert!(list.iter().any(|r| r["trigger"]["url-filter"].as_str().unwrap().contains("doubleclick\\.net")));
        let off: serde_json::Value = serde_json::from_str(&Protection { level: Level::Off, lowered: vec![] }.apple_rules()).unwrap();
        assert_eq!(off.as_array().unwrap().len(), 1);
    }
}
