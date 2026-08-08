//! Declarative motion primitives inspired by [motion.dev](https://motion.dev).

mod component;
mod presence;
mod stagger;
mod style;
mod transition;
mod values;
mod variants;

pub use component::Motion;
pub use presence::{init as init_presence, AnimatePresence, PresenceMode};
pub use stagger::Stagger;
pub use style::MotionStyle;
pub use transition::{cubic_bezier, ease_in_cubic, ease_out_cubic, Ease, Transition};
pub use values::{init as init_values, use_motion_value, MotionValue, MotionValueStore};
pub use variants::Variants;

/// Initialize motion globals (values + presence). Call once at app startup.
pub fn init(cx: &mut gpui::App) {
    init_values(cx);
    init_presence(cx);
}
