use std::time::Duration;

use gpui::{
    div, prelude::*, px, AnimationExt, AnyElement, App, ElementId, IntoElement, ParentElement,
    RenderOnce, SharedString, StyleRefinement, Styled, Window,
};

use crate::component::StyledSlot;
use crate::motion::style::{apply_style, MotionStyle, ResolvedStyle};
use crate::motion::transition::{Ease, Transition};
use crate::motion::values::MotionValue;
use crate::motion::variants::Variants;

/// A `div`-like element with motion.dev-style animation props.
#[derive(IntoElement)]
pub struct Motion {
    id: ElementId,
    style: StyleRefinement,
    children: Vec<AnyElement>,
    initial: MotionStyle,
    animate: MotionStyle,
    exit: Option<MotionStyle>,
    transition: Transition,
    while_hover: Option<MotionStyle>,
    while_tap: Option<MotionStyle>,
    variants: Option<Variants>,
    layout: bool,
    /// Optional shared value mixed into opacity (0..=1).
    opacity_value: Option<MotionValue>,
    /// Previous layout size for layout animations (set via `.layout`).
    layout_from: Option<(gpui::Pixels, gpui::Pixels)>,
    layout_to: Option<(gpui::Pixels, gpui::Pixels)>,
    id_label: SharedString,
}

impl Default for Motion {
    fn default() -> Self {
        Self::new()
    }
}

impl Motion {
    pub fn new() -> Self {
        Self {
            id: ElementId::Name("motion".into()),
            id_label: "motion".into(),
            style: StyleRefinement::default(),
            children: Vec::new(),
            initial: MotionStyle::new(),
            animate: MotionStyle::new(),
            exit: None,
            transition: Transition::default(),
            while_hover: None,
            while_tap: None,
            variants: None,
            layout: false,
            opacity_value: None,
            layout_from: None,
            layout_to: None,
        }
    }

    pub fn id(mut self, id: impl Into<SharedString>) -> Self {
        let label: SharedString = id.into();
        self.id_label = label.clone();
        self.id = ElementId::Name(label);
        self
    }

    pub fn initial(mut self, style: MotionStyle) -> Self {
        self.initial = style;
        self
    }

    pub fn animate(mut self, style: MotionStyle) -> Self {
        self.animate = style;
        self
    }

    /// Exit style used by [`crate::motion::AnimatePresence`].
    pub fn exit(mut self, style: MotionStyle) -> Self {
        self.exit = Some(style);
        self
    }

    pub fn exit_style(&self) -> Option<MotionStyle> {
        self.exit
    }

    pub fn transition(mut self, transition: Transition) -> Self {
        self.transition = transition;
        self
    }

    /// Hover target (animated enter still runs; hover snaps toward this style).
    pub fn while_hover(mut self, style: MotionStyle) -> Self {
        self.while_hover = Some(style);
        self
    }

    /// Pressed/active target (motion.dev `whileTap`).
    pub fn while_tap(mut self, style: MotionStyle) -> Self {
        self.while_tap = Some(style);
        self
    }

    pub fn variants(mut self, variants: Variants) -> Self {
        self.variants = Some(variants);
        self
    }

    pub fn initial_variant(mut self, name: impl AsRef<str>) -> Self {
        if let Some(style) = self.variants.as_ref().and_then(|v| v.get(name.as_ref())) {
            self.initial = style;
        }
        self
    }

    pub fn animate_variant(mut self, name: impl AsRef<str>) -> Self {
        if let Some(style) = self.variants.as_ref().and_then(|v| v.get(name.as_ref())) {
            self.animate = style;
        }
        self
    }

    pub fn exit_variant(mut self, name: impl AsRef<str>) -> Self {
        if let Some(style) = self.variants.as_ref().and_then(|v| v.get(name.as_ref())) {
            self.exit = Some(style);
        }
        self
    }

