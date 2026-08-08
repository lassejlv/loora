use gpui::{
    div, prelude::*, App, Div, ElementId, InteractiveElement, IntoElement, ParentElement,
    Refineable, RenderOnce, SharedString, StyleRefinement, Styled, Window,
};

use crate::hooks::use_navigate;
use crate::state::{normalize_pathname, RouterState};

/// Navigation link that updates the router path on click.
#[derive(IntoElement)]
pub struct NavLink {
    base: Div,
    children: Vec<gpui::AnyElement>,
    to: SharedString,
    active_style: Option<Box<StyleRefinement>>,
    end: bool,
}

impl Default for NavLink {
    fn default() -> Self {
        Self {
            base: div(),
            children: Vec::new(),
            to: SharedString::default(),
            active_style: None,
            end: false,
        }
    }
}

impl Styled for NavLink {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl ParentElement for NavLink {
    fn extend(&mut self, elements: impl IntoIterator<Item = gpui::AnyElement>) {
        self.children.extend(elements);
    }
}

impl InteractiveElement for NavLink {
    fn interactivity(&mut self) -> &mut gpui::Interactivity {
        self.base.interactivity()
    }
}

impl NavLink {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn to(mut self, to: impl Into<SharedString>) -> Self {
        self.to = to.into();
        self
    }

    /// Style applied when this link matches the current path.
    pub fn active(mut self, f: impl FnOnce(StyleRefinement) -> StyleRefinement) -> Self {
        self.active_style = Some(Box::new(f(StyleRefinement::default())));
        self
    }

    /// When `true`, only exact path matches are active (React Router `end`).
    pub fn end(mut self, end: bool) -> Self {
        self.end = end;
        self
    }
}

fn is_active_path(pathname: &str, to: &str, end: bool) -> bool {
    let pathname = normalize_pathname(pathname);
    let to = normalize_pathname(to);

    if to.as_ref() == "/" || end {
        pathname.as_ref() == to.as_ref()
    } else {
        pathname.as_ref() == to.as_ref()
            || pathname
                .strip_prefix(to.as_ref())
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    }
}

impl RenderOnce for NavLink {
    fn render(mut self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let to = normalize_pathname(self.to.as_ref());
        let is_active = if cx.has_global::<RouterState>() {
            is_active_path(
                cx.global::<RouterState>().location.pathname.as_ref(),
                to.as_ref(),
                self.end,
            )
        } else {
            false
        };

        if is_active {
            if let Some(active_style) = self.active_style.as_ref() {
                self.base.style().refine(active_style);
            }
        }

        self.base
            .id(ElementId::from(to.clone()))
            .cursor_pointer()
            .on_click(move |_, window, cx| {
                let mut navigate = use_navigate(cx);
                navigate(to.clone());
                window.refresh();
            })
            .children(self.children)
    }
}

#[cfg(test)]
mod tests {
    use super::is_active_path;

    #[test]
    fn root_only_active_on_exact_root() {
        assert!(is_active_path("/", "/", false));
        assert!(!is_active_path("/settings", "/", false));
    }

    #[test]
    fn matches_descendants_by_default() {
        assert!(is_active_path("/settings/profile", "/settings", false));
    }

    #[test]
    fn end_requires_exact_match() {
        assert!(is_active_path("/settings", "/settings", true));
        assert!(!is_active_path("/settings/profile", "/settings", true));
    }

    #[test]
    fn respects_segment_boundaries() {
        assert!(!is_active_path("/users", "/user", false));
        assert!(!is_active_path("/settings-and-more", "/settings", false));
    }
}
