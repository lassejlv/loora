use gpui::{px, Pixels, Styled};

/// Animatable visual properties (motion.dev style objects).
#[derive(Clone, Copy, Debug, Default)]
pub struct MotionStyle {
    pub opacity: Option<f32>,
    pub x: Option<Pixels>,
    pub y: Option<Pixels>,
    pub scale: Option<f32>,
    pub width: Option<Pixels>,
    pub height: Option<Pixels>,
}

impl MotionStyle {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn opacity(mut self, value: f32) -> Self {
        self.opacity = Some(value.clamp(0.0, 1.0));
        self
    }

    pub fn x(mut self, value: impl Into<Pixels>) -> Self {
        self.x = Some(value.into());
        self
    }

    pub fn y(mut self, value: impl Into<Pixels>) -> Self {
        self.y = Some(value.into());
        self
    }

    pub fn scale(mut self, value: f32) -> Self {
        self.scale = Some(value.max(0.0));
        self
    }

    pub fn width(mut self, value: impl Into<Pixels>) -> Self {
        self.width = Some(value.into());
        self
    }

    pub fn height(mut self, value: impl Into<Pixels>) -> Self {
        self.height = Some(value.into());
        self
    }

    pub(crate) fn resolve(self, base: ResolvedStyle) -> ResolvedStyle {
        ResolvedStyle {
            opacity: self.opacity.unwrap_or(base.opacity),
            x: self.x.unwrap_or(base.x),
            y: self.y.unwrap_or(base.y),
            scale: self.scale.unwrap_or(base.scale),
            width: self.width.or(base.width),
            height: self.height.or(base.height),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn merge(self, overlay: MotionStyle) -> MotionStyle {
        MotionStyle {
            opacity: overlay.opacity.or(self.opacity),
            x: overlay.x.or(self.x),
            y: overlay.y.or(self.y),
            scale: overlay.scale.or(self.scale),
            width: overlay.width.or(self.width),
            height: overlay.height.or(self.height),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ResolvedStyle {
    pub opacity: f32,
    pub x: Pixels,
    pub y: Pixels,
    pub scale: f32,
    pub width: Option<Pixels>,
    pub height: Option<Pixels>,
}

impl Default for ResolvedStyle {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            x: px(0.),
            y: px(0.),
            scale: 1.0,
            width: None,
            height: None,
        }
    }
}

impl ResolvedStyle {
    pub fn lerp(self, target: Self, t: f32) -> Self {
        let t = t.clamp(0.0, 1.0);
        Self {
            opacity: lerp_f32(self.opacity, target.opacity, t),
            x: lerp_px(self.x, target.x, t),
            y: lerp_px(self.y, target.y, t),
            scale: lerp_f32(self.scale, target.scale, t),
            width: match (self.width, target.width) {
                (Some(a), Some(b)) => Some(lerp_px(a, b, t)),
                (None, Some(b)) => Some(b),
                (Some(a), None) => Some(a),
                (None, None) => None,
            },
            height: match (self.height, target.height) {
                (Some(a), Some(b)) => Some(lerp_px(a, b, t)),
                (None, Some(b)) => Some(b),
                (Some(a), None) => Some(a),
                (None, None) => None,
            },
        }
    }
}

pub(crate) fn lerp_f32(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

pub(crate) fn lerp_px(a: Pixels, b: Pixels, t: f32) -> Pixels {
    let a: f32 = a.into();
    let b: f32 = b.into();
    px(a + (b - a) * t)
}

pub(crate) fn apply_style<E: Styled>(mut el: E, style: ResolvedStyle) -> E {
    let opacity = if (style.scale - 1.0).abs() > f32::EPSILON {
        (style.opacity * style.scale.clamp(0.35, 1.25)).clamp(0.0, 1.0)
    } else {
        style.opacity.clamp(0.0, 1.0)
    };

    el = el.opacity(opacity).ml(style.x).mt(style.y);
    if let Some(w) = style.width {
        el = el.w(w);
    }
    if let Some(h) = style.height {
        el = el.h(h);
    }
    el
}
