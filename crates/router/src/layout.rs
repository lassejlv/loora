use gpui::{AnyElement, App, Window};

/// Layout wrapper for nested routes. Injects the matched child via [`Outlet`].
pub trait Layout {
    fn outlet(&mut self, element: AnyElement);
    fn render_layout(self: Box<Self>, window: &mut Window, cx: &mut App) -> AnyElement;
}
