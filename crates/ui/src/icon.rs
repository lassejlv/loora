use gpui::{
    px, svg, App, Hsla, IntoElement, Pixels, RenderOnce, SharedString, StyleRefinement, Styled,
    Window,
};

use crate::component::StyledSlot;

/// Named Hugeicons (free stroke-rounded) assets bundled with the UI crate.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum IconName {
    Home,
    Search,
    Dashboard,
    Folder,
    Message,
    Notification,
    Settings,
    User,
    // Canvas toolbar
    Cursor,
    Hand,
    View,
    ViewOff,
    LayoutRight,
    Grid,
    Text,
    Square,
    Shapes,
    Image,
    Diamond,
    Undo,
    Redo,
    Add,
    Lock,
    Unlock,
    ChevronRight,
    ChevronDown,
    Drag,
    Circle,
    PenTool,
    MoreHorizontal,
    Layers,
    GroupItems,
    UngroupItems,
    SidebarLeft,
    BoundingBox,
    Scissors,
    Copy,
    Duplicate,
    ClipboardPaste,
    BringToFront,
    BringForward,
    SendBackward,
    SendToBack,
    CancelSquare,
    Delete,
}

impl IconName {
    /// Asset path relative to the registered [`crate::Assets`] root.
    pub fn path(self) -> SharedString {
        SharedString::from(match self {
            Self::Home => "icons/home-01.svg",
            Self::Search => "icons/search-01.svg",
            Self::Dashboard => "icons/dashboard-square-01.svg",
            Self::Folder => "icons/folder-01.svg",
            Self::Message => "icons/message-01.svg",
            Self::Notification => "icons/notification-03.svg",
            Self::Settings => "icons/settings-01.svg",
            Self::User => "icons/user-circle.svg",
            Self::Cursor => "icons/cursor-02.svg",
            Self::Hand => "icons/hand.svg",
            Self::View => "icons/view.svg",
            Self::ViewOff => "icons/view-off.svg",
            Self::LayoutRight => "icons/layout-right.svg",
            Self::Grid => "icons/grid.svg",
            Self::Text => "icons/text.svg",
            Self::Square => "icons/square.svg",
            Self::Shapes => "icons/shapes.svg",
            Self::Image => "icons/image-01.svg",
            Self::Diamond => "icons/diamond.svg",
            Self::Undo => "icons/undo.svg",
            Self::Redo => "icons/redo.svg",
            Self::Add => "icons/add-01.svg",
            Self::Lock => "icons/lock.svg",
            Self::Unlock => "icons/unlock.svg",
            Self::ChevronRight => "icons/arrow-right-01.svg",
            Self::ChevronDown => "icons/arrow-down-01.svg",
            Self::Drag => "icons/drag-drop-vertical.svg",
            Self::Circle => "icons/circle.svg",
            Self::PenTool => "icons/pen-tool-01.svg",
            Self::MoreHorizontal => "icons/more-horizontal.svg",
            Self::Layers => "icons/layers-01.svg",
            Self::GroupItems => "icons/group-items.svg",
            Self::UngroupItems => "icons/ungroup-items.svg",
            Self::SidebarLeft => "icons/sidebar-left.svg",
            Self::BoundingBox => "icons/bounding-box.svg",
            Self::Scissors => "icons/scissors.svg",
            Self::Copy => "icons/copy-01.svg",
            Self::Duplicate => "icons/copy-02.svg",
            Self::ClipboardPaste => "icons/clipboard-paste.svg",
            Self::BringToFront => "icons/layer-bring-to-front.svg",
            Self::BringForward => "icons/layer-bring-forward.svg",
            Self::SendBackward => "icons/layer-send-backward.svg",
            Self::SendToBack => "icons/layer-send-to-back.svg",
            Self::CancelSquare => "icons/cancel-square.svg",
            Self::Delete => "icons/delete-02.svg",
        })
    }
}

/// Hugeicons-backed SVG icon.
///
/// Implements [`Styled`], so callers can chain GPUI style helpers (size, color, opacity, …)
/// the same way they would on a `div` / `svg`. Color comes from `text_color` (alpha-mask paint).
#[derive(IntoElement)]
pub struct Icon {
    name: IconName,
    style: StyleRefinement,
}

impl Icon {
    pub fn new(name: IconName) -> Self {
        Self::hugeicon(name)
    }

    pub fn hugeicon(name: IconName) -> Self {
        Self {
            name,
            style: StyleRefinement::default().size(px(18.)).flex_shrink_0(),
        }
    }

    pub fn px(mut self, size: impl Into<Pixels>) -> Self {
        let size = size.into();
        self = self.size(size);
        self
    }

    pub fn color(self, color: Hsla) -> Self {
        self.text_color(color)
    }

    pub fn name(&self) -> IconName {
        self.name
    }
}

impl Styled for Icon {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Icon {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        svg().path(self.name.path()).refine_style(&self.style)
    }
}
