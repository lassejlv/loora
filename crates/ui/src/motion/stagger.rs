use std::time::Duration;

use gpui::{
    div, AnyElement, App, IntoElement, ParentElement, RenderOnce, SharedString, StyleRefinement,
    Styled, Window,
};

use crate::component::StyledSlot;
use crate::motion::component::Motion;
use crate::motion::style::MotionStyle;
use crate::motion::transition::Transition;

/// Staggers enter animations across child [`Motion`] elements (motion.dev stagger).
///
/// ```ignore
/// Stagger::new()
///     .transition(
///         Transition::spring()
///             .delay_children(Duration::from_millis(40))
///             .stagger_children(Duration::from_millis(60)),
///     )
///     .child(Motion::new().id("a").fade_up().child(...))
///     .child(Motion::new().id("b").fade_up().child(...))
/// ```
#[derive(IntoElement, Default)]
pub struct Stagger {
    style: StyleRefinement,
    transition: Transition,
    motions: Vec<Motion>,
    children: Vec<AnyElement>,
}

impl Stagger {
    pub fn new() -> Self {
        Self {
            style: StyleRefinement::default(),
            transition: Transition::spring()
                .delay_children(Duration::from_millis(30))
                .stagger_children(Duration::from_millis(55)),
            motions: Vec::new(),
            children: Vec::new(),
        }
    }

    pub fn transition(mut self, transition: Transition) -> Self {
        self.transition = transition;
        self
    }

    /// Add a motion child that will receive stagger delay.
    pub fn motion(mut self, motion: Motion) -> Self {
        self.motions.push(motion);
        self
    }
}

impl Styled for Stagger {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl ParentElement for Stagger {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Stagger {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let base_delay = self.transition.delay_children;
        let stagger = self.transition.stagger_children;
        let child_transition = self.transition.clone();

        div()
            .refine_style(&self.style)
            .children(self.motions.into_iter().enumerate().map(|(index, motion)| {
                let delay = base_delay + stagger * (index as u32);
                let transition = child_transition.clone().with_extra_delay(delay);
                motion.transition(transition).into_any_element()
            }))
            .children(self.children)
    }
}

/// Helper to build a default staggered fade-up item.
#[allow(dead_code)]
pub fn stagger_item(id: impl Into<SharedString>, _style: MotionStyle) -> Motion {
    Motion::new().id(id).fade_up()
}
