//! More places to look a book up for Find details online, beside Google
//! Books and Open Library (searched from the page itself): Audible's public
//! catalogue, which knows audiobooks, narrators and series, Apple Books
//! (ebooks and audiobooks, with large covers), and Hardcover, for people
//! who've connected it for their ratings. These are reached from
//! here because their services don't answer a web page directly.

use serde::Serialize;
use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::hardcover::{graphql, Transport};

const LIMIT: usize = 8;

/// A book found online, the same shape the page uses for every source.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub id: String,
    pub source: String,
    pub title: String,
    pub authors: Vec<String>,
    pub narrators: Vec<String>,
    pub series: Option<String>,
    pub series_index: Option<String>,
    pub synopsis: Option<String>,
    pub genres: Vec<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub language: Option<String>,
    pub isbn: Option<String>,
    pub cover_url: Option<String>,
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

fn names(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|list| list.iter().filter_map(|p| text(&p["name"]).or_else(|| text(p))).collect())
        .unwrap_or_default()
}

/// HTML from a catalogue as plain text, paragraphs kept.
pub fn plain(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    let mut tag = String::new();
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let t = tag.trim_start_matches('/').split_whitespace().next().unwrap_or("").to_ascii_lowercase();
                if matches!(t.as_str(), "p" | "br" | "div") && !out.ends_with("\n\n") && !out.is_empty() {
                    out.push_str(if t == "br" { "\n" } else { "\n\n" });
                }
            }
            _ if in_tag => tag.push(c),
            _ => out.push(c),
        }
    }
    let out = out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
    out.lines().map(str::trim).collect::<Vec<_>>().join("\n").split("\n\n\n").collect::<Vec<_>>().join("\n\n").trim().to_string()
}

/// A series number as TBV keeps it: "3", "2.5"; anything else is left out.
fn number(v: &Value) -> Option<String> {
    let raw = v.as_f64().map(|n| n.to_string()).or_else(|| text(v))?;
    let first = raw.split(|c: char| !(c.is_ascii_digit() || c == '.')).find(|s| !s.is_empty())?;
    first.parse::<f64>().ok().map(|n| if n.fract() == 0.0 { format!("{}", n as i64) } else { n.to_string() })
}

fn language_code(name: &str) -> String {
    match name.to_ascii_lowercase().as_str() {
        "english" => "en",
        "german" => "de",
        "french" => "fr",
        "spanish" => "es",
        "italian" => "it",
        "portuguese" => "pt",
        "dutch" => "nl",
        "japanese" => "ja",
        "swedish" => "sv",
        "danish" => "da",
        "norwegian" => "no",
        "finnish" => "fi",
        "polish" => "pl",
        "russian" => "ru",
        other => return other.to_string(),
    }
    .to_string()
}

/// Audible's catalogue answer as found books.
pub fn audible_from(data: &Value) -> Vec<Found> {
    let Some(products) = data["products"].as_array() else { return Vec::new() };
    products
        .iter()
        .take(LIMIT)
        .filter_map(|p| {
            let title = text(&p["title"])?;
            let series = p["series"].as_array().and_then(|s| s.first()).cloned().unwrap_or(Value::Null);
            let synopsis = text(&p["publisher_summary"]).or_else(|| text(&p["merchandising_summary"])).map(|h| plain(&h));
            let genres: Vec<String> = p["category_ladders"]
                .as_array()
                .map(|ladders| {
                    let mut out: Vec<String> = Vec::new();
                    for ladder in ladders {
                        for rung in ladder["ladder"].as_array().into_iter().flatten().skip(1) {
                            if let Some(name) = text(&rung["name"]) {
                                if !out.contains(&name) && out.len() < 6 {
                                    out.push(name);
                                }
                            }
                        }
                    }
                    out
                })
                .unwrap_or_default();
            let cover = p["product_images"].as_object().and_then(|images| {
                ["500", "1024", "252"].iter().find_map(|size| images.get(*size)).and_then(text)
            });
            Some(Found {
                id: format!("audible:{}", text(&p["asin"]).unwrap_or_default()),
                source: "audible".into(),
                title,
                authors: names(&p["authors"]),
                narrators: names(&p["narrators"]),
                series: text(&series["title"]),
                series_index: number(&series["sequence"]),
                synopsis,
                genres,
                publisher: text(&p["publisher_name"]),
                published: text(&p["release_date"]).or_else(|| text(&p["issue_date"])),
                language: text(&p["language"]).map(|l| language_code(&l)),
                isbn: None,
                cover_url: cover.map(|c| c.replace("http://", "https://")),
            })
        })
        .collect()
}

