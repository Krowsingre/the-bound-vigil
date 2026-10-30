//! Custom themes: four colours of the person's own (page, surface, accent
//! and highlight), named, and synced so every device has the same ones.
//! Which theme a device shows stays that device's own choice (app.settings).

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::ids::new_record_id;
use crate::time::now_utc;
use crate::{Error, Library, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    /// Empty when saving a new one.
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// Colours as `#rrggbb`.
    pub page: String,
    pub surface: String,
    pub accent: String,
    pub highlight: String,
}

const MAX_NAME_CHARS: usize = 40;

fn colour(value: &str) -> Result<String> {
    let v = value.trim().to_ascii_lowercase();
    if v.len() == 7 && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(v)
    } else {
        Err(Error::Unsuitable("a theme's colours are written like #2f3a44".into()))
    }
}

impl Library {
    /// The custom themes, in the order they were made.
    pub fn custom_themes(&self) -> Result<Vec<CustomTheme>> {
        let mut statement = self
            .conn
            .prepare("SELECT id, name, page, surface, accent, highlight FROM custom_themes WHERE deleted_at IS NULL ORDER BY created_at, id")?;
        let rows = statement.query_map([], |r| {
            Ok(CustomTheme { id: r.get(0)?, name: r.get(1)?, page: r.get(2)?, surface: r.get(3)?, accent: r.get(4)?, highlight: r.get(5)? })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Saves a theme: a new one when it has no id, otherwise that one changed.
    pub fn save_custom_theme(&self, theme: &CustomTheme) -> Result<CustomTheme> {
        let name: String = theme.name.trim().chars().take(MAX_NAME_CHARS).collect();
        if name.is_empty() {
            return Err(Error::Unsuitable("give the theme a name".into()));
        }
        let saved = CustomTheme {
            id: if theme.id.is_empty() { new_record_id() } else { theme.id.clone() },
            name,
            page: colour(&theme.page)?,
            surface: colour(&theme.surface)?,
            accent: colour(&theme.accent)?,
            highlight: colour(&theme.highlight)?,
        };
        let now = now_utc();
        self.conn.execute(
            "INSERT INTO custom_themes (id, name, page, surface, accent, highlight, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET name = ?2, page = ?3, surface = ?4, accent = ?5, highlight = ?6, updated_at = ?7, deleted_at = NULL
             WHERE name IS NOT ?2 OR page IS NOT ?3 OR surface IS NOT ?4 OR accent IS NOT ?5 OR highlight IS NOT ?6 OR deleted_at IS NOT NULL",
            params![saved.id, saved.name, saved.page, saved.surface, saved.accent, saved.highlight, now],
        )?;
        Ok(saved)
    }

    pub fn remove_custom_theme(&self, id: &str) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            "UPDATE custom_themes SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::open_temp_library;

    fn theme(name: &str) -> CustomTheme {
        CustomTheme { id: String::new(), name: name.into(), page: "#F1EFEB".into(), surface: "#faf9f6".into(), accent: "#2f3a44".into(), highlight: "#c9d6e3".into() }
    }

    #[test]
    fn themes_are_made_changed_and_removed() {
        let (_dir, library) = open_temp_library();
        let made = library.save_custom_theme(&theme("  Dusk ")).unwrap();
        assert_eq!(made.name, "Dusk");
        assert_eq!(made.page, "#f1efeb");
        let changed = library.save_custom_theme(&CustomTheme { name: "Dawn".into(), ..made.clone() }).unwrap();
        assert_eq!(changed.id, made.id);
        assert_eq!(library.custom_themes().unwrap(), vec![changed]);
        library.remove_custom_theme(&made.id).unwrap();
        assert!(library.custom_themes().unwrap().is_empty());
    }

    #[test]
    fn odd_colours_and_empty_names_are_refused() {
        let (_dir, library) = open_temp_library();
        assert!(library.save_custom_theme(&theme(" ")).is_err());
        assert!(library.save_custom_theme(&CustomTheme { accent: "blue".into(), ..theme("Sea") }).is_err());
    }
}
