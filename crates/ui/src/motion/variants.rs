use std::collections::HashMap;

use gpui::SharedString;

use crate::motion::style::MotionStyle;

/// Named style sets (motion.dev variants).
///
/// ```ignore
/// let variants = Variants::new()
///     .set("hidden", MotionStyle::new().opacity(0.).y(px(12.)))
///     .set("visible", MotionStyle::new().opacity(1.).y(px(0.)))
///     .set("exit", MotionStyle::new().opacity(0.).y(px(-12.)));
///
/// Motion::new().variants(variants).initial_variant("hidden").animate_variant("visible")
/// ```
#[derive(Clone, Default)]
pub struct Variants {
    map: HashMap<SharedString, MotionStyle>,
}

impl Variants {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(mut self, name: impl Into<SharedString>, style: MotionStyle) -> Self {
        self.map.insert(name.into(), style);
        self
    }

    pub fn get(&self, name: &str) -> Option<MotionStyle> {
        self.map.get(name).copied()
    }
}