/// Searches Audible's public catalogue (no account needed).
pub fn search_audible(title: &str, author: &str) -> Result<Vec<Found>> {
    if title.trim().is_empty() && author.trim().is_empty() {
        return Ok(Vec::new());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(15)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION"), " (desktop eBook reader)"))
        .build()
        .into();
    let mut request = agent
        .get("https://api.audible.com/1.0/catalog/products")
        .query("num_results", LIMIT.to_string())
        .query("products_sort_by", "Relevance")
        .query("response_groups", "contributors,media,product_attrs,product_desc,product_extended_attrs,series,category_ladders");
    if !title.trim().is_empty() {
        request = request.query("title", title.trim());
    }
    if !author.trim().is_empty() {
        request = request.query("author", author.trim());
    }
    let mut response = request.call().map_err(|e| Error::Offline(format!("Audible couldn't be reached: {e}")))?;
    let data: Value = response.body_mut().read_json().map_err(|e| Error::Offline(format!("Audible's answer couldn't be read: {e}")))?;
    Ok(audible_from(&data))
}

/// Apple's search answer (ebooks or audiobooks) as found books. Apple gives
/// no series, publisher or language, so those are left for other sources.
pub fn apple_from(data: &Value) -> Vec<Found> {
    let Some(results) = data["results"].as_array() else { return Vec::new() };
    results
        .iter()
        .filter_map(|r| {
            // Ebooks are "tracks"; audiobooks are "collections".
            let audiobook = text(&r["wrapperType"]).as_deref() == Some("audiobook");
            let title = if audiobook { text(&r["collectionName"]) } else { text(&r["trackName"]) }?;
            let id = if audiobook { &r["collectionId"] } else { &r["trackId"] };
            let mut genres: Vec<String> = r["genres"]
                .as_array()
                .map(|g| g.iter().filter_map(text).filter(|g| g != "Books").collect())
                .unwrap_or_default();
            if let Some(primary) = text(&r["primaryGenreName"]) {
                if primary != "Books" && !genres.contains(&primary) {
                    genres.insert(0, primary);
                }
            }
            genres.truncate(6);
            let authors: Vec<String> = text(&r["artistName"])
                .map(|a| a.split(" & ").map(str::trim).filter(|a| !a.is_empty()).map(String::from).collect())
                .unwrap_or_default();
            // Apple's picture links name their size; a larger one is the same picture.
            let cover = text(&r["artworkUrl100"]).or_else(|| text(&r["artworkUrl60"])).map(|c| {
                c.replace("http://", "https://").replace("100x100bb", "1000x1000bb").replace("60x60bb", "1000x1000bb")
            });
            Some(Found {
                id: format!("apple:{}", id.as_i64().map(|n| n.to_string()).or_else(|| text(id)).unwrap_or_default()),
                source: "apple".into(),
                title,
                authors,
                synopsis: text(&r["description"]).map(|h| plain(&h)).filter(|d| !d.is_empty()),
                genres,
                published: text(&r["releaseDate"]).map(|d| d.chars().take(10).collect()),
                cover_url: cover,
                ..Found::default()
            })
        })
        .collect()
}

/// Searches Apple Books for ebooks and audiobooks (no account needed).
pub fn search_apple(title: &str, author: &str) -> Result<Vec<Found>> {
    let term = format!("{} {}", title.trim(), author.trim());
    if term.trim().is_empty() {
        return Ok(Vec::new());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(15)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION"), " (eBook reader)"))
        .build()
        .into();
    let mut found = Vec::new();
    let mut failed = None;
    for (media, limit) in [("ebook", 5), ("audiobook", 3)] {
        let answer = agent
            .get("https://itunes.apple.com/search")
            .query("term", term.trim())
            .query("media", media)
            .query("entity", media)
            .query("limit", limit.to_string())
            .call()
            .map_err(|e| Error::Offline(format!("Apple Books couldn't be reached: {e}")))
            .and_then(|mut response| {
                response.body_mut().read_json::<Value>().map_err(|e| Error::Offline(format!("Apple Books' answer couldn't be read: {e}")))
            });
        match answer {
            Ok(data) => found.extend(apple_from(&data)),
            Err(e) => failed = Some(e),
        }
    }
    match failed {
        Some(e) if found.is_empty() => Err(e),
        _ => Ok(found),
    }
}

/// Hardcover's search answer as found books.
pub fn hardcover_from(data: &Value) -> Vec<Found> {
    let hits = data.pointer("/search/results/hits").and_then(Value::as_array).cloned().unwrap_or_default();
    hits.iter()
        .take(LIMIT)
        .filter_map(|hit| {
            let d = &hit["document"];
            let title = text(&d["title"])?;
            let featured = &d["featured_series"];
            let series = text(&featured["series"]["name"]).or_else(|| d["series_names"].as_array().and_then(|s| s.first()).and_then(text));
            let isbn = d["isbns"].as_array().and_then(|list| {
                let all: Vec<String> = list.iter().filter_map(text).collect();
                all.iter().find(|i| i.len() == 13).or(all.first()).cloned()
            });
            let id = d["id"].as_i64().map(|n| n.to_string()).or_else(|| text(&d["id"])).unwrap_or_default();
            Some(Found {
                id: format!("hardcover:{id}"),
                source: "hardcover".into(),
                title,
                authors: d["author_names"].as_array().map(|a| a.iter().filter_map(text).collect()).unwrap_or_default(),
                narrators: Vec::new(),
                series_index: series.as_ref().and_then(|_| number(&featured["position"])),
                series,
                synopsis: text(&d["description"]).map(|h| plain(&h)),
                genres: d["genres"].as_array().map(|g| g.iter().filter_map(text).take(6).collect()).unwrap_or_default(),
                publisher: None,
                published: d["release_year"].as_i64().map(|y| y.to_string()).or_else(|| text(&d["release_date"])),
                language: None,
                isbn,
                cover_url: text(&d["image"]["url"]),
            })
        })
        .collect()
}

/// Searches Hardcover with the person's own connection.
pub fn search_hardcover(net: &dyn Transport, token: &str, title: &str, author: &str) -> Result<Vec<Found>> {
    let q = format!("{} {}", title.trim(), author.trim());
    if q.trim().is_empty() {
        return Ok(Vec::new());
    }
    let data = graphql(
        net,
        token,
        "query ($q: String!, $n: Int!) { search(query: $q, query_type: \"Book\", per_page: $n, page: 1) { results } }",
        json!({ "q": q.trim(), "n": LIMIT }),
    )?;
    Ok(hardcover_from(&data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audible_gives_series_narrators_and_a_plain_synopsis() {
        let data = json!({ "products": [{
            "asin": "B002V0QK4C",
            "title": "Guards! Guards!",
            "authors": [{ "name": "Terry Pratchett" }],
            "narrators": [{ "name": "Nigel Planer" }],
            "series": [{ "title": "Discworld", "sequence": "8" }, { "title": "City Watch", "sequence": "1" }],
            "publisher_name": "Isis Audio Books",
            "release_date": "2005-01-01",
            "language": "english",
            "publisher_summary": "<p>Here be dragons.</p><p>And <b>more</b>.</p>",
            "product_images": { "500": "https://m.media-amazon.com/images/I/51.jpg" },
            "category_ladders": [{ "ladder": [{ "name": "Science Fiction & Fantasy" }, { "name": "Fantasy" }, { "name": "Humorous" }] }]
        }]});
        let found = audible_from(&data);
        assert_eq!(found.len(), 1);
        let f = &found[0];
        assert_eq!((f.series.as_deref(), f.series_index.as_deref()), (Some("Discworld"), Some("8")));
        assert_eq!(f.narrators, ["Nigel Planer"]);
        assert_eq!(f.synopsis.as_deref(), Some("Here be dragons.\n\nAnd more."));
        assert_eq!(f.language.as_deref(), Some("en"));
        assert_eq!(f.genres, ["Fantasy", "Humorous"]);
        assert_eq!(f.cover_url.as_deref(), Some("https://m.media-amazon.com/images/I/51.jpg"));
    }

    #[test]
    fn apple_gives_ebooks_and_audiobooks_with_large_covers() {
        let data = json!({ "results": [
            { "wrapperType": "ebook", "kind": "ebook", "trackId": 360583612, "trackName": "Mort", "artistName": "Terry Pratchett",
              "description": "<p>Death takes an apprentice.</p><p>Second.</p>", "genres": ["Fantasy", "Books", "Fiction & Literature"],
              "releaseDate": "2009-10-13T07:00:00Z", "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg" },
            { "wrapperType": "audiobook", "collectionId": 1440000000_i64, "collectionName": "Good Omens", "artistName": "Terry Pratchett & Neil Gaiman",
              "primaryGenreName": "Sci-Fi & Fantasy", "releaseDate": "2019-05-01T07:00:00Z", "artworkUrl60": "http://is1.mzstatic.com/a/60x60bb.jpg" },
            { "wrapperType": "ebook", "trackId": 1 }
        ]});
        let found = apple_from(&data);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].id, "apple:360583612");
        assert_eq!(found[0].source, "apple");
        assert_eq!(found[0].synopsis.as_deref(), Some("Death takes an apprentice.\n\nSecond."));
        assert_eq!(found[0].genres, ["Fantasy", "Fiction & Literature"]);
        assert_eq!(found[0].published.as_deref(), Some("2009-10-13"));
        assert_eq!(found[0].cover_url.as_deref(), Some("https://is1-ssl.mzstatic.com/image/thumb/x/1000x1000bb.jpg"));
        assert_eq!(found[1].title, "Good Omens");
        assert_eq!(found[1].authors, ["Terry Pratchett", "Neil Gaiman"]);
        assert_eq!(found[1].genres, ["Sci-Fi & Fantasy"]);
        assert_eq!(found[1].cover_url.as_deref(), Some("https://is1.mzstatic.com/a/1000x1000bb.jpg"));
    }

    #[test]
    fn hardcover_gives_its_featured_series() {
        let data = json!({ "search": { "results": { "hits": [{ "document": {
            "id": 427, "title": "Mort", "author_names": ["Terry Pratchett"],
            "featured_series": { "position": 4, "series": { "name": "Discworld" } },
            "isbns": ["0552131067", "9780552131063"], "release_year": 1987,
            "description": "Death takes an apprentice.", "image": { "url": "https://assets.hardcover.app/mort.jpg" }
        }}]}}});
        let f = &hardcover_from(&data)[0];
        assert_eq!((f.series.as_deref(), f.series_index.as_deref()), (Some("Discworld"), Some("4")));
        assert_eq!(f.isbn.as_deref(), Some("9780552131063"));
        assert_eq!(f.published.as_deref(), Some("1987"));
        assert_eq!(f.id, "hardcover:427");
    }

    #[test]
    fn series_numbers_are_kept_as_numbers() {
        assert_eq!(number(&json!("Book 3")), Some("3".into()));
        assert_eq!(number(&json!(2.5)), Some("2.5".into()));
        assert_eq!(number(&json!("")), None);
    }
}
