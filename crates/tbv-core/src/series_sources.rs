//! More places to find the books of a series: Wikidata, the ISFDB and
//! Google Books, all free and needing no account. Each gives a list of
//! `SeriesEntry`, merged with Hardcover's and Audible's (see `series::merge`).

use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;

use crate::error::{Error, Result};
use crate::manage::author_key;
use crate::series::SeriesEntry;

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        // Wikimedia asks every tool to say who it is.
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION"), " (desktop eBook reader; https://github.com/Krowsingre/the-bound-vigil)"))
        .build()
        .into()
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// "4", "4.5" or "Book 4" as a number.
fn number_in(s: &str) -> Option<f64> {
    let start = s.find(|c: char| c.is_ascii_digit())?;
    let digits: String = s[start..].chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect();
    digits.trim_end_matches(['.', ',']).replace(',', ".").parse().ok()
}

/// Whether a book's authors fit the author searched for (or either is unknown).
fn same_author(authors: &[String], author: &str) -> bool {
    let want = author_key(&[author.to_string()]);
    want.is_empty() || authors.is_empty() || authors.iter().any(|a| author_key(std::slice::from_ref(a)) == want)
}

// Wikidata: books say which series they're "part of" (P179), with their
// number in it as a "series ordinal" (P1545).

/// The SPARQL query for the books of every series with this name.
pub fn wikidata_query(name: &str) -> String {
    let name = name.trim().replace('\\', "\\\\").replace('"', "\\\"");
    let mut names = vec![format!("\"{name}\"@en"), format!("\"{name} series\"@en")];
    let lower = name.to_lowercase();
    if lower != name {
        names.push(format!("\"{lower}\"@en"));
    }
    format!(
        "SELECT ?series ?book ?bookLabel ?ordinal ?authorLabel WHERE {{ \
         VALUES ?name {{ {} }} \
         ?series rdfs:label|skos:altLabel ?name . \
         ?book p:P179 ?statement . ?statement ps:P179 ?series . \
         OPTIONAL {{ ?statement pq:P1545 ?ordinal . }} \
         OPTIONAL {{ ?book wdt:P50 ?author . }} \
         SERVICE wikibase:label {{ bd:serviceParam wikibase:language \"en\". }} \
         }} LIMIT 1000",
        names.join(" ")
    )
}

/// Wikidata's answer as the books of one series: of the series with this
/// name, the one with the most books by the author.
pub fn wikidata_series_from(data: &Value, author: &str) -> Vec<SeriesEntry> {
    // series → book → entry, keeping the order books first appear in.
    let mut series: Vec<(String, Vec<(String, SeriesEntry)>)> = Vec::new();
    for row in data["results"]["bindings"].as_array().into_iter().flatten() {
        let (Some(id), Some(book)) = (text(&row["series"]["value"]), text(&row["book"]["value"])) else { continue };
        let Some(title) = text(&row["bookLabel"]["value"]) else { continue };
        // An item with no English name comes back as its id ("Q123").
        if title.starts_with('Q') && title[1..].chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let books = match series.iter_mut().find(|(s, _)| *s == id) {
            Some((_, books)) => books,
            None => {
                series.push((id, Vec::new()));
                &mut series.last_mut().expect("just pushed").1
            }
        };
        let entry = match books.iter_mut().find(|(b, _)| *b == book) {
            Some((_, entry)) => entry,
            None => {
                books.push((book, SeriesEntry { title, source: "wikidata".into(), ..Default::default() }));
                &mut books.last_mut().expect("just pushed").1
            }
        };
        if entry.position.is_none() {
            entry.position = row["ordinal"]["value"].as_str().and_then(number_in);
        }
        if let Some(name) = text(&row["authorLabel"]["value"]) {
            if !entry.authors.contains(&name) {
                entry.authors.push(name);
            }
        }
    }
    series
        .into_iter()
        .map(|(_, books)| books.into_iter().map(|(_, e)| e).filter(|e| same_author(&e.authors, author)).collect::<Vec<_>>())
        .max_by_key(Vec::len)
        .unwrap_or_default()
}

pub fn search_wikidata_series(name: &str, author: &str) -> Result<Vec<SeriesEntry>> {
    let mut response = agent()
        .get("https://query.wikidata.org/sparql")
        .query("query", wikidata_query(name))
        .query("format", "json")
        .header("Accept", "application/sparql-results+json")
        .call()
        .map_err(|e| Error::Offline(format!("Wikidata couldn't be reached: {e}")))?;
    let data: Value = response.body_mut().read_json().map_err(|e| Error::Offline(format!("Wikidata's answer couldn't be read: {e}")))?;
    Ok(wikidata_series_from(&data, author))
}

// The ISFDB (Internet Speculative Fiction Database): series pages list each
// title with its number. It has no API for series, so its pages are read.

const ISFDB: &str = "https://www.isfdb.org/cgi-bin/";

/// The few entities ISFDB's pages use in titles.
fn unescape(s: &str) -> String {
    let mut out = s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
    while let Some(start) = out.find("&#") {
        let Some(len) = out[start..].find(';') else { break };
        let code = &out[start + 2..start + len];
        let ch = code.strip_prefix(['x', 'X']).map_or_else(|| code.parse().ok(), |hex| u32::from_str_radix(hex, 16).ok()).and_then(char::from_u32);
        let Some(ch) = ch else { break };
        out.replace_range(start..start + len + 1, &ch.to_string());
    }
    out
}

/// The text inside the link starting at `at` (just after `href="…"`).
fn link_text(html: &str, at: usize) -> Option<(String, usize)> {
    let open = at + html[at..].find('>')? + 1;
    let close = open + html[open..].find("</a>")?;
    let inner = &html[open..close];
    // Drop any tags inside the link.
    let mut plain = String::new();
    let mut in_tag = false;
    for c in inner.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => plain.push(c),
            _ => {}
        }
    }
    Some((unescape(plain.trim()), close + 4))
}

