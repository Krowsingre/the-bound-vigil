//! Rules that fill a collection by themselves: "author contains Le Fanu",
//! "rating at least 4", "added within 30 days". A collection with rules
//! holds every book that matches, and keeps up as books change.

use rusqlite::types::Value;
use serde::{Deserialize, Serialize};

/// Most rules one collection can have.
pub const MAX_RULES: usize = 12;
const MAX_VALUE_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRules {
    /// True: a book needs to match any one rule. False: every rule.
    #[serde(default)]
    pub any: bool,
    pub rules: Vec<Rule>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub field: RuleField,
    pub op: RuleOp,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleField {
    Title,
    Author,
    Series,
    Publisher,
    Language,
    Format,
    Rating,
    /// unread, in_progress or read.
    Status,
    Favorite,
    UpNext,
    /// When the book was added, in days.
    Added,
    /// "device" (its file is here) or "cloud".
    Location,
    /// One of your tags.
    Tag,
    /// One of its genres.
    Genre,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleOp {
    Contains,
    NotContains,
    Is,
    IsNot,
    StartsWith,
    IsEmpty,
    AtLeast,
    AtMost,
    WithinDays,
    OlderThanDays,
}

const TITLE: &str = "COALESCE(o_title.value, f_title.value, b.title)";
const AUTHORS: &str = "COALESCE(o_authors.value, f_authors.value, b.authors)";
const SERIES: &str = "COALESCE(o_series.value, f_series.value, b.series)";

/// `%` and `_` typed by the person are matched as themselves.
fn like(text: &str, start: &str, end: &str) -> Value {
    let escaped = text.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    Value::Text(format!("{start}{escaped}{end}"))
}

impl CollectionRules {
    /// Rules kept as given, less any that can't be used and over-long values.
    pub fn cleaned(&self) -> CollectionRules {
        let rules = self
            .rules
            .iter()
            .filter(|r| r.sql(&mut Vec::new()).is_some())
            .take(MAX_RULES)
            .map(|r| Rule { value: r.value.trim().chars().take(MAX_VALUE_CHARS).collect(), ..r.clone() })
            .collect();
        CollectionRules { any: self.any, rules }
    }

    /// The condition on `b` (with `BOOK_FROM`'s joins) and its values,
    /// numbered after `values` already holds.
    pub fn sql(&self, values: &mut Vec<Value>) -> String {
        let parts: Vec<String> = self.rules.iter().filter_map(|r| r.sql(values)).collect();
        if parts.is_empty() {
            return "1".into();
        }
        format!("({})", parts.join(if self.any { " OR " } else { " AND " }))
    }
}

impl Rule {
    fn sql(&self, values: &mut Vec<Value>) -> Option<String> {
        use RuleField as F;
        use RuleOp as O;
        let value = self.value.trim();
        let mut bind = |v: Value| {
            values.push(v);
            format!("?{}", values.len())
        };
        let text = |column: &str, bind: &mut dyn FnMut(Value) -> String| -> Option<String> {
            let lowered = format!("lower(COALESCE({column}, ''))");
            Some(match self.op {
                O::IsEmpty => format!("trim(COALESCE({column}, '')) = ''"),
                _ if value.is_empty() => return None,
                O::Contains => format!("{lowered} LIKE {} ESCAPE '\\'", bind(like(value, "%", "%"))),
                O::NotContains => format!("{lowered} NOT LIKE {} ESCAPE '\\'", bind(like(value, "%", "%"))),
                O::StartsWith => format!("{lowered} LIKE {} ESCAPE '\\'", bind(like(value, "", "%"))),
                O::Is => format!("{lowered} = {}", bind(Value::Text(value.to_lowercase()))),
                O::IsNot => format!("{lowered} != {}", bind(Value::Text(value.to_lowercase()))),
                _ => return None,
            })
        };
        let number = || value.parse::<i64>().ok().filter(|n| *n >= 0);
        let yes = match value {
            "yes" => Some(1),
            "no" => Some(0),
            _ => None,
        };
        Some(match self.field {
            F::Title => text(TITLE, &mut bind)?,
            F::Series => text(SERIES, &mut bind)?,
            F::Publisher => text(crate::home::PUBLISHER, &mut bind)?,
            F::Language => text(crate::home::LANGUAGE, &mut bind)?,
            F::Author => {
                // Any one of the book's authors.
                let each = |test: String| format!("EXISTS (SELECT 1 FROM json_each({AUTHORS}) a WHERE {test})");
                match self.op {
                    O::IsEmpty => format!("json_array_length({AUTHORS}) = 0"),
                    _ if value.is_empty() => return None,
                    O::Contains => each(format!("lower(a.value) LIKE {} ESCAPE '\\'", bind(like(value, "%", "%")))),
                    O::NotContains => format!("NOT {}", each(format!("lower(a.value) LIKE {} ESCAPE '\\'", bind(like(value, "%", "%"))))),
                    O::StartsWith => each(format!("lower(a.value) LIKE {} ESCAPE '\\'", bind(like(value, "", "%")))),
                    O::Is => each(format!("lower(a.value) = {}", bind(Value::Text(value.to_lowercase())))),
                    O::IsNot => format!("NOT {}", each(format!("lower(a.value) = {}", bind(Value::Text(value.to_lowercase()))))),
                    _ => return None,
                }
            }
            F::Format => match self.op {
                O::Is | O::IsNot if !value.is_empty() => {
                    let test = if self.op == O::Is { "=" } else { "!=" };
                    format!("lower(b.format) {test} {}", bind(Value::Text(value.to_lowercase())))
                }
                _ => return None,
            },
            F::Rating => match self.op {
                O::IsEmpty => "b.rating IS NULL".into(),
                O::Is => format!("b.rating = {}", bind(Value::Integer(number()?))),
                O::AtLeast => format!("b.rating >= {}", bind(Value::Integer(number()?))),
                O::AtMost => format!("b.rating <= {}", bind(Value::Integer(number()?))),
                _ => return None,
            },
            F::Status => match (self.op, value) {
                (O::Is | O::IsNot, "unread" | "in_progress" | "read") => {
                    let test = if self.op == O::Is { "=" } else { "!=" };
                    format!("b.status {test} {}", bind(Value::Text(value.into())))
                }
                _ => return None,
            },
            F::Favorite | F::UpNext => {
                let column = if self.field == F::Favorite { "b.favorite" } else { "b.want_to_read" };
                match (self.op, yes) {
                    (O::Is, Some(flag)) => format!("COALESCE({column}, 0) = {flag}"),
                    _ => return None,
                }
            }
            F::Added => {
                let days = number()?;
                let since = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                match self.op {
                    O::WithinDays => format!("b.added_at >= {}", bind(Value::Text(since))),
                    O::OlderThanDays => format!("b.added_at < {}", bind(Value::Text(since))),
                    _ => return None,
                }
            }
            F::Tag => {
                let any = |test: &str| {
                    format!("EXISTS (SELECT 1 FROM book_tags t WHERE t.book_id = b.id AND t.removed_at IS NULL{test})")
                };
                match self.op {
                    O::IsEmpty => format!("NOT {}", any("")),
                    _ if value.is_empty() => return None,
                    O::Is => any(&format!(
                        " AND lower(t.tag) = {}",
                        bind(Value::Text(value.to_lowercase()))
                    )),
                    O::IsNot => format!(
                        "NOT {}",
                        any(&format!(
                            " AND lower(t.tag) = {}",
                            bind(Value::Text(value.to_lowercase()))
                        ))
                    ),
                    O::Contains => any(&format!(
                        " AND lower(t.tag) LIKE {} ESCAPE '\\'",
                        bind(like(value, "%", "%"))
                    )),
                    _ => return None,
                }
            }
            F::Genre => {
                const GENRES: &str = "COALESCE(o_genres.value, f_genres.value)";
                let any = |test: &str| {
                    format!(
                        "EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid({GENRES}) THEN {GENRES} ELSE '[]' END) g WHERE 1 = 1{test})"
                    )
                };
                match self.op {
                    O::IsEmpty => format!("NOT {}", any("")),
                    _ if value.is_empty() => return None,
                    O::Is => any(&format!(" AND lower(g.value) = {}", bind(Value::Text(value.to_lowercase())))),
                    O::IsNot => format!("NOT {}", any(&format!(" AND lower(g.value) = {}", bind(Value::Text(value.to_lowercase()))))),
                    O::Contains => any(&format!(" AND lower(g.value) LIKE {} ESCAPE '\\'", bind(like(value, "%", "%")))),
                    _ => return None,
                }
            }
            F::Location => match (self.op, value) {
                (O::Is, "device") => "lf.path IS NOT NULL".into(),
                (O::Is, "cloud") => "lf.path IS NULL".into(),
                _ => return None,
            },
        })
    }
}
