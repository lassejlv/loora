use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::extras::{
    DocumentAnimation, Interaction, NodeAnimation, OverrideMap, ResponsiveMap, Transition,
    VectorPath, VisualStates,
};
use crate::id::NodeId;

/// Fractional sibling order step (Loora default).
pub const DEFAULT_ORDER_STEP: f64 = 1024.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const fn rgba(r: f32, g: f32, b: f32, a: f32) -> Self {
        Self { r, g, b, a }
    }

    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self {
            r: r as f32 / 255.0,
            g: g as f32 / 255.0,
            b: b as f32 / 255.0,
            a: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum StrokeStyle {
    #[default]
    Solid,
    Dashed,
    Dotted,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub color: Color,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    pub width: f32,
    #[serde(default)]
    pub style: StrokeStyle,
}

impl Stroke {
    pub fn solid(color: Color, width: f32) -> Self {
        Self {
            color,
            token_id: None,
            width,
            style: StrokeStyle::Solid,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Paint {
    Solid {
        color: Color,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token_id: Option<String>,
    },
    LinearGradient {
        angle: f32,
        stops: Vec<GradientStop>,
    },
    RadialGradient {
        cx: f32,
        cy: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        size: Option<String>,
        stops: Vec<GradientStop>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GradientStop {
    pub offset: f32,
    pub color: Color,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
}

impl Paint {
    pub fn solid(color: Color) -> Self {
        Self::Solid {
            color,
            token_id: None,
        }
    }

    pub fn solid_color(&self) -> Option<Color> {
        match self {
            Self::Solid { color, .. } => Some(*color),
            Self::LinearGradient { stops, .. } | Self::RadialGradient { stops, .. } => {
                stops.first().map(|s| s.color)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Corners {
    pub tl: f32,
    pub tr: f32,
    pub br: f32,
    pub bl: f32,
}

impl Corners {
    pub fn uniform(radius: f32) -> Self {
        let r = radius.max(0.0);
        Self {
            tl: r,
            tr: r,
            br: r,
            bl: r,
        }
    }

    pub fn max(&self) -> f32 {
        self.tl.max(self.tr).max(self.br).max(self.bl)
    }

    pub fn is_uniform(&self) -> bool {
        (self.tl - self.tr).abs() < f32::EPSILON
            && (self.tl - self.br).abs() < f32::EPSILON
            && (self.tl - self.bl).abs() < f32::EPSILON
    }
}

impl Default for Corners {
    fn default() -> Self {
        Self::uniform(0.0)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Shadow {
    pub color: Color,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    pub x: f32,
    pub y: f32,
    pub blur: f32,
    pub spread: f32,
    #[serde(default)]
    pub inset: bool,
}

impl Default for Shadow {
    fn default() -> Self {
        Self {
            color: Color::rgba(0.0, 0.0, 0.0, 0.25),
            token_id: None,
            x: 0.0,
            y: 8.0,
            blur: 24.0,
            spread: -8.0,
            inset: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Overflow {
    #[default]
    Visible,
    Hidden,
    Auto,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "StyleSerde")]
pub struct Style {
    pub fills: Vec<Paint>,
    pub stroke: Option<Stroke>,
    pub corners: Corners,
    pub opacity: f32,
    #[serde(default)]
    pub shadows: Vec<Shadow>,
    #[serde(default)]
    pub overflow: Overflow,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blend_mode: Option<String>,
}

impl Style {
    pub fn solid_fill(&self) -> Option<Color> {
        self.fills.first().and_then(|p| p.solid_color())
    }

    pub fn set_solid_fill(&mut self, color: Option<Color>) {
        match color {
            Some(c) => {
                if let Some(Paint::Solid { color, token_id }) = self.fills.first_mut() {
                    *color = c;
                    *token_id = None;
                } else {
                    self.fills = vec![Paint::solid(c)];
                }
            }
            None => self.fills.clear(),
        }
    }

    pub fn radius(&self) -> f32 {
        if self.corners.is_uniform() {
            self.corners.tl
        } else {
            self.corners.max()
        }
    }

    pub fn set_radius(&mut self, radius: f32) {
        self.corners = Corners::uniform(radius);
    }
}

impl Default for Style {
    fn default() -> Self {
        Self {
            fills: Vec::new(),
            stroke: None,
            corners: Corners::default(),
            opacity: 1.0,
            shadows: Vec::new(),
            overflow: Overflow::Visible,
            blend_mode: None,
        }
    }
}

/// Accepts both legacy (`fill`/`radius`) and new (`fills`/`corners`) documents.
#[derive(Deserialize)]
struct StyleSerde {
    #[serde(default)]
    fills: Option<Vec<Paint>>,
    #[serde(default)]
    fill: Option<Color>,
    #[serde(default)]
    stroke: Option<Stroke>,
    #[serde(default)]
    corners: Option<Corners>,
    #[serde(default)]
    radius: Option<f32>,
    #[serde(default = "default_opacity")]
    opacity: f32,
    #[serde(default)]
    shadows: Vec<Shadow>,
    #[serde(default)]
    overflow: Overflow,
    #[serde(default)]
    blend_mode: Option<String>,
}

fn default_opacity() -> f32 {
    1.0
}

impl From<StyleSerde> for Style {
    fn from(value: StyleSerde) -> Self {
        let fills = if let Some(fills) = value.fills {
            fills
        } else if let Some(color) = value.fill {
            vec![Paint::solid(color)]
        } else {
            Vec::new()
        };
        let corners = value
            .corners
            .unwrap_or_else(|| Corners::uniform(value.radius.unwrap_or(0.0)));
        Self {
            fills,
            stroke: value.stroke,
            corners,
            opacity: value.opacity,
            shadows: value.shadows,
            overflow: value.overflow,
            blend_mode: value.blend_mode,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LayoutMode {
    #[default]
    Absolute,
    Flex,
    Grid,
}

/// How a frame/child sizes itself on one axis inside auto-layout.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SizeMode {
    #[default]
    Fixed,
    Percent,
    Hug,
    Fill,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum FlexDirection {
    #[default]
    Row,
    Column,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LayoutAlign {
    Start,
    Center,
    End,
    #[default]
    Stretch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LayoutJustify {
    #[default]
    Start,
    Center,
    End,
    SpaceBetween,
    SpaceAround,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LayoutPosition {
    #[default]
    Absolute,
    Flow,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Insets {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

impl Insets {
    pub fn uniform(v: f32) -> Self {
        Self {
            top: v,
            right: v,
            bottom: v,
            left: v,
        }
    }
}

/// Absolute box plus optional stack / constraint fields (serde-defaulted).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "LayoutSerde")]
pub struct Layout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub mode: LayoutMode,
    #[serde(default)]
    pub direction: FlexDirection,
    #[serde(default)]
    pub align: LayoutAlign,
    #[serde(default)]
    pub justify: LayoutJustify,
    #[serde(default)]
    pub gap: f32,
    #[serde(default)]
    pub wrap: bool,
    #[serde(default)]
    pub columns: u32,
    #[serde(default)]
    pub padding: Insets,
    #[serde(default)]
    pub position: LayoutPosition,
    #[serde(default)]
    pub grow: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shrink: Option<f32>,
    #[serde(default)]
    pub width_mode: SizeMode,
    #[serde(default)]
    pub height_mode: SizeMode,
    /// Original percentage value (0-100) when the corresponding mode is
    /// `Percent`; the concrete width/height remains cached in pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width_percent: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height_percent: Option<f64>,
    #[serde(default)]
    pub align_self: Option<LayoutAlign>,
    #[serde(default)]
    pub min_width: Option<f64>,
    #[serde(default)]
    pub max_width: Option<f64>,
    #[serde(default)]
    pub min_height: Option<f64>,
    #[serde(default)]
    pub max_height: Option<f64>,
    #[serde(default)]
    pub aspect_ratio: Option<f64>,
}

impl Layout {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
            ..Self::default_box()
        }
    }

    fn default_box() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            mode: LayoutMode::Absolute,
            direction: FlexDirection::Row,
            align: LayoutAlign::Stretch,
            justify: LayoutJustify::Start,
            gap: 0.0,
            wrap: false,
            columns: 2,
            padding: Insets::default(),
            position: LayoutPosition::Absolute,
            grow: 0.0,
            shrink: None,
            width_mode: SizeMode::Fixed,
            height_mode: SizeMode::Fixed,
            width_percent: None,
            height_percent: None,
            align_self: None,
            min_width: None,
            max_width: None,
            min_height: None,
            max_height: None,
            aspect_ratio: None,
        }
    }

    pub fn clamp_size(&self, mut width: f64, mut height: f64) -> (f64, f64) {
        if let Some(min) = self.min_width {
            width = width.max(min);
        }
        if let Some(max) = self.max_width {
            width = width.min(max);
        }
        if let Some(min) = self.min_height {
            height = height.max(min);
        }
        if let Some(max) = self.max_height {
            height = height.min(max);
        }
        if let Some(ratio) = self.aspect_ratio {
            if ratio > 0.0 {
                // Prefer width as master when both change; keep width, derive height.
                height = width / ratio;
                if let Some(min) = self.min_height {
                    height = height.max(min);
                }
                if let Some(max) = self.max_height {
                    height = height.min(max);
                }
            }
        }
        (width.max(1.0), height.max(1.0))
    }
}

#[derive(Deserialize)]
struct LayoutSerde {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    mode: LayoutMode,
    #[serde(default)]
    direction: FlexDirection,
    #[serde(default)]
    align: LayoutAlign,
    #[serde(default)]
    justify: LayoutJustify,
    #[serde(default)]
    gap: f32,
    #[serde(default)]
    wrap: bool,
    #[serde(default)]
    columns: Option<u32>,
    #[serde(default)]
    padding: Insets,
    #[serde(default)]
    position: LayoutPosition,
    #[serde(default)]
    grow: f32,
    #[serde(default)]
    shrink: Option<f32>,
    #[serde(default)]
    width_mode: SizeMode,
    #[serde(default)]
    height_mode: SizeMode,
    #[serde(default)]
    width_percent: Option<f64>,
    #[serde(default)]
    height_percent: Option<f64>,
    #[serde(default)]
    align_self: Option<LayoutAlign>,
    #[serde(default)]
    min_width: Option<f64>,
    #[serde(default)]
    max_width: Option<f64>,
    #[serde(default)]
    min_height: Option<f64>,
    #[serde(default)]
    max_height: Option<f64>,
    #[serde(default)]
    aspect_ratio: Option<f64>,
}

impl From<LayoutSerde> for Layout {
    fn from(value: LayoutSerde) -> Self {
        Self {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            mode: value.mode,
            direction: value.direction,
            align: value.align,
            justify: value.justify,
            gap: value.gap,
            wrap: value.wrap,
            columns: value.columns.unwrap_or(2),
            padding: value.padding,
            position: value.position,
            grow: value.grow,
            shrink: value.shrink,
            width_mode: value.width_mode,
            height_mode: value.height_mode,
            width_percent: value.width_percent,
            height_percent: value.height_percent,
            align_self: value.align_self,
            min_width: value.min_width,
            max_width: value.max_width,
            min_height: value.min_height,
            max_height: value.max_height,
            aspect_ratio: value.aspect_ratio,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
    Justify,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TextTransform {
    #[default]
    None,
    Uppercase,
    Lowercase,
    Capitalize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TextDecoration {
    #[default]
    None,
    Underline,
    LineThrough,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Typography {
    #[serde(default = "default_font_family")]
    pub family: String,
    #[serde(default = "default_font_size")]
    pub size: f32,
    #[serde(default = "default_font_weight")]
    pub weight: u16,
    #[serde(default)]
    pub line_height: Option<f32>,
    #[serde(default)]
    pub letter_spacing: f32,
    #[serde(default = "default_text_color")]
    pub color: Color,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_token: Option<String>,
    #[serde(default)]
    pub align: TextAlign,
    #[serde(default)]
    pub transform: TextTransform,
    #[serde(default)]
    pub decoration: TextDecoration,
    #[serde(default = "default_text_wrap")]
    pub wrap: bool,
}

impl Default for Typography {
    fn default() -> Self {
        Self {
            family: default_font_family(),
            size: default_font_size(),
            weight: default_font_weight(),
            line_height: None,
            letter_spacing: 0.0,
            color: default_text_color(),
            color_token: None,
            align: TextAlign::Left,
            transform: TextTransform::None,
            decoration: TextDecoration::None,
            wrap: true,
        }
    }
}

fn default_font_family() -> String {
    "System".into()
}

fn default_font_size() -> f32 {
    16.0
}

fn default_font_weight() -> u16 {
    400
}

fn default_text_color() -> Color {
    Color::rgb(0xf0, 0xf0, 0xf2)
}

fn default_text_wrap() -> bool {
    true
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    #[default]
    Rectangle,
    Ellipse,
    Line,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ImageFit {
    #[default]
    Cover,
    Contain,
    Fill,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Page,
    Frame,
    Rectangle,
    Text,
    Image,
    Component,
    Instance,
    Vector,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub kind: NodeKind,
    pub name: String,
    pub parent_id: Option<NodeId>,
    pub order: f64,
    pub hidden: bool,
    pub locked: bool,
    pub layout: Layout,
    pub style: Style,
    #[serde(default)]
    pub text: Option<String>,
    /// Legacy field; prefer `typography.size`. Kept for old docs / patches.
    #[serde(default = "default_font_size")]
    pub font_size: f32,
    #[serde(default)]
    pub typography: Option<Typography>,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub image_alt: String,
    #[serde(default)]
    pub image_fit: ImageFit,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default, skip_serializing_if = "ResponsiveMap::is_empty")]
    pub responsive: ResponsiveMap,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visual_states: Option<VisualStates>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<Transition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub animations: Vec<NodeAnimation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interactions: Vec<Interaction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "OverrideMap::is_empty")]
    pub overrides: OverrideMap,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<VectorPath>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub component_variants: Vec<String>,
    /// Component master: variant name → (master node id → patch).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub variant_overrides: HashMap<String, OverrideMap>,
    /// Instance descendant: id of the master node this was cloned from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_id: Option<String>,
    #[serde(default)]
    pub shape_kind: ShapeKind,
    #[serde(default)]
    pub semantic_tag: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_runs: Vec<crate::extras::TextRun>,
    #[serde(default)]
    pub vector_view_box: Option<String>,
    #[serde(default)]
    pub viewport: Option<crate::extras::PageViewport>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub states: HashMap<String, crate::extras::StateDefinition>,
    #[serde(default)]
    pub default_variant: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

impl Node {
    fn base(
        id_prefix: &str,
        kind: NodeKind,
        name: impl Into<String>,
        parent_id: Option<NodeId>,
        layout: Layout,
        style: Style,
    ) -> Self {
        Self {
            id: NodeId::new(id_prefix),
            kind,
            name: name.into(),
            parent_id,
            order: DEFAULT_ORDER_STEP,
            hidden: false,
            locked: false,
            layout,
            style,
            text: None,
            font_size: default_font_size(),
            typography: None,
            image_path: None,
            image_alt: String::new(),
            image_fit: ImageFit::Cover,
            rotation: 0.0,
            responsive: ResponsiveMap::new(),
            visual_states: None,
            transition: None,
            animations: Vec::new(),
            interactions: Vec::new(),
            component_id: None,
            variant: None,
            overrides: OverrideMap::new(),
            paths: Vec::new(),
            component_variants: Vec::new(),
            variant_overrides: HashMap::new(),
            origin_id: None,
            shape_kind: ShapeKind::Rectangle,
            semantic_tag: None,
            text_runs: Vec::new(),
            vector_view_box: None,
            viewport: None,
            states: HashMap::new(),
            default_variant: None,
            metadata: serde_json::Value::Null,
        }
    }

    pub fn page(name: impl Into<String>) -> Self {
        Self::base(
            "page",
            NodeKind::Page,
            name,
            None,
            Layout::new(0.0, 0.0, 1440.0, 900.0),
            Style {
                fills: vec![Paint::solid(Color::rgb(0x1a, 0x1a, 0x1a))],
                ..Style::default()
            },
        )
    }

    pub fn frame(name: impl Into<String>, parent_id: NodeId, layout: Layout) -> Self {
        Self::base(
            "frame",
            NodeKind::Frame,
            name,
            Some(parent_id),
            layout,
            Style {
                fills: vec![Paint::solid(Color::rgb(0x22, 0x22, 0x22))],
                corners: Corners::uniform(8.0),
                ..Style::default()
            },
        )
    }

    pub fn rectangle(name: impl Into<String>, parent_id: NodeId, layout: Layout) -> Self {
        Self::base(
            "rect",
            NodeKind::Rectangle,
            name,
            Some(parent_id),
            layout,
            Style {
                fills: vec![Paint::solid(Color::rgb(0x7a, 0xa2, 0xf7))],
                corners: Corners::uniform(4.0),
                ..Style::default()
            },
        )
    }

    pub fn text(
        name: impl Into<String>,
        parent_id: NodeId,
        layout: Layout,
        content: impl Into<String>,
    ) -> Self {
        let mut node = Self::base(
            "text",
            NodeKind::Text,
            name,
            Some(parent_id),
            layout,
            Style::default(),
        );
        node.text = Some(content.into());
        node.font_size = 24.0;
        node.typography = Some(Typography {
            size: 24.0,
            ..Typography::default()
        });
        node
    }

    pub fn image(name: impl Into<String>, parent_id: NodeId, layout: Layout) -> Self {
        Self::base(
            "image",
            NodeKind::Image,
            name,
            Some(parent_id),
            layout,
            Style {
                fills: vec![Paint::solid(Color::rgb(0x2e, 0x2e, 0x34))],
                corners: Corners::uniform(8.0),
                ..Style::default()
            },
        )
    }

    pub fn component(name: impl Into<String>, parent_id: NodeId, layout: Layout) -> Self {
        let mut node = Self::base(
            "component",
            NodeKind::Component,
            name,
            Some(parent_id),
            layout,
            Style {
                fills: vec![Paint::solid(Color::rgb(0x2a, 0x24, 0x38))],
                corners: Corners::uniform(8.0),
                ..Style::default()
            },
        );
        node.component_variants = vec!["Default".into()];
        node.variant = Some("Default".into());
        node
    }

    pub fn instance(
        name: impl Into<String>,
        parent_id: NodeId,
        layout: Layout,
        component_id: impl Into<String>,
    ) -> Self {
        let mut node = Self::base(
            "instance",
            NodeKind::Instance,
            name,
            Some(parent_id),
            layout,
            Style::default(),
        );
        node.component_id = Some(component_id.into());
        node.variant = Some("Default".into());
        node
    }

    pub fn vector(name: impl Into<String>, parent_id: NodeId, layout: Layout) -> Self {
        let mut node = Self::base(
            "vector",
            NodeKind::Vector,
            name,
            Some(parent_id),
            layout,
            Style::default(),
        );
        node.paths = vec![crate::extras::VectorPath {
            d: "M0 0 L100 0 L100 100 L0 100 Z".into(),
            fill: Some(Color::rgb(0x7a, 0xa2, 0xf7)),
            fill_token: None,
            stroke: None,
            stroke_token: None,
            stroke_width: None,
        }];
        node
    }

    /// Apply an override patch onto a cloned node (responsive / instance).
    pub fn apply_override_patch(&self, patch: &crate::extras::OverridePatch) -> Self {
        let mut node = self.clone();
        if let Some(name) = &patch.name {
            node.name = name.clone();
        }
        if let Some(layout) = &patch.layout {
            node.layout = layout.clone();
        }
        if let Some(layout) = &patch.layout_patch {
            if let Some(value) = layout.position {
                node.layout.position = value;
            }
            if let Some(value) = layout.x {
                node.layout.x = value;
            }
            if let Some(value) = layout.y {
                node.layout.y = value;
            }
            if let Some(value) = layout.width {
                node.layout.width_mode = value.mode;
                node.layout.width_percent = if value.mode == SizeMode::Percent {
                    value.value
                } else {
                    None
                };
                if value.mode != SizeMode::Percent {
                    if let Some(px) = value.value {
                        node.layout.width = px;
                    }
                }
            }
            if let Some(value) = layout.height {
                node.layout.height_mode = value.mode;
                node.layout.height_percent = if value.mode == SizeMode::Percent {
                    value.value
                } else {
                    None
                };
                if value.mode != SizeMode::Percent {
                    if let Some(px) = value.value {
                        node.layout.height = px;
                    }
                }
            }
            if let Some(value) = layout.min_width {
                node.layout.min_width = value;
            }
            if let Some(value) = layout.max_width {
                node.layout.max_width = value;
            }
            if let Some(value) = layout.min_height {
                node.layout.min_height = value;
            }
            if let Some(value) = layout.max_height {
                node.layout.max_height = value;
            }
            if let Some(value) = layout.aspect_ratio {
                node.layout.aspect_ratio = value;
            }
            if let Some(value) = layout.mode {
                node.layout.mode = value;
            }
            if let Some(value) = layout.direction {
                node.layout.direction = value;
            }
            if let Some(value) = layout.wrap {
                node.layout.wrap = value;
            }
            if let Some(value) = layout.gap {
                node.layout.gap = value;
            }
            if let Some(value) = layout.padding {
                node.layout.padding = value;
            }
            if let Some(value) = layout.align {
                node.layout.align = value;
            }
            if let Some(value) = layout.justify {
                node.layout.justify = value;
            }
            if let Some(value) = layout.columns {
                node.layout.columns = value;
            }
            if let Some(value) = layout.align_self {
                node.layout.align_self = value;
            }
            if let Some(value) = layout.grow {
                node.layout.grow = value;
            }
            if let Some(value) = layout.shrink {
                node.layout.shrink = value;
            }
        }
        if let Some(style) = &patch.style {
            node.style = style.clone();
        }
        if let Some(style) = &patch.style_patch {
            if let Some(value) = &style.fills {
                node.style.fills = value.clone();
            }
            if let Some(value) = &style.stroke {
                node.style.stroke = value.clone();
            }
            if let Some(value) = style.corners {
                node.style.corners = value;
            }
            if let Some(value) = &style.shadows {
                node.style.shadows = value.clone();
            }
            if let Some(value) = style.opacity {
                node.style.opacity = value;
            }
            if let Some(value) = style.overflow {
                node.style.overflow = value;
            }
            if let Some(value) = &style.blend_mode {
                node.style.blend_mode = value.clone();
            }
            if let Some(value) = &style.typography {
                let mut typography = node.effective_typography();
                if let Some(family) = &value.family {
                    typography.family = family.clone();
                }
                if let Some(size) = value.size {
                    typography.size = size;
                }
                if let Some(weight) = value.weight {
                    typography.weight = weight;
                }
                if let Some(line_height) = value.line_height {
                    typography.line_height = Some(line_height);
                }
                if let Some(letter_spacing) = value.letter_spacing {
                    typography.letter_spacing = letter_spacing;
                }
                if let Some(align) = value.align.as_deref() {
                    typography.align = match align {
                        "center" => TextAlign::Center,
                        "right" => TextAlign::Right,
                        "justify" => TextAlign::Justify,
                        _ => TextAlign::Left,
                    };
                }
                if let Some(wrap) = value.wrap {
                    typography.wrap = wrap;
                }
                if let Some(decoration) = value.decoration.as_deref() {
                    typography.decoration = match decoration {
                        "underline" => TextDecoration::Underline,
                        "line-through" => TextDecoration::LineThrough,
                        _ => TextDecoration::None,
                    };
                }
                if let Some(transform) = value.transform.as_deref() {
                    typography.transform = match transform {
                        "uppercase" => TextTransform::Uppercase,
                        "lowercase" => TextTransform::Lowercase,
                        "capitalize" => TextTransform::Capitalize,
                        _ => TextTransform::None,
                    };
                }
                node.font_size = typography.size;
                node.typography = Some(typography);
            }
        }
        if let Some(text) = &patch.text {
            node.text = Some(text.clone());
        }
        if let Some(typography) = &patch.typography {
            node.typography = Some(typography.clone());
            node.font_size = typography.size;
        }
        if let Some(rotation) = patch.rotation {
            node.rotation = rotation;
        }
        if let Some(opacity) = patch.opacity {
            node.style.opacity = opacity;
        }
        if let Some(hidden) = patch.hidden {
            node.hidden = hidden;
        }
        if let Some(locked) = patch.locked {
            node.locked = locked;
        }
        if let Some(value) = &patch.semantic_tag {
            node.semantic_tag = Some(value.clone());
        }
        if let Some(value) = &patch.text_runs {
            node.text_runs = value.clone();
        }
        if let Some(value) = &patch.image_path {
            node.image_path = Some(value.clone());
        }
        if let Some(value) = &patch.image_alt {
            node.image_alt = value.clone();
        }
        if let Some(value) = &patch.interactions {
            node.interactions = value.clone();
        }
        if let Some(value) = &patch.variant {
            node.variant = Some(value.clone());
        }
        if let Some(value) = &patch.visual_states {
            node.visual_states = Some(value.clone());
        }
        if let Some(value) = &patch.transition {
            node.transition = Some(value.clone());
        }
        if let Some(value) = &patch.animations {
            node.animations = value.clone();
        }
        node
    }

    pub fn is_container(&self) -> bool {
        matches!(
            self.kind,
            NodeKind::Page | NodeKind::Frame | NodeKind::Component | NodeKind::Instance
        )
    }

    pub fn text_content(&self) -> &str {
        self.text.as_deref().unwrap_or("Text")
    }

    /// Approximate content size for text hug / auto-resize.
    pub fn estimate_text_size(&self) -> (f64, f64) {
        let size = self
            .typography
            .as_ref()
            .map(|t| t.size as f64)
            .unwrap_or(self.font_size as f64)
            .max(1.0);
        let weight = self.typography.as_ref().map(|t| t.weight).unwrap_or(400);
        let lh = self
            .typography
            .as_ref()
            .and_then(|t| t.line_height)
            .unwrap_or(1.25) as f64;
        let text = self.text_content();
        let advance = if weight >= 600 { 0.62 } else { 0.56 };
        let mut max_line = 1.0_f64;
        for line in text.split('\n') {
            max_line = max_line.max(line.chars().count().max(1) as f64);
        }
        let lines = text.split('\n').count().max(1) as f64;
        let letter = self
            .typography
            .as_ref()
            .map(|t| t.letter_spacing as f64)
            .unwrap_or(0.0);
        let width = (max_line * (size * advance + letter)).clamp(8.0, 1200.0) + 8.0;
        let height = (size * lh * lines).max(size) + 4.0;
        (width, height)
    }

    pub fn effective_typography(&self) -> Typography {
        let mut t = self.typography.clone().unwrap_or_default();
        if self.typography.is_none() {
            t.size = self.font_size;
        }
        t
    }

    pub fn display_text(&self) -> String {
        let raw = self.text_content();
        let t = self.effective_typography();
        match t.transform {
            TextTransform::None => raw.to_string(),
            TextTransform::Uppercase => raw.to_uppercase(),
            TextTransform::Lowercase => raw.to_lowercase(),
            TextTransform::Capitalize => raw
                .split_whitespace()
                .map(|w| {
                    let mut chars = w.chars();
                    match chars.next() {
                        Some(c) => {
                            let mut s = c.to_uppercase().collect::<String>();
                            s.push_str(chars.as_str());
                            s
                        }
                        None => String::new(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" "),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Document {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub nodes: std::collections::HashMap<NodeId, Node>,
    pub root_page_id: NodeId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub breakpoints: Vec<crate::extras::Breakpoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tokens: Vec<crate::extras::DesignToken>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub animations: Vec<DocumentAnimation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub themes: Vec<crate::extras::CanvasTheme>,
    #[serde(default = "default_theme_id")]
    pub active_theme_id: String,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

fn default_schema_version() -> u32 {
    2
}

fn default_theme_id() -> String {
    "default".into()
}

impl Document {
    pub fn empty(name: impl Into<String>) -> Self {
        let page = Node::page("Page 1");
        let root_page_id = page.id.clone();
        let mut nodes = std::collections::HashMap::new();
        nodes.insert(page.id.clone(), page);
        Self {
            schema_version: 2,
            id: NodeId::new("doc").to_string(),
            name: name.into(),
            nodes,
            root_page_id,
            breakpoints: vec![
                crate::extras::Breakpoint {
                    id: "tablet".into(),
                    name: "Tablet".into(),
                    min_width: 768.0,
                    preview_width: 768.0,
                },
                crate::extras::Breakpoint {
                    id: "mobile".into(),
                    name: "Mobile".into(),
                    min_width: 390.0,
                    preview_width: 390.0,
                },
            ],
            tokens: vec![
                crate::extras::DesignToken {
                    id: "accent".into(),
                    name: "Accent".into(),
                    color: Color::rgb(0x7a, 0xa2, 0xf7),
                    token_type: "color".into(),
                    value: serde_json::Value::String("#7aa2f7".into()),
                    modes: HashMap::new(),
                },
                crate::extras::DesignToken {
                    id: "danger".into(),
                    name: "Danger".into(),
                    color: Color::rgb(0xf7, 0x76, 0x8e),
                    token_type: "color".into(),
                    value: serde_json::Value::String("#f7768e".into()),
                    modes: HashMap::new(),
                },
            ],
            animations: Vec::new(),
            themes: vec![crate::extras::CanvasTheme {
                id: "default".into(),
                name: "Default".into(),
            }],
            active_theme_id: "default".into(),
            metadata: serde_json::Value::Null,
        }
    }
}

/// Seed document with a page and a few shapes.
pub fn demo_document() -> Document {
    let mut doc = Document::empty("Demo");
    let page_id = doc.root_page_id.clone();

    let mut frame = Node::frame(
        "Card",
        page_id.clone(),
        Layout::new(120.0, 80.0, 320.0, 220.0),
    );
    frame.order = DEFAULT_ORDER_STEP;
    frame
        .style
        .set_solid_fill(Some(Color::rgb(0x2a, 0x2a, 0x2e)));
    let frame_id = frame.id.clone();

    let mut rect_a = Node::rectangle(
        "Accent",
        frame_id.clone(),
        Layout::new(24.0, 24.0, 120.0, 80.0),
    );
    rect_a.order = DEFAULT_ORDER_STEP;
    rect_a
        .style
        .set_solid_fill(Some(Color::rgb(0x7a, 0xa2, 0xf7)));

    let mut rect_b = Node::rectangle(
        "Secondary",
        frame_id.clone(),
        Layout::new(160.0, 48.0, 120.0, 120.0),
    );
    rect_b.order = DEFAULT_ORDER_STEP * 2.0;
    rect_b
        .style
        .set_solid_fill(Some(Color::rgb(0x9e, 0xce, 0x6a)));
    rect_b.style.set_radius(12.0);

    let mut loose = Node::rectangle("Floating", page_id, Layout::new(500.0, 140.0, 180.0, 100.0));
    loose.order = DEFAULT_ORDER_STEP * 2.0;
    loose
        .style
        .set_solid_fill(Some(Color::rgb(0xf7, 0x76, 0x8e)));
    loose.style.set_radius(16.0);

    doc.nodes.insert(frame.id.clone(), frame);
    doc.nodes.insert(rect_a.id.clone(), rect_a);
    doc.nodes.insert(rect_b.id.clone(), rect_b);
    doc.nodes.insert(loose.id.clone(), loose);
    doc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_fill_and_radius() {
        let json = r#"{
            "fill": {"r":1.0,"g":0.0,"b":0.0,"a":1.0},
            "stroke": null,
            "radius": 8.0,
            "opacity": 0.5
        }"#;
        let style: Style = serde_json::from_str(json).unwrap();
        assert_eq!(style.fills.len(), 1);
        assert_eq!(style.corners.tl, 8.0);
        assert!((style.opacity - 0.5).abs() < f32::EPSILON);
    }
}