/// Links to series pages on a search page, with their names.
pub fn isfdb_series_links(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(found) = html[from..].find("pe.cgi?") {
        let at = from + found + "pe.cgi?".len();
        let id: String = html[at..].chars().take_while(char::is_ascii_digit).collect();
        match link_text(html, at) {
            Some((name, end)) if !id.is_empty() => {
                out.push((id, name));
                from = end;
            }
            _ => from = at,
        }
    }
    out
}

/// A series page's numbered titles. Each line reads like
/// `<li> 4 <a href="…title.cgi?123">Mort</a> (1987) [N] by …`.
pub fn isfdb_series_from(html: &str, author: &str) -> Vec<SeriesEntry> {
    let mut out = Vec::new();
    for item in html.split("<li>").skip(1) {
        let Some(link) = item.find("title.cgi?") else { continue };
        // The number comes before the link; lines without one are usually
        // short stories or omnibuses, so they're left out.
        let before = item[..item[..link].rfind("<a").unwrap_or(link)].trim();
        let Some(position) = before.split_whitespace().next().and_then(|n| n.trim_end_matches(['-', '–', '.']).parse::<f64>().ok()) else {
            continue;
        };
        let Some((title, end)) = link_text(item, link) else { continue };
        if title.is_empty() {
            continue;
        }
        // Authors are the links to author pages on the same line.
        let rest = &item[end..];
        let line_end = end + [rest.find('\n'), rest.find("</li>"), rest.find("<ul")].into_iter().flatten().min().unwrap_or(rest.len());
        let authors: Vec<String> = item[end..line_end]
            .match_indices("ea.cgi?")
            .filter_map(|(i, _)| link_text(item, end + i).map(|(name, _)| name))
            .filter(|n| !n.is_empty())
            .collect();
        if !same_author(&authors, author) {
            continue;
        }
        out.push(SeriesEntry { title, position: Some(position), authors, cover_url: None, source: "isfdb".into() });
    }
    out
}

fn isfdb_page(agent: &ureq::Agent, url: &str) -> Result<String> {
    let mut response = agent.get(url).call().map_err(|e| Error::Offline(format!("The ISFDB couldn't be reached: {e}")))?;
    let bytes = response.body_mut().with_config().limit(8 * 1024 * 1024).read_to_vec().map_err(|e| Error::Offline(format!("The ISFDB's page couldn't be read: {e}")))?;
    // Its pages are in Latin-1, which Windows-1252 covers.
    Ok(encoding_rs::WINDOWS_1252.decode(&bytes).0.into_owned())
}

