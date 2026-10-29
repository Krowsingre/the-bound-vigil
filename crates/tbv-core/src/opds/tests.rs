use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

use super::*;
use crate::library::tests::open_temp_library;

const GUTENBERG_START: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/">
  <id>http://www.gutenberg.org/ebooks.opds/</id>
  <title>Project Gutenberg</title>
  <link rel="search" type="application/opensearchdescription+xml" href="/catalog/osd-books.xml"/>
  <link rel="next" type="application/atom+xml;profile=opds-catalog" href="/ebooks/search.opds/?start_index=26"/>
  <entry>
    <title>Popular</title>
    <id>http://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads</id>
    <link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/search.opds/?sort_order=downloads"/>
  </entry>
</feed>"#;

const GUTENBERG_BOOK: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dcterms="http://purl.org/dc/terms/">
  <title>Pride and Prejudice</title>
  <entry>
    <id>urn:gutenberg:1342:2</id>
    <title>Pride and Prejudice</title>
    <author><name>Austen, Jane</name></author>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>A novel of <b>manners</b> &amp; marriage.</p></div></content>
    <dcterms:language>en</dcterms:language>
    <dcterms:issued>1998-06-01</dcterms:issued>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition" title="EPUB (no images)" href="https://www.gutenberg.org/ebooks/1342.epub.noimages"/>
    <link type="application/x-mobipocket-ebook" rel="http://opds-spec.org/acquisition" href="https://www.gutenberg.org/ebooks/1342.kf8.images"/>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition" title="EPUB3 (E-readers incl. Send-to-Kindle)" href="https://www.gutenberg.org/ebooks/1342.epub3.images"/>
    <link type="image/jpeg" rel="http://opds-spec.org/image" href="https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg"/>
    <link type="image/jpeg" rel="http://opds-spec.org/image/thumbnail" href="https://www.gutenberg.org/cache/epub/1342/pg1342.cover.small.jpg"/>
    <link type="application/atom+xml;profile=opds-catalog" rel="related" href="/ebooks/1342/also.opds"/>
  </entry>
  <entry>
    <title>A bought book</title>
    <id>bought</id>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition/buy" href="/buy/1"/>
  </entry>
</feed>"#;

#[test]
fn an_atom_catalog_is_read_with_its_shelves_books_and_search() {
    let base = Url::parse("https://www.gutenberg.org/ebooks.opds/").unwrap();
    let (feed, search) = parse_atom(GUTENBERG_START, &base).unwrap();
    assert_eq!(feed.title, "Project Gutenberg");
    assert_eq!(feed.next.as_deref(), Some("https://www.gutenberg.org/ebooks/search.opds/?start_index=26"));
    assert_eq!(search, Some(SearchLink::Description("https://www.gutenberg.org/catalog/osd-books.xml".into())));
    assert_eq!(feed.entries[0].navigation.as_deref(), Some("https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads"));
    assert!(feed.entries[0].files.is_empty());

    let (feed, _) = parse_atom(GUTENBERG_BOOK, &base).unwrap();
    let book = &feed.entries[0];
    assert_eq!(book.title, "Pride and Prejudice");
    assert_eq!(book.authors, ["Austen, Jane"]);
    assert_eq!(book.summary.as_deref(), Some("A novel of manners & marriage."));
    assert_eq!(book.language.as_deref(), Some("en"));
    assert_eq!(book.cover.as_deref(), Some("https://www.gutenberg.org/cache/epub/1342/pg1342.cover.small.jpg"));
    // EPUB before MOBI; "related" isn't a way in.
    assert_eq!(book.files.iter().map(|f| f.format.as_deref().unwrap()).collect::<Vec<_>>(), ["epub", "epub", "mobi"]);
    assert_eq!(book.navigation, None);
    assert!(!book.not_free);
    let bought = &feed.entries[1];
    assert!(bought.not_free && bought.files.is_empty());
}

