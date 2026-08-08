use gpui::{AnyElement, App, Empty, IntoElement, RenderOnce, Window};

/// Placeholder where a matched child route is rendered inside a layout.
#[derive(IntoElement)]
pub struct Outlet {
    pub(crate) element: AnyElement,
}

impl Default for Outlet {
    fn default() -> Self {
        Self {
            element: Empty.into_any_element(),
        }
    }
}

impl Outlet {
    pub fn new() -> Self {
        Self::default()
    }
}

impl From<AnyElement> for Outlet {
    fn from(element: AnyElement) -> Self {
        Self { element }
    }
}

impl RenderOnce for Outlet {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        self.element
    }
}
