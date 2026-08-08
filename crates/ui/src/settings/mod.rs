//! App settings shell (Cursor-inspired sidebar + content pages).

mod dialog;
mod shortcuts;

pub use dialog::SettingsDialog;
pub use shortcuts::{
    display_keystroke, format_keystroke_label, resolve_keystrokes, shortcut_catalog,
    ShortcutCategory, ShortcutDef,
};

/// Sidebar section ids for the settings shell.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SettingsSection {
    #[default]
    General,
    Appearance,
    Shortcuts,
}

impl SettingsSection {
    pub fn id(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::Appearance => "appearance",
            Self::Shortcuts => "shortcuts",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::General => "General",
            Self::Appearance => "Appearance",
            Self::Shortcuts => "Shortcuts",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "general" => Some(Self::General),
            "appearance" => Some(Self::Appearance),
            "shortcuts" => Some(Self::Shortcuts),
            _ => None,
        }
    }
}
