//! Component library for Loora.
//!
//! Compose these primitives in your binary crate (`loora-desktop` is the app).

mod assets;
mod button;
mod canvas;
mod color_picker;
mod component;
mod context_menu;
mod icon;
mod motion;
mod settings;
mod sidebar;
mod text_field;
mod theme;
mod tooltip;

pub use assets::Assets;
pub use button::{Button, ButtonVariant, BUTTON_VARIANTS};
pub use canvas::{
    CanvasTool, CanvasWorkspace, FitAll, FitSelection, GroupSelection, NewDesign, Redo,
    SaveDesign, ToggleFiles, ToggleSettings, ToolFrame, ToolHand, ToolImage, ToolRectangle,
    ToolSelect, ToolText, Undo, UngroupSelection, ZoomIn, ZoomOut, ZoomReset,
};
pub use color_picker::{
    color_to_rgba, format_hex as format_color_hex, parse_hex as parse_color_hex, preset_colors,
    ColorPickerField, ColorPickerPopover, Hsv,
};
pub use component::{Component, ComponentExt, StyledSlot};
pub use context_menu::{
    action_id_at, clamp_highlight, first_action_index, move_highlight, ContextMenu,
    ContextMenuAction, ContextMenuEntry,
};
pub use icon::{Icon, IconName};
pub use motion::{
    cubic_bezier, ease_in_cubic, ease_out_cubic, init as init_motion, use_motion_value,
    AnimatePresence, Ease, Motion, MotionStyle, MotionValue, MotionValueStore, PresenceMode,
    Stagger, Transition, Variants,
};
pub use settings::{
    display_keystroke, format_keystroke_label, resolve_keystrokes, shortcut_catalog,
    SettingsDialog, SettingsSection, ShortcutCategory, ShortcutDef,
};
pub use sidebar::{Sidebar, SidebarEntry, SidebarItem};
pub use text_field::{blinking_caret, field_content};
pub use theme::{Theme, ThemeKind};
pub use tooltip::Tooltip;
