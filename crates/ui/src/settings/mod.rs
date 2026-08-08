//! App settings as a routed full page (Cursor-inspired sidebar + content).

mod page;
mod shortcuts;

pub use page::{SettingsSectionPage, SettingsShell};
pub use shortcuts::{
    display_keystroke, format_keystroke_label, resolve_keystrokes, shortcut_catalog,
    ShortcutCategory, ShortcutDef,
};

/// Sidebar section ids / paths for the settings shell.
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

    /// Absolute router path for this section.
    pub fn path(self) -> &'static str {
        match self {
            Self::General => "/settings",
            Self::Appearance => "/settings/appearance",
            Self::Shortcuts => "/settings/shortcuts",
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

    pub fn from_pathname(pathname: &str) -> Self {
        let path = pathname.trim_end_matches('/');
        match path {
            "/settings/appearance" => Self::Appearance,
            "/settings/shortcuts" => Self::Shortcuts,
            _ => Self::General,
        }
    }
}