pub fn search_isfdb_series(name: &str, author: &str) -> Result<Vec<SeriesEntry>> {
    let agent = agent();
    let search = format!("{ISFDB}se.cgi?arg={}&type=Series", form_encode(name.trim()));
    let page = isfdb_page(&agent, &search)?;
    // One exact match goes straight to the series page.
    let here = isfdb_series_from(&page, author);
    if !here.is_empty() {
        return Ok(here);
    }
    let want = name.trim().to_lowercase();
    let links = isfdb_series_links(&page);
    let Some((id, _)) = links.iter().find(|(_, n)| n.to_lowercase() == want).or_else(|| links.first()) else {
        return Ok(Vec::new());
    };
    Ok(isfdb_series_from(&isfdb_page(&agent, &format!("{ISFDB}pe.cgi?{id}"))?, author))
}

fn form_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            b' ' => "+".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

// Google Books: some ebooks carry `seriesInfo`, and the whole series can
// then be asked for by its id.

/// The series most of the search results belong to.
pub fn google_series_id(data: &Value) -> Option<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for item in data["items"].as_array().into_iter().flatten() {
        for s in item["volumeInfo"]["seriesInfo"]["volumeSeries"].as_array().into_iter().flatten() {
            if let Some(id) = text(&s["seriesId"]) {
                *counts.entry(id).or_default() += 1;
            }
        }
    }
    counts.into_iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0))).map(|(id, _)| id)
}

/// Books of a Google Books series, from a search answer or the series' own list.
pub fn google_series_from(volumes: &[Value], series_id: &str, author: &str) -> Vec<SeriesEntry> {
    volumes
        .iter()
        .filter_map(|item| {
            let info = &item["volumeInfo"];
            let series = info["seriesInfo"]["volumeSeries"].as_array()?.iter().find(|s| text(&s["seriesId"]).as_deref() == Some(series_id))?;
            let title = text(&info["title"])?;
            let position = text(&info["seriesInfo"]["bookDisplayNumber"]).and_then(|n| number_in(&n)).or_else(|| series["orderNumber"].as_f64());
            let authors: Vec<String> = info["authors"].as_array().map(|a| a.iter().filter_map(text).collect()).unwrap_or_default();
            let cover_url = text(&info["imageLinks"]["thumbnail"]).map(|c| c.replace("http://", "https://"));
            Some(SeriesEntry { title, position, authors, cover_url, source: "google".into() })
        })
        .filter(|e| same_author(&e.authors, author))
        .collect()
}