#[test]
fn an_opensearch_description_gives_the_atom_search_address() {
    let xml = r#"<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
      <Url type="text/html" template="https://www.gutenberg.org/ebooks/search/?query={searchTerms}"/>
      <Url type="application/atom+xml" template="/ebooks/search.opds/?query={searchTerms}"/>
    </OpenSearchDescription>"#;
    let base = Url::parse("https://www.gutenberg.org/catalog/osd-books.xml").unwrap();
    assert_eq!(parse_opensearch(xml, &base).as_deref(), Some("https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}"));
    assert_eq!(strip_optional_fields("https://x/s?q=ash&page={startPage?}&n={count?}"), "https://x/s?q=ash&page=&n=");
}

#[test]
fn a_json_catalog_is_read_too() {
    let body = r#"{
      "metadata": {"title": "Shelf"},
      "links": [{"rel": "next", "href": "page2.json"}, {"rel": "search", "href": "/search{?query}", "templated": true}],
      "navigation": [{"href": "/new.json", "title": "New"}],
      "groups": [{"publications": [{
        "metadata": {"title": "Moby-Dick", "author": [{"name": "Herman Melville"}], "language": ["en"], "identifier": "urn:x:1"},
        "links": [{"rel": "http://opds-spec.org/acquisition/open-access", "href": "/moby.epub", "type": "application/epub+zip"}],
        "images": [{"href": "/tiny.jpg", "width": 60}, {"href": "/big.jpg", "width": 600}, {"href": "/mid.jpg", "width": 200}]
      }]}]
    }"#;
    let base = Url::parse("https://books.example/opds/start.json").unwrap();
    let feed = parse_json(body, &base).unwrap();
    assert_eq!(feed.title, "Shelf");
    assert_eq!(feed.next.as_deref(), Some("https://books.example/opds/page2.json"));
    assert_eq!(feed.search.as_deref(), Some("https://books.example/search?query={searchTerms}"));
    assert_eq!(feed.entries[0].navigation.as_deref(), Some("https://books.example/new.json"));
    let book = &feed.entries[1];
    assert_eq!((book.title.as_str(), book.authors.clone()), ("Moby-Dick", vec!["Herman Melville".to_string()]));
    assert_eq!(book.cover.as_deref(), Some("https://books.example/mid.jpg"));
    assert_eq!(book.files[0].url, "https://books.example/moby.epub");
    assert!(parse_json(r#"{"hello": 1}"#, &base).is_err());
}

#[test]
fn sign_ins_are_answered_both_ways() {
    assert_eq!(base64(b"Aladdin:open sesame"), "QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
    assert_eq!(base64(b"ab"), "YWI=");
    // The worked example in RFC 2617.
    let challenge = r#"Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#;
    let answer = digest_answer(challenge, "Mufasa", "Circle Of Life", "GET", "/dir/index.html", "0a4f113b").unwrap();
    assert!(answer.contains(r#"response="6629fae49393a05397450978507c4ef1""#), "{answer}");
    assert!(answer.contains(r#"opaque="5ccc069c403ebaf9f0171e9517f40e41""#));
}

#[test]
fn a_download_knows_its_format_from_what_it_can() {
    assert_eq!(download_format(None, "application/epub+zip", None, "https://x/1").as_deref(), Some("epub"));
    assert_eq!(download_format(Some("mobi"), "application/octet-stream", None, "https://x/1").as_deref(), Some("mobi"));
    assert_eq!(download_format(None, "application/octet-stream", Some("pg1342-images-3.epub"), "https://x/1").as_deref(), Some("epub"));
    assert_eq!(download_format(None, "", None, "https://www.gutenberg.org/ebooks/1342.epub3.images").as_deref(), Some("epub"));
    assert_eq!(download_format(None, "application/zip", None, "https://x/book.exe"), None);
    assert_eq!(safe_name("War/Peace: a <novel>?"), "War Peace a novel");
}

#[test]
fn catalogs_start_with_gutenberg_and_keep_passwords_to_their_own_server() {
    let (_dir, library) = open_temp_library();
    let names = |l: &Library| l.catalogs().unwrap().into_iter().map(|c| c.name).collect::<Vec<_>>();
    assert_eq!(names(&library), ["Project Gutenberg"]);
    // Standard Ebooks, built in before 1.18, goes unless someone signed in to it.
    let old = r#"[{"id":"gutenberg","name":"Project Gutenberg","url":"https://www.gutenberg.org/ebooks.opds/"},{"id":"standard-ebooks","name":"Standard Ebooks","url":"https://standardebooks.org/feeds/opds"}]"#;
    library.set_setting(SETTINGS_KEY, old).unwrap();
    assert_eq!(names(&library), ["Project Gutenberg"]);
    let signed_in = old.replace(r#"feeds/opds"}"#, r#"feeds/opds","username":"me@example.com"}"#);
    library.set_setting(SETTINGS_KEY, &signed_in).unwrap();
    assert_eq!(names(&library), ["Project Gutenberg", "Standard Ebooks"]);
    library.remove_catalog("standard-ebooks").unwrap();
    let calibre = library
        .save_catalog(&CatalogInput { id: None, name: "".into(), url: "http://192.168.1.20:8080/opds".into(), username: Some("embre".into()), password: Some("pw".into()) })
        .unwrap();
    assert_eq!(calibre.name, "192.168.1.20");
    assert!(calibre.has_password);
    assert_eq!(names(&library), ["Project Gutenberg", "192.168.1.20"]);
    // Renamed, same server: the password stays.
    let edit = CatalogInput { id: Some(calibre.id.clone()), name: "Calibre".into(), url: "http://192.168.1.20:8080/opds".into(), username: Some("embre".into()), password: None };
    assert!(library.save_catalog(&edit).unwrap().has_password);
    // Pointed at another server: it doesn't follow.
    let moved = CatalogInput { url: "http://other.example/opds".into(), ..edit };
    assert!(!library.save_catalog(&moved).unwrap().has_password);
    assert!(library.save_catalog(&CatalogInput { id: None, name: "x".into(), url: "ftp://x".into(), username: None, password: None }).is_err());
    assert!(crate::data::is_secret_setting(SETTINGS_KEY));
}

/// A little catalog server, answering `count` requests: the feed needs a
/// sign-in, then the book is sent.
fn serve(count: usize) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let base = address.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().take(count) {
            let mut stream = stream.unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut authorized = false;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                if line.to_ascii_lowercase().starts_with("authorization: basic ") && line.contains(&base64(b"embre:pw")) {
                    authorized = true;
                }
            }
            let (status, mime, body): (&str, &str, Vec<u8>) = if !authorized {
                ("401 Unauthorized", "text/plain", b"no".to_vec())
            } else if first.contains("/opds ") {
                let feed = format!(
                    r#"<feed xmlns="http://www.w3.org/2005/Atom"><title>Calibre</title><entry><title>Ash</title><id>1</id>
                    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="{base}/get/1"/></entry></feed>"#
                );
                ("200 OK", "application/atom+xml;profile=opds-catalog", feed.into_bytes())
            } else {
                ("200 OK", "application/epub+zip", b"PK pretend epub".to_vec())
            };
            let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = stream.write_all(&body);
        }
    });
    address
}

#[test]
fn a_signed_in_catalog_is_browsed_and_a_book_brought_down() {
    let (dir, library) = open_temp_library();
    let address = serve(3);
    let view = library
        .save_catalog(&CatalogInput { id: None, name: "Calibre".into(), url: format!("{address}/opds"), username: Some("embre".into()), password: Some("pw".into()) })
        .unwrap();
    let access = library.catalog_access(&view.id).unwrap();
    let feed = access.feed(None).unwrap();
    assert_eq!(feed.entries[0].title, "Ash");
    let file = access.download(&feed.entries[0].files[0], "Ash", dir.path()).unwrap();
    assert_eq!(file.file_name().unwrap(), "Ash.epub");
    assert_eq!(fs::read(&file).unwrap(), b"PK pretend epub");

    // Without the password the catalog says no, and the page is told so.
    let wrong = library.save_catalog(&CatalogInput { id: Some(view.id.clone()), name: "Calibre".into(), url: format!("{address}/opds"), username: None, password: None }).unwrap();
    let err = library.catalog_access(&wrong.id).unwrap().feed(None).unwrap_err();
    assert_eq!(err.to_string(), NEEDS_LOGIN);
}

/// A catalog server that answers from `answer(first line, signed in)` and
/// reports, per request, whether a password came with it.
/// Status line, extra headers and body.
type Answer = (String, String, Vec<u8>);

fn serve_with(count: usize, answer: fn(&str, bool, &str) -> Answer) -> (String, std::sync::mpsc::Receiver<bool>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let base = address.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming().take(count) {
            let mut stream = stream.unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut authorized = false;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                authorized |= line.to_ascii_lowercase().starts_with("authorization:");
            }
            let _ = tx.send(authorized);
            let (status, extra, body) = answer(&first, authorized, &base);
            let _ = write!(stream, "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = stream.write_all(&body);
        }
    });
    (address, rx)
}

#[test]
fn a_catalog_that_moves_is_read_from_where_it_landed() {
    let (dir, library) = open_temp_library();
    let (address, asked) = serve_with(3, |first, authorized, base| {
        if first.contains("/shelf ") {
            ("301 Moved".into(), format!("Location: {base}/shelf/\r\n"), Vec::new())
        } else if !authorized {
            ("401 Unauthorized".into(), String::new(), b"no".to_vec())
        } else {
            let feed = r#"<feed xmlns="http://www.w3.org/2005/Atom"><title>Shelf</title><entry><title>Ash</title><id>1</id>
                <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="books/1"/></entry></feed>"#;
            ("200 OK".into(), "Content-Type: application/atom+xml\r\n".into(), feed.as_bytes().to_vec())
        }
    });
    let view = library
        .save_catalog(&CatalogInput { id: None, name: "Calibre".into(), url: format!("{address}/shelf"), username: Some("embre".into()), password: Some("pw".into()) })
        .unwrap();
    let feed = library.catalog_access(&view.id).unwrap().feed(None).unwrap();
    // The link is relative to the page after the redirect, not before it.
    assert_eq!(feed.entries[0].files[0].url, format!("{address}/shelf/books/1"));
    assert_eq!(feed.url, format!("{address}/shelf/"));
    // Signed in, moved (the password isn't carried along), then asked again at the new address.
    assert_eq!(asked.try_iter().collect::<Vec<_>>(), [true, false, true]);
    drop(dir);
}

#[test]
fn a_password_only_goes_to_the_same_scheme_host_and_port() {
    let (_dir, library) = open_temp_library();
    let (other, asked) = serve_with(1, |_, _, _| ("200 OK".into(), "Content-Type: application/atom+xml\r\n".into(), br#"<feed xmlns="http://www.w3.org/2005/Atom"><title>x</title></feed>"#.to_vec()));
    // The saved catalog is on another port of the same computer.
    let view = library
        .save_catalog(&CatalogInput { id: None, name: "Calibre".into(), url: "http://127.0.0.1:1/opds".into(), username: Some("embre".into()), password: Some("pw".into()) })
        .unwrap();
    library.catalog_access(&view.id).unwrap().feed(Some(&format!("{other}/opds"))).unwrap();
    assert_eq!(asked.try_iter().collect::<Vec<_>>(), [false]);
}

#[test]
fn signing_out_of_audiobookshelf_keeps_the_server() {
    let (_dir, library) = open_temp_library();
    let saved = library.save_abs_server(None, "Home", "http://nas:13378", "embre", Some(("t".into(), "r".into()))).unwrap();
    assert!(saved.has_password);
    library.sign_out_abs_server(&saved.id).unwrap();
    let after = library.catalogs().unwrap().into_iter().find(|c| c.id == saved.id).unwrap();
    assert!(!after.has_password);
    assert_eq!(after.username.as_deref(), Some("embre"));
    // Signing in again keeps the same server.
    let again = library.save_abs_server(Some(&saved.id), "Home", "http://nas:13378", "embre", Some(("t2".into(), "r2".into()))).unwrap();
    assert_eq!((again.id, again.has_password), (saved.id, true));
}
