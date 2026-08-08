use gpui::{
    div, prelude::*, AnyElement, App, ElementId, IntoElement, ParentElement, Refineable,
    RenderOnce, StyleRefinement, Styled, Window,
};

/// Convenience helpers for building styleable UI components.
pub trait ComponentExt: Sized {
    /// Transform this component while building it.
    ///
    /// Useful when nesting style tweaks inside a parent builder:
    /// `SidebarItem::new(...).configure(|item| item.h(px(40.)).rounded(px(10.)))`
    fn configure(self, f: impl FnOnce(Self) -> Self) -> Self {
        f(self)
    }
}

impl<T> ComponentExt for T {}

/// Merge a [`StyleRefinement`] into any [`Styled`] element.
pub trait StyledSlot: Styled + Sized {
    fn refine_style(mut self, style: &StyleRefinement) -> Self {
        self.style().refine(style);
        self
    }
}

impl<T: Styled> StyledSlot for T {}

/// A styleable shell for composing UI — the primitive used to build other components.
///
/// Implements [`Styled`] (Tailwind-like chain) and [`ParentElement`] (`.child` / `.children`).
/// Nested parts should expose their own slot APIs (e.g. `.icon(|i| …)`, `.label(|s| …)`).
///
/// ```ignore
/// Component::new()
///     .id("row")
///     .flex()
///     .items_center()
///     .gap_2()
///     .child(Icon::hugeicon(IconName::Home).size(px(18.)))
///     .child("Home")
/// ```
#[derive(IntoElement, Default)]
pub struct Component {
    id: Option<ElementId>,
    style: StyleRefinement,
    children: Vec<AnyElement>,
}

impl Component {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.id = Some(id.into());
        self
    }
}

impl Styled for Component {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl ParentElement for Component {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Component {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let element = div().refine_style(&self.style).children(self.children);
        match self.id {
            Some(id) => element.id(id).into_any_element(),
            None => element.into_any_element(),
        }
    }
}