pub fn search_google_series(name: &str, author: &str) -> Result<Vec<SeriesEntry>> {
    let agent = agent();
    let mut q = format!("\"{}\"", name.trim());
    if !author.trim().is_empty() {
        q.push_str(&format!(" inauthor:{}", author.trim()));
    }
    let offline = |e: ureq::Error| Error::Offline(format!("Google Books couldn't be reached: {e}"));
    let mut response = agent.get("https://www.googleapis.com/books/v1/volumes").query("q", q).query("maxResults", "40").call().map_err(offline)?;
    let data: Value = response.body_mut().read_json().map_err(|e| Error::Offline(format!("Google Books' answer couldn't be read: {e}")))?;
    let Some(id) = google_series_id(&data) else { return Ok(Vec::new()) };
    // The series' own list has every book; the search only some.
    let members = agent
        .get("https://www.googleapis.com/books/v1/series/membership/get")
        .query("series_id", &id)
        .query("page_size", "100")
        .call()
        .ok()
        .and_then(|mut r| r.body_mut().read_json::<Value>().ok())
        .and_then(|v| v["member"].as_array().cloned())
        .unwrap_or_default();
    let found = data["items"].as_array().cloned().unwrap_or_default();
    Ok(google_series_from(&[members, found].concat(), &id, author))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn wikidata_picks_the_authors_series_and_reads_ordinals() {
        let row = |series: &str, book: &str, title: &str, ordinal: Option<&str>, author: &str| {
            let mut r = json!({
                "series": { "value": series }, "book": { "value": book },
                "bookLabel": { "value": title }, "authorLabel": { "value": author }
            });
            if let Some(o) = ordinal {
                r["ordinal"] = json!({ "value": o });
            }
            r
        };
        let data = json!({ "results": { "bindings": [
            row("s1", "b1", "The Colour of Magic", Some("1"), "Terry Pratchett"),
            row("s1", "b1", "The Colour of Magic", Some("1"), "Someone Else"),
            row("s1", "b2", "Mort", Some("4"), "Terry Pratchett"),
            row("s1", "b3", "Q12345", Some("5"), "Terry Pratchett"),
            row("s2", "b9", "Discworld Noir", None, "A Studio"),
        ]}});
        let found = wikidata_series_from(&data, "Terry Pratchett");
        assert_eq!(found.iter().map(|e| (e.title.as_str(), e.position)).collect::<Vec<_>>(), [("The Colour of Magic", Some(1.0)), ("Mort", Some(4.0))]);
        assert_eq!(found[0].authors, ["Terry Pratchett", "Someone Else"]);
        assert!(wikidata_query("Say \"hi\"").contains(r#""Say \"hi\""@en"#));
    }

    #[test]
    fn isfdb_series_pages_give_numbered_titles() {
        let page = r#"<ul>
<li> 1 <a href="https://www.isfdb.org/cgi-bin/title.cgi?1" dir="ltr">The Colour of Magic</a> (1983) [N] by <a href="https://www.isfdb.org/cgi-bin/ea.cgi?9" dir="ltr">Terry Pratchett</a>
<li> 2.5 <a href="https://www.isfdb.org/cgi-bin/title.cgi?2" dir="ltr">Troll Bridge</a> (1992) [SF] by <a href="https://www.isfdb.org/cgi-bin/ea.cgi?9" dir="ltr">Terry Pratchett</a>
<li> <a href="https://www.isfdb.org/cgi-bin/title.cgi?3" dir="ltr">The Discworld Companion</a> (1994) by <a href="https://www.isfdb.org/cgi-bin/ea.cgi?9" dir="ltr">Terry Pratchett</a>
<li> 4 <a href="https://www.isfdb.org/cgi-bin/title.cgi?4" dir="ltr">Mort &amp; More</a> (1987) [N] by <a href="https://www.isfdb.org/cgi-bin/ea.cgi?10" dir="ltr">Somebody Else</a>
</ul>"#;
        let found = isfdb_series_from(page, "Terry Pratchett");
        assert_eq!(found.iter().map(|e| (e.title.as_str(), e.position)).collect::<Vec<_>>(), [("The Colour of Magic", Some(1.0)), ("Troll Bridge", Some(2.5))]);
        assert_eq!(isfdb_series_from(page, "")[2].title, "Mort & More");
        let search = r#"<tr><td><a href="https://www.isfdb.org/cgi-bin/pe.cgi?45" dir="ltr">Discworld</a></td></tr>
<tr><td><a href="https://www.isfdb.org/cgi-bin/pe.cgi?46" dir="ltr">Discworld Maps</a></td></tr>"#;
        assert_eq!(isfdb_series_links(search), [("45".to_string(), "Discworld".to_string()), ("46".to_string(), "Discworld Maps".to_string())]);
        assert_eq!(unescape("Caf&#233; &#x4E;"), "Café N");
    }

    #[test]
    fn google_books_series_by_id_and_number() {
        let volume = |title: &str, id: &str, number: Option<&str>, order: Option<u32>| {
            json!({ "volumeInfo": {
                "title": title, "authors": ["Michael Dalton"],
                "imageLinks": { "thumbnail": format!("http://books.google.com/{title}.jpg") },
                "seriesInfo": { "bookDisplayNumber": number, "volumeSeries": [{ "seriesId": id, "orderNumber": order }] }
            }})
        };
        let search = json!({ "items": [
            volume("Breeder Mage", "S1", Some("1"), Some(1)),
            volume("Breeder Mage 2", "S1", None, Some(2)),
            volume("Other", "S2", Some("1"), None),
        ]});
        assert_eq!(google_series_id(&search).as_deref(), Some("S1"));
        let found = google_series_from(search["items"].as_array().unwrap(), "S1", "Michael Dalton");
        assert_eq!(found.iter().map(|e| (e.title.as_str(), e.position)).collect::<Vec<_>>(), [("Breeder Mage", Some(1.0)), ("Breeder Mage 2", Some(2.0))]);
        assert_eq!(found[0].cover_url.as_deref(), Some("https://books.google.com/Breeder Mage.jpg"));
        assert_eq!(number_in("Book 3"), Some(3.0));
    }
}
