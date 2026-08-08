//! Keyboard shortcut catalog and display helpers.

use std::collections::HashMap;

/// Grouping for the Shortcuts settings page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShortcutCategory {
    App,
    File,
    Edit,
    View,
    Arrange,
    Tools,
}

impl ShortcutCategory {
    pub fn label(self) -> &'static str {
        match self {
            Self::App => "App",
            Self::File => "File",
            Self::Edit => "Edit",
            Self::View => "View",
            Self::Arrange => "Arrange",
            Self::Tools => "Tools",
        }
    }
}

/// One remappable action shown in Settings → Shortcuts.
#[derive(Clone, Copy, Debug)]
pub struct ShortcutDef {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub category: ShortcutCategory,
    /// Default GPUI keystroke strings (e.g. `"secondary-s"`, `"v"`).
    pub defaults: &'static [&'static str],
}

/// Built-in remappable shortcuts for the canvas workspace.
pub fn shortcut_catalog() -> &'static [ShortcutDef] {
    &[
        ShortcutDef {
            id: "toggle_settings",
            label: "Open Settings",
            description: "Show or hide the settings window",
            category: ShortcutCategory::App,
            defaults: &["secondary-,"],
        },
        ShortcutDef {
            id: "new_design",
            label: "New Design",
            description: "Create a blank design file",
            category: ShortcutCategory::File,
            defaults: &["secondary-n"],
        },
        ShortcutDef {
            id: "open_designs",
            label: "Open Designs",
            description: "Browse and open saved designs",
            category: ShortcutCategory::File,
            defaults: &["secondary-o", "secondary-k"],
        },
        ShortcutDef {
            id: "save_design",
            label: "Save",
            description: "Save the active design",
            category: ShortcutCategory::File,
            defaults: &["secondary-s"],
        },
        ShortcutDef {
            id: "undo",
            label: "Undo",
            description: "Undo the last canvas change",
            category: ShortcutCategory::Edit,
            defaults: &["secondary-z"],
        },
        ShortcutDef {
            id: "redo",
            label: "Redo",
            description: "Redo the last undone change",
            category: ShortcutCategory::Edit,
            defaults: &["secondary-shift-z"],
        },
        ShortcutDef {
            id: "zoom_in",
            label: "Zoom In",
            description: "Zoom the canvas in",
            category: ShortcutCategory::View,
            defaults: &["secondary-=", "secondary-+"],
        },
        ShortcutDef {
            id: "zoom_out",
            label: "Zoom Out",
            description: "Zoom the canvas out",
            category: ShortcutCategory::View,
            defaults: &["secondary--"],
        },
        ShortcutDef {
            id: "zoom_reset",
            label: "Actual Size",
            description: "Reset zoom to 100%",
            category: ShortcutCategory::View,
            defaults: &["secondary-0"],
        },
        ShortcutDef {
            id: "fit_selection",
            label: "Fit Selection",
            description: "Frame the current selection",
            category: ShortcutCategory::View,
            defaults: &["secondary-1"],
        },
        ShortcutDef {
            id: "fit_all",
            label: "Fit All Pages",
            description: "Frame every page on the canvas",
            category: ShortcutCategory::View,
            defaults: &["secondary-2"],
        },
        ShortcutDef {
            id: "group",
            label: "Group",
            description: "Group the selected layers",
            category: ShortcutCategory::Arrange,
            defaults: &["secondary-g"],
        },
        ShortcutDef {
            id: "ungroup",
            label: "Ungroup",
            description: "Ungroup the selected group",
            category: ShortcutCategory::Arrange,
            defaults: &["secondary-shift-g"],
        },
        ShortcutDef {
            id: "tool_select",
            label: "Select Tool",
            description: "Switch to the select tool",
            category: ShortcutCategory::Tools,
            defaults: &["v"],
        },
        ShortcutDef {
            id: "tool_hand",
            label: "Hand Tool",
            description: "Pan the canvas",
            category: ShortcutCategory::Tools,
            defaults: &["h"],
        },
        ShortcutDef {
            id: "tool_rectangle",
            label: "Rectangle Tool",
            description: "Draw rectangles",
            category: ShortcutCategory::Tools,
            defaults: &["r"],
        },
        ShortcutDef {
            id: "tool_frame",
            label: "Frame Tool",
            description: "Draw frames",
            category: ShortcutCategory::Tools,
            defaults: &["f"],
        },
        ShortcutDef {
            id: "tool_text",
            label: "Text Tool",
            description: "Add text layers",
            category: ShortcutCategory::Tools,
            defaults: &["t"],
        },
        ShortcutDef {
            id: "tool_image",
            label: "Image Tool",
            description: "Place images",
            category: ShortcutCategory::Tools,
            defaults: &["i"],
        },
    ]
}

