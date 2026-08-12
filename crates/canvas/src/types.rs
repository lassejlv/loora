use std::ops::Range;

use gpui::{Hsla, Pixels, Point, Rgba};
use loora_engine::{Bounds, Camera, Insets, NodeId, Vec2};

pub(crate) const SNAP_SCREEN_PX: f64 = 6.0;
pub(crate) const HANDLE_SCREEN_PX: f64 = 8.0;
pub(crate) const ROTATION_HANDLE_SCREEN_PX: f64 = 24.0;
pub(crate) const MIN_NODE_SIZE: f64 = 1.0;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeTextEdit {
    pub id: NodeId,
    pub anchor: usize,
    pub caret: usize,
    pub caret_visible: bool,
    pub marked_range: Option<Range<usize>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CanvasTool {
    Select,
    Hand,
    Preview,
    Frame,
    Text,
    Rectangle,
    Shapes,
    Image,
    Component,
}

impl CanvasTool {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Select => "select",
            Self::Hand => "hand",
            Self::Preview => "preview",
            Self::Frame => "frame",
            Self::Text => "text",
            Self::Rectangle => "rectangle",
            Self::Shapes => "shapes",
            Self::Image => "image",
            Self::Component => "component",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Select => "Select",
            Self::Hand => "Hand",
            Self::Preview => "Preview",
            Self::Frame => "Frame",
            Self::Text => "Text",
            Self::Rectangle => "Rectangle",
            Self::Shapes => "Shape",
            Self::Image => "Image",
            Self::Component => "Component",
        }
    }

    pub fn shortcut(self) -> Option<&'static str> {
        match self {
            Self::Select => Some("V"),
            Self::Hand => Some("H"),
            Self::Preview => Some("P"),
            Self::Frame => Some("F"),
            Self::Text => Some("T"),
            Self::Rectangle => Some("R"),
            Self::Image => Some("I"),
            _ => None,
        }
    }

    pub fn from_name(value: &str) -> Option<Self> {
        match value {
            "select" | "v" => Some(Self::Select),
            "hand" | "h" => Some(Self::Hand),
            "preview" => Some(Self::Preview),
            "frame" | "f" => Some(Self::Frame),
            "text" | "t" => Some(Self::Text),
            "rectangle" | "r" => Some(Self::Rectangle),
            "shapes" => Some(Self::Shapes),
            "image" | "i" => Some(Self::Image),
            "component" => Some(Self::Component),
            _ => None,
        }
    }

    pub(crate) fn draws(self) -> bool {
        matches!(
            self,
            Self::Frame
                | Self::Text
                | Self::Rectangle
                | Self::Shapes
                | Self::Image
                | Self::Component
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResizeHandle {
    NorthWest,
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CanvasEvent {
    SelectionChanged(Vec<NodeId>),
    CameraChanged(Camera),
    MoveCommitted {
        ids: Vec<NodeId>,
        dx: f64,
        dy: f64,
        duplicate: bool,
        drop_world: Vec2,
    },
    TransformCommitted {
        bounds: Vec<(NodeId, Bounds)>,
        rotations: Vec<(NodeId, f32)>,
    },
    LayoutMetricsChanged {
        id: NodeId,
        gap: f32,
        padding: Insets,
    },
    CreateCommitted {
        tool: CanvasTool,
        bounds: Bounds,
    },
    ToolChanged(CanvasTool),
    ContextMenuRequested {
        position: Point<Pixels>,
        world: Vec2,
        hit: Option<NodeId>,
    },
    PreviewTriggered {
        id: NodeId,
        trigger: PreviewTrigger,
    },
    OverlayCloseRequested,
    BeginTextEdit {
        id: NodeId,
        anchor: usize,
        caret: usize,
    },
    EndTextEdit,
    TextSelectionChanged {
        id: NodeId,
        anchor: usize,
        caret: usize,
    },
    TextEdited {
        id: NodeId,
        text: String,
        anchor: usize,
        caret: usize,
        marked_range: Option<Range<usize>>,
    },
    ChooseImage(NodeId),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewTrigger {
    Click,
    DoubleClick,
    Hover,
    HoverEnd,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CanvasPalette {
    pub background: Hsla,
    pub page_label: Hsla,
    pub selection: Hsla,
    pub guide: Hsla,
    pub agent: Hsla,
    pub image_placeholder: Hsla,
}

impl Default for CanvasPalette {
    fn default() -> Self {
        Self {
            background: rgba(0x0f, 0x0f, 0x10, 0xff),
            page_label: rgba(0xa0, 0xa0, 0xaa, 0xff),
            selection: rgba(0x7a, 0xa2, 0xf7, 0xff),
            guide: rgba(0xe8, 0x79, 0xf9, 0xff),
            agent: rgba(0x72, 0xd5, 0x8c, 0xff),
            image_placeholder: rgba(0x2a, 0x2a, 0x2e, 0xff),
        }
    }
}
pub(crate) fn rgba(r: u8, g: u8, b: u8, a: u8) -> Hsla {
    Rgba {
        r: r as f32 / 255.0,
        g: g as f32 / 255.0,
        b: b as f32 / 255.0,
        a: a as f32 / 255.0,
    }
    .into()
}
