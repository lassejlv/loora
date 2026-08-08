//! Document engine for Loora (GPUI-free).

pub mod camera;
pub mod canvas_import;
pub mod engine;
pub mod extras;
pub mod hit;
pub mod html;
pub mod id;
pub mod model;
pub mod ops;
pub mod store;

pub use camera::Camera;
pub use engine::{ApplyOptions, CanvasEngine, EngineError};
pub use extras::{
    AnimationKeyframe, AnimationTrigger, Breakpoint, CanvasAction, CanvasTheme, DesignToken,
    DimensionPatch, DocumentAnimation, Interaction, InteractionTrigger, LayoutPatch,
    MotionTransform, NodeAnimation, OverrideMap, OverridePatch, PageViewport, ResponsiveMap,
    StateCondition, StateDefinition, StateValue, StylePatch, TextRun, Transition, TypographyPatch,
    VectorPath, VisualState, VisualStates,
};
pub use hit::{Bounds, Vec2};
pub use html::{compile_canvas, export_page_svg, standalone_html, CompiledCanvas, HtmlCanvasOptions};
pub use id::NodeId;
pub use model::{
    demo_document, Color, Corners, Document, FlexDirection, GradientStop, Insets, Layout,
    ImageFit, LayoutAlign, LayoutJustify, LayoutMode, LayoutPosition, Node, NodeKind, Overflow,
    Paint, Shadow, ShapeKind, SizeMode, Stroke, StrokeStyle, Style, TextAlign, TextDecoration,
    TextTransform, Typography, DEFAULT_ORDER_STEP,
};
pub use ops::{NodePatch, Operation, Transaction};
pub use store::{DesignFileInfo, DesignStore, ImportReport};