/// Resolve the active keystroke list for an action (override or defaults).
pub fn resolve_keystrokes(
    def: &ShortcutDef,
    overrides: &HashMap<String, String>,
) -> Vec<String> {
    if let Some(custom) = overrides.get(def.id) {
        if !custom.is_empty() {
            return vec![custom.clone()];
        }
    }
    def.defaults.iter().map(|s| (*s).to_string()).collect()
}

/// Human-readable keystroke label for chips in the UI.
pub fn format_keystroke_label(keystroke: &str) -> String {
    let secondary = if cfg!(target_os = "macos") {
        "⌘"
    } else {
        "Ctrl"
    };
    let mut parts = Vec::new();
    for part in keystroke.split('-') {
        let label = match part.to_ascii_lowercase().as_str() {
            "secondary" => secondary.to_string(),
            "cmd" | "super" | "win" => {
                if cfg!(target_os = "macos") {
                    "⌘".into()
                } else if cfg!(target_os = "windows") {
                    "Win".into()
                } else {
                    "Super".into()
                }
            }
            "ctrl" => "Ctrl".into(),
            "alt" => {
                if cfg!(target_os = "macos") {
                    "⌥".into()
                } else {
                    "Alt".into()
                }
            }
            "shift" => {
                if cfg!(target_os = "macos") {
                    "⇧".into()
                } else {
                    "Shift".into()
                }
            }
            "fn" => "Fn".into(),
            "," => ",".into(),
            "=" => "=".into(),
            "+" => "+".into(),
            key if key.len() == 1 => key.to_ascii_uppercase(),
            other => {
                let mut chars = other.chars();
                match chars.next() {
                    Some(c) => format!("{}{}", c.to_ascii_uppercase(), chars.as_str()),
                    None => other.to_string(),
                }
            }
        };
        parts.push(label);
    }

    if cfg!(target_os = "macos") {
        parts.concat()
    } else {
        parts.join("+")
    }
}

/// Display helpers used by the settings page for a resolved binding list.
pub fn display_keystroke(keystrokes: &[String]) -> String {
    keystrokes
        .iter()
        .map(|k| format_keystroke_label(k))
        .collect::<Vec<_>>()
        .join(" / ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_uses_override_when_present() {
        let def = shortcut_catalog()
            .iter()
            .find(|d| d.id == "save_design")
            .unwrap();
        let mut overrides = HashMap::new();
        overrides.insert("save_design".into(), "ctrl-shift-s".into());
        assert_eq!(
            resolve_keystrokes(def, &overrides),
            vec!["ctrl-shift-s".to_string()]
        );
    }

    #[test]
    fn resolve_falls_back_to_defaults() {
        let def = shortcut_catalog()
            .iter()
            .find(|d| d.id == "tool_select")
            .unwrap();
        let overrides = HashMap::new();
        assert_eq!(resolve_keystrokes(def, &overrides), vec!["v".to_string()]);
    }

    #[test]
    fn format_secondary_save_is_readable() {
        let label = format_keystroke_label("secondary-s");
        assert!(!label.is_empty());
        assert!(label.contains('S') || label.contains('s'));
    }
}
