//! People's names written either way round (embre, 19 November): "Primo, Jaz"
//! and "Jaz Primo" are one author. Searching finds either order. The same
//! rules are in src/lib/authorNames.ts, which shows names as chosen.

const SUFFIXES: &[&str] = &["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "ph.d.", "md", "m.d."];
const PARTICLES: &[&str] = &["van", "von", "der", "den", "de", "del", "della", "di", "da", "du", "la", "le", "st", "st.", "dos", "das", "ten", "ter", "bin", "al"];

fn is_suffix(word: &str) -> bool {
    SUFFIXES.contains(&word.trim().to_lowercase().as_str())
}

/// "Primo, Jaz" → "Jaz Primo". A name with no comma is kept as it is.
pub fn first_last(name: &str) -> String {
    let parts: Vec<&str> = name.split(',').map(str::trim).filter(|p| !p.is_empty()).collect();
    match parts.as_slice() {
        [last, first] if !is_suffix(first) => format!("{first} {last}"),
        [last, first, suffix] if is_suffix(suffix) => format!("{first} {last} {suffix}"),
        _ => name.trim().to_string(),
    }
}

/// "Jaz Primo" → "Primo, Jaz"; "Ursula K. Le Guin" → "Le Guin, Ursula K.".
pub fn last_first(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.contains(',') {
        return trimmed.to_string();
    }
    let mut words: Vec<&str> = trimmed.split_whitespace().collect();
    let suffix = if words.len() > 2 && words.last().is_some_and(|w| is_suffix(w)) { words.pop() } else { None };
    if words.len() < 2 || words[0].eq_ignore_ascii_case("the") {
        return trimmed.to_string();
    }
    let mut at = words.len() - 1;
    while at > 1 && PARTICLES.contains(&words[at - 1].to_lowercase().as_str()) {
        at -= 1;
    }
    let mut out = format!("{}, {}", words[at..].join(" "), words[..at].join(" "));
    if let Some(suffix) = suffix {
        out.push_str(", ");
        out.push_str(suffix);
    }
    out
}

fn tidy(text: &str) -> String {
    text.to_lowercase().replace(['.', ','], " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// One key for a person however the name is written.
pub fn key(name: &str) -> String {
    tidy(&first_last(name))
}

/// A JSON list of names as search text: each name both ways round, so
/// "jaz primo" and "primo jaz" both find "Primo, Jaz".
pub fn search_text(list: &str) -> String {
    let names: Vec<String> = serde_json::from_str(list).unwrap_or_default();
    names.iter().map(|n| format!("{} | {}", key(n), tidy(&last_first(&first_last(n))))).collect::<Vec<_>>().join(" | ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_either_way_round_are_one_person() {
        assert_eq!(first_last("Primo, Jaz"), "Jaz Primo");
        assert_eq!(first_last("King, Martin Luther, Jr."), "Martin Luther King Jr.");
        assert_eq!(last_first("Ursula K. Le Guin"), "Le Guin, Ursula K.");
        assert_eq!(last_first("The Ash Choir"), "The Ash Choir");
        assert_eq!(key("Primo, Jaz"), key("Jaz Primo"));
        let text = search_text(r#"["Primo, Jaz"]"#);
        assert!(text.contains("jaz primo") && text.contains("primo jaz"), "{text}");
    }
}