    /// Enable layout-size animation between `from` and `to` sizes.
    pub fn layout(
        mut self,
        from: (impl Into<gpui::Pixels>, impl Into<gpui::Pixels>),
        to: (impl Into<gpui::Pixels>, impl Into<gpui::Pixels>),
    ) -> Self {
        self.layout = true;
        self.layout_from = Some((from.0.into(), from.1.into()));
        self.layout_to = Some((to.0.into(), to.1.into()));
        self
    }

    /// Bind opacity to a shared [`MotionValue`] (multiplied with animated opacity).
    pub fn opacity_from(mut self, value: MotionValue) -> Self {
        self.opacity_value = Some(value);
        self
    }

    pub fn fade_up(self) -> Self {
        self.initial(MotionStyle::new().opacity(0.).y(px(14.)))
            .animate(MotionStyle::new().opacity(1.).y(px(0.)))
            .exit(MotionStyle::new().opacity(0.).y(px(-10.)))
            .transition(Transition::spring().stiffness(280.).damping(26.))
    }

    pub fn fade_in(self) -> Self {
        self.initial(MotionStyle::new().opacity(0.))
            .animate(MotionStyle::new().opacity(1.))
            .exit(MotionStyle::new().opacity(0.))
            .transition(Transition::tween(Duration::from_millis(280)).ease(Ease::EaseOut))
    }

    pub fn pop_in(self) -> Self {
        self.initial(MotionStyle::new().opacity(0.).scale(0.92))
            .animate(MotionStyle::new().opacity(1.).scale(1.))
            .exit(MotionStyle::new().opacity(0.).scale(0.96))
            .transition(
                Transition::spring()
                    .bounce(0.2)
                    .duration(Duration::from_millis(420)),
            )
    }
}

impl Styled for Motion {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl ParentElement for Motion {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Motion {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let mut from = self.initial.resolve(ResolvedStyle::default());
        let mut to = self.animate.resolve(from);

        if self.layout {
            if let (Some((fw, fh)), Some((tw, th))) = (self.layout_from, self.layout_to) {
                from.width = Some(fw);
                from.height = Some(fh);
                to.width = Some(tw);
                to.height = Some(th);
            }
        }

        let hover = self.while_hover.map(|h| h.resolve(to));
        let tap = self.while_tap.map(|t| t.resolve(to));
        let transition = self.transition;
        let base_style = self.style;
        let children = self.children;
        let anim_id = self.id;
        let interact_id = ElementId::Name(format!("{}__hit", self.id_label).into());
        let opacity_value = self.opacity_value;

        let mut el = div()
            .id(interact_id)
            .refine_style(&base_style)
            .children(children);

        if let Some(hover) = hover {
            el = el.hover(move |s| {
                let mut s = s.opacity(hover.opacity).ml(hover.x).mt(hover.y);
                if let Some(w) = hover.width {
                    s = s.w(w);
                }
                if let Some(h) = hover.height {
                    s = s.h(h);
                }
                s
            });
        }

        if let Some(tap) = tap {
            el = el.active(move |s| {
                let mut s = s.opacity(tap.opacity).ml(tap.x).mt(tap.y);
                if let Some(w) = tap.width {
                    s = s.w(w);
                }
                if let Some(h) = tap.height {
                    s = s.h(h);
                }
                s
            });
        }

        el.with_animation(anim_id, transition.into_animation(), move |this, delta| {
            let mut frame = from.lerp(to, delta);
            if let Some(value) = opacity_value.as_ref() {
                frame.opacity = (frame.opacity * value.get().clamp(0.0, 1.0)).clamp(0.0, 1.0);
            }
            apply_style(this, frame)
        })
    }
}

/// Convenience for building a labeled variant map quickly.
#[allow(dead_code)]
pub fn variant_pair(
    hidden: MotionStyle,
    visible: MotionStyle,
) -> (Variants, SharedString, SharedString) {
    let variants = Variants::new()
        .set("hidden", hidden)
        .set("visible", visible);
    (variants, "hidden".into(), "visible".into())
}
