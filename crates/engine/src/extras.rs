//! Document-level and node extras for responsive, motion, components, actions, vector, tokens.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::model::{
    Color, Corners, FlexDirection, Layout, LayoutAlign, LayoutJustify, LayoutMode,
    LayoutPosition, Overflow, Paint, SizeMode, Stroke, Style, Typography,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Breakpoint {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub min_width: f64,
    #[serde(default)]
    pub preview_width: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DesignToken {
    pub id: String,
    pub name: String,
    #[serde(default = "default_token_type")]
    pub token_type: String,
    pub color: Color,
    #[serde(default)]
    pub value: serde_json::Value,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub modes: HashMap<String, serde_json::Value>,
}

fn default_token_type() -> String {
    "color".into()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CanvasTheme {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MotionTransform {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotate: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skew_x: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skew_y: Option<f32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AnimationKeyframe {
    pub offset: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<MotionTransform>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentAnimation {
    pub id: String,
    pub name: String,
    #[serde(default = "default_duration")]
    pub duration_ms: f32,
    #[serde(default = "default_easing")]
    pub easing: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cubic_bezier: Option<[f32; 4]>,
    #[serde(default)]
    pub delay_ms: f32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keyframes: Vec<AnimationKeyframe>,
    #[serde(default = "default_iterations")]
    pub iterations: f32,
    #[serde(default)]
    pub infinite: bool,
    #[serde(default = "default_direction")]
    pub direction: String,
    #[serde(default = "default_fill")]
    pub fill: String,
}

fn default_duration() -> f32 {
    300.0
}

fn default_easing() -> String {
    "ease-out".into()
}

fn default_iterations() -> f32 {
    1.0
}

fn default_direction() -> String {
    "normal".into()
}

fn default_fill() -> String {
    "none".into()
}

/// Serializable subset used for responsive overrides and instance overrides.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct OverridePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Layout>,
    /// Field-level Canvas V2 layout patch. Imported documents use this so an
    /// override changes only the fields it actually contains.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout_patch: Option<LayoutPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<Style>,
    /// Field-level Canvas V2 style patch (including partial typography).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_patch: Option<StylePatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typography: Option<Typography>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic_tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_runs: Option<Vec<TextRun>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_alt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interactions: Option<Vec<Interaction>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visual_states: Option<VisualStates>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<Transition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<Vec<NodeAnimation>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct DimensionPatch {
    pub mode: SizeMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LayoutPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<LayoutPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<DimensionPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<DimensionPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_width: Option<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_height: Option<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_height: Option<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<LayoutMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<FlexDirection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<crate::model::Insets>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<LayoutAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub justify: Option<LayoutJustify>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align_self: Option<Option<LayoutAlign>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grow: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shrink: Option<Option<f32>>,
}

impl LayoutPatch {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct StylePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fills: Option<Vec<Paint>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Option<Stroke>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corners: Option<Corners>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadows: Option<Vec<crate::model::Shadow>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overflow: Option<Overflow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blend_mode: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typography: Option<TypographyPatch>,
}

impl StylePatch {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VisualState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<MotionTransform>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<StylePatch>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct VisualStates {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hover: Option<VisualState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub press: Option<VisualState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<VisualState>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    #[serde(default = "default_duration")]
    pub duration_ms: f32,
    #[serde(default = "default_easing")]
    pub easing: String,
    #[serde(default)]
    pub delay_ms: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cubic_bezier: Option<[f32; 4]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<String>,
}

impl Default for Transition {
    fn default() -> Self {
        Self {
            duration_ms: 300.0,
            easing: default_easing(),
            delay_ms: 0.0,
            cubic_bezier: None,
            properties: vec!["all".into()],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AnimationTrigger {
    #[default]
    Load,
    InView,
    Always,
    Hover,
    Press,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NodeAnimation {
    pub animation_id: String,
    #[serde(default)]
    pub trigger: AnimationTrigger,
    #[serde(default)]
    pub delay_ms: f32,
    #[serde(default)]
    pub once: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum InteractionTrigger {
    #[default]
    Click,
    DoubleClick,
    Hover,
    HoverEnd,
    Submit,
    Change,
    Input,
    Focus,
    Blur,
    StateChange,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StateValue {
    String(String),
    Number(f64),
    Boolean(bool),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StateCondition {
    pub state_id: String,
    pub operator: String,
    pub value: StateValue,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StateDefinition {
    pub id: String,
    pub name: String,
    pub state_type: String,
    pub initial: StateValue,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CanvasAction {
    OpenUrl {
        url: String,
        #[serde(default = "default_target")]
        target: String,
    },
    Navigate {
        page_id: String,
    },
    Visibility {
        node_id: String,
        value: String,
    },
    OpenOverlay {
        page_id: String,
    },
    CloseOverlay,
    SetVariant {
        instance_id: String,
        variant: String,
    },
    SetState {
        state_id: String,
        value: StateValue,
    },
    ToggleState {
        state_id: String,
    },
    IncrementState {
        state_id: String,
        amount: f64,
    },
    SetTheme {
        theme_id: String,
    },
}

fn default_target() -> String {
    "_blank".into()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Interaction {
    #[serde(default)]
    pub trigger: InteractionTrigger,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub when: Vec<StateCondition>,
    pub actions: Vec<CanvasAction>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TypographyPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decoration: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextRun {
    pub start: usize,
    pub end: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typography: Option<TypographyPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_token: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PageViewport {
    pub width: f64,
    pub min_height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VectorPath {
    pub d: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f32>,
}

pub type ResponsiveMap = HashMap<String, OverridePatch>;
pub type OverrideMap = HashMap<String, OverridePatch>;

/// Solid color or a document token reference.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ColorOrToken {
    Color(Color),
    Token { token: String },
}

impl ColorOrToken {
    pub fn resolve(&self, tokens: &[DesignToken]) -> Color {
        match self {
            Self::Color(color) => *color,
            Self::Token { token } => tokens
                .iter()
                .find(|t| t.id == *token || t.name == *token)
                .map(|t| t.color)
                .unwrap_or(Color::rgb(0x80, 0x80, 0x80)),
        }
    }
}
