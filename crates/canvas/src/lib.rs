//! Native GPUI canvas surface for Loora.
//!
//! This crate deliberately depends on the document engine, not on `loora-ui`.
//! The desktop shell remains responsible for history, persistence and panels;
//! this surface owns drawing and pointer interactions.

mod motion;
mod scene_raster;
pub mod style_fixture;

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use gpui::{
    canvas, div, fill, font, outline, point, prelude::FluentBuilder, px, quad, relative, size, App,
    Background, BorderStyle, Bounds as GpBounds, BoxShadow, ContentMask, Context,
    Corners as GpCorners, Edges, Entity, EventEmitter, FontWeight, Hsla, InteractiveElement,
    IntoElement, MouseButton, MouseDownEvent, MouseExitEvent, MouseMoveEvent, MouseUpEvent,
    ParentElement, Path as GpPath, PathBuilder, PinchEvent, Pixels, Point, Render, RenderImage,
    Rgba, ScrollWheelEvent, ShapedLine, SharedString, StatefulInteractiveElement,
    StrikethroughStyle, Styled, Task, TextAlign as GpTextAlign, TextRun, TransformationMatrix,
    UnderlineStyle, Window,
};
use loora_engine::{
    AnimationTrigger, Bounds, Camera, Color, Document, FlexDirection, ImageFit, Insets, Layout,
    LayoutMode, Node, NodeId, NodeKind, Overflow, Paint, ShapeKind, TextAlign as EngineTextAlign,
    TextDecoration, Vec2,
};
use svgtypes::{PathParser, PathSegment};

use motion::{MotionFrame, MotionRuntime};

const SNAP_SCREEN_PX: f64 = 6.0;
const HANDLE_SCREEN_PX: f64 = 8.0;
const ROTATION_HANDLE_SCREEN_PX: f64 = 24.0;
const MIN_NODE_SIZE: f64 = 1.0;

fn apply_scroll_delta(camera: &mut Camera, local: Vec2, delta: Vec2, zoom: bool) {
    if zoom {
        camera.zoom_at(local, (delta.y * 0.003).exp());
    } else {
        camera.pan_by(delta.x, delta.y);
    }
}

fn apply_pinch_delta(camera: &mut Camera, local: Vec2, delta: f64) {
    camera.zoom_at(local, (1.0 + delta).max(0.01));
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeTextEdit {
    pub id: NodeId,
    pub anchor: usize,
    pub caret: usize,
    pub caret_visible: bool,
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

    fn draws(self) -> bool {
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
    BeginTextEdit(NodeId),
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GuideAxis {
    Vertical,
    Horizontal,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Guide {
    axis: GuideAxis,
    position: f64,
    from: f64,
    to: f64,
    label: Option<f64>,
}

#[derive(Clone, Debug)]
enum DragState {
    Pan {
        start_screen: Vec2,
        start_pan: Vec2,
    },
    Move {
        start_world: Vec2,
        ids: Vec<NodeId>,
        originals: HashMap<NodeId, Bounds>,
        delta: Vec2,
        duplicate: bool,
    },
    Resize {
        start_world: Vec2,
        handle: ResizeHandle,
        basis: ResizeBasis,
        originals: HashMap<NodeId, Bounds>,
        group: Bounds,
        multi: Option<MultiTransform>,
        current: HashMap<NodeId, Bounds>,
    },
    Rotate {
        center: Vec2,
        start_angle: f64,
        originals: HashMap<NodeId, f32>,
        current: HashMap<NodeId, f32>,
        bounds: Option<MultiRotateBounds>,
    },
    LayoutGap {
        id: NodeId,
        direction: FlexDirection,
        start_world: Vec2,
        start_gap: f32,
        current_gap: f32,
        padding: Insets,
    },
    LayoutPadding {
        id: NodeId,
        edge: PaddingEdge,
        start_world: Vec2,
        gap: f32,
        start_padding: Insets,
        current_padding: Insets,
        container: Bounds,
    },
    Marquee {
        start_world: Vec2,
        current_world: Vec2,
    },
    Create {
        tool: CanvasTool,
        start_world: Vec2,
        current_world: Vec2,
    },
}

#[derive(Clone, Debug)]
struct MultiTransform {
    members: HashMap<NodeId, MultiTransformMember>,
}

#[derive(Clone, Copy, Debug)]
struct MultiTransformMember {
    original: Bounds,
    visual_center: Vec2,
    parent_inverse: Affine2,
}

#[derive(Clone, Debug)]
struct MultiRotateBounds {
    current: HashMap<NodeId, Bounds>,
    members: MultiTransform,
}

#[derive(Clone, Copy, Debug)]
struct ResizeBasis {
    x_axis: Vec2,
    y_axis: Vec2,
    x_scale: f64,
    y_scale: f64,
}

impl ResizeBasis {
    const IDENTITY: Self = Self {
        x_axis: Vec2 { x: 1.0, y: 0.0 },
        y_axis: Vec2 { x: 0.0, y: 1.0 },
        x_scale: 1.0,
        y_scale: 1.0,
    };

    fn project(self, delta: Vec2) -> Vec2 {
        Vec2::new(
            (delta.x * self.x_axis.x + delta.y * self.x_axis.y) / self.x_scale.max(0.000_001),
            (delta.x * self.y_axis.x + delta.y * self.y_axis.y) / self.y_scale.max(0.000_001),
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PaddingEdge {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Clone, Debug)]
enum LayoutBadgeKind {
    Gap(FlexDirection),
    Padding(PaddingEdge),
}

#[derive(Clone, Debug)]
struct LayoutBadge {
    bounds: Bounds,
    label: String,
    kind: LayoutBadgeKind,
}

pub struct NativeCanvas {
    document: Arc<Document>,
    world_bounds: HashMap<NodeId, Bounds>,
    paint_order: Arc<Vec<NodeId>>,
    revision: u64,
    camera: Camera,
    selection: Vec<NodeId>,
    agent_nodes: Vec<NodeId>,
    tool: CanvasTool,
    preview: bool,
    preview_overlay: Option<NodeId>,
    text_edit: Option<NativeTextEdit>,
    palette: CanvasPalette,
    images: HashMap<String, Arc<RenderImage>>,
    image_opacity_variants: HashMap<NodeId, OpacityImage>,
    gradient_fills: HashMap<(NodeId, usize), GradientRaster>,
    rotated_images: HashMap<NodeId, RotatedImage>,
    page_rasters: HashMap<NodeId, PageRaster>,
    page_generations: HashMap<NodeId, u64>,
    page_raster_jobs: HashMap<NodeId, PageRasterJob>,
    display_scale: f32,
    viewport: Rc<Cell<GpBounds<Pixels>>>,
    drag: Option<DragState>,
    guides: Vec<Guide>,
    hovered: Option<NodeId>,
    pressed: Option<NodeId>,
    focused: Option<NodeId>,
    motion: MotionRuntime,
    timeline_bounds: Rc<Cell<GpBounds<Pixels>>>,
    timeline_scrubbing: bool,
    space_pan: bool,
    pointer_world: Option<Vec2>,
}

impl EventEmitter<CanvasEvent> for NativeCanvas {}

impl NativeCanvas {
    pub fn new(document: Document, camera: Camera, _cx: &mut Context<Self>) -> Self {
        Self::new_with_viewport(document, camera, Rc::new(Cell::new(GpBounds::default())))
    }

    pub fn new_with_viewport(
        document: Document,
        camera: Camera,
        viewport: Rc<Cell<GpBounds<Pixels>>>,
    ) -> Self {
        let world_bounds = absolute_bounds(&document);
        let paint_order = Arc::new(paint_order(&document));
        let page_generations = document
            .nodes
            .values()
            .filter(|node| node.is_root_frame())
            .map(|node| (node.id.clone(), 0))
            .collect();
        let mut canvas = Self {
            document: Arc::new(document),
            world_bounds,
            paint_order,
            revision: 0,
            camera,
            selection: Vec::new(),
            agent_nodes: Vec::new(),
            tool: CanvasTool::Select,
            preview: false,
            preview_overlay: None,
            text_edit: None,
            palette: CanvasPalette::default(),
            images: HashMap::new(),
            image_opacity_variants: HashMap::new(),
            gradient_fills: HashMap::new(),
            rotated_images: HashMap::new(),
            page_rasters: HashMap::new(),
            page_generations,
            page_raster_jobs: HashMap::new(),
            display_scale: 1.0,
            viewport,
            drag: None,
            guides: Vec::new(),
            hovered: None,
            pressed: None,
            focused: None,
            motion: MotionRuntime::default(),
            timeline_bounds: Rc::new(Cell::new(GpBounds::default())),
            timeline_scrubbing: false,
            space_pan: false,
            pointer_world: None,
        };
        let initial_document = canvas.document.clone();
        canvas.sync_images(&initial_document);
        canvas.sync_rotated_images(&initial_document);
        canvas
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_scene(
        &mut self,
        document: Arc<Document>,
        revision: u64,
        camera: Camera,
        selection: Vec<NodeId>,
        agent_nodes: Vec<NodeId>,
        tool: CanvasTool,
        preview: bool,
        preview_overlay: Option<NodeId>,
        text_edit: Option<NativeTextEdit>,
        palette: CanvasPalette,
        cx: &mut Context<Self>,
    ) {
        let document_changed = self.revision != revision;
        let changed = document_changed
            || self.camera != camera
            || self.selection != selection
            || self.agent_nodes != agent_nodes
            || self.tool != tool
            || self.preview != preview
            || self.preview_overlay != preview_overlay
            || self.text_edit != text_edit
            || self.palette != palette;
        if document_changed {
            let changed_pages = changed_raster_pages(&self.document, &document);
            let current_pages = document
                .nodes
                .values()
                .filter(|node| node.is_root_frame())
                .map(|node| node.id.clone())
                .collect::<HashSet<_>>();
            for page_id in changed_pages {
                if current_pages.contains(&page_id) {
                    *self.page_generations.entry(page_id.clone()).or_default() += 1;
                }
                self.page_raster_jobs.remove(&page_id);
            }
            self.page_generations
                .retain(|id, _| current_pages.contains(id));
            self.page_rasters.retain(|id, _| current_pages.contains(id));
            self.page_raster_jobs
                .retain(|id, _| current_pages.contains(id));
            self.sync_images(&document);
            self.image_opacity_variants.clear();
            self.gradient_fills.clear();
            self.sync_rotated_images(&document);
            self.world_bounds = absolute_bounds(&document);
            self.paint_order = Arc::new(paint_order(&document));
            self.document = document;
            self.revision = revision;
        }
        self.camera = camera;
        self.selection = selection;
        self.agent_nodes = agent_nodes;
        self.tool = tool;
        self.preview = preview;
        if !preview {
            self.hovered = None;
            self.pressed = None;
            self.focused = None;
        }
        self.preview_overlay = preview_overlay;
        self.text_edit = text_edit;
        self.palette = palette;
        if changed {
            cx.notify();
        }
    }

    pub fn camera(&self) -> Camera {
        self.camera
    }

    pub fn set_space_pan(&mut self, active: bool, cx: &mut Context<Self>) {
        if self.space_pan != active {
            self.space_pan = active;
            cx.notify();
        }
    }

    pub fn pointer_world(&self) -> Option<Vec2> {
        self.pointer_world
    }

    fn toggle_motion_playback(&mut self, cx: &mut Context<Self>) {
        self.motion.toggle_playback(Instant::now());
        cx.notify();
    }

    fn restart_motion_playback(&mut self, cx: &mut Context<Self>) {
        self.motion.restart(Instant::now());
        cx.notify();
    }

    fn scrub_motion_at(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let bounds = self.timeline_bounds.get();
        let width = f32::from(bounds.size.width).max(1.0);
        let progress = (f32::from(position.x - bounds.origin.x) / width).clamp(0.0, 1.0);
        self.motion.scrub(&self.document, progress, Instant::now());
        cx.notify();
    }

    fn on_timeline_down(
        &mut self,
        event: &MouseDownEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.timeline_scrubbing = true;
        self.scrub_motion_at(event.position, cx);
        cx.stop_propagation();
    }

    fn on_timeline_move(
        &mut self,
        event: &MouseMoveEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.timeline_scrubbing && event.dragging() {
            self.scrub_motion_at(event.position, cx);
            cx.stop_propagation();
        }
    }

    fn on_timeline_up(
        &mut self,
        _event: &MouseUpEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.timeline_scrubbing = false;
        cx.stop_propagation();
    }

    fn sync_images(&mut self, document: &Document) {
        let paths = document
            .nodes
            .values()
            .filter_map(|node| node.image_path.as_ref())
            .filter(|path| !path.starts_with("http://") && !path.starts_with("https://"))
            .cloned()
            .collect::<HashSet<_>>();
        self.images.retain(|path, _| paths.contains(path));
        for path in paths {
            if self.images.contains_key(&path) {
                continue;
            }
            if let Some(image) = load_render_image(Path::new(&path)) {
                self.images.insert(path, image);
            }
        }
    }

    fn sync_gradient_fills(
        &mut self,
        document: &Document,
        motion_frames: &HashMap<NodeId, MotionFrame>,
    ) {
        let mut active = HashSet::new();
        for node in document.nodes.values() {
            for (index, paint) in node.style.fills.iter().enumerate() {
                if matches!(
                    paint,
                    Paint::LinearGradient { .. } | Paint::RadialGradient { .. }
                ) {
                    let key = (node.id.clone(), index);
                    active.insert(key.clone());
                    let opacity = node_opacity(document, node, motion_frames);
                    let alpha = (opacity * 255.0).round() as u8;
                    if self
                        .gradient_fills
                        .get(&key)
                        .is_some_and(|raster| raster.alpha == alpha)
                    {
                        continue;
                    }
                    if let Some(image) = render_gradient_image(paint, alpha as f32 / 255.0) {
                        self.gradient_fills
                            .insert(key, GradientRaster { alpha, image });
                    }
                }
            }
        }
        self.gradient_fills.retain(|key, _| active.contains(key));
    }

    fn sync_rotated_images(&mut self, document: &Document) {
        self.rotated_images.clear();
        for node in document.nodes.values() {
            if node.kind != NodeKind::Image || node.rotation.abs() <= f32::EPSILON {
                continue;
            }
            let Some(path) = node.image_path.as_deref() else {
                continue;
            };
            if path.starts_with("http://") || path.starts_with("https://") {
                continue;
            }
            if let Some(image) = load_rotated_image(
                Path::new(path),
                node.layout.width.max(1.0) as f32 / node.layout.height.max(1.0) as f32,
                node.image_fit,
                node.rotation,
            ) {
                self.rotated_images.insert(node.id.clone(), image);
            }
        }
    }

    fn sync_image_opacity_variants(
        &mut self,
        document: &Document,
        motion_frames: &HashMap<NodeId, MotionFrame>,
    ) {
        let mut active = HashSet::new();
        for node in document
            .nodes
            .values()
            .filter(|node| node.kind == NodeKind::Image)
        {
            let opacity = node_opacity(document, node, motion_frames);
            let alpha = (opacity * 255.0).round() as u8;
            if alpha == 255 {
                continue;
            }
            let source = self
                .rotated_images
                .get(&node.id)
                .map(|rotated| rotated.image.clone())
                .or_else(|| {
                    node.image_path
                        .as_ref()
                        .and_then(|path| self.images.get(path))
                        .cloned()
                });
            let Some(source) = source else {
                continue;
            };
            active.insert(node.id.clone());
            if self
                .image_opacity_variants
                .get(&node.id)
                .is_some_and(|variant| {
                    variant.alpha == alpha && Arc::ptr_eq(&variant.source, &source)
                })
            {
                continue;
            }
            self.image_opacity_variants.insert(
                node.id.clone(),
                OpacityImage {
                    alpha,
                    image: render_image_with_opacity(&source, alpha as f32 / 255.0),
                    source,
                },
            );
        }
        self.image_opacity_variants
            .retain(|id, _| active.contains(id));
    }

    #[cfg(test)]
    fn sync_page_rasters(
        &mut self,
        document: &Document,
        motion_frames: &HashMap<NodeId, MotionFrame>,
        preview_bounds: &HashMap<NodeId, Bounds>,
    ) {
        self.sync_page_rasters_with_context(document, motion_frames, preview_bounds, None);
    }

    fn sync_page_rasters_with_context(
        &mut self,
        document: &Document,
        motion_frames: &HashMap<NodeId, MotionFrame>,
        preview_bounds: &HashMap<NodeId, Bounds>,
        mut cx: Option<&mut Context<Self>>,
    ) {
        let move_roots = match &self.drag {
            Some(DragState::Move { ids, .. }) if move_raster_can_split(document, ids) => {
                ids.clone()
            }
            _ => Vec::new(),
        };
        let uses_interaction_layers = !move_roots.is_empty() || self.text_edit.is_some();
        let preview_document = (!uses_interaction_layers)
            .then(|| raster_preview_document(document, preview_bounds, self.drag.as_ref()))
            .flatten();
        let raster_document = preview_document.as_ref().unwrap_or(document);
        let scale = raster_scale_for_zoom(self.camera.zoom, self.display_scale);
        let mut active = HashSet::new();
        let pages = raster_document
            .nodes
            .values()
            .filter(|node| node.is_root_frame())
            .map(|node| node.id.clone())
            .collect::<Vec<_>>();
        for page_id in pages {
            if !scene_raster::page_needs_raster(raster_document, &page_id, motion_frames) {
                continue;
            }
            let mut page_move_roots = move_roots
                .iter()
                .filter(|id| root_page_for_node(document, id).as_ref() == Some(&page_id))
                .cloned()
                .collect::<Vec<_>>();
            page_move_roots.sort_by(|left, right| left.as_str().cmp(right.as_str()));
            let mode =
                if !page_move_roots.is_empty() {
                    PageRasterMode::Move(page_move_roots)
                } else if let Some(edit) = self.text_edit.as_ref().filter(|edit| {
                    root_page_for_node(document, &edit.id).as_ref() == Some(&page_id)
                }) {
                    PageRasterMode::TextEdit(edit.id.clone())
                } else {
                    PageRasterMode::Full
                };
            let mut motion_key = motion_frames
                .iter()
                .filter(|(id, _)| {
                    root_page_for_node(raster_document, id).as_ref() == Some(&page_id)
                })
                .map(|(id, frame)| (id.clone(), frame.clone()))
                .collect::<Vec<_>>();
            motion_key.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
            let geometry = raster_geometry_key(raster_document, &page_id);
            let generation = self.page_generations.get(&page_id).copied().unwrap_or(0);
            let key = PageRasterKey {
                generation,
                scale_bits: scale.to_bits(),
                motion_frames: motion_key.clone(),
                geometry: geometry.clone(),
                mode: mode.clone(),
            };
            active.insert(page_id.clone());
            let content_matches = self.page_rasters.get(&page_id).is_some_and(|cached| {
                cached.generation == generation
                    && cached.motion_frames == motion_key
                    && cached.geometry == geometry
                    && cached.mode == mode
            });
            if content_matches
                && self
                    .page_rasters
                    .get(&page_id)
                    .is_some_and(|cached| cached.scale >= scale)
            {
                continue;
            }
            let source_document = if matches!(mode, PageRasterMode::Full) {
                raster_document.clone()
            } else {
                document.clone()
            };
            if content_matches {
                if let Some(cx) = cx.as_deref_mut() {
                    self.schedule_page_raster(
                        source_document,
                        page_id.clone(),
                        motion_frames.clone(),
                        key,
                        cx,
                    );
                }
                continue;
            }
            self.page_raster_jobs.remove(&page_id);
            let rendered =
                render_page_raster(&source_document, &page_id, motion_frames, scale, &mode);
            match rendered {
                Ok((pixels, overlay)) => {
                    self.page_rasters
                        .insert(page_id, page_raster_from_pixels(key, pixels, overlay));
                }
                Err(_) => {
                    self.page_rasters.remove(&page_id);
                }
            }
        }
        self.page_rasters.retain(|id, _| active.contains(id));
        self.page_raster_jobs.retain(|id, _| active.contains(id));
    }

    fn schedule_page_raster(
        &mut self,
        document: Document,
        page_id: NodeId,
        motion_frames: HashMap<NodeId, MotionFrame>,
        key: PageRasterKey,
        cx: &mut Context<Self>,
    ) {
        if self
            .page_raster_jobs
            .get(&page_id)
            .is_some_and(|job| job.key == key)
        {
            return;
        }
        let job_page_id = page_id.clone();
        let job_key = key.clone();
        let task = cx.spawn(async move |this, cx| {
            let render_page_id = job_page_id.clone();
            let render_key = job_key.clone();
            let rendered = cx
                .background_executor()
                .spawn(async move {
                    render_page_raster(
                        &document,
                        &render_page_id,
                        &motion_frames,
                        f32::from_bits(render_key.scale_bits),
                        &render_key.mode,
                    )
                })
                .await;
            this.update(cx, |this, cx| {
                let is_current = this
                    .page_raster_jobs
                    .get(&job_page_id)
                    .is_some_and(|job| job.key == job_key);
                if !is_current {
                    return;
                }
                this.page_raster_jobs.remove(&job_page_id);
                if let Ok((pixels, overlay)) = rendered {
                    this.page_rasters.insert(
                        job_page_id.clone(),
                        page_raster_from_pixels(job_key, pixels, overlay),
                    );
                    cx.notify();
                }
            })
            .ok();
        });
        self.page_raster_jobs
            .insert(page_id, PageRasterJob { key, _task: task });
    }

    fn viewport_local(&self, position: Point<Pixels>) -> Vec2 {
        let viewport = self.viewport.get();
        Vec2::new(
            f32::from(position.x - viewport.origin.x) as f64,
            f32::from(position.y - viewport.origin.y) as f64,
        )
    }

    fn preview_world_at(&self, screen: Vec2, all_bounds: &HashMap<NodeId, Bounds>) -> Option<Vec2> {
        let Some(overlay) = self.preview_overlay.as_ref() else {
            return Some(self.camera.screen_to_world(screen));
        };
        let overlay_bounds = all_bounds.get(overlay).copied()?;
        let viewport = self.viewport.get();
        let overlay_width = (overlay_bounds.width * self.camera.zoom).max(1.0);
        let overlay_height = (overlay_bounds.height * self.camera.zoom).max(1.0);
        let scale = 1.0_f64
            .min(f32::from(viewport.size.width) as f64 * 0.86 / overlay_width)
            .min(f32::from(viewport.size.height) as f64 * 0.86 / overlay_height);
        let viewport_center = Vec2::new(
            f32::from(viewport.size.width) as f64 * 0.5,
            f32::from(viewport.size.height) as f64 * 0.5,
        );
        let overlay_center = self.camera.world_to_screen(Vec2::new(
            overlay_bounds.x + overlay_bounds.width * 0.5,
            overlay_bounds.y + overlay_bounds.height * 0.5,
        ));
        let original_screen = Vec2::new(
            overlay_center.x + (screen.x - viewport_center.x) / scale,
            overlay_center.y + (screen.y - viewport_center.y) / scale,
        );
        let world = self.camera.screen_to_world(original_screen);
        overlay_bounds.contains(world).then_some(world)
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let screen = self.viewport_local(event.position);
        let world = self.camera.screen_to_world(screen);
        self.pointer_world = Some(world);
        let all_bounds = &self.world_bounds;

        if self.preview {
            if event.button == MouseButton::Left {
                let Some(preview_world) = self.preview_world_at(screen, all_bounds) else {
                    cx.emit(CanvasEvent::OverlayCloseRequested);
                    cx.stop_propagation();
                    return;
                };
                let hit = hit_test_with_motion(
                    &self.document,
                    all_bounds,
                    &self.paint_order,
                    preview_world,
                    self.motion.frames(),
                );
                self.pressed = hit.clone();
                self.focused = hit.clone();
                if let Some(id) = hit {
                    cx.emit(CanvasEvent::PreviewTriggered {
                        id,
                        trigger: if event.click_count >= 2 {
                            PreviewTrigger::DoubleClick
                        } else {
                            PreviewTrigger::Click
                        },
                    });
                }
                cx.stop_propagation();
                cx.notify();
            }
            return;
        }

        if event.button == MouseButton::Right {
            cx.emit(CanvasEvent::ContextMenuRequested {
                position: event.position,
                world,
                hit: hit_test(&self.document, all_bounds, &self.paint_order, world),
            });
            cx.stop_propagation();
            return;
        }

        if !matches!(event.button, MouseButton::Left | MouseButton::Middle) {
            return;
        }

        if event.button == MouseButton::Middle || self.tool == CanvasTool::Hand || self.space_pan {
            self.drag = Some(DragState::Pan {
                start_screen: screen,
                start_pan: self.camera.pan,
            });
            cx.stop_propagation();
            return;
        }

        if self.tool.draws() {
            self.drag = Some(DragState::Create {
                tool: self.tool,
                start_world: world,
                current_world: world,
            });
            cx.stop_propagation();
            return;
        }

        let editor_geometries = visual_geometries(
            &self.document,
            all_bounds,
            self.motion.frames(),
            self.drag.as_ref(),
        );
        if let Some((id, badge)) = hit_layout_badge(
            world,
            &self.selection,
            &self.document,
            all_bounds,
            &editor_geometries,
            self.camera.zoom,
        ) {
            let node = self.document.nodes.get(&id).expect("selected layout node");
            match badge.kind {
                LayoutBadgeKind::Gap(direction) => {
                    self.drag = Some(DragState::LayoutGap {
                        id,
                        direction,
                        start_world: world,
                        start_gap: node.layout.gap,
                        current_gap: node.layout.gap,
                        padding: node.layout.padding,
                    });
                }
                LayoutBadgeKind::Padding(edge) => {
                    self.drag = Some(DragState::LayoutPadding {
                        id,
                        edge,
                        start_world: world,
                        gap: node.layout.gap,
                        start_padding: node.layout.padding,
                        current_padding: node.layout.padding,
                        container: all_bounds[&node.id],
                    });
                }
            }
            cx.stop_propagation();
            cx.notify();
            return;
        }

        if let Some(geometry) = hit_rotation_handle(
            world,
            &self.selection,
            &editor_geometries,
            HANDLE_SCREEN_PX / self.camera.zoom,
            ROTATION_HANDLE_SCREEN_PX / self.camera.zoom,
        ) {
            let center = geometry.center();
            let ids = top_level_selection(&self.selection, &self.document);
            let originals = ids
                .iter()
                .filter_map(|id| {
                    self.document
                        .nodes
                        .get(id)
                        .map(|node| (id.clone(), node.rotation))
                })
                .collect::<HashMap<_, _>>();
            let transform = multi_transform(&ids, &self.document, all_bounds, &editor_geometries);
            let bounds = transform.clone().map(|members| MultiRotateBounds {
                current: members
                    .members
                    .iter()
                    .map(|(id, member)| (id.clone(), member.original))
                    .collect(),
                members,
            });
            self.drag = Some(DragState::Rotate {
                center,
                start_angle: angle_from(center, world),
                current: originals.clone(),
                originals,
                bounds,
            });
            cx.stop_propagation();
            return;
        }

        if let Some((handle, group, basis)) = hit_resize_handle(
            world,
            &self.selection,
            all_bounds,
            &editor_geometries,
            HANDLE_SCREEN_PX / self.camera.zoom,
        ) {
            let ids = top_level_selection(&self.selection, &self.document);
            let originals = ids
                .iter()
                .filter_map(|id| {
                    all_bounds
                        .get(id)
                        .copied()
                        .map(|bounds| (id.clone(), bounds))
                })
                .collect::<HashMap<_, _>>();
            let multi = multi_transform(&ids, &self.document, all_bounds, &editor_geometries);
            self.drag = Some(DragState::Resize {
                start_world: world,
                handle,
                basis,
                originals: originals.clone(),
                group,
                multi,
                current: originals,
            });
            cx.stop_propagation();
            return;
        }

        if let Some(hit) = hit_test(&self.document, all_bounds, &self.paint_order, world) {
            if event.click_count >= 2 {
                if let Some(node) = self.document.nodes.get(&hit) {
                    match node.kind {
                        NodeKind::Text => cx.emit(CanvasEvent::BeginTextEdit(hit)),
                        NodeKind::Image => cx.emit(CanvasEvent::ChooseImage(hit)),
                        _ => {}
                    }
                }
                return;
            }
            let mut selection = self.selection.clone();
            if event.modifiers.shift {
                if let Some(index) = selection.iter().position(|id| id == &hit) {
                    selection.remove(index);
                } else {
                    selection.push(hit.clone());
                }
            } else if !selection.contains(&hit) {
                selection = vec![hit.clone()];
            }
            self.selection = selection.clone();
            cx.emit(CanvasEvent::SelectionChanged(selection));

            let ids = top_level_selection(&self.selection, &self.document);
            let originals = ids
                .iter()
                .filter_map(|id| {
                    all_bounds
                        .get(id)
                        .copied()
                        .map(|bounds| (id.clone(), bounds))
                })
                .collect();
            self.drag = Some(DragState::Move {
                start_world: world,
                ids,
                originals,
                delta: Vec2::default(),
                duplicate: event.modifiers.alt,
            });
        } else {
            if !event.modifiers.shift {
                self.selection.clear();
                cx.emit(CanvasEvent::SelectionChanged(Vec::new()));
            }
            self.drag = Some(DragState::Marquee {
                start_world: world,
                current_world: world,
            });
        }
        cx.stop_propagation();
        cx.notify();
    }

    fn on_mouse_move(
        &mut self,
        event: &MouseMoveEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let screen = self.viewport_local(event.position);
        let world = self.camera.screen_to_world(screen);
        self.pointer_world = Some(world);
        let all_bounds = &self.world_bounds;
        if self.preview {
            let preview_world = self.preview_world_at(screen, all_bounds);
            self.pointer_world = preview_world;
            let hit = preview_world.and_then(|world| {
                hit_test_with_motion(
                    &self.document,
                    all_bounds,
                    &self.paint_order,
                    world,
                    self.motion.frames(),
                )
            });
            if hit != self.hovered {
                if let Some(id) = self.hovered.take() {
                    cx.emit(CanvasEvent::PreviewTriggered {
                        id,
                        trigger: PreviewTrigger::HoverEnd,
                    });
                }
                if let Some(id) = hit.clone() {
                    cx.emit(CanvasEvent::PreviewTriggered {
                        id,
                        trigger: PreviewTrigger::Hover,
                    });
                }
                self.hovered = hit;
                cx.notify();
            }
            return;
        }
        if !event.dragging() && event.pressed_button != Some(MouseButton::Middle) {
            return;
        }
        let editor_geometries =
            visual_geometries(&self.document, all_bounds, self.motion.frames(), None);
        let (snap_bounds, snap_originals) = match &self.drag {
            Some(DragState::Move { ids, .. }) => (
                editor_geometries
                    .iter()
                    .filter(|(id, _)| {
                        !ids.iter()
                            .any(|root| is_descendant_or_self(id, root, &self.document))
                    })
                    .map(|(id, geometry)| (id.clone(), geometry.aabb))
                    .collect(),
                ids.iter()
                    .filter_map(|id| {
                        editor_geometries
                            .get(id)
                            .map(|geometry| (id.clone(), geometry.aabb))
                    })
                    .collect(),
            ),
            _ => (all_bounds.clone(), HashMap::new()),
        };
        self.guides.clear();

        match self.drag.as_mut() {
            Some(DragState::Pan {
                start_screen,
                start_pan,
            }) => {
                self.camera.pan = Vec2::new(
                    start_pan.x + screen.x - start_screen.x,
                    start_pan.y + screen.y - start_screen.y,
                );
                cx.emit(CanvasEvent::CameraChanged(self.camera));
            }
            Some(DragState::Move {
                start_world,
                ids,
                delta,
                ..
            }) => {
                let mut raw = Vec2::new(world.x - start_world.x, world.y - start_world.y);
                if event.modifiers.shift {
                    if raw.x.abs() >= raw.y.abs() {
                        raw.y = 0.0;
                    } else {
                        raw.x = 0.0;
                    }
                }
                let (snapped, guides) =
                    snap_move(raw, ids, &snap_originals, &snap_bounds, self.camera.zoom);
                *delta = snapped;
                self.guides = guides;
            }
            Some(DragState::Resize {
                start_world,
                handle,
                basis,
                originals,
                group,
                multi,
                current,
            }) => {
                let delta =
                    basis.project(Vec2::new(world.x - start_world.x, world.y - start_world.y));
                let resized_group = if event.modifiers.shift {
                    resize_bounds_with_aspect(*group, *handle, delta)
                } else {
                    resize_bounds(*group, *handle, delta)
                };
                *current = multi.as_ref().map_or_else(
                    || scale_group(originals, *group, resized_group),
                    |multi| scale_multi_transform(multi, *group, resized_group),
                );
            }
            Some(DragState::Rotate {
                center,
                start_angle,
                originals,
                current,
                bounds,
            }) => {
                let mut delta = angle_delta(*start_angle, angle_from(*center, world));
                if event.modifiers.shift {
                    delta = (delta / 15.0).round() * 15.0;
                }
                *current = originals
                    .iter()
                    .map(|(id, rotation)| (id.clone(), normalize_degrees(*rotation + delta as f32)))
                    .collect();
                if let Some(bounds) = bounds {
                    bounds.current = rotate_multi_transform(&bounds.members, *center, delta);
                }
            }
            Some(DragState::LayoutGap {
                direction,
                start_world,
                start_gap,
                current_gap,
                ..
            }) => {
                let delta = match direction {
                    FlexDirection::Row => world.x - start_world.x,
                    FlexDirection::Column => world.y - start_world.y,
                };
                *current_gap = (*start_gap as f64 + delta).max(0.0) as f32;
            }
            Some(DragState::LayoutPadding {
                edge,
                start_world,
                start_padding,
                current_padding,
                container,
                ..
            }) => {
                let delta = Vec2::new(world.x - start_world.x, world.y - start_world.y);
                *current_padding = resized_padding(
                    *start_padding,
                    *edge,
                    delta,
                    container.width,
                    container.height,
                );
            }
            Some(DragState::Marquee { current_world, .. }) => *current_world = world,
            Some(DragState::Create {
                start_world,
                current_world,
                ..
            }) => {
                *current_world = if event.modifiers.shift {
                    let dx = world.x - start_world.x;
                    let dy = world.y - start_world.y;
                    let extent = dx.abs().max(dy.abs());
                    Vec2::new(
                        start_world.x + extent.copysign(dx),
                        start_world.y + extent.copysign(dy),
                    )
                } else {
                    world
                };
            }
            None => return,
        }
        if let Some(DragState::Move { ids, .. }) = &self.drag {
            if let [id] = ids.as_slice() {
                if let Some(guide) =
                    flow_drop_guide(&self.document, &self.paint_order, id, world, all_bounds)
                {
                    self.guides.push(guide);
                }
            }
        }
        cx.notify();
    }

    fn on_mouse_up(&mut self, event: &MouseUpEvent, _window: &mut Window, cx: &mut Context<Self>) {
        if !matches!(event.button, MouseButton::Left | MouseButton::Middle) {
            return;
        }
        if self.preview {
            if event.button == MouseButton::Left && self.pressed.take().is_some() {
                cx.notify();
            }
            return;
        }
        let drop_world = self
            .camera
            .screen_to_world(self.viewport_local(event.position));
        let drag = self.drag.take();
        self.guides.clear();
        match drag {
            Some(DragState::Move {
                ids,
                delta,
                duplicate,
                ..
            }) if delta.x.abs() > f64::EPSILON || delta.y.abs() > f64::EPSILON => {
                cx.emit(CanvasEvent::MoveCommitted {
                    ids,
                    dx: delta.x,
                    dy: delta.y,
                    duplicate,
                    drop_world,
                });
            }
            Some(DragState::Resize { current, .. }) => {
                let mut members = current.into_iter().collect::<Vec<_>>();
                members.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
                cx.emit(CanvasEvent::TransformCommitted {
                    bounds: members,
                    rotations: Vec::new(),
                });
            }
            Some(DragState::Rotate {
                current, bounds, ..
            }) => {
                let mut transformed_bounds = bounds
                    .map(|bounds| bounds.current.into_iter().collect::<Vec<_>>())
                    .unwrap_or_default();
                transformed_bounds.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
                let mut rotations = current.into_iter().collect::<Vec<_>>();
                rotations.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
                cx.emit(CanvasEvent::TransformCommitted {
                    bounds: transformed_bounds,
                    rotations,
                });
            }
            Some(DragState::LayoutGap {
                id,
                current_gap,
                padding,
                ..
            }) => cx.emit(CanvasEvent::LayoutMetricsChanged {
                id,
                gap: current_gap,
                padding,
            }),
            Some(DragState::LayoutPadding {
                id,
                gap,
                current_padding,
                ..
            }) => cx.emit(CanvasEvent::LayoutMetricsChanged {
                id,
                gap,
                padding: current_padding,
            }),
            Some(DragState::Marquee {
                start_world,
                current_world,
            }) => {
                let marquee = normalized_bounds(start_world, current_world);
                let all_bounds = &self.world_bounds;
                let geometries =
                    visual_geometries(&self.document, all_bounds, self.motion.frames(), None);
                let mut selection = selectable_nodes(&self.document)
                    .into_iter()
                    .filter(|id| {
                        geometries.get(id).is_some_and(|geometry| {
                            quad_intersects_bounds(geometry.corners, marquee)
                        })
                    })
                    .collect::<Vec<_>>();
                selection.sort_by(|left, right| left.as_str().cmp(right.as_str()));
                self.selection = selection.clone();
                cx.emit(CanvasEvent::SelectionChanged(selection));
            }
            Some(DragState::Create {
                tool,
                start_world,
                current_world,
            }) => {
                let bounds = defaulted_create_bounds(tool, start_world, current_world);
                cx.emit(CanvasEvent::CreateCommitted { tool, bounds });
            }
            _ => {}
        }
        cx.notify();
    }

    fn on_mouse_exit(
        &mut self,
        _event: &MouseExitEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(id) = self.hovered.take() {
            cx.emit(CanvasEvent::PreviewTriggered {
                id,
                trigger: PreviewTrigger::HoverEnd,
            });
        }
        self.pressed = None;
        cx.notify();
    }

    fn on_scroll(
        &mut self,
        event: &ScrollWheelEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.preview {
            return;
        }
        let delta = event.delta.pixel_delta(px(20.));
        let local = self.viewport_local(event.position);
        apply_scroll_delta(
            &mut self.camera,
            local,
            Vec2::new(f32::from(delta.x) as f64, f32::from(delta.y) as f64),
            event.modifiers.control || event.modifiers.platform,
        );
        cx.emit(CanvasEvent::CameraChanged(self.camera));
        cx.stop_propagation();
        cx.notify();
    }

    fn on_pinch(&mut self, event: &PinchEvent, _window: &mut Window, cx: &mut Context<Self>) {
        if self.preview {
            return;
        }
        let local = self.viewport_local(event.position);
        apply_pinch_delta(&mut self.camera, local, event.delta as f64);
        cx.emit(CanvasEvent::CameraChanged(self.camera));
        cx.stop_propagation();
        cx.notify();
    }

    fn preview_bounds(&self) -> HashMap<NodeId, Bounds> {
        let mut bounds = self.world_bounds.clone();
        match &self.drag {
            Some(DragState::Move {
                ids,
                originals,
                delta,
                ..
            }) => {
                for id in ids {
                    if let Some(original) = originals.get(id) {
                        translate_subtree(&self.document, id, delta.x, delta.y, &mut bounds);
                        bounds.insert(
                            id.clone(),
                            Bounds::new(
                                original.x + delta.x,
                                original.y + delta.y,
                                original.width,
                                original.height,
                            ),
                        );
                    }
                }
            }
            Some(DragState::Resize { current, .. }) => {
                bounds.extend(current.iter().map(|(id, bounds)| (id.clone(), *bounds)));
            }
            Some(DragState::Rotate {
                bounds: Some(current),
                ..
            }) => {
                bounds.extend(
                    current
                        .current
                        .iter()
                        .map(|(id, bounds)| (id.clone(), *bounds)),
                );
            }
            _ => {}
        }
        bounds
    }
}

fn raster_preview_document(
    document: &Document,
    preview_bounds: &HashMap<NodeId, Bounds>,
    drag: Option<&DragState>,
) -> Option<Document> {
    let mut preview = document.clone();
    match drag? {
        DragState::Move { ids, .. } => {
            for id in ids {
                apply_preview_node_bounds(&mut preview, id, preview_bounds);
            }
        }
        DragState::Resize { current, .. } => {
            for id in current.keys() {
                apply_preview_node_bounds(&mut preview, id, preview_bounds);
            }
        }
        DragState::Rotate {
            current, bounds, ..
        } => {
            if let Some(bounds) = bounds {
                for id in bounds.current.keys() {
                    apply_preview_node_bounds(&mut preview, id, preview_bounds);
                }
            }
            for (id, rotation) in current {
                if let Some(node) = preview.nodes.get_mut(id) {
                    node.rotation = *rotation;
                }
            }
        }
        DragState::LayoutGap {
            id, current_gap, ..
        } => {
            preview.nodes.get_mut(id)?.layout.gap = *current_gap;
        }
        DragState::LayoutPadding {
            id,
            current_padding,
            ..
        } => {
            preview.nodes.get_mut(id)?.layout.padding = *current_padding;
        }
        DragState::Pan { .. } | DragState::Marquee { .. } | DragState::Create { .. } => {
            return None;
        }
    }
    Some(preview)
}

fn move_raster_can_split(document: &Document, roots: &[NodeId]) -> bool {
    if roots.is_empty() {
        return false;
    }
    let roots = roots.iter().cloned().collect::<HashSet<_>>();
    let has_blend = |node: &Node| {
        node.style
            .blend_mode
            .as_deref()
            .is_some_and(|mode| mode != "normal")
    };
    for node in document.nodes.values() {
        let mut current = Some(&node.id);
        while let Some(id) = current {
            if roots.contains(id) {
                if has_blend(node) {
                    return false;
                }
                break;
            }
            current = document
                .nodes
                .get(id)
                .and_then(|candidate| candidate.parent_id.as_ref());
        }
    }
    for root in &roots {
        let mut current = document
            .nodes
            .get(root)
            .and_then(|node| node.parent_id.as_ref());
        while let Some(id) = current {
            let Some(node) = document.nodes.get(id) else {
                break;
            };
            if has_blend(node) {
                return false;
            }
            current = node.parent_id.as_ref();
        }
    }
    true
}

fn apply_preview_node_bounds(
    document: &mut Document,
    id: &NodeId,
    preview_bounds: &HashMap<NodeId, Bounds>,
) {
    let Some(target) = preview_bounds.get(id).copied() else {
        return;
    };
    let parent_origin = document
        .nodes
        .get(id)
        .and_then(|node| node.parent_id.as_ref())
        .and_then(|parent| preview_bounds.get(parent))
        .map_or(Vec2::default(), |bounds| Vec2::new(bounds.x, bounds.y));
    if let Some(node) = document.nodes.get_mut(id) {
        node.layout.x = target.x - parent_origin.x;
        node.layout.y = target.y - parent_origin.y;
        node.layout.width = target.width;
        node.layout.height = target.height;
    }
}

fn raster_geometry_key(document: &Document, page_id: &NodeId) -> Vec<(NodeId, Layout, u32)> {
    let mut geometry = document
        .nodes
        .values()
        .filter(|node| root_page_for_node(document, &node.id).as_ref() == Some(page_id))
        .map(|node| {
            (
                node.id.clone(),
                node.layout.clone(),
                node.rotation.to_bits(),
            )
        })
        .collect::<Vec<_>>();
    geometry.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
    geometry
}

impl Render for NativeCanvas {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let now = Instant::now();
        self.display_scale = window.scale_factor().max(1.0);
        let preview_bounds = self.preview_bounds();
        let viewport_bounds = self.viewport.get();
        let in_view = in_view_nodes(
            &self.document,
            &preview_bounds,
            self.camera,
            viewport_bounds,
            self.preview_overlay.as_ref(),
        );
        let animating = self.motion.tick(
            &self.document,
            self.revision,
            self.preview,
            self.hovered.as_ref(),
            self.pressed.as_ref(),
            self.focused.as_ref(),
            &in_view,
            now,
            cx.reduce_motion(),
        );
        let motion_frames = self.motion.frames().clone();
        let document = self.document.clone();
        self.sync_gradient_fills(&document, &motion_frames);
        self.sync_image_opacity_variants(&document, &motion_frames);
        self.sync_page_rasters_with_context(&document, &motion_frames, &preview_bounds, Some(cx));
        let playback = self.motion.snapshot(&self.document);
        let trigger_state = active_trigger_state(
            &self.document,
            self.hovered.as_ref(),
            self.pressed.as_ref(),
            self.focused.as_ref(),
            &in_view,
        );
        if animating
            || viewport_bounds.size.width <= px(0.0)
            || viewport_bounds.size.height <= px(0.0)
        {
            window.request_animation_frame();
        }
        let paint_order = self.paint_order.clone();
        let camera = self.camera;
        let selection = self.selection.clone();
        let agent_nodes = self.agent_nodes.clone();
        let palette = self.palette;
        let guides = self.guides.clone();
        let images = self.images.clone();
        let image_opacity_variants = self.image_opacity_variants.clone();
        let gradient_fills = self.gradient_fills.clone();
        let rotated_images = self.rotated_images.clone();
        let page_rasters = self.page_rasters.clone();
        let drag = self.drag.clone();
        let viewport = self.viewport.clone();
        let preview = self.preview;
        let preview_overlay = self.preview_overlay.clone();
        let text_edit = self.text_edit.clone();
        let entity = cx.entity();
        let timeline_bounds = self.timeline_bounds.clone();

        div()
            .id("native-canvas")
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(palette.background)
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_down(MouseButton::Middle, cx.listener(Self::on_mouse_down))
            .on_mouse_down(MouseButton::Right, cx.listener(Self::on_mouse_down))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_exit(cx.listener(Self::on_mouse_exit))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up(MouseButton::Middle, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Middle, cx.listener(Self::on_mouse_up))
            .on_scroll_wheel(cx.listener(Self::on_scroll))
            .on_pinch(cx.listener(Self::on_pinch))
            .child(
                canvas(
                    move |bounds, window, _cx| {
                        viewport.set(bounds);
                        prepare_scene(
                            &document,
                            &paint_order,
                            &motion_frames,
                            &preview_bounds,
                            camera,
                            selection,
                            agent_nodes,
                            guides,
                            drag,
                            palette,
                            &images,
                            &image_opacity_variants,
                            &gradient_fills,
                            &rotated_images,
                            &page_rasters,
                            preview,
                            preview_overlay,
                            text_edit,
                            bounds,
                            window,
                        )
                    },
                    paint_scene,
                )
                .size_full(),
            )
            .when(preview, |this| {
                this.child(preview_playback_controls(
                    entity,
                    playback,
                    trigger_state,
                    timeline_bounds,
                ))
            })
    }
}

fn active_trigger_state(
    document: &Document,
    hovered: Option<&NodeId>,
    pressed: Option<&NodeId>,
    focused: Option<&NodeId>,
    in_view: &HashSet<NodeId>,
) -> String {
    if pressed.is_some_and(|id| {
        document.nodes.get(id).is_some_and(|node| {
            node.visual_states
                .as_ref()
                .is_some_and(|states| states.press.is_some())
                || node
                    .animations
                    .iter()
                    .any(|animation| animation.trigger == AnimationTrigger::Press)
        })
    }) {
        return "Press active".into();
    }
    if hovered.is_some_and(|id| {
        document.nodes.get(id).is_some_and(|node| {
            node.visual_states
                .as_ref()
                .is_some_and(|states| states.hover.is_some())
                || node
                    .animations
                    .iter()
                    .any(|animation| animation.trigger == AnimationTrigger::Hover)
        })
    }) {
        return "Hover active".into();
    }
    if focused.is_some_and(|id| {
        document.nodes.get(id).is_some_and(|node| {
            node.visual_states
                .as_ref()
                .is_some_and(|states| states.focus.is_some())
        })
    }) {
        return "Focus active".into();
    }
    let visible = in_view
        .iter()
        .filter(|id| {
            document.nodes.get(*id).is_some_and(|node| {
                node.animations
                    .iter()
                    .any(|animation| animation.trigger == AnimationTrigger::InView)
            })
        })
        .count();
    if visible > 0 {
        format!("In view · {visible}")
    } else {
        "Load".into()
    }
}

fn preview_playback_button(
    entity: Entity<NativeCanvas>,
    id: &'static str,
    label: impl Into<SharedString>,
    action: fn(&mut NativeCanvas, &mut Context<NativeCanvas>),
) -> impl IntoElement {
    div()
        .id(id)
        .h(px(24.0))
        .px(px(8.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(6.0))
        .bg(rgba(0x2a, 0x2a, 0x2e, 0xff))
        .text_size(px(10.0))
        .text_color(rgba(0xe8, 0xe8, 0xec, 0xff))
        .cursor_pointer()
        .hover(|style| style.bg(rgba(0x3a, 0x3a, 0x40, 0xff)))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            entity.update(cx, action);
        })
        .child(label.into())
}

fn preview_playback_controls(
    entity: Entity<NativeCanvas>,
    playback: motion::PlaybackSnapshot,
    trigger_state: String,
    timeline_bounds: Rc<Cell<GpBounds<Pixels>>>,
) -> impl IntoElement {
    let down = entity.clone();
    let moved = entity.clone();
    let up = entity.clone();
    let track_bounds = timeline_bounds.clone();
    div()
        .id("native-motion-controls")
        .absolute()
        .left(relative(0.5))
        .ml(px(-218.0))
        .bottom(px(68.0))
        .w(px(436.0))
        .h(px(38.0))
        .px(px(7.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        .rounded(px(10.0))
        .border_1()
        .border_color(rgba(0x4a, 0x4a, 0x50, 0xff))
        .bg(rgba(0x18, 0x18, 0x1b, 0xf2))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .child(preview_playback_button(
            entity.clone(),
            "native-motion-play",
            if playback.playing { "Pause" } else { "Play" },
            NativeCanvas::toggle_motion_playback,
        ))
        .child(preview_playback_button(
            entity.clone(),
            "native-motion-restart",
            "Restart",
            NativeCanvas::restart_motion_playback,
        ))
        .child(
            div()
                .id("native-motion-scrubber")
                .relative()
                .w(px(156.0))
                .h(px(20.0))
                .cursor_pointer()
                .on_mouse_down(MouseButton::Left, move |event, window, cx| {
                    down.update(cx, |canvas, cx| canvas.on_timeline_down(event, window, cx));
                })
                .on_mouse_move(move |event, window, cx| {
                    moved.update(cx, |canvas, cx| canvas.on_timeline_move(event, window, cx));
                })
                .on_mouse_up(MouseButton::Left, move |event, window, cx| {
                    up.update(cx, |canvas, cx| canvas.on_timeline_up(event, window, cx));
                })
                .on_mouse_up_out(MouseButton::Left, {
                    let up = entity.clone();
                    move |event, window, cx| {
                        up.update(cx, |canvas, cx| canvas.on_timeline_up(event, window, cx));
                    }
                })
                .child(
                    div()
                        .absolute()
                        .left_0()
                        .right_0()
                        .top(px(8.0))
                        .h(px(4.0))
                        .rounded(px(2.0))
                        .bg(rgba(0x3a, 0x3a, 0x40, 0xff)),
                )
                .child(
                    div()
                        .absolute()
                        .left_0()
                        .top(px(8.0))
                        .w(relative(playback.progress))
                        .h(px(4.0))
                        .rounded(px(2.0))
                        .bg(rgba(0x7a, 0xa2, 0xf7, 0xff)),
                )
                .child(
                    div()
                        .absolute()
                        .left(relative(playback.progress))
                        .top(px(5.0))
                        .ml(px(-5.0))
                        .size(px(10.0))
                        .rounded(px(5.0))
                        .bg(rgba(0xff, 0xff, 0xff, 0xff)),
                )
                .child(
                    canvas(
                        move |bounds, _, _| {
                            track_bounds.set(bounds);
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .inset_0()
                    .size_full(),
                ),
        )
        .child(
            div()
                .w(px(58.0))
                .text_size(px(9.0))
                .text_color(rgba(0xa8, 0xa8, 0xb0, 0xff))
                .child(format!(
                    "{:.1}/{:.1}s",
                    playback.elapsed_ms / 1000.0,
                    playback.duration_ms / 1000.0
                )),
        )
        .child(
            div()
                .flex_1()
                .text_size(px(9.0))
                .text_color(rgba(0xc4, 0xb5, 0xfd, 0xff))
                .child(trigger_state),
        )
}

#[derive(Clone)]
struct PreparedText {
    line: ShapedLine,
    origin: Point<Pixels>,
    line_height: Pixels,
    align: GpTextAlign,
    width: Pixels,
    clip: GpBounds<Pixels>,
    selection: Option<GpBounds<Pixels>>,
    caret: Option<GpBounds<Pixels>>,
    rotation: f32,
    rotation_center: Point<Pixels>,
    svg: Option<SharedString>,
    svg_color: Hsla,
}

#[derive(Clone)]
struct PreparedVectorPath {
    fill: Option<(GpPath<Pixels>, Hsla)>,
    stroke: Option<(GpPath<Pixels>, Hsla)>,
}

#[derive(Clone)]
struct RotatedImage {
    image: Arc<RenderImage>,
    width_ratio: f32,
    height_ratio: f32,
}

#[derive(Clone)]
struct GradientRaster {
    alpha: u8,
    image: Arc<RenderImage>,
}

#[derive(Clone)]
struct OpacityImage {
    alpha: u8,
    image: Arc<RenderImage>,
    source: Arc<RenderImage>,
}

#[derive(Clone)]
struct PageRaster {
    generation: u64,
    scale: f32,
    motion_frames: Vec<(NodeId, MotionFrame)>,
    geometry: Vec<(NodeId, Layout, u32)>,
    mode: PageRasterMode,
    image: Arc<RenderImage>,
    overlay: Option<Arc<RenderImage>>,
}

#[derive(Clone, Debug, PartialEq)]
struct PageRasterKey {
    generation: u64,
    scale_bits: u32,
    motion_frames: Vec<(NodeId, MotionFrame)>,
    geometry: Vec<(NodeId, Layout, u32)>,
    mode: PageRasterMode,
}

struct PageRasterJob {
    key: PageRasterKey,
    _task: Task<()>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PageRasterMode {
    Full,
    Move(Vec<NodeId>),
    TextEdit(NodeId),
}

fn render_page_raster(
    document: &Document,
    page_id: &NodeId,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    scale: f32,
    mode: &PageRasterMode,
) -> Result<(image::RgbaImage, Option<image::RgbaImage>), String> {
    match mode {
        PageRasterMode::Move(roots) => {
            scene_raster::render_page_layers(document, page_id, motion_frames, scale, roots)
                .map(|(background, overlay)| (background, Some(overlay)))
        }
        PageRasterMode::TextEdit(id) => scene_raster::render_page_without_subtrees(
            document,
            page_id,
            motion_frames,
            scale,
            std::slice::from_ref(id),
        )
        .map(|background| (background, None)),
        PageRasterMode::Full => scene_raster::render_page(document, page_id, motion_frames, scale)
            .map(|background| (background, None)),
    }
}

fn page_raster_from_pixels(
    key: PageRasterKey,
    pixels: image::RgbaImage,
    overlay: Option<image::RgbaImage>,
) -> PageRaster {
    let image = Arc::new(RenderImage::new(smallvec::smallvec![image::Frame::new(
        pixels,
    )]));
    let overlay = overlay.map(|pixels| {
        Arc::new(RenderImage::new(smallvec::smallvec![image::Frame::new(
            pixels,
        )]))
    });
    PageRaster {
        generation: key.generation,
        scale: f32::from_bits(key.scale_bits),
        motion_frames: key.motion_frames,
        geometry: key.geometry,
        mode: key.mode,
        image,
        overlay,
    }
}

#[derive(Clone)]
struct PreparedNode {
    kind: NodeKind,
    shape_kind: ShapeKind,
    bounds: GpBounds<Pixels>,
    corners_points: [Point<Pixels>; 4],
    clip: GpBounds<Pixels>,
    fills: Vec<PreparedFill>,
    border: Option<(Hsla, Pixels, BorderStyle)>,
    corners: GpCorners<Pixels>,
    text: Vec<PreparedText>,
    image: Option<Arc<RenderImage>>,
    image_bounds: Option<GpBounds<Pixels>>,
    image_overlay: Option<PreparedImageOverlay>,
    image_fit: ImageFit,
    shadows: Vec<BoxShadow>,
    vector_paths: Vec<PreparedVectorPath>,
    rotation: f32,
    overlay_root: bool,
}

#[derive(Clone)]
struct PreparedImageOverlay {
    image: Arc<RenderImage>,
    bounds: GpBounds<Pixels>,
    clip: GpBounds<Pixels>,
}

#[derive(Clone)]
enum PreparedFill {
    Background(Background),
    Image(Arc<RenderImage>),
}

struct PreparedGuideLabel {
    line: ShapedLine,
    origin: Point<Pixels>,
    background: GpBounds<Pixels>,
}

struct PreparedLayoutBadge {
    bounds: GpBounds<Pixels>,
    line: ShapedLine,
    origin: Point<Pixels>,
    metric: bool,
}

struct PreparedSelection {
    corners: [Point<Pixels>; 4],
    handles: [Point<Pixels>; 8],
}

struct PreparedScene {
    nodes: Vec<PreparedNode>,
    labels: Vec<PreparedText>,
    selection: Vec<PreparedSelection>,
    rotation_handle: Option<(Point<Pixels>, Point<Pixels>)>,
    agents: Vec<[Point<Pixels>; 4]>,
    guides: Vec<(GuideAxis, Pixels, Pixels, Pixels)>,
    guide_labels: Vec<PreparedGuideLabel>,
    layout_badges: Vec<PreparedLayoutBadge>,
    marquee: Option<GpBounds<Pixels>>,
    create: Option<GpBounds<Pixels>>,
    overlay_scrim: bool,
    palette: CanvasPalette,
    viewport: GpBounds<Pixels>,
}

fn in_view_nodes(
    document: &Document,
    world_bounds: &HashMap<NodeId, Bounds>,
    camera: Camera,
    viewport: GpBounds<Pixels>,
    preview_overlay: Option<&NodeId>,
) -> HashSet<NodeId> {
    if viewport.size.width <= px(0.0) || viewport.size.height <= px(0.0) {
        return HashSet::new();
    }
    let overlay_transform = preview_overlay.and_then(|overlay| {
        let bounds = world_bounds.get(overlay).copied()?;
        let screen = world_to_screen(bounds, camera, viewport);
        let width = f32::from(screen.size.width).max(1.0);
        let height = f32::from(screen.size.height).max(1.0);
        let scale = 1.0_f32
            .min(f32::from(viewport.size.width) * 0.86 / width)
            .min(f32::from(viewport.size.height) * 0.86 / height);
        Some((screen.center(), scale))
    });

    let geometries = visual_geometries(document, world_bounds, &HashMap::new(), None);
    world_bounds
        .iter()
        .filter_map(|(id, bounds)| {
            let node = document.nodes.get(id)?;
            if node_or_ancestor_hidden(document, node) {
                return None;
            }
            let visual_bounds = geometries.get(id).map_or(*bounds, |geometry| geometry.aabb);
            let mut screen = world_to_screen(visual_bounds, camera, viewport);
            if preview_overlay
                .is_some_and(|overlay| id == overlay || is_descendant_of(document, id, overlay))
            {
                if let Some((overlay_center, scale)) = overlay_transform {
                    screen =
                        overlay_screen_bounds(screen, overlay_center, scale, viewport.center());
                }
            }
            screen.intersects(&viewport).then(|| id.clone())
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn prepare_scene(
    document: &Document,
    paint_order: &[NodeId],
    motion_frames: &HashMap<NodeId, MotionFrame>,
    world_bounds: &HashMap<NodeId, Bounds>,
    camera: Camera,
    selection: Vec<NodeId>,
    agent_nodes: Vec<NodeId>,
    guides: Vec<Guide>,
    drag: Option<DragState>,
    palette: CanvasPalette,
    images: &HashMap<String, Arc<RenderImage>>,
    image_opacity_variants: &HashMap<NodeId, OpacityImage>,
    gradient_fills: &HashMap<(NodeId, usize), GradientRaster>,
    rotated_images: &HashMap<NodeId, RotatedImage>,
    page_rasters: &HashMap<NodeId, PageRaster>,
    preview: bool,
    preview_overlay: Option<NodeId>,
    text_edit: Option<NativeTextEdit>,
    viewport: GpBounds<Pixels>,
    window: &mut Window,
) -> PreparedScene {
    let mut nodes = Vec::new();
    let mut labels = Vec::new();
    let geometries = visual_geometries(document, world_bounds, motion_frames, drag.as_ref());
    let overlay_transform = preview_overlay.as_ref().and_then(|overlay| {
        let bounds = world_bounds.get(overlay).copied()?;
        let screen = world_to_screen(bounds, camera, viewport);
        let width = f32::from(screen.size.width).max(1.0);
        let height = f32::from(screen.size.height).max(1.0);
        let scale = 1.0_f32
            .min(f32::from(viewport.size.width) * 0.86 / width)
            .min(f32::from(viewport.size.height) * 0.86 / height);
        Some((screen.center(), scale))
    });
    for id in paint_order_with_overlay(document, paint_order, preview_overlay.as_ref()) {
        let Some(node) = document.nodes.get(&id) else {
            continue;
        };
        let raster_page_id =
            root_page_for_node(document, &id).filter(|page_id| page_rasters.contains_key(page_id));
        if raster_page_id.as_ref().is_some_and(|page_id| {
            page_id != &id && text_edit.as_ref().is_none_or(|edit| edit.id != id)
        }) {
            continue;
        }
        let page_raster = page_rasters.get(&id);
        let Some(geometry) = geometries.get(&id).copied() else {
            continue;
        };
        let belongs_to_overlay = preview_overlay
            .as_ref()
            .is_some_and(|overlay| &id == overlay || is_descendant_of(document, &id, overlay));
        let mut screen = world_to_screen(geometry.bounds, camera, viewport);
        let mut screen_corners = geometry
            .corners
            .map(|corner| world_point_to_screen(corner, camera, viewport));
        let mut screen_aabb = world_to_screen(geometry.aabb, camera, viewport);
        let overlay_scale = if belongs_to_overlay {
            if let Some((overlay_center, scale)) = overlay_transform {
                screen = overlay_screen_bounds(screen, overlay_center, scale, viewport.center());
                screen_aabb =
                    overlay_screen_bounds(screen_aabb, overlay_center, scale, viewport.center());
                screen_corners = screen_corners.map(|corner| {
                    overlay_screen_point(corner, overlay_center, scale, viewport.center())
                });
                scale
            } else {
                1.0
            }
        } else {
            1.0
        };
        let motion = motion_frames.get(&id);
        if !screen_aabb.intersects(&viewport) || node_or_ancestor_hidden(document, node) {
            continue;
        }
        let clip_world = inherited_clip(document, world_bounds, node);
        let clip = clip_world
            .map(|clip| {
                let clip = world_to_screen(clip, camera, viewport);
                if belongs_to_overlay {
                    if let Some((overlay_center, scale)) = overlay_transform {
                        overlay_screen_bounds(clip, overlay_center, scale, viewport.center())
                    } else {
                        clip
                    }
                } else {
                    clip
                }
                .intersect(&viewport)
            })
            .unwrap_or(viewport);
        let opacity = node_opacity(document, node, motion_frames);
        let motion_fill = motion.and_then(|motion| motion.fill);
        let text_fill = text_paint_color(node, motion_fill);
        let fills = if page_raster.is_some() {
            Vec::new()
        } else if node.kind == NodeKind::Text {
            vec![PreparedFill::Background(
                color_hsla(fallback_fill(node.kind), opacity).into(),
            )]
        } else {
            motion_fill
                .map(|color| vec![PreparedFill::Background(color_hsla(color, opacity).into())])
                .unwrap_or_else(|| node_fills(node, opacity, gradient_fills))
        };
        let border = page_raster
            .is_none()
            .then(|| {
                motion
                    .and_then(|motion| motion.stroke.as_ref())
                    .or(node.style.stroke.as_ref())
                    .map(|stroke| {
                        (
                            color_hsla(stroke.color, opacity),
                            px((stroke.width * camera.zoom as f32).max(0.5)),
                            match stroke.style {
                                loora_engine::StrokeStyle::Solid => BorderStyle::Solid,
                                loora_engine::StrokeStyle::Dashed => BorderStyle::Dashed,
                                loora_engine::StrokeStyle::Dotted => BorderStyle::Dashed,
                            },
                        )
                    })
            })
            .flatten();
        let scale = camera.zoom as f32 * overlay_scale;
        let motion_corners = motion.map_or(node.style.corners, |motion| motion.corners);
        let corners = if page_raster.is_some() {
            GpCorners::all(px(0.0))
        } else if node.shape_kind == ShapeKind::Ellipse {
            GpCorners::all(screen.size.width.min(screen.size.height) / 2.0)
        } else {
            GpCorners {
                top_left: px(motion_corners.tl * scale),
                top_right: px(motion_corners.tr * scale),
                bottom_right: px(motion_corners.br * scale),
                bottom_left: px(motion_corners.bl * scale),
            }
        };
        let rotation = geometry.rotation;
        let text = if page_raster.is_some() {
            Vec::new()
        } else {
            prepare_node_text(
                node,
                screen,
                clip,
                scale,
                (text_fill, opacity),
                text_edit.as_ref().filter(|edit| edit.id == id),
                rotation,
                window,
            )
        };
        if node.is_root_frame()
            && root_page_label_is_frontmost(
                &id,
                document,
                world_bounds,
                paint_order,
                1.0 / camera.zoom.max(0.01),
            )
        {
            let label = SharedString::from(node.name.clone());
            let run = TextRun {
                len: label.len(),
                font: font(".SystemUIFont"),
                color: palette.page_label,
                ..Default::default()
            };
            labels.push(PreparedText {
                line: window
                    .text_system()
                    .shape_line(label, px(11.), &[run], None),
                origin: point(screen.origin.x, screen.origin.y - px(22.)),
                line_height: px(14.),
                align: GpTextAlign::Left,
                width: screen.size.width,
                clip: viewport,
                selection: None,
                caret: None,
                rotation: 0.0,
                rotation_center: screen.center(),
                svg: None,
                svg_color: palette.page_label,
            });
        }
        let shadows = if page_raster.is_some() {
            Vec::new()
        } else {
            node.style
                .shadows
                .iter()
                .map(|shadow| BoxShadow {
                    color: color_hsla(shadow.color, opacity),
                    offset: point(px(shadow.x * scale), px(shadow.y * scale)),
                    blur_radius: px((shadow.blur * scale).max(0.0)),
                    spread_radius: px(shadow.spread * scale),
                    inset: shadow.inset,
                })
                .collect()
        };
        let vector_paths = if page_raster.is_none() && node.kind == NodeKind::Vector {
            prepare_vector_paths(node, screen, opacity, rotation)
        } else {
            Vec::new()
        };
        let rotated_image = (page_raster.is_none()
            && !matches!(&drag, Some(DragState::Rotate { .. }))
            && motion.map_or(0.0, |motion| motion.rotate).abs() <= f32::EPSILON)
            .then(|| rotated_images.get(&id))
            .flatten();
        let image = page_raster.map(|raster| raster.image.clone()).or_else(|| {
            image_opacity_variants
                .get(&id)
                .map(|variant| variant.image.clone())
                .or_else(|| rotated_image.map(|rotated| rotated.image.clone()))
                .or_else(|| {
                    node.image_path
                        .as_ref()
                        .and_then(|path| images.get(path))
                        .cloned()
                })
        });
        let image_bounds = rotated_image.map(|rotated| {
            let expanded = size(
                screen.size.width * rotated.width_ratio,
                screen.size.height * rotated.height_ratio,
            );
            GpBounds::new(
                point(
                    screen.center().x - expanded.width / 2.0,
                    screen.center().y - expanded.height / 2.0,
                ),
                expanded,
            )
        });
        let image_overlay = page_raster
            .and_then(|raster| raster.overlay.as_ref().map(|image| (raster, image)))
            .map(|(raster, image)| {
                let delta = match (&raster.mode, &drag) {
                    (PageRasterMode::Move(roots), Some(DragState::Move { delta, .. }))
                        if !roots.contains(&id) =>
                    {
                        *delta
                    }
                    _ => Vec2::default(),
                };
                let bounds = GpBounds::new(
                    screen.origin
                        + point(
                            px((delta.x * camera.zoom) as f32),
                            px((delta.y * camera.zoom) as f32),
                        ),
                    screen.size,
                );
                PreparedImageOverlay {
                    image: image.clone(),
                    bounds,
                    clip: screen.intersect(&clip),
                }
            });
        nodes.push(PreparedNode {
            kind: page_raster.map_or(node.kind, |_| NodeKind::Image),
            shape_kind: node.shape_kind,
            bounds: screen,
            corners_points: screen_corners,
            clip,
            fills,
            border,
            corners,
            text,
            image,
            image_bounds,
            image_overlay,
            image_fit: if page_raster.is_some() || rotated_image.is_some() {
                ImageFit::Fill
            } else {
                node.image_fit
            },
            shadows,
            vector_paths,
            rotation,
            overlay_root: preview_overlay.as_ref() == Some(&id),
        });
    }

    let layout_badges = if preview {
        Vec::new()
    } else {
        layout_badges(
            &selection,
            document,
            world_bounds,
            &geometries,
            camera.zoom,
        )
            .map(|(layout_id, mut badges)| {
                match &drag {
                    Some(DragState::LayoutGap {
                        id, current_gap, ..
                    }) if id == &layout_id => {
                        for badge in &mut badges {
                            if matches!(badge.kind, LayoutBadgeKind::Gap(_)) {
                                badge.label = format!("G {current_gap:.0}");
                            }
                        }
                    }
                    Some(DragState::LayoutPadding {
                        id,
                        edge,
                        current_padding,
                        ..
                    }) if id == &layout_id => {
                        let value = match edge {
                            PaddingEdge::Top => current_padding.top,
                            PaddingEdge::Right => current_padding.right,
                            PaddingEdge::Bottom => current_padding.bottom,
                            PaddingEdge::Left => current_padding.left,
                        };
                        for badge in &mut badges {
                            if matches!(badge.kind, LayoutBadgeKind::Padding(candidate) if candidate == *edge)
                            {
                                badge.label = format!("{} {value:.0}", padding_edge_label(*edge));
                            }
                        }
                    }
                    _ => {}
                }
                badges
                    .into_iter()
                    .map(|badge| {
                        let bounds = world_to_screen(badge.bounds, camera, viewport);
                        let text = SharedString::from(badge.label);
                        let run = TextRun {
                            len: text.len(),
                            font: font(".SystemUIFont"),
                            color: rgba(0xff, 0xff, 0xff, 0xff),
                            ..Default::default()
                        };
                        let line = window
                            .text_system()
                            .shape_line(text, px(9.0), &[run], None);
                        let origin = point(
                            bounds.center().x - line.width() / 2.0,
                            bounds.center().y - px(5.5),
                        );
                        PreparedLayoutBadge {
                            bounds,
                            line,
                            origin,
                            metric: true,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let selection_geometry = selection_visual_geometry(&selection, &geometries);
    let rotation_handle = selection_geometry.map(|geometry| {
        let (handle, anchor) = geometry.rotation_handle(ROTATION_HANDLE_SCREEN_PX / camera.zoom);
        (
            world_point_to_screen(handle, camera, viewport),
            world_point_to_screen(anchor, camera, viewport),
        )
    });
    let selection = selection_geometry
        .into_iter()
        .map(|geometry| PreparedSelection {
            corners: geometry
                .corners
                .map(|corner| world_point_to_screen(corner, camera, viewport)),
            handles: geometry
                .handles()
                .map(|handle| world_point_to_screen(handle, camera, viewport)),
        })
        .collect();
    let agents = agent_nodes
        .iter()
        .filter_map(|id| geometries.get(id))
        .map(|geometry| {
            geometry
                .corners
                .map(|corner| world_point_to_screen(corner, camera, viewport))
        })
        .collect();
    let guide_labels = guides
        .iter()
        .filter_map(|guide| {
            let value = guide.label?;
            let text = SharedString::from(format!("{value:.0}"));
            let run = TextRun {
                len: text.len(),
                font: font(".SystemUIFont"),
                color: rgba(0xff, 0xff, 0xff, 0xff),
                ..Default::default()
            };
            let line = window
                .text_system()
                .shape_line(text, px(10.0), &[run], None);
            let (x, y) = match guide.axis {
                GuideAxis::Vertical => (
                    world_x(guide.position, camera, viewport) + px(6.0),
                    (world_y(guide.from, camera, viewport) + world_y(guide.to, camera, viewport))
                        / 2.0,
                ),
                GuideAxis::Horizontal => (
                    (world_x(guide.from, camera, viewport) + world_x(guide.to, camera, viewport))
                        / 2.0,
                    world_y(guide.position, camera, viewport) - px(18.0),
                ),
            };
            let origin = point(x, y);
            let background = GpBounds::new(
                origin - point(px(4.0), px(2.0)),
                size(line.width() + px(8.0), px(15.0)),
            );
            Some(PreparedGuideLabel {
                line,
                origin,
                background,
            })
        })
        .collect();
    let guides = guides
        .into_iter()
        .map(|guide| match guide.axis {
            GuideAxis::Vertical => (
                guide.axis,
                world_x(guide.position, camera, viewport),
                world_y(guide.from, camera, viewport),
                world_y(guide.to, camera, viewport),
            ),
            GuideAxis::Horizontal => (
                guide.axis,
                world_y(guide.position, camera, viewport),
                world_x(guide.from, camera, viewport),
                world_x(guide.to, camera, viewport),
            ),
        })
        .collect();
    let marquee = match &drag {
        Some(DragState::Marquee {
            start_world,
            current_world,
        }) => Some(world_to_screen(
            normalized_bounds(*start_world, *current_world),
            camera,
            viewport,
        )),
        _ => None,
    };
    let create = match &drag {
        Some(DragState::Create {
            start_world,
            current_world,
            ..
        }) => Some(world_to_screen(
            normalized_bounds(*start_world, *current_world),
            camera,
            viewport,
        )),
        _ => None,
    };
    PreparedScene {
        nodes,
        labels,
        selection,
        rotation_handle,
        agents,
        guides,
        guide_labels,
        layout_badges,
        marquee,
        create,
        overlay_scrim: preview && preview_overlay.is_some(),
        palette,
        viewport,
    }
}

fn paint_scene(_bounds: GpBounds<Pixels>, scene: PreparedScene, window: &mut Window, cx: &mut App) {
    window.with_content_mask(
        Some(ContentMask {
            bounds: scene.viewport,
        }),
        |window| {
            for label in &scene.labels {
                let _ = label.line.paint(
                    label.origin,
                    label.line_height,
                    label.align,
                    Some(label.width),
                    window,
                    cx,
                );
            }
            let mut scrim_painted = false;
            for node in &scene.nodes {
                if scene.overlay_scrim && node.overlay_root && !scrim_painted {
                    window.paint_quad(fill(scene.viewport, rgba(0x00, 0x00, 0x00, 0x94)));
                    scrim_painted = true;
                }
                window.with_content_mask(Some(ContentMask { bounds: node.clip }), |window| {
                    paint_node(node, window);
                    for text in &node.text {
                        window.with_content_mask(
                            Some(ContentMask { bounds: text.clip }),
                            |window| {
                                if let Some(selection) = text.selection {
                                    window
                                        .paint_quad(fill(selection, rgba(0x4a, 0x86, 0xe8, 0x66)));
                                }
                                if let Some(svg) = &text.svg {
                                    let scale_factor = window.scale_factor();
                                    let radians = text.rotation.to_radians();
                                    let cos = radians.cos();
                                    let sin = radians.sin();
                                    let center_x = f32::from(text.rotation_center.x) * scale_factor;
                                    let center_y = f32::from(text.rotation_center.y) * scale_factor;
                                    let transform = TransformationMatrix {
                                        rotation_scale: [[cos, -sin], [sin, cos]],
                                        translation: [
                                            center_x - cos * center_x + sin * center_y,
                                            center_y - sin * center_x - cos * center_y,
                                        ],
                                    };
                                    let bounds = GpBounds::new(
                                        text.origin,
                                        size(text.width, text.line_height),
                                    );
                                    let _ = window.paint_svg(
                                        bounds,
                                        svg.clone(),
                                        Some(svg.as_bytes()),
                                        transform,
                                        text.svg_color,
                                        cx,
                                    );
                                } else {
                                    let _ = text.line.paint(
                                        text.origin,
                                        text.line_height,
                                        text.align,
                                        Some(text.width),
                                        window,
                                        cx,
                                    );
                                }
                                if let Some(caret) = text.caret {
                                    window.paint_quad(fill(caret, rgba(0xff, 0xff, 0xff, 0xff)));
                                }
                            },
                        );
                    }
                });
            }
            for corners in scene.agents {
                paint_dashed_polygon(corners, scene.palette.agent, window);
            }
            for selection in scene.selection {
                paint_selection(selection, scene.palette.selection, window);
            }
            for badge in scene.layout_badges {
                window.paint_quad(quad(
                    badge.bounds,
                    px(5.0),
                    if badge.metric {
                        rgba(0x2b, 0x18, 0x32, 0xf2)
                    } else {
                        rgba(0x1d, 0x1d, 0x20, 0xf2)
                    },
                    px(1.0),
                    if badge.metric {
                        scene.palette.guide
                    } else {
                        scene.palette.selection
                    },
                    BorderStyle::Solid,
                ));
                let _ =
                    badge
                        .line
                        .paint(badge.origin, px(11.0), GpTextAlign::Left, None, window, cx);
            }
            if let Some((handle, anchor)) = scene.rotation_handle {
                let mut builder = PathBuilder::stroke(px(1.0));
                builder.move_to(handle);
                builder.line_to(anchor);
                if let Ok(path) = builder.build() {
                    window.paint_path(path, scene.palette.selection);
                }
                window.paint_quad(quad(
                    GpBounds::new(handle - point(px(5.0), px(5.0)), size(px(10.0), px(10.0))),
                    px(5.0),
                    rgba(0xff, 0xff, 0xff, 0xff),
                    px(1.0),
                    scene.palette.selection,
                    BorderStyle::Solid,
                ));
            }
            for (axis, position, from, to) in scene.guides {
                let bounds = match axis {
                    GuideAxis::Vertical => GpBounds::from_corners(
                        point(position - px(0.5), from),
                        point(position + px(0.5), to),
                    ),
                    GuideAxis::Horizontal => GpBounds::from_corners(
                        point(from, position - px(0.5)),
                        point(to, position + px(0.5)),
                    ),
                };
                window.paint_quad(fill(bounds, scene.palette.guide));
            }
            for label in scene.guide_labels {
                window.paint_quad(quad(
                    label.background,
                    px(4.0),
                    scene.palette.guide,
                    px(0.0),
                    gpui::transparent_black(),
                    BorderStyle::Solid,
                ));
                let _ =
                    label
                        .line
                        .paint(label.origin, px(12.0), GpTextAlign::Left, None, window, cx);
            }
            if let Some(bounds) = scene.marquee {
                window.paint_quad(quad(
                    bounds,
                    px(0.),
                    rgba(0x7a, 0xa2, 0xf7, 0x18),
                    px(1.),
                    scene.palette.selection,
                    BorderStyle::Solid,
                ));
            }
            if let Some(bounds) = scene.create {
                window.paint_quad(quad(
                    bounds,
                    px(4.),
                    rgba(0x7a, 0xa2, 0xf7, 0x22),
                    px(1.),
                    scene.palette.selection,
                    BorderStyle::Dashed,
                ));
            }
        },
    );
}

fn paint_node(node: &PreparedNode, window: &mut Window) {
    window.paint_drop_shadows(node.bounds, node.corners, &node.shadows);

    if node.kind == NodeKind::Vector && !node.vector_paths.is_empty() {
        for path in &node.vector_paths {
            if let Some((path, fill)) = &path.fill {
                window.paint_path(path.clone(), *fill);
            }
            if let Some((path, stroke)) = &path.stroke {
                window.paint_path(path.clone(), *stroke);
            }
        }
        window.paint_inset_shadows(node.bounds, node.corners, &node.shadows);
        return;
    }

    if node.shape_kind == ShapeKind::Line {
        let mut builder =
            PathBuilder::stroke(node.border.map(|(_, width, _)| width).unwrap_or(px(1.0)));
        let start = rotate_point(
            point(node.bounds.left(), node.bounds.center().y),
            node.bounds.center(),
            node.rotation,
        );
        let end = rotate_point(
            point(node.bounds.right(), node.bounds.center().y),
            node.bounds.center(),
            node.rotation,
        );
        builder.move_to(start);
        builder.line_to(end);
        if let Ok(path) = builder.build() {
            let color = node
                .border
                .map(|(color, _, _)| color)
                .unwrap_or_else(|| rgba(0xff, 0xff, 0xff, 0xff));
            window.paint_path(path, color);
        }
        return;
    }

    let (border_color, border_width, border_style) =
        node.border
            .unwrap_or((gpui::transparent_black(), px(0.), BorderStyle::Solid));
    for fill in node.fills.iter().rev() {
        match fill {
            PreparedFill::Background(fill) => {
                if node.rotation.abs() > f32::EPSILON {
                    let mut builder = PathBuilder::fill();
                    builder.add_polygon(&node.corners_points, true);
                    if let Ok(path) = builder.build() {
                        window.paint_path(path, *fill);
                    }
                } else {
                    window.paint_quad(quad(
                        node.bounds,
                        node.corners,
                        *fill,
                        Edges::all(px(0.0)),
                        gpui::transparent_black(),
                        BorderStyle::Solid,
                    ));
                }
            }
            PreparedFill::Image(image) => {
                let _ = window.paint_image(
                    node.bounds,
                    node.bounds,
                    node.corners,
                    image.clone(),
                    0,
                    false,
                );
            }
        }
    }
    if border_width > px(0.0) {
        if node.rotation.abs() > f32::EPSILON {
            let mut builder = PathBuilder::stroke(border_width);
            builder.add_polygon(&node.corners_points, true);
            if let Ok(path) = builder.build() {
                window.paint_path(path, border_color);
            }
        } else {
            window.paint_quad(quad(
                node.bounds,
                node.corners,
                gpui::transparent_black(),
                Edges::all(border_width),
                border_color,
                border_style,
            ));
        }
    }

    if node.kind == NodeKind::Image {
        if let Some(image) = &node.image {
            let image_bounds = node
                .image_bounds
                .unwrap_or_else(|| fitted_image_bounds(node.bounds, image, node.image_fit));
            let clip_bounds = node.image_bounds.unwrap_or(node.bounds);
            let corners = if node.image_bounds.is_some() {
                GpCorners::all(px(0.0))
            } else {
                node.corners
            };
            let _ = window.paint_image(clip_bounds, image_bounds, corners, image.clone(), 0, false);
        } else {
            let inset = px(8.);
            let inner = GpBounds::from_corners(
                node.bounds.origin + point(inset, inset),
                node.bounds.bottom_right() - point(inset, inset),
            );
            window.paint_quad(outline(
                inner,
                rgba(0xff, 0xff, 0xff, 0x28),
                BorderStyle::Dashed,
            ));
        }
    }
    if let Some(overlay) = &node.image_overlay {
        window.with_content_mask(
            Some(ContentMask {
                bounds: overlay.clip,
            }),
            |window| {
                let _ = window.paint_image(
                    overlay.clip,
                    overlay.bounds,
                    GpCorners::all(px(0.0)),
                    overlay.image.clone(),
                    0,
                    false,
                );
            },
        );
    }
    window.paint_inset_shadows(node.bounds, node.corners, &node.shadows);
}

fn rotate_point(value: Point<Pixels>, center: Point<Pixels>, rotation: f32) -> Point<Pixels> {
    if rotation.abs() <= f32::EPSILON {
        return value;
    }
    let radians = rotation.to_radians();
    let cos = radians.cos();
    let sin = radians.sin();
    let x = f32::from(value.x - center.x);
    let y = f32::from(value.y - center.y);
    point(
        center.x + px(x * cos - y * sin),
        center.y + px(x * sin + y * cos),
    )
}

fn overlay_screen_bounds(
    bounds: GpBounds<Pixels>,
    overlay_center: Point<Pixels>,
    scale: f32,
    viewport_center: Point<Pixels>,
) -> GpBounds<Pixels> {
    GpBounds::new(
        point(
            viewport_center.x + (bounds.origin.x - overlay_center.x) * scale,
            viewport_center.y + (bounds.origin.y - overlay_center.y) * scale,
        ),
        size(bounds.size.width * scale, bounds.size.height * scale),
    )
}

fn overlay_screen_point(
    value: Point<Pixels>,
    overlay_center: Point<Pixels>,
    scale: f32,
    viewport_center: Point<Pixels>,
) -> Point<Pixels> {
    point(
        viewport_center.x + (value.x - overlay_center.x) * scale,
        viewport_center.y + (value.y - overlay_center.y) * scale,
    )
}

fn fitted_image_bounds(
    bounds: GpBounds<Pixels>,
    image: &RenderImage,
    fit: ImageFit,
) -> GpBounds<Pixels> {
    if fit == ImageFit::Fill {
        return bounds;
    }
    let source = image.size(0);
    let source_width = i32::from(source.width).max(1) as f32;
    let source_height = i32::from(source.height).max(1) as f32;
    let target_width = f32::from(bounds.size.width).max(1.0);
    let target_height = f32::from(bounds.size.height).max(1.0);
    let scale = match fit {
        ImageFit::Cover => (target_width / source_width).max(target_height / source_height),
        ImageFit::Contain => (target_width / source_width).min(target_height / source_height),
        ImageFit::Fill => 1.0,
    };
    let image_size = size(px(source_width * scale), px(source_height * scale));
    GpBounds::new(
        point(
            bounds.center().x - image_size.width / 2.0,
            bounds.center().y - image_size.height / 2.0,
        ),
        image_size,
    )
}

fn paint_selection(selection: PreparedSelection, color: Hsla, window: &mut Window) {
    let mut builder = PathBuilder::stroke(px(1.0));
    builder.add_polygon(&selection.corners, true);
    if let Ok(path) = builder.build() {
        window.paint_path(path, color);
    }
    for position in selection.handles {
        window.paint_quad(quad(
            GpBounds::new(position - point(px(3.), px(3.)), size(px(6.), px(6.))),
            px(1.),
            rgba(0xff, 0xff, 0xff, 0xff),
            px(1.),
            color,
            BorderStyle::Solid,
        ));
    }
}

fn paint_dashed_polygon(corners: [Point<Pixels>; 4], color: Hsla, window: &mut Window) {
    const DASH: f32 = 5.0;
    const GAP: f32 = 3.0;
    for index in 0..4 {
        let start = corners[index];
        let end = corners[(index + 1) % 4];
        let dx = f32::from(end.x - start.x);
        let dy = f32::from(end.y - start.y);
        let length = (dx * dx + dy * dy).sqrt();
        if length <= f32::EPSILON {
            continue;
        }
        let mut offset = 0.0;
        while offset < length {
            let from = offset / length;
            let to = (offset + DASH).min(length) / length;
            let mut builder = PathBuilder::stroke(px(1.0));
            builder.move_to(point(start.x + px(dx * from), start.y + px(dy * from)));
            builder.line_to(point(start.x + px(dx * to), start.y + px(dy * to)));
            if let Ok(path) = builder.build() {
                window.paint_path(path, color);
            }
            offset += DASH + GAP;
        }
    }
}

fn prepare_vector_paths(
    node: &Node,
    bounds: GpBounds<Pixels>,
    opacity: f32,
    rotation: f32,
) -> Vec<PreparedVectorPath> {
    let view_box = parse_view_box(node.vector_view_box.as_deref().unwrap_or("0 0 100 100"));
    let scale = ((f32::from(bounds.size.width) / view_box.2 as f32).abs()
        + (f32::from(bounds.size.height) / view_box.3 as f32).abs())
        * 0.5;

    node.paths
        .iter()
        .filter_map(|vector| {
            let segments = PathParser::from(vector.d.as_str())
                .collect::<Result<Vec<_>, _>>()
                .ok()?;
            let fill = vector.fill.and_then(|color| {
                build_svg_path(&segments, bounds, view_box, rotation, PathBuilder::fill())
                    .map(|path| (path, color_hsla(color, opacity)))
            });
            let stroke = vector.stroke.and_then(|color| {
                let width = px(vector.stroke_width.unwrap_or(1.0).max(0.1) * scale.max(0.1));
                build_svg_path(
                    &segments,
                    bounds,
                    view_box,
                    rotation,
                    PathBuilder::stroke(width),
                )
                .map(|path| (path, color_hsla(color, opacity)))
            });
            (fill.is_some() || stroke.is_some()).then_some(PreparedVectorPath { fill, stroke })
        })
        .collect()
}

fn parse_view_box(value: &str) -> (f64, f64, f64, f64) {
    let values = value
        .split(|character: char| character.is_ascii_whitespace() || character == ',')
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<f64>().ok())
        .collect::<Vec<_>>();
    if values.len() == 4 && values[2].abs() > f64::EPSILON && values[3].abs() > f64::EPSILON {
        (values[0], values[1], values[2], values[3])
    } else {
        (0.0, 0.0, 100.0, 100.0)
    }
}

fn build_svg_path(
    segments: &[PathSegment],
    bounds: GpBounds<Pixels>,
    view_box: (f64, f64, f64, f64),
    rotation: f32,
    mut builder: PathBuilder,
) -> Option<GpPath<Pixels>> {
    let mut current = (0.0, 0.0);
    let mut subpath_start = current;
    let mut cubic_control = None;
    let mut quadratic_control = None;
    let mapped = |value: (f64, f64)| {
        let x = (value.0 - view_box.0) / view_box.2;
        let y = (value.1 - view_box.1) / view_box.3;
        rotate_point(
            point(
                bounds.origin.x + bounds.size.width * x as f32,
                bounds.origin.y + bounds.size.height * y as f32,
            ),
            bounds.center(),
            rotation,
        )
    };
    let resolve = |abs: bool, x: f64, y: f64, current: (f64, f64)| {
        if abs {
            (x, y)
        } else {
            (current.0 + x, current.1 + y)
        }
    };

    for segment in segments {
        match *segment {
            PathSegment::MoveTo { abs, x, y } => {
                current = resolve(abs, x, y, current);
                subpath_start = current;
                builder.move_to(mapped(current));
            }
            PathSegment::LineTo { abs, x, y } => {
                current = resolve(abs, x, y, current);
                builder.line_to(mapped(current));
            }
            PathSegment::HorizontalLineTo { abs, x } => {
                current.0 = if abs { x } else { current.0 + x };
                builder.line_to(mapped(current));
            }
            PathSegment::VerticalLineTo { abs, y } => {
                current.1 = if abs { y } else { current.1 + y };
                builder.line_to(mapped(current));
            }
            PathSegment::CurveTo {
                abs,
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => {
                let control_a = resolve(abs, x1, y1, current);
                let control_b = resolve(abs, x2, y2, current);
                let end = resolve(abs, x, y, current);
                builder.cubic_bezier_to(mapped(end), mapped(control_a), mapped(control_b));
                current = end;
                cubic_control = Some(control_b);
                quadratic_control = None;
                continue;
            }
            PathSegment::SmoothCurveTo { abs, x2, y2, x, y } => {
                let control_a = cubic_control
                    .map(|control| (2.0 * current.0 - control.0, 2.0 * current.1 - control.1))
                    .unwrap_or(current);
                let control_b = resolve(abs, x2, y2, current);
                let end = resolve(abs, x, y, current);
                builder.cubic_bezier_to(mapped(end), mapped(control_a), mapped(control_b));
                current = end;
                cubic_control = Some(control_b);
                quadratic_control = None;
                continue;
            }
            PathSegment::Quadratic { abs, x1, y1, x, y } => {
                let control = resolve(abs, x1, y1, current);
                let end = resolve(abs, x, y, current);
                builder.curve_to(mapped(end), mapped(control));
                current = end;
                quadratic_control = Some(control);
                cubic_control = None;
                continue;
            }
            PathSegment::SmoothQuadratic { abs, x, y } => {
                let control = quadratic_control
                    .map(|control| (2.0 * current.0 - control.0, 2.0 * current.1 - control.1))
                    .unwrap_or(current);
                let end = resolve(abs, x, y, current);
                builder.curve_to(mapped(end), mapped(control));
                current = end;
                quadratic_control = Some(control);
                cubic_control = None;
                continue;
            }
            PathSegment::EllipticalArc {
                abs,
                rx,
                ry,
                x_axis_rotation,
                large_arc,
                sweep,
                x,
                y,
            } => {
                let end = resolve(abs, x, y, current);
                let radius = point(
                    bounds.size.width * (rx / view_box.2).abs() as f32,
                    bounds.size.height * (ry / view_box.3).abs() as f32,
                );
                builder.arc_to(
                    radius,
                    px(x_axis_rotation as f32 + rotation),
                    large_arc,
                    sweep,
                    mapped(end),
                );
                current = end;
            }
            PathSegment::ClosePath { .. } => {
                builder.close();
                current = subpath_start;
            }
        }
        cubic_control = None;
        quadratic_control = None;
    }
    builder.build().ok()
}

fn prepare_node_text(
    node: &Node,
    bounds: GpBounds<Pixels>,
    clip: GpBounds<Pixels>,
    scale: f32,
    paint: (Option<Color>, f32),
    text_edit: Option<&NativeTextEdit>,
    rotation: f32,
    window: &mut Window,
) -> Vec<PreparedText> {
    if node.kind != NodeKind::Text {
        return Vec::new();
    }
    let typography = node.typography.clone().unwrap_or_default();
    let (color, opacity) = paint;
    let font_size = px((typography.size * scale).max(1.));
    let line_height = px(resolved_line_height(&typography).max(1.0) * scale);
    let align = match typography.align {
        EngineTextAlign::Left | EngineTextAlign::Justify => GpTextAlign::Left,
        EngineTextAlign::Center => GpTextAlign::Center,
        EngineTextAlign::Right => GpTextAlign::Right,
    };
    let text = if text_edit.is_some() {
        node.text.clone().unwrap_or_default()
    } else {
        node.display_text()
    };
    let mut byte_offset = 0;
    let mut char_offset = 0;
    text.split('\n')
        .enumerate()
        .map(|(index, line)| {
            let line_start = byte_offset;
            let line_end = line_start + line.len();
            byte_offset = line_end + 1;
            let line_start_char = char_offset;
            char_offset += line.chars().count() + 1;
            let shared = SharedString::from(line.to_owned());
            let runs = text_runs_for_line(node, &typography, line, line_start_char, color, opacity);
            let line = window
                .text_system()
                .shape_line(shared, font_size, &runs, None);
            let origin = point(
                bounds.origin.x,
                bounds.origin.y + line_height * index as f32,
            );
            let align_offset = match align {
                GpTextAlign::Left => px(0.0),
                GpTextAlign::Center => (bounds.size.width - line.width()).max(px(0.0)) / 2.0,
                GpTextAlign::Right => (bounds.size.width - line.width()).max(px(0.0)),
            };
            let selection = text_edit.and_then(|edit| {
                let (start, end) = if edit.anchor <= edit.caret {
                    (edit.anchor, edit.caret)
                } else {
                    (edit.caret, edit.anchor)
                };
                let start = start.max(line_start).min(line_end);
                let end = end.max(line_start).min(line_end);
                (start < end).then(|| {
                    let left = line.x_for_index(start - line_start);
                    let right = line.x_for_index(end - line_start);
                    GpBounds::from_corners(
                        point(origin.x + align_offset + left, origin.y),
                        point(origin.x + align_offset + right, origin.y + line_height),
                    )
                })
            });
            let caret = text_edit.and_then(|edit| {
                (edit.caret_visible && edit.caret >= line_start && edit.caret <= line_end).then(
                    || {
                        let x = line.x_for_index(edit.caret - line_start);
                        GpBounds::new(
                            point(origin.x + align_offset + x, origin.y),
                            size(px(1.0), line_height),
                        )
                    },
                )
            });
            let svg =
                should_use_text_svg(rotation, typography.letter_spacing, text_edit).then(|| {
                    SharedString::from(styled_text_svg(
                        line.text.as_ref(),
                        f32::from(bounds.size.width),
                        f32::from(line_height),
                        f32::from(font_size),
                        &typography.family,
                        typography.weight,
                        typography.align,
                        typography.letter_spacing * scale,
                    ))
                });
            PreparedText {
                line,
                origin,
                line_height,
                align,
                width: bounds.size.width,
                clip,
                selection,
                caret,
                rotation,
                rotation_center: bounds.center(),
                svg,
                svg_color: color_hsla(color.unwrap_or(typography.color), opacity),
            }
        })
        .collect()
}

fn resolved_line_height(typography: &loora_engine::Typography) -> f32 {
    typography.size * typography.line_height.unwrap_or(1.25)
}

fn root_page_label_is_frontmost(
    id: &NodeId,
    document: &Document,
    world_bounds: &HashMap<NodeId, Bounds>,
    paint_order: &[NodeId],
    tolerance: f64,
) -> bool {
    let Some(index) = paint_order.iter().position(|candidate| candidate == id) else {
        return true;
    };
    let Some(bounds) = world_bounds.get(id) else {
        return true;
    };
    !paint_order[index + 1..].iter().any(|candidate| {
        let Some(node) = document.nodes.get(candidate) else {
            return false;
        };
        let Some(other) = world_bounds.get(candidate) else {
            return false;
        };
        node.is_root_frame()
            && (other.x - bounds.x).abs() <= tolerance
            && (other.y - bounds.y).abs() <= tolerance
    })
}

fn text_paint_color(node: &Node, motion_fill: Option<Color>) -> Option<Color> {
    motion_fill.or_else(|| node.style.solid_fill())
}

fn should_use_text_svg(
    rotation: f32,
    letter_spacing: f32,
    text_edit: Option<&NativeTextEdit>,
) -> bool {
    text_edit.is_none() && (rotation.abs() > f32::EPSILON || letter_spacing.abs() > f32::EPSILON)
}

#[allow(clippy::too_many_arguments)]
fn styled_text_svg(
    text: &str,
    width: f32,
    height: f32,
    font_size: f32,
    family: &str,
    weight: u16,
    align: EngineTextAlign,
    letter_spacing: f32,
) -> String {
    let (x, anchor) = match align {
        EngineTextAlign::Left | EngineTextAlign::Justify => (0.0, "start"),
        EngineTextAlign::Center => (width * 0.5, "middle"),
        EngineTextAlign::Right => (width, "end"),
    };
    let escape = |value: &str| {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    };
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\"><text x=\"{x}\" y=\"{font_size}\" text-anchor=\"{anchor}\" font-family=\"{}\" font-size=\"{font_size}\" font-weight=\"{weight}\" letter-spacing=\"{letter_spacing}\" fill=\"white\">{}</text></svg>",
        escape(family),
        escape(text),
    )
}

fn text_runs_for_line(
    node: &Node,
    typography: &loora_engine::Typography,
    line: &str,
    line_start_char: usize,
    override_color: Option<Color>,
    opacity: f32,
) -> Vec<TextRun> {
    let line_chars = line.chars().count();
    let line_end_char = line_start_char + line_chars;
    let mut boundaries = vec![0, line_chars];
    for run in &node.text_runs {
        let start = run.start.max(line_start_char).min(line_end_char);
        let end = run.end.max(line_start_char).min(line_end_char);
        boundaries.push(start.saturating_sub(line_start_char));
        boundaries.push(end.saturating_sub(line_start_char));
    }
    boundaries.sort_unstable();
    boundaries.dedup();

    let byte_at_char = |index: usize| {
        line.char_indices()
            .nth(index)
            .map(|(byte, _)| byte)
            .unwrap_or(line.len())
    };
    let base_color = override_color.unwrap_or(typography.color);
    let mut runs = Vec::new();
    for range in boundaries.windows(2) {
        let local_start = range[0];
        let local_end = range[1];
        if local_start >= local_end {
            continue;
        }
        let global_start = line_start_char + local_start;
        let global_end = line_start_char + local_end;
        let styled = node
            .text_runs
            .iter()
            .rev()
            .find(|run| run.start <= global_start && run.end >= global_end);
        let patch = styled.and_then(|run| run.typography.as_ref());
        let family = patch
            .and_then(|patch| patch.family.as_deref())
            .unwrap_or(&typography.family);
        let mut text_font = font(if family == "System" {
            ".SystemUIFont"
        } else {
            family
        });
        text_font.weight = FontWeight(
            patch
                .and_then(|patch| patch.weight)
                .unwrap_or(typography.weight) as f32,
        );
        let color = styled.and_then(|run| run.color).unwrap_or(base_color);
        let decoration = patch
            .and_then(|patch| patch.decoration.as_deref())
            .map(str::to_owned)
            .unwrap_or_else(|| match typography.decoration {
                TextDecoration::None => "none".into(),
                TextDecoration::Underline => "underline".into(),
                TextDecoration::LineThrough => "line-through".into(),
            });
        let byte_start = byte_at_char(local_start);
        let byte_end = byte_at_char(local_end);
        runs.push(TextRun {
            len: byte_end - byte_start,
            font: text_font,
            color: color_hsla(color, opacity),
            underline: (decoration == "underline").then_some(UnderlineStyle {
                thickness: px(1.0),
                color: None,
                wavy: false,
            }),
            strikethrough: (decoration == "line-through").then_some(StrikethroughStyle {
                thickness: px(1.0),
                color: None,
            }),
            ..Default::default()
        });
    }
    if runs.is_empty() {
        let mut text_font = font(if typography.family == "System" {
            ".SystemUIFont"
        } else {
            typography.family.as_str()
        });
        text_font.weight = FontWeight(typography.weight as f32);
        runs.push(TextRun {
            len: line.len(),
            font: text_font,
            color: color_hsla(base_color, opacity),
            ..Default::default()
        });
    }
    runs
}

fn fallback_fill(kind: NodeKind) -> Color {
    match kind {
        NodeKind::Image => Color::rgb(0x2a, 0x2a, 0x2e),
        NodeKind::Vector => Color::rgba(0.7, 0.7, 0.75, 0.18),
        _ => Color::rgba(0.0, 0.0, 0.0, 0.0),
    }
}

fn node_fills(
    node: &Node,
    opacity: f32,
    gradients: &HashMap<(NodeId, usize), GradientRaster>,
) -> Vec<PreparedFill> {
    let fills = node
        .style
        .fills
        .iter()
        .enumerate()
        .filter_map(|(index, paint)| match paint {
            Paint::Solid { color, .. } => {
                Some(PreparedFill::Background(color_hsla(*color, opacity).into()))
            }
            Paint::LinearGradient { .. } | Paint::RadialGradient { .. } => gradients
                .get(&(node.id.clone(), index))
                .map(|raster| raster.image.clone())
                .map(PreparedFill::Image),
        })
        .collect::<Vec<_>>();
    if fills.is_empty() {
        vec![PreparedFill::Background(
            color_hsla(fallback_fill(node.kind), opacity).into(),
        )]
    } else {
        fills
    }
}

const GRADIENT_RASTER_SIZE: u32 = 192;

fn render_gradient_image(paint: &Paint, opacity: f32) -> Option<Arc<RenderImage>> {
    let mut raster = image::RgbaImage::new(GRADIENT_RASTER_SIZE, GRADIENT_RASTER_SIZE);
    for (x, y, pixel) in raster.enumerate_pixels_mut() {
        let u = x as f32 / (GRADIENT_RASTER_SIZE - 1) as f32;
        let v = y as f32 / (GRADIENT_RASTER_SIZE - 1) as f32;
        let color = match paint {
            Paint::LinearGradient { angle, stops } => {
                let radians = angle.to_radians();
                let dx = radians.sin();
                let dy = -radians.cos();
                let span = (dx.abs() + dy.abs()).max(f32::EPSILON);
                let offset = 0.5 + ((u - 0.5) * dx + (v - 0.5) * dy) / span;
                sample_gradient(stops, offset)
            }
            Paint::RadialGradient { cx, cy, stops, .. } => {
                let cx = normalize_gradient_position(*cx);
                let cy = normalize_gradient_position(*cy);
                let radius = [
                    (cx * cx + cy * cy).sqrt(),
                    ((1.0 - cx).powi(2) + cy.powi(2)).sqrt(),
                    (cx.powi(2) + (1.0 - cy).powi(2)).sqrt(),
                    ((1.0 - cx).powi(2) + (1.0 - cy).powi(2)).sqrt(),
                ]
                .into_iter()
                .fold(0.0_f32, f32::max)
                .max(f32::EPSILON);
                let offset =
                    (((u - cx).powi(2) + (v - cy).powi(2)).sqrt() / radius).clamp(0.0, 1.0);
                sample_gradient(stops, offset)
            }
            Paint::Solid { .. } => return None,
        }?;
        *pixel = image::Rgba([
            (color.b.clamp(0.0, 1.0) * 255.0).round() as u8,
            (color.g.clamp(0.0, 1.0) * 255.0).round() as u8,
            (color.r.clamp(0.0, 1.0) * 255.0).round() as u8,
            (color.a.clamp(0.0, 1.0) * opacity.clamp(0.0, 1.0) * 255.0).round() as u8,
        ]);
    }
    let frame = image::Frame::new(raster);
    Some(Arc::new(RenderImage::new(smallvec::smallvec![frame])))
}

fn normalize_gradient_position(value: f32) -> f32 {
    if value.abs() > 1.0 {
        value / 100.0
    } else {
        value
    }
    .clamp(0.0, 1.0)
}

fn sample_gradient(stops: &[loora_engine::GradientStop], offset: f32) -> Option<Color> {
    let first = stops.first()?;
    let last = stops.last()?;
    let offset = offset.clamp(0.0, 1.0);
    if offset <= first.offset {
        return Some(first.color);
    }
    for pair in stops.windows(2) {
        if offset <= pair[1].offset {
            let width = (pair[1].offset - pair[0].offset).max(f32::EPSILON);
            let progress = ((offset - pair[0].offset) / width).clamp(0.0, 1.0);
            return Some(Color::rgba(
                pair[0].color.r + (pair[1].color.r - pair[0].color.r) * progress,
                pair[0].color.g + (pair[1].color.g - pair[0].color.g) * progress,
                pair[0].color.b + (pair[1].color.b - pair[0].color.b) * progress,
                pair[0].color.a + (pair[1].color.a - pair[0].color.a) * progress,
            ));
        }
    }
    Some(last.color)
}

fn load_render_image(path: &Path) -> Option<Arc<RenderImage>> {
    let mut image = image::open(path).ok()?.into_rgba8();
    for pixel in image.as_mut().chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let frame = image::Frame::new(image);
    Some(Arc::new(RenderImage::new(smallvec::smallvec![frame])))
}

fn render_image_with_opacity(source: &Arc<RenderImage>, opacity: f32) -> Arc<RenderImage> {
    let opacity = opacity.clamp(0.0, 1.0);
    if opacity >= 1.0 - f32::EPSILON {
        return source.clone();
    }
    let frames = (0..source.frame_count())
        .filter_map(|index| {
            let dimensions = source.size(index);
            let width = i32::from(dimensions.width).max(0) as u32;
            let height = i32::from(dimensions.height).max(0) as u32;
            let mut bytes = source.as_bytes(index)?.to_vec();
            for pixel in bytes.chunks_exact_mut(4) {
                pixel[3] = (pixel[3] as f32 * opacity).round() as u8;
            }
            let buffer = image::RgbaImage::from_raw(width, height, bytes)?;
            Some(image::Frame::from_parts(buffer, 0, 0, source.delay(index)))
        })
        .collect::<Vec<_>>();
    if frames.is_empty() {
        source.clone()
    } else {
        Arc::new(RenderImage::new(frames))
    }
}

fn load_rotated_image(
    path: &Path,
    aspect_ratio: f32,
    fit: ImageFit,
    rotation: f32,
) -> Option<RotatedImage> {
    let source = image::open(path).ok()?.into_rgba8();
    let aspect_ratio = aspect_ratio.clamp(0.1, 10.0);
    let (base_width, base_height) = if aspect_ratio >= 1.0 {
        (384_u32, (384.0 / aspect_ratio).round().max(16.0) as u32)
    } else {
        ((384.0 * aspect_ratio).round().max(16.0) as u32, 384_u32)
    };
    let source_width = source.width().max(1) as f32;
    let source_height = source.height().max(1) as f32;
    let fit_scale = match fit {
        ImageFit::Cover => {
            (base_width as f32 / source_width).max(base_height as f32 / source_height)
        }
        ImageFit::Contain => {
            (base_width as f32 / source_width).min(base_height as f32 / source_height)
        }
        ImageFit::Fill => 0.0,
    };
    let (scaled_width, scaled_height) = if fit == ImageFit::Fill {
        (base_width, base_height)
    } else {
        (
            (source_width * fit_scale).round().max(1.0) as u32,
            (source_height * fit_scale).round().max(1.0) as u32,
        )
    };
    let scaled = image::imageops::resize(
        &source,
        scaled_width,
        scaled_height,
        image::imageops::FilterType::Lanczos3,
    );
    let mut fitted = image::RgbaImage::new(base_width, base_height);
    image::imageops::overlay(
        &mut fitted,
        &scaled,
        (base_width as i64 - scaled_width as i64) / 2,
        (base_height as i64 - scaled_height as i64) / 2,
    );
    let mut rotated = rotate_rgba(&fitted, rotation);
    let width_ratio = rotated.width() as f32 / base_width as f32;
    let height_ratio = rotated.height() as f32 / base_height as f32;
    for pixel in rotated.as_mut().chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let frame = image::Frame::new(rotated);
    Some(RotatedImage {
        image: Arc::new(RenderImage::new(smallvec::smallvec![frame])),
        width_ratio,
        height_ratio,
    })
}

fn rotate_rgba(source: &image::RgbaImage, rotation: f32) -> image::RgbaImage {
    let radians = rotation.to_radians();
    let cos = radians.cos();
    let sin = radians.sin();
    let width = source.width() as f32;
    let height = source.height() as f32;
    let output_width = (width * cos.abs() + height * sin.abs()).ceil().max(1.0) as u32;
    let output_height = (width * sin.abs() + height * cos.abs()).ceil().max(1.0) as u32;
    let source_center = ((width - 1.0) * 0.5, (height - 1.0) * 0.5);
    let output_center = (
        (output_width as f32 - 1.0) * 0.5,
        (output_height as f32 - 1.0) * 0.5,
    );
    image::RgbaImage::from_fn(output_width, output_height, |x, y| {
        let dx = x as f32 - output_center.0;
        let dy = y as f32 - output_center.1;
        let source_x = cos * dx + sin * dy + source_center.0;
        let source_y = -sin * dx + cos * dy + source_center.1;
        if source_x >= 0.0 && source_x < width && source_y >= 0.0 && source_y < height {
            *source.get_pixel(
                source_x.round().clamp(0.0, width - 1.0) as u32,
                source_y.round().clamp(0.0, height - 1.0) as u32,
            )
        } else {
            image::Rgba([0, 0, 0, 0])
        }
    })
}

fn rgba(r: u8, g: u8, b: u8, a: u8) -> Hsla {
    Rgba {
        r: r as f32 / 255.0,
        g: g as f32 / 255.0,
        b: b as f32 / 255.0,
        a: a as f32 / 255.0,
    }
    .into()
}

fn color_hsla(color: Color, opacity: f32) -> Hsla {
    Rgba {
        r: color.r,
        g: color.g,
        b: color.b,
        a: color.a * opacity,
    }
    .into()
}

fn node_opacity(
    document: &Document,
    node: &Node,
    motion_frames: &HashMap<NodeId, MotionFrame>,
) -> f32 {
    let mut opacity = 1.0;
    let mut current = Some(node);
    let mut visited = HashSet::new();
    while let Some(current_node) = current {
        if !visited.insert(current_node.id.clone()) {
            break;
        }
        opacity *= motion_frames
            .get(&current_node.id)
            .map_or(current_node.style.opacity, |motion| motion.opacity)
            .clamp(0.0, 1.0);
        current = current_node
            .parent_id
            .as_ref()
            .and_then(|parent_id| document.nodes.get(parent_id));
    }
    opacity.clamp(0.0, 1.0)
}

fn world_to_screen(bounds: Bounds, camera: Camera, viewport: GpBounds<Pixels>) -> GpBounds<Pixels> {
    let origin = camera.world_to_screen(Vec2::new(bounds.x, bounds.y));
    GpBounds::new(
        viewport.origin + point(px(origin.x as f32), px(origin.y as f32)),
        size(
            px((bounds.width * camera.zoom) as f32),
            px((bounds.height * camera.zoom) as f32),
        ),
    )
}

fn world_point_to_screen(value: Vec2, camera: Camera, viewport: GpBounds<Pixels>) -> Point<Pixels> {
    let screen = camera.world_to_screen(value);
    viewport.origin + point(px(screen.x as f32), px(screen.y as f32))
}

fn world_x(value: f64, camera: Camera, viewport: GpBounds<Pixels>) -> Pixels {
    viewport.origin.x + px((value * camera.zoom + camera.pan.x) as f32)
}

fn world_y(value: f64, camera: Camera, viewport: GpBounds<Pixels>) -> Pixels {
    viewport.origin.y + px((value * camera.zoom + camera.pan.y) as f32)
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Affine2 {
    xx: f64,
    xy: f64,
    yx: f64,
    yy: f64,
    tx: f64,
    ty: f64,
}

impl Affine2 {
    const IDENTITY: Self = Self {
        xx: 1.0,
        xy: 0.0,
        yx: 0.0,
        yy: 1.0,
        tx: 0.0,
        ty: 0.0,
    };

    fn translate(x: f64, y: f64) -> Self {
        Self {
            tx: x,
            ty: y,
            ..Self::IDENTITY
        }
    }

    fn rotate(degrees: f64) -> Self {
        let radians = degrees.to_radians();
        let cos = radians.cos();
        let sin = radians.sin();
        Self {
            xx: cos,
            xy: -sin,
            yx: sin,
            yy: cos,
            tx: 0.0,
            ty: 0.0,
        }
    }

    fn scale(x: f64, y: f64) -> Self {
        Self {
            xx: x,
            yy: y,
            ..Self::IDENTITY
        }
    }

    /// Compose two transforms so `other` is applied first, followed by `self`.
    fn compose(self, other: Self) -> Self {
        Self {
            xx: self.xx * other.xx + self.xy * other.yx,
            xy: self.xx * other.xy + self.xy * other.yy,
            yx: self.yx * other.xx + self.yy * other.yx,
            yy: self.yx * other.xy + self.yy * other.yy,
            tx: self.xx * other.tx + self.xy * other.ty + self.tx,
            ty: self.yx * other.tx + self.yy * other.ty + self.ty,
        }
    }

    fn around(center: Vec2, translate: Vec2, scale: Vec2, rotation: f64) -> Self {
        Self::translate(center.x + translate.x, center.y + translate.y)
            .compose(Self::rotate(rotation))
            .compose(Self::scale(scale.x, scale.y))
            .compose(Self::translate(-center.x, -center.y))
    }

    fn apply(self, value: Vec2) -> Vec2 {
        Vec2::new(
            self.xx * value.x + self.xy * value.y + self.tx,
            self.yx * value.x + self.yy * value.y + self.ty,
        )
    }

    fn apply_vector(self, value: Vec2) -> Vec2 {
        Vec2::new(
            self.xx * value.x + self.xy * value.y,
            self.yx * value.x + self.yy * value.y,
        )
    }

    fn inverse(self) -> Option<Self> {
        let determinant = self.xx * self.yy - self.xy * self.yx;
        if determinant.abs() <= f64::EPSILON {
            return None;
        }
        let xx = self.yy / determinant;
        let xy = -self.xy / determinant;
        let yx = -self.yx / determinant;
        let yy = self.xx / determinant;
        Some(Self {
            xx,
            xy,
            yx,
            yy,
            tx: -(xx * self.tx + xy * self.ty),
            ty: -(yx * self.tx + yy * self.ty),
        })
    }
}

#[derive(Clone, Copy, Debug)]
struct VisualGeometry {
    matrix: Affine2,
    bounds: Bounds,
    aabb: Bounds,
    corners: [Vec2; 4],
    rotation: f32,
}

impl VisualGeometry {
    fn from_matrix(base: Bounds, matrix: Affine2) -> Self {
        let corners = [
            Vec2::new(base.x, base.y),
            Vec2::new(base.right(), base.y),
            Vec2::new(base.right(), base.bottom()),
            Vec2::new(base.x, base.bottom()),
        ]
        .map(|corner| matrix.apply(corner));
        let center = matrix.apply(Vec2::new(
            base.x + base.width * 0.5,
            base.y + base.height * 0.5,
        ));
        let width = point_distance(corners[0], corners[1]);
        let height = point_distance(corners[0], corners[3]);
        let rotation = (corners[1].y - corners[0].y)
            .atan2(corners[1].x - corners[0].x)
            .to_degrees() as f32;
        let min_x = corners
            .iter()
            .map(|point| point.x)
            .fold(f64::INFINITY, f64::min);
        let max_x = corners
            .iter()
            .map(|point| point.x)
            .fold(f64::NEG_INFINITY, f64::max);
        let min_y = corners
            .iter()
            .map(|point| point.y)
            .fold(f64::INFINITY, f64::min);
        let max_y = corners
            .iter()
            .map(|point| point.y)
            .fold(f64::NEG_INFINITY, f64::max);
        Self {
            matrix,
            bounds: Bounds::new(
                center.x - width * 0.5,
                center.y - height * 0.5,
                width,
                height,
            ),
            aabb: Bounds::new(min_x, min_y, max_x - min_x, max_y - min_y),
            corners,
            rotation,
        }
    }

    fn local_point(self, world: Vec2) -> Option<Vec2> {
        self.matrix.inverse().map(|inverse| inverse.apply(world))
    }
}

#[derive(Clone, Copy, Debug)]
struct SelectionGeometry {
    corners: [Vec2; 4],
}

impl SelectionGeometry {
    fn center(self) -> Vec2 {
        Vec2::new(
            self.corners.iter().map(|point| point.x).sum::<f64>() / 4.0,
            self.corners.iter().map(|point| point.y).sum::<f64>() / 4.0,
        )
    }

    fn aabb(self) -> Bounds {
        let min_x = self
            .corners
            .iter()
            .map(|point| point.x)
            .fold(f64::INFINITY, f64::min);
        let max_x = self
            .corners
            .iter()
            .map(|point| point.x)
            .fold(f64::NEG_INFINITY, f64::max);
        let min_y = self
            .corners
            .iter()
            .map(|point| point.y)
            .fold(f64::INFINITY, f64::min);
        let max_y = self
            .corners
            .iter()
            .map(|point| point.y)
            .fold(f64::NEG_INFINITY, f64::max);
        Bounds::new(min_x, min_y, max_x - min_x, max_y - min_y)
    }

    fn handles(self) -> [Vec2; 8] {
        let [top_left, top_right, bottom_right, bottom_left] = self.corners;
        [
            top_left,
            midpoint(top_left, top_right),
            top_right,
            midpoint(top_right, bottom_right),
            bottom_right,
            midpoint(bottom_right, bottom_left),
            bottom_left,
            midpoint(bottom_left, top_left),
        ]
    }

    fn rotation_handle(self, offset: f64) -> (Vec2, Vec2) {
        let anchor = midpoint(self.corners[0], self.corners[1]);
        let center = self.center();
        let outward = unit_vector(Vec2::new(anchor.x - center.x, anchor.y - center.y))
            .unwrap_or(Vec2::new(0.0, -1.0));
        (
            Vec2::new(anchor.x + outward.x * offset, anchor.y + outward.y * offset),
            anchor,
        )
    }
}

fn selection_visual_geometry(
    ids: &[NodeId],
    geometries: &HashMap<NodeId, VisualGeometry>,
) -> Option<SelectionGeometry> {
    let selected = ids
        .iter()
        .filter_map(|id| geometries.get(id).copied())
        .collect::<Vec<_>>();
    match selected.as_slice() {
        [] => None,
        [geometry] => Some(SelectionGeometry {
            corners: geometry.corners,
        }),
        geometries => {
            let aabb = geometries
                .iter()
                .map(|geometry| geometry.aabb)
                .reduce(union_bounds)?;
            Some(SelectionGeometry {
                corners: [
                    Vec2::new(aabb.x, aabb.y),
                    Vec2::new(aabb.right(), aabb.y),
                    Vec2::new(aabb.right(), aabb.bottom()),
                    Vec2::new(aabb.x, aabb.bottom()),
                ],
            })
        }
    }
}

fn midpoint(left: Vec2, right: Vec2) -> Vec2 {
    Vec2::new((left.x + right.x) * 0.5, (left.y + right.y) * 0.5)
}

fn unit_vector(value: Vec2) -> Option<Vec2> {
    let length = (value.x.powi(2) + value.y.powi(2)).sqrt();
    (length > f64::EPSILON).then(|| Vec2::new(value.x / length, value.y / length))
}

fn point_distance(left: Vec2, right: Vec2) -> f64 {
    ((right.x - left.x).powi(2) + (right.y - left.y).powi(2)).sqrt()
}

fn visual_geometries(
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    drag: Option<&DragState>,
) -> HashMap<NodeId, VisualGeometry> {
    let mut matrices = HashMap::new();
    let mut geometries = HashMap::new();
    for id in document.nodes.keys() {
        let _ = resolve_visual_geometry(
            document,
            bounds,
            motion_frames,
            drag,
            id,
            &mut matrices,
            &mut geometries,
            &mut HashSet::new(),
        );
    }
    geometries
}

#[allow(clippy::too_many_arguments)]
fn resolve_visual_geometry(
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    drag: Option<&DragState>,
    id: &NodeId,
    matrices: &mut HashMap<NodeId, Affine2>,
    geometries: &mut HashMap<NodeId, VisualGeometry>,
    visiting: &mut HashSet<NodeId>,
) -> Option<VisualGeometry> {
    if let Some(geometry) = geometries.get(id) {
        return Some(*geometry);
    }
    if !visiting.insert(id.clone()) {
        return None;
    }
    let node = document.nodes.get(id)?;
    let base = *bounds.get(id)?;
    let parent_matrix = if let Some(parent_id) = node.parent_id.as_ref() {
        let _ = resolve_visual_geometry(
            document,
            bounds,
            motion_frames,
            drag,
            parent_id,
            matrices,
            geometries,
            visiting,
        )?;
        *matrices.get(parent_id)?
    } else {
        Affine2::IDENTITY
    };
    let motion = motion_frames.get(id);
    let rotation = match drag {
        Some(DragState::Rotate { current, .. }) => {
            current.get(id).copied().unwrap_or(node.rotation)
        }
        _ => node.rotation,
    } + motion.map_or(0.0, |frame| frame.rotate);
    let center = Vec2::new(base.x + base.width * 0.5, base.y + base.height * 0.5);
    let own = Affine2::around(
        center,
        Vec2::new(
            motion.map_or(0.0, |frame| frame.x as f64),
            motion.map_or(0.0, |frame| frame.y as f64),
        ),
        Vec2::new(
            motion.map_or(1.0, |frame| frame.scale_x.max(0.01) as f64),
            motion.map_or(1.0, |frame| frame.scale_y.max(0.01) as f64),
        ),
        rotation as f64,
    );
    let matrix = parent_matrix.compose(own);
    let geometry = VisualGeometry::from_matrix(base, matrix);
    visiting.remove(id);
    matrices.insert(id.clone(), matrix);
    geometries.insert(id.clone(), geometry);
    Some(geometry)
}

fn absolute_bounds(document: &Document) -> HashMap<NodeId, Bounds> {
    let mut cache = HashMap::new();
    for id in document.nodes.keys() {
        let _ = resolve_absolute(document, id, &mut cache, &mut HashSet::new());
    }
    cache
}

fn resolve_absolute(
    document: &Document,
    id: &NodeId,
    cache: &mut HashMap<NodeId, Bounds>,
    visiting: &mut HashSet<NodeId>,
) -> Option<Bounds> {
    if let Some(bounds) = cache.get(id) {
        return Some(*bounds);
    }
    if !visiting.insert(id.clone()) {
        return None;
    }
    let node = document.nodes.get(id)?;
    let parent = node.parent_id.as_ref().and_then(|parent| {
        resolve_absolute(document, parent, cache, visiting)
            .map(|bounds| Vec2::new(bounds.x, bounds.y))
    });
    visiting.remove(id);
    let bounds = Bounds::new(
        node.layout.x + parent.map_or(0.0, |value| value.x),
        node.layout.y + parent.map_or(0.0, |value| value.y),
        node.layout.width,
        node.layout.height,
    );
    cache.insert(id.clone(), bounds);
    Some(bounds)
}

fn paint_order(document: &Document) -> Vec<NodeId> {
    fn visit(
        parent: Option<&NodeId>,
        children_by_parent: &HashMap<Option<NodeId>, Vec<&Node>>,
        output: &mut Vec<NodeId>,
    ) {
        let Some(children) = children_by_parent.get(&parent.cloned()) else {
            return;
        };
        for node in children {
            output.push(node.id.clone());
            visit(Some(&node.id), children_by_parent, output);
        }
    }

    let mut children_by_parent = HashMap::<Option<NodeId>, Vec<&Node>>::new();
    for node in document.nodes.values() {
        children_by_parent
            .entry(node.parent_id.clone())
            .or_default()
            .push(node);
    }
    for children in children_by_parent.values_mut() {
        children.sort_by(|left, right| {
            left.order
                .total_cmp(&right.order)
                .then_with(|| left.id.as_str().cmp(right.id.as_str()))
        });
    }

    let mut output = Vec::with_capacity(document.nodes.len());
    visit(None, &children_by_parent, &mut output);
    output
}

fn paint_order_with_overlay(
    document: &Document,
    paint_order: &[NodeId],
    overlay: Option<&NodeId>,
) -> Vec<NodeId> {
    let mut order = paint_order.to_vec();
    let Some(overlay) = overlay else {
        return order;
    };
    let mut overlay_nodes = Vec::new();
    order.retain(|id| {
        let belongs_to_overlay = id == overlay || is_descendant_of(document, id, overlay);
        if belongs_to_overlay {
            overlay_nodes.push(id.clone());
        }
        !belongs_to_overlay
    });
    order.extend(overlay_nodes);
    order
}

fn is_descendant_of(document: &Document, id: &NodeId, ancestor: &NodeId) -> bool {
    let mut parent = document
        .nodes
        .get(id)
        .and_then(|node| node.parent_id.as_ref());
    while let Some(parent_id) = parent {
        if parent_id == ancestor {
            return true;
        }
        parent = document
            .nodes
            .get(parent_id)
            .and_then(|node| node.parent_id.as_ref());
    }
    false
}

fn root_page_for_node(document: &Document, id: &NodeId) -> Option<NodeId> {
    let mut current = document.nodes.get(id)?;
    loop {
        if current.is_root_frame() {
            return Some(current.id.clone());
        }
        let parent_id = current.parent_id.as_ref()?;
        current = document.nodes.get(parent_id)?;
    }
}

fn changed_raster_pages(previous: &Document, current: &Document) -> HashSet<NodeId> {
    let ids = previous
        .nodes
        .keys()
        .chain(current.nodes.keys())
        .cloned()
        .collect::<HashSet<_>>();
    let mut pages = HashSet::new();
    for id in ids {
        if previous.nodes.get(&id) == current.nodes.get(&id) {
            continue;
        }
        if let Some(page_id) = root_page_for_node(previous, &id) {
            pages.insert(page_id);
        }
        if let Some(page_id) = root_page_for_node(current, &id) {
            pages.insert(page_id);
        }
    }
    pages
}

fn raster_scale_for_zoom(zoom: f64, display_scale: f32) -> f32 {
    let required = (zoom as f32 * display_scale.max(1.0)).clamp(0.5, 4.0);
    [0.5, 1.0, 2.0, 4.0]
        .into_iter()
        .find(|scale| *scale >= required)
        .unwrap_or(4.0)
}

fn inherited_clip(
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    node: &Node,
) -> Option<Bounds> {
    let mut clip = None;
    let mut parent = node.parent_id.as_ref();
    while let Some(parent_id) = parent {
        let parent_node = document.nodes.get(parent_id)?;
        if parent_node.style.overflow != Overflow::Visible {
            let parent_bounds = *bounds.get(parent_id)?;
            clip = Some(match clip {
                Some(existing) => intersect_bounds(existing, parent_bounds),
                None => parent_bounds,
            });
        }
        parent = parent_node.parent_id.as_ref();
    }
    clip
}

fn node_or_ancestor_hidden(document: &Document, node: &Node) -> bool {
    if node.hidden {
        return true;
    }
    let mut parent = node.parent_id.as_ref();
    while let Some(parent_id) = parent {
        let Some(parent_node) = document.nodes.get(parent_id) else {
            break;
        };
        if parent_node.hidden {
            return true;
        }
        parent = parent_node.parent_id.as_ref();
    }
    false
}

fn hit_test(
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    paint_order: &[NodeId],
    world: Vec2,
) -> Option<NodeId> {
    hit_test_with_motion(document, bounds, paint_order, world, &HashMap::new())
}

fn hit_test_with_motion(
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    paint_order: &[NodeId],
    world: Vec2,
    motion_frames: &HashMap<NodeId, MotionFrame>,
) -> Option<NodeId> {
    let geometries = visual_geometries(document, bounds, motion_frames, None);
    let node_contains = |id: &NodeId, node: &Node| {
        let Some(base) = bounds.get(id).copied() else {
            return false;
        };
        let Some(geometry) = geometries.get(id).copied() else {
            return false;
        };
        let Some(local) = geometry.local_point(world) else {
            return false;
        };
        point_inside_node_shape(node, base, local)
            && point_inside_ancestor_clips(document, bounds, &geometries, node, world)
    };
    paint_order
        .iter()
        .rev()
        .find(|id| {
            document.nodes.get(id).is_some_and(|node| {
                !node_or_ancestor_hidden(document, node)
                    && !node.locked
                    && !node.is_root_frame()
                    && node_contains(id, node)
            })
        })
        .cloned()
        .or_else(|| {
            paint_order
                .iter()
                .rev()
                .find(|id| {
                    document.nodes.get(id).is_some_and(|node| {
                        !node_or_ancestor_hidden(document, node)
                            && !node.locked
                            && node_contains(id, node)
                    })
                })
                .cloned()
        })
}

fn point_inside_ancestor_clips(
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    geometries: &HashMap<NodeId, VisualGeometry>,
    node: &Node,
    world: Vec2,
) -> bool {
    let mut parent = node.parent_id.as_ref();
    while let Some(parent_id) = parent {
        let Some(parent_node) = document.nodes.get(parent_id) else {
            return false;
        };
        if parent_node.style.overflow != Overflow::Visible {
            let Some(base) = bounds.get(parent_id).copied() else {
                return false;
            };
            let Some(local) = geometries
                .get(parent_id)
                .and_then(|geometry| geometry.local_point(world))
            else {
                return false;
            };
            if !point_inside_node_shape(parent_node, base, local) {
                return false;
            }
        }
        parent = parent_node.parent_id.as_ref();
    }
    true
}

fn point_inside_node_shape(node: &Node, bounds: Bounds, point: Vec2) -> bool {
    if !bounds.contains(point) {
        return false;
    }
    let x = point.x - bounds.x;
    let y = point.y - bounds.y;
    if node.shape_kind == ShapeKind::Ellipse {
        let rx = bounds.width * 0.5;
        let ry = bounds.height * 0.5;
        if rx <= f64::EPSILON || ry <= f64::EPSILON {
            return false;
        }
        return ((x - rx) / rx).powi(2) + ((y - ry) / ry).powi(2) <= 1.0;
    }
    let limit = bounds.width.min(bounds.height) * 0.5;
    let corners = node.style.corners;
    let tl = (corners.tl as f64).clamp(0.0, limit);
    let tr = (corners.tr as f64).clamp(0.0, limit);
    let br = (corners.br as f64).clamp(0.0, limit);
    let bl = (corners.bl as f64).clamp(0.0, limit);
    if x < tl && y < tl {
        return (x - tl).powi(2) + (y - tl).powi(2) <= tl.powi(2);
    }
    if x > bounds.width - tr && y < tr {
        return (x - (bounds.width - tr)).powi(2) + (y - tr).powi(2) <= tr.powi(2);
    }
    if x > bounds.width - br && y > bounds.height - br {
        return (x - (bounds.width - br)).powi(2) + (y - (bounds.height - br)).powi(2)
            <= br.powi(2);
    }
    if x < bl && y > bounds.height - bl {
        return (x - bl).powi(2) + (y - (bounds.height - bl)).powi(2) <= bl.powi(2);
    }
    true
}

fn flow_drop_guide(
    document: &Document,
    paint_order: &[NodeId],
    dragged: &NodeId,
    world: Vec2,
    bounds: &HashMap<NodeId, Bounds>,
) -> Option<Guide> {
    let stack = paint_order.iter().rev().find_map(|id| {
        let node = document.nodes.get(id)?;
        (node.is_container()
            && matches!(
                node.layout.mode,
                loora_engine::LayoutMode::Flex | loora_engine::LayoutMode::Grid
            )
            && !is_descendant_or_self(id, dragged, document)
            && bounds.get(id).is_some_and(|bounds| bounds.contains(world)))
        .then_some(node)
    })?;
    let stack_bounds = *bounds.get(&stack.id)?;
    let mut siblings = document
        .nodes
        .values()
        .filter(|node| {
            node.id != *dragged
                && node.parent_id.as_ref() == Some(&stack.id)
                && !node.hidden
                && node.layout.position == loora_engine::LayoutPosition::Flow
        })
        .collect::<Vec<_>>();
    siblings.sort_by(|left, right| {
        left.order
            .total_cmp(&right.order)
            .then_with(|| left.id.as_str().cmp(right.id.as_str()))
    });
    let insertion = siblings
        .iter()
        .position(|sibling| {
            let Some(bounds) = bounds.get(&sibling.id) else {
                return false;
            };
            let center_x = bounds.x + bounds.width * 0.5;
            let center_y = bounds.y + bounds.height * 0.5;
            match stack.layout.mode {
                loora_engine::LayoutMode::Flex
                    if stack.layout.direction == loora_engine::FlexDirection::Row =>
                {
                    world.x < center_x
                }
                loora_engine::LayoutMode::Flex => world.y < center_y,
                loora_engine::LayoutMode::Grid => {
                    world.y < center_y
                        || ((world.y - center_y).abs() <= bounds.height * 0.5 && world.x < center_x)
                }
                loora_engine::LayoutMode::Absolute => false,
            }
        })
        .unwrap_or(siblings.len());
    let padding = stack.layout.padding;
    match stack.layout.mode {
        loora_engine::LayoutMode::Flex
            if stack.layout.direction == loora_engine::FlexDirection::Column =>
        {
            let position = siblings
                .get(insertion)
                .and_then(|sibling| bounds.get(&sibling.id))
                .map_or_else(
                    || {
                        siblings
                            .last()
                            .and_then(|sibling| bounds.get(&sibling.id))
                            .map_or(stack_bounds.y + padding.top as f64, Bounds::bottom)
                    },
                    |bounds| bounds.y,
                );
            Some(Guide {
                axis: GuideAxis::Horizontal,
                position,
                from: stack_bounds.x + padding.left as f64,
                to: stack_bounds.right() - padding.right as f64,
                label: None,
            })
        }
        loora_engine::LayoutMode::Flex | loora_engine::LayoutMode::Grid => {
            let target = siblings
                .get(insertion)
                .and_then(|sibling| bounds.get(&sibling.id));
            let fallback = siblings.last().and_then(|sibling| bounds.get(&sibling.id));
            let position = target.map_or_else(
                || fallback.map_or(stack_bounds.x + padding.left as f64, Bounds::right),
                |bounds| bounds.x,
            );
            let (from, to) = if stack.layout.mode == loora_engine::LayoutMode::Grid {
                target
                    .or(fallback)
                    .map_or((stack_bounds.y, stack_bounds.bottom()), |bounds| {
                        (bounds.y, bounds.bottom())
                    })
            } else {
                (
                    stack_bounds.y + padding.top as f64,
                    stack_bounds.bottom() - padding.bottom as f64,
                )
            };
            Some(Guide {
                axis: GuideAxis::Vertical,
                position,
                from,
                to,
                label: None,
            })
        }
        loora_engine::LayoutMode::Absolute => None,
    }
}

fn selectable_nodes(document: &Document) -> Vec<NodeId> {
    paint_order(document)
        .into_iter()
        .filter(|id| {
            document
                .nodes
                .get(id)
                .is_some_and(|node| !node_or_ancestor_hidden(document, node) && !node.locked)
        })
        .collect()
}

fn top_level_selection(selection: &[NodeId], document: &Document) -> Vec<NodeId> {
    let selected = selection.iter().cloned().collect::<HashSet<_>>();
    selection
        .iter()
        .filter(|id| {
            let mut parent = document
                .nodes
                .get(*id)
                .and_then(|node| node.parent_id.as_ref());
            while let Some(parent_id) = parent {
                if selected.contains(parent_id) {
                    return false;
                }
                parent = document
                    .nodes
                    .get(parent_id)
                    .and_then(|node| node.parent_id.as_ref());
            }
            true
        })
        .cloned()
        .collect()
}

fn is_descendant_or_self(id: &NodeId, root: &NodeId, document: &Document) -> bool {
    if id == root {
        return true;
    }
    let mut parent = document
        .nodes
        .get(id)
        .and_then(|node| node.parent_id.as_ref());
    while let Some(parent_id) = parent {
        if parent_id == root {
            return true;
        }
        parent = document
            .nodes
            .get(parent_id)
            .and_then(|node| node.parent_id.as_ref());
    }
    false
}

fn translate_subtree(
    document: &Document,
    root: &NodeId,
    dx: f64,
    dy: f64,
    bounds: &mut HashMap<NodeId, Bounds>,
) {
    if let Some(value) = bounds.get_mut(root) {
        value.x += dx;
        value.y += dy;
    }
    let children = document
        .nodes
        .values()
        .filter(|node| node.parent_id.as_ref() == Some(root))
        .map(|node| node.id.clone())
        .collect::<Vec<_>>();
    for child in children {
        translate_subtree(document, &child, dx, dy, bounds);
    }
}

fn selection_bounds(ids: &[NodeId], bounds: &HashMap<NodeId, Bounds>) -> Option<Bounds> {
    ids.iter()
        .filter_map(|id| bounds.get(id).copied())
        .reduce(union_bounds)
}

fn multi_transform(
    ids: &[NodeId],
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    geometries: &HashMap<NodeId, VisualGeometry>,
) -> Option<MultiTransform> {
    if ids.len() <= 1 {
        return None;
    }
    let members = ids
        .iter()
        .filter_map(|id| {
            let original = *bounds.get(id)?;
            let geometry = geometries.get(id)?;
            let parent_matrix = document
                .nodes
                .get(id)
                .and_then(|node| node.parent_id.as_ref())
                .and_then(|parent| geometries.get(parent))
                .map_or(Affine2::IDENTITY, |geometry| geometry.matrix);
            Some((
                id.clone(),
                MultiTransformMember {
                    original,
                    visual_center: Vec2::new(
                        geometry.bounds.x + geometry.bounds.width * 0.5,
                        geometry.bounds.y + geometry.bounds.height * 0.5,
                    ),
                    parent_inverse: parent_matrix.inverse()?,
                },
            ))
        })
        .collect::<HashMap<_, _>>();
    (members.len() == ids.len()).then_some(MultiTransform { members })
}

fn layout_badges(
    selection: &[NodeId],
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    geometries: &HashMap<NodeId, VisualGeometry>,
    zoom: f64,
) -> Option<(NodeId, Vec<LayoutBadge>)> {
    let [id] = selection else {
        return None;
    };
    let node = document.nodes.get(id)?;
    if node.locked || !matches!(node.layout.mode, LayoutMode::Flex | LayoutMode::Grid) {
        return None;
    }
    let container = *bounds.get(id)?;
    let zoom = zoom.max(Camera::MIN_ZOOM);
    let mut badges = Vec::new();
    if let Some((position, direction)) = gap_badge_position(node, document, bounds) {
        let label = format!("G {:.0}", node.layout.gap);
        badges.push(metric_badge(
            position,
            label,
            LayoutBadgeKind::Gap(direction),
            zoom,
        ));
    }

    let padding = node.layout.padding;
    let handles = [
        (
            PaddingEdge::Top,
            Vec2::new(
                container.x + container.width * 0.25,
                container.y + padding.top as f64,
            ),
            format!("T {:.0}", padding.top),
        ),
        (
            PaddingEdge::Right,
            Vec2::new(
                container.right() - padding.right as f64,
                container.y + container.height * 0.25,
            ),
            format!("R {:.0}", padding.right),
        ),
        (
            PaddingEdge::Bottom,
            Vec2::new(
                container.x + container.width * 0.75,
                container.bottom() - padding.bottom as f64,
            ),
            format!("B {:.0}", padding.bottom),
        ),
        (
            PaddingEdge::Left,
            Vec2::new(
                container.x + padding.left as f64,
                container.y + container.height * 0.75,
            ),
            format!("L {:.0}", padding.left),
        ),
    ];
    badges.extend(handles.into_iter().map(|(edge, position, label)| {
        metric_badge(position, label, LayoutBadgeKind::Padding(edge), zoom)
    }));
    let matrix = geometries.get(id)?.matrix;
    for badge in &mut badges {
        let center = Vec2::new(
            badge.bounds.x + badge.bounds.width * 0.5,
            badge.bounds.y + badge.bounds.height * 0.5,
        );
        let center = matrix.apply(center);
        badge.bounds.x = center.x - badge.bounds.width * 0.5;
        badge.bounds.y = center.y - badge.bounds.height * 0.5;
    }
    Some((id.clone(), badges))
}

fn metric_badge(center: Vec2, label: String, kind: LayoutBadgeKind, zoom: f64) -> LayoutBadge {
    let width = (label.chars().count() as f64 * 6.0 + 12.0) / zoom;
    let height = 18.0 / zoom;
    LayoutBadge {
        bounds: Bounds::new(
            center.x - width * 0.5,
            center.y - height * 0.5,
            width,
            height,
        ),
        label,
        kind,
    }
}

fn gap_badge_position(
    container: &Node,
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
) -> Option<(Vec2, FlexDirection)> {
    let mut children = document
        .nodes
        .values()
        .filter(|node| {
            node.parent_id.as_ref() == Some(&container.id)
                && !node.hidden
                && node.layout.position == loora_engine::LayoutPosition::Flow
        })
        .collect::<Vec<_>>();
    children.sort_by(|left, right| {
        left.order
            .total_cmp(&right.order)
            .then_with(|| left.id.as_str().cmp(right.id.as_str()))
    });
    let first = bounds.get(&children.first()?.id)?;
    let second = bounds.get(&children.get(1)?.id)?;
    let direction = if container.layout.mode == LayoutMode::Flex {
        container.layout.direction
    } else if (second.x - first.x).abs() >= (second.y - first.y).abs() {
        FlexDirection::Row
    } else {
        FlexDirection::Column
    };
    Some(match direction {
        FlexDirection::Row => (
            Vec2::new(
                (first.right() + second.x) * 0.5,
                (first.y.max(second.y) + first.bottom().min(second.bottom())) * 0.5,
            ),
            direction,
        ),
        FlexDirection::Column => (
            Vec2::new(
                (first.x.max(second.x) + first.right().min(second.right())) * 0.5,
                (first.bottom() + second.y) * 0.5,
            ),
            direction,
        ),
    })
}

fn padding_edge_label(edge: PaddingEdge) -> &'static str {
    match edge {
        PaddingEdge::Top => "T",
        PaddingEdge::Right => "R",
        PaddingEdge::Bottom => "B",
        PaddingEdge::Left => "L",
    }
}

fn hit_layout_badge(
    world: Vec2,
    selection: &[NodeId],
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    geometries: &HashMap<NodeId, VisualGeometry>,
    zoom: f64,
) -> Option<(NodeId, LayoutBadge)> {
    let (id, badges) = layout_badges(selection, document, bounds, geometries, zoom)?;
    badges
        .into_iter()
        .rev()
        .find(|badge| badge.bounds.contains(world))
        .map(|badge| (id, badge))
}

fn resized_padding(
    mut padding: Insets,
    edge: PaddingEdge,
    delta: Vec2,
    width: f64,
    height: f64,
) -> Insets {
    match edge {
        PaddingEdge::Top => {
            let max = (height - padding.bottom as f64 - 1.0).max(0.0);
            padding.top = (padding.top as f64 + delta.y).clamp(0.0, max) as f32;
        }
        PaddingEdge::Right => {
            let max = (width - padding.left as f64 - 1.0).max(0.0);
            padding.right = (padding.right as f64 - delta.x).clamp(0.0, max) as f32;
        }
        PaddingEdge::Bottom => {
            let max = (height - padding.top as f64 - 1.0).max(0.0);
            padding.bottom = (padding.bottom as f64 - delta.y).clamp(0.0, max) as f32;
        }
        PaddingEdge::Left => {
            let max = (width - padding.right as f64 - 1.0).max(0.0);
            padding.left = (padding.left as f64 + delta.x).clamp(0.0, max) as f32;
        }
    }
    padding
}

fn hit_resize_handle(
    world: Vec2,
    selection: &[NodeId],
    bounds: &HashMap<NodeId, Bounds>,
    geometries: &HashMap<NodeId, VisualGeometry>,
    radius: f64,
) -> Option<(ResizeHandle, Bounds, ResizeBasis)> {
    let raw_group = selection_bounds(selection, bounds)?;
    let geometry = selection_visual_geometry(selection, geometries)?;
    let group = if selection.len() == 1 {
        raw_group
    } else {
        geometry.aabb()
    };
    let handles = geometry.handles();
    let points = [
        (ResizeHandle::NorthWest, handles[0]),
        (ResizeHandle::North, handles[1]),
        (ResizeHandle::NorthEast, handles[2]),
        (ResizeHandle::East, handles[3]),
        (ResizeHandle::SouthEast, handles[4]),
        (ResizeHandle::South, handles[5]),
        (ResizeHandle::SouthWest, handles[6]),
        (ResizeHandle::West, handles[7]),
    ];
    let basis = if selection.len() == 1 {
        let x_vector = Vec2::new(
            geometry.corners[1].x - geometry.corners[0].x,
            geometry.corners[1].y - geometry.corners[0].y,
        );
        let y_vector = Vec2::new(
            geometry.corners[3].x - geometry.corners[0].x,
            geometry.corners[3].y - geometry.corners[0].y,
        );
        let x_length = point_distance(geometry.corners[0], geometry.corners[1]);
        let y_length = point_distance(geometry.corners[0], geometry.corners[3]);
        ResizeBasis {
            x_axis: unit_vector(x_vector)?,
            y_axis: unit_vector(y_vector)?,
            x_scale: x_length / raw_group.width.max(MIN_NODE_SIZE),
            y_scale: y_length / raw_group.height.max(MIN_NODE_SIZE),
        }
    } else {
        ResizeBasis::IDENTITY
    };
    points
        .into_iter()
        .find(|(_, point)| {
            (world.x - point.x).abs() <= radius && (world.y - point.y).abs() <= radius
        })
        .map(|(handle, _)| (handle, group, basis))
}

fn hit_rotation_handle(
    world: Vec2,
    selection: &[NodeId],
    geometries: &HashMap<NodeId, VisualGeometry>,
    radius: f64,
    offset: f64,
) -> Option<SelectionGeometry> {
    let geometry = selection_visual_geometry(selection, geometries)?;
    let (handle, _) = geometry.rotation_handle(offset);
    ((world.x - handle.x).abs() <= radius && (world.y - handle.y).abs() <= radius)
        .then_some(geometry)
}

fn angle_from(center: Vec2, point: Vec2) -> f64 {
    (point.y - center.y).atan2(point.x - center.x).to_degrees()
}

fn angle_delta(start: f64, current: f64) -> f64 {
    let mut delta = current - start;
    while delta > 180.0 {
        delta -= 360.0;
    }
    while delta < -180.0 {
        delta += 360.0;
    }
    delta
}

fn normalize_degrees(value: f32) -> f32 {
    let value = value % 360.0;
    if value > 180.0 {
        value - 360.0
    } else if value <= -180.0 {
        value + 360.0
    } else {
        value
    }
}

fn resize_bounds(bounds: Bounds, handle: ResizeHandle, delta: Vec2) -> Bounds {
    let mut left = bounds.x;
    let mut top = bounds.y;
    let mut right = bounds.right();
    let mut bottom = bounds.bottom();
    if matches!(
        handle,
        ResizeHandle::NorthWest | ResizeHandle::West | ResizeHandle::SouthWest
    ) {
        left = (left + delta.x).min(right - MIN_NODE_SIZE);
    }
    if matches!(
        handle,
        ResizeHandle::NorthEast | ResizeHandle::East | ResizeHandle::SouthEast
    ) {
        right = (right + delta.x).max(left + MIN_NODE_SIZE);
    }
    if matches!(
        handle,
        ResizeHandle::NorthWest | ResizeHandle::North | ResizeHandle::NorthEast
    ) {
        top = (top + delta.y).min(bottom - MIN_NODE_SIZE);
    }
    if matches!(
        handle,
        ResizeHandle::SouthWest | ResizeHandle::South | ResizeHandle::SouthEast
    ) {
        bottom = (bottom + delta.y).max(top + MIN_NODE_SIZE);
    }
    Bounds::new(left, top, right - left, bottom - top)
}

fn resize_bounds_with_aspect(bounds: Bounds, handle: ResizeHandle, delta: Vec2) -> Bounds {
    if matches!(
        handle,
        ResizeHandle::North | ResizeHandle::East | ResizeHandle::South | ResizeHandle::West
    ) {
        return resize_bounds(bounds, handle, delta);
    }
    let target = resize_bounds(bounds, handle, delta);
    let ratio = bounds.width.max(MIN_NODE_SIZE) / bounds.height.max(MIN_NODE_SIZE);
    let (width, height) = if target.width / target.height.max(MIN_NODE_SIZE) > ratio {
        (target.width, target.width / ratio)
    } else {
        (target.height * ratio, target.height)
    };
    let x = match handle {
        ResizeHandle::NorthWest | ResizeHandle::SouthWest => bounds.right() - width,
        _ => bounds.x,
    };
    let y = match handle {
        ResizeHandle::NorthWest | ResizeHandle::NorthEast => bounds.bottom() - height,
        _ => bounds.y,
    };
    Bounds::new(x, y, width, height)
}

fn scale_group(
    originals: &HashMap<NodeId, Bounds>,
    source: Bounds,
    target: Bounds,
) -> HashMap<NodeId, Bounds> {
    let sx = target.width / source.width.max(MIN_NODE_SIZE);
    let sy = target.height / source.height.max(MIN_NODE_SIZE);
    originals
        .iter()
        .map(|(id, bounds)| {
            (
                id.clone(),
                Bounds::new(
                    target.x + (bounds.x - source.x) * sx,
                    target.y + (bounds.y - source.y) * sy,
                    (bounds.width * sx).max(MIN_NODE_SIZE),
                    (bounds.height * sy).max(MIN_NODE_SIZE),
                ),
            )
        })
        .collect()
}

fn scale_multi_transform(
    transform: &MultiTransform,
    source: Bounds,
    target: Bounds,
) -> HashMap<NodeId, Bounds> {
    let sx = target.width / source.width.max(MIN_NODE_SIZE);
    let sy = target.height / source.height.max(MIN_NODE_SIZE);
    transform
        .members
        .iter()
        .map(|(id, member)| {
            let desired_center = Vec2::new(
                target.x + (member.visual_center.x - source.x) * sx,
                target.y + (member.visual_center.y - source.y) * sy,
            );
            let raw_delta = member.parent_inverse.apply_vector(Vec2::new(
                desired_center.x - member.visual_center.x,
                desired_center.y - member.visual_center.y,
            ));
            let width = (member.original.width * sx).max(MIN_NODE_SIZE);
            let height = (member.original.height * sy).max(MIN_NODE_SIZE);
            let original_center = Vec2::new(
                member.original.x + member.original.width * 0.5,
                member.original.y + member.original.height * 0.5,
            );
            (
                id.clone(),
                Bounds::new(
                    original_center.x + raw_delta.x - width * 0.5,
                    original_center.y + raw_delta.y - height * 0.5,
                    width,
                    height,
                ),
            )
        })
        .collect()
}

fn rotate_multi_transform(
    transform: &MultiTransform,
    center: Vec2,
    degrees: f64,
) -> HashMap<NodeId, Bounds> {
    let rotation = Affine2::rotate(degrees);
    transform
        .members
        .iter()
        .map(|(id, member)| {
            let offset = Vec2::new(
                member.visual_center.x - center.x,
                member.visual_center.y - center.y,
            );
            let rotated = rotation.apply_vector(offset);
            let desired_center = Vec2::new(center.x + rotated.x, center.y + rotated.y);
            let raw_delta = member.parent_inverse.apply_vector(Vec2::new(
                desired_center.x - member.visual_center.x,
                desired_center.y - member.visual_center.y,
            ));
            (
                id.clone(),
                Bounds::new(
                    member.original.x + raw_delta.x,
                    member.original.y + raw_delta.y,
                    member.original.width,
                    member.original.height,
                ),
            )
        })
        .collect()
}

fn snap_move(
    raw: Vec2,
    ids: &[NodeId],
    originals: &HashMap<NodeId, Bounds>,
    all_bounds: &HashMap<NodeId, Bounds>,
    zoom: f64,
) -> (Vec2, Vec<Guide>) {
    let Some(group) = selection_bounds(ids, originals) else {
        return (raw, Vec::new());
    };
    let moving = Bounds::new(group.x + raw.x, group.y + raw.y, group.width, group.height);
    let threshold = SNAP_SCREEN_PX / zoom.max(Camera::MIN_ZOOM);
    let moving_x = [moving.x, moving.x + moving.width / 2.0, moving.right()];
    let moving_y = [moving.y, moving.y + moving.height / 2.0, moving.bottom()];
    let ignored = ids.iter().cloned().collect::<HashSet<_>>();
    let mut best_x: Option<(f64, f64, Bounds)> = None;
    let mut best_y: Option<(f64, f64, Bounds)> = None;
    for (id, target) in all_bounds {
        if ignored.contains(id) {
            continue;
        }
        let target_x = [target.x, target.x + target.width / 2.0, target.right()];
        let target_y = [target.y, target.y + target.height / 2.0, target.bottom()];
        for source in moving_x {
            for destination in target_x {
                let adjustment = destination - source;
                if adjustment.abs() <= threshold
                    && best_x.is_none_or(|best| adjustment.abs() < best.0.abs())
                {
                    best_x = Some((adjustment, destination, *target));
                }
            }
        }
        for source in moving_y {
            for destination in target_y {
                let adjustment = destination - source;
                if adjustment.abs() <= threshold
                    && best_y.is_none_or(|best| adjustment.abs() < best.0.abs())
                {
                    best_y = Some((adjustment, destination, *target));
                }
            }
        }
    }
    let snapped = Vec2::new(
        raw.x + best_x.map_or(0.0, |value| value.0),
        raw.y + best_y.map_or(0.0, |value| value.0),
    );
    let moved = Bounds::new(
        group.x + snapped.x,
        group.y + snapped.y,
        group.width,
        group.height,
    );
    let mut guides = Vec::new();
    if let Some((_, position, target)) = best_x {
        guides.push(Guide {
            axis: GuideAxis::Vertical,
            position,
            from: moved.y.min(target.y),
            to: moved.bottom().max(target.bottom()),
            label: axis_gap(moved.y, moved.bottom(), target.y, target.bottom()),
        });
    }
    if let Some((_, position, target)) = best_y {
        guides.push(Guide {
            axis: GuideAxis::Horizontal,
            position,
            from: moved.x.min(target.x),
            to: moved.right().max(target.right()),
            label: axis_gap(moved.x, moved.right(), target.x, target.right()),
        });
    }
    (snapped, guides)
}

fn axis_gap(first_start: f64, first_end: f64, second_start: f64, second_end: f64) -> Option<f64> {
    if first_end <= second_start {
        Some(second_start - first_end)
    } else if second_end <= first_start {
        Some(first_start - second_end)
    } else {
        None
    }
}

fn normalized_bounds(first: Vec2, second: Vec2) -> Bounds {
    Bounds::new(
        first.x.min(second.x),
        first.y.min(second.y),
        (first.x - second.x).abs(),
        (first.y - second.y).abs(),
    )
}

fn defaulted_create_bounds(tool: CanvasTool, start: Vec2, end: Vec2) -> Bounds {
    let bounds = normalized_bounds(start, end);
    if bounds.width >= 4.0 || bounds.height >= 4.0 {
        return Bounds::new(
            bounds.x,
            bounds.y,
            bounds.width.max(MIN_NODE_SIZE),
            bounds.height.max(MIN_NODE_SIZE),
        );
    }
    let (width, height) = match tool {
        CanvasTool::Frame => (320.0, 240.0),
        CanvasTool::Text => (160.0, 40.0),
        CanvasTool::Image => (240.0, 180.0),
        _ => (120.0, 100.0),
    };
    Bounds::new(start.x, start.y, width, height)
}

fn union_bounds(left: Bounds, right: Bounds) -> Bounds {
    let x = left.x.min(right.x);
    let y = left.y.min(right.y);
    Bounds::new(
        x,
        y,
        left.right().max(right.right()) - x,
        left.bottom().max(right.bottom()) - y,
    )
}

fn intersect_bounds(left: Bounds, right: Bounds) -> Bounds {
    let x = left.x.max(right.x);
    let y = left.y.max(right.y);
    Bounds::new(
        x,
        y,
        (left.right().min(right.right()) - x).max(0.0),
        (left.bottom().min(right.bottom()) - y).max(0.0),
    )
}

fn quad_intersects_bounds(quad: [Vec2; 4], bounds: Bounds) -> bool {
    let rectangle = [
        Vec2::new(bounds.x, bounds.y),
        Vec2::new(bounds.right(), bounds.y),
        Vec2::new(bounds.right(), bounds.bottom()),
        Vec2::new(bounds.x, bounds.bottom()),
    ];
    let mut axes = vec![Vec2::new(1.0, 0.0), Vec2::new(0.0, 1.0)];
    axes.extend((0..4).map(|index| {
        let edge = Vec2::new(
            quad[(index + 1) % 4].x - quad[index].x,
            quad[(index + 1) % 4].y - quad[index].y,
        );
        Vec2::new(-edge.y, edge.x)
    }));
    axes.into_iter().all(|axis| {
        let project = |point: &Vec2| point.x * axis.x + point.y * axis.y;
        let quad_min = quad.iter().map(project).fold(f64::INFINITY, f64::min);
        let quad_max = quad.iter().map(project).fold(f64::NEG_INFINITY, f64::max);
        let rect_min = rectangle.iter().map(project).fold(f64::INFINITY, f64::min);
        let rect_max = rectangle
            .iter()
            .map(project)
            .fold(f64::NEG_INFINITY, f64::max);
        quad_max >= rect_min && rect_max >= quad_min
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{AppContext, TestAppContext};
    use loora_engine::{Layout, Node};

    #[test]
    fn gradient_sampling_preserves_middle_stops() {
        let stops = vec![
            loora_engine::GradientStop {
                offset: 0.0,
                color: Color::rgb(255, 0, 0),
                token_id: None,
            },
            loora_engine::GradientStop {
                offset: 0.5,
                color: Color::rgb(0, 255, 0),
                token_id: None,
            },
            loora_engine::GradientStop {
                offset: 1.0,
                color: Color::rgb(0, 0, 255),
                token_id: None,
            },
        ];
        let middle = sample_gradient(&stops, 0.5).unwrap();
        assert!(middle.g > 0.99);
        assert!(middle.r < 0.01);
        assert!(middle.b < 0.01);
    }

    #[test]
    fn image_rotation_expands_the_raster_without_losing_pixels() {
        let mut source = image::RgbaImage::new(4, 2);
        for pixel in source.pixels_mut() {
            *pixel = image::Rgba([255, 255, 255, 255]);
        }
        let rotated = rotate_rgba(&source, 90.0);
        assert_eq!((rotated.width(), rotated.height()), (3, 4));
        assert!(rotated.pixels().any(|pixel| pixel.0[3] == 255));
    }

    #[test]
    fn rich_text_runs_use_character_ranges_and_utf8_byte_lengths() {
        let page = NodeId::from("page");
        let mut node = Node::text("Rich", page, Layout::new(0.0, 0.0, 200.0, 40.0), "AéB");
        node.text_runs.push(loora_engine::TextRun {
            start: 1,
            end: 2,
            typography: Some(loora_engine::TypographyPatch {
                family: Some("Courier".into()),
                weight: Some(700),
                ..loora_engine::TypographyPatch::default()
            }),
            color: Some(Color::rgb(255, 0, 0)),
            color_token: None,
        });
        let runs = text_runs_for_line(&node, &node.effective_typography(), "AéB", 0, None, 1.0);
        assert_eq!(runs.iter().map(|run| run.len).sum::<usize>(), "AéB".len());
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[1].len, "é".len());
        assert_eq!(runs[1].font.family.as_ref(), "Courier");
        assert_eq!(runs[1].font.weight, FontWeight(700.0));
    }

    #[test]
    fn text_nodes_use_style_fill_before_typography_fallback() {
        let page = NodeId::from("page");
        let mut node = Node::text("Label", page, Layout::new(0.0, 0.0, 200.0, 40.0), "Label");
        let fill = Color::rgb(0x20, 0x21, 0x24);
        node.style.set_solid_fill(Some(fill));
        node.typography.as_mut().unwrap().color = Color::rgb(0xf0, 0xf0, 0xf0);

        assert_eq!(text_paint_color(&node, None), Some(fill));
    }

    #[test]
    fn native_line_height_uses_the_css_style_multiplier() {
        let typography = loora_engine::Typography {
            size: 20.0,
            line_height: Some(1.5),
            ..loora_engine::Typography::default()
        };

        assert!((resolved_line_height(&typography) - 30.0).abs() < f32::EPSILON);
    }

    #[test]
    fn svg_text_preserves_letter_spacing() {
        let svg = styled_text_svg(
            "Apps",
            100.0,
            24.0,
            16.0,
            "System",
            400,
            EngineTextAlign::Left,
            2.0,
        );

        assert!(svg.contains("letter-spacing=\"2\""));
        assert!(should_use_text_svg(0.0, 2.0, None));
    }

    #[test]
    fn child_opacity_is_compounded_with_its_ancestors() {
        let mut document = Document::empty("Opacity");
        let page = document.root_page_id.clone();
        let mut parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        parent.style.opacity = 0.5;
        let mut child = Node::rectangle(
            "Child",
            parent.id.clone(),
            Layout::new(0.0, 0.0, 50.0, 50.0),
        );
        child.style.opacity = 0.4;
        let child_id = child.id.clone();
        document.nodes.insert(parent.id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);

        let opacity = node_opacity(
            &document,
            document.nodes.get(&child_id).unwrap(),
            &HashMap::new(),
        );

        assert!((opacity - 0.2).abs() < f32::EPSILON);
    }

    #[test]
    fn animated_parent_opacity_compounds_into_static_children() {
        let mut document = Document::empty("Animated opacity");
        let page = document.root_page_id.clone();
        let parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        let parent_id = parent.id.clone();
        let mut child = Node::rectangle(
            "Child",
            parent_id.clone(),
            Layout::new(0.0, 0.0, 50.0, 50.0),
        );
        child.style.opacity = 0.4;
        let child_id = child.id.clone();
        document.nodes.insert(parent_id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);
        let frames = HashMap::from([(
            parent_id,
            MotionFrame {
                opacity: 0.25,
                x: 0.0,
                y: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotate: 0.0,
                fill: None,
                corners: loora_engine::Corners::default(),
                stroke: None,
            },
        )]);

        let opacity = node_opacity(&document, document.nodes.get(&child_id).unwrap(), &frames);

        assert!((opacity - 0.1).abs() < f32::EPSILON);
    }

    #[test]
    fn nested_overflow_clips_intersect_in_world_space() {
        let mut document = Document::empty("Nested clips");
        let page = document.root_page_id.clone();
        let mut outer = Node::frame("Outer", page, Layout::new(10.0, 20.0, 100.0, 100.0));
        outer.style.overflow = Overflow::Hidden;
        let mut inner = Node::frame(
            "Inner",
            outer.id.clone(),
            Layout::new(80.0, 80.0, 50.0, 50.0),
        );
        inner.style.overflow = Overflow::Hidden;
        let child = Node::rectangle("Child", inner.id.clone(), Layout::new(0.0, 0.0, 50.0, 50.0));
        let child_id = child.id.clone();
        document.nodes.insert(outer.id.clone(), outer);
        document.nodes.insert(inner.id.clone(), inner);
        document.nodes.insert(child_id.clone(), child);
        let bounds = absolute_bounds(&document);

        let clip =
            inherited_clip(&document, &bounds, document.nodes.get(&child_id).unwrap()).unwrap();

        assert_eq!(clip, Bounds::new(90.0, 100.0, 20.0, 20.0));
    }

    #[test]
    fn gradient_raster_uses_compounded_node_opacity() {
        let mut document = Document::empty("Gradient opacity");
        let page = document.root_page_id.clone();
        let mut parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        parent.style.opacity = 0.5;
        let mut child = Node::rectangle(
            "Gradient",
            parent.id.clone(),
            Layout::new(0.0, 0.0, 50.0, 50.0),
        );
        child.style.opacity = 0.4;
        child.style.fills = vec![Paint::LinearGradient {
            angle: 0.0,
            stops: vec![
                loora_engine::GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 255, 255),
                    token_id: None,
                },
                loora_engine::GradientStop {
                    offset: 1.0,
                    color: Color::rgb(255, 255, 255),
                    token_id: None,
                },
            ],
        }];
        let child_id = child.id.clone();
        document.nodes.insert(parent.id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );

        canvas.sync_gradient_fills(&document, &HashMap::new());

        let raster = canvas.gradient_fills.get(&(child_id, 0)).unwrap();
        assert_eq!(raster.image.as_bytes(0).unwrap()[3], 51);
    }

    #[test]
    fn image_pixels_respect_effective_opacity() {
        let frame = image::Frame::new(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([10, 20, 30, 200]),
        ));
        let source = Arc::new(RenderImage::new(smallvec::smallvec![frame]));

        let faded = render_image_with_opacity(&source, 0.5);

        assert_eq!(faded.as_bytes(0).unwrap(), &[10, 20, 30, 100]);
    }

    #[test]
    fn image_cache_uses_compounded_node_opacity() {
        let mut document = Document::empty("Image opacity");
        let page = document.root_page_id.clone();
        let mut parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        parent.style.opacity = 0.5;
        let mut child = Node::image(
            "Image",
            parent.id.clone(),
            Layout::new(0.0, 0.0, 50.0, 50.0),
        );
        child.style.opacity = 0.4;
        child.image_path = Some("fixture".into());
        let child_id = child.id.clone();
        document.nodes.insert(parent.id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);
        let frame = image::Frame::new(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([10, 20, 30, 200]),
        ));
        let source = Arc::new(RenderImage::new(smallvec::smallvec![frame]));
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.images.insert("fixture".into(), source);

        canvas.sync_image_opacity_variants(&document, &HashMap::new());

        let variant = canvas.image_opacity_variants.get(&child_id).unwrap();
        assert_eq!(variant.image.as_bytes(0).unwrap()[3], 40);
    }

    #[test]
    fn initial_scene_loads_local_image_assets() {
        let mut document = Document::empty("Initial images");
        let page = document.root_page_id.clone();
        let mut image = Node::image("Logo", page, Layout::new(0.0, 0.0, 64.0, 64.0));
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../desktop/assets/logo.png")
            .to_string_lossy()
            .into_owned();
        image.image_path = Some(path.clone());
        document.nodes.insert(image.id.clone(), image);

        let canvas = NativeCanvas::new_with_viewport(
            document,
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );

        assert!(canvas.images.contains_key(&path));
    }

    #[test]
    fn overlapping_artboards_only_paint_the_frontmost_page_label() {
        let mut document = Document::empty("Pages");
        let desktop = document.root_page_id.clone();
        let mut homepage = Node::root_frame("Homepage");
        homepage.layout.x = 0.25;
        homepage.order = 2048.0;
        let homepage_id = homepage.id.clone();
        document.nodes.insert(homepage_id.clone(), homepage);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);

        assert!(!root_page_label_is_frontmost(
            &desktop, &document, &bounds, &order, 1.0,
        ));
        assert!(root_page_label_is_frontmost(
            &homepage_id,
            &document,
            &bounds,
            &order,
            1.0,
        ));
    }

    #[test]
    fn resize_group_scales_every_member_from_shared_origin() {
        let first = NodeId::from("first");
        let second = NodeId::from("second");
        let originals = HashMap::from([
            (first.clone(), Bounds::new(0.0, 0.0, 50.0, 100.0)),
            (second.clone(), Bounds::new(50.0, 0.0, 50.0, 100.0)),
        ]);
        let scaled = scale_group(
            &originals,
            Bounds::new(0.0, 0.0, 100.0, 100.0),
            Bounds::new(10.0, 20.0, 200.0, 50.0),
        );
        assert_eq!(scaled[&first], Bounds::new(10.0, 20.0, 100.0, 50.0));
        assert_eq!(scaled[&second], Bounds::new(110.0, 20.0, 100.0, 50.0));
    }

    #[test]
    fn top_level_selection_drops_descendants_of_selected_nodes() {
        let mut document = Document::empty("Test");
        let page = document.root_page_id.clone();
        let parent = Node::frame("Parent", page.clone(), Layout::new(0.0, 0.0, 100.0, 100.0));
        let child = Node::rectangle(
            "Child",
            parent.id.clone(),
            Layout::new(10.0, 10.0, 20.0, 20.0),
        );
        document.nodes.insert(parent.id.clone(), parent.clone());
        document.nodes.insert(child.id.clone(), child.clone());
        assert_eq!(
            top_level_selection(&[parent.id.clone(), child.id], &document),
            vec![parent.id]
        );
    }

    #[test]
    fn snap_move_aligns_centers_in_world_space() {
        let moving = NodeId::from("moving");
        let target = NodeId::from("target");
        let originals = HashMap::from([(moving.clone(), Bounds::new(0.0, 0.0, 100.0, 100.0))]);
        let all = HashMap::from([
            (moving.clone(), originals[&moving]),
            (target, Bounds::new(202.0, 0.0, 100.0, 100.0)),
        ]);
        let (delta, guides) = snap_move(Vec2::new(100.0, 0.0), &[moving], &originals, &all, 1.0);
        assert_eq!(delta.x, 102.0);
        assert!(guides.iter().any(|guide| guide.axis == GuideAxis::Vertical));
    }

    #[test]
    fn smart_guides_report_non_overlapping_distance() {
        let moving = NodeId::from("moving");
        let target = NodeId::from("target");
        let originals = HashMap::from([(moving.clone(), Bounds::new(0.0, 0.0, 100.0, 50.0))]);
        let all = HashMap::from([
            (moving.clone(), originals[&moving]),
            (target, Bounds::new(202.0, 150.0, 100.0, 50.0)),
        ]);
        let (_, guides) = snap_move(Vec2::new(102.0, 0.0), &[moving], &originals, &all, 1.0);
        assert_eq!(guides[0].label, Some(100.0));
    }

    #[test]
    fn rotation_handle_hit_and_wrapped_angle_are_stable() {
        let id = NodeId::from("selected");
        let bounds = HashMap::from([(id.clone(), Bounds::new(100.0, 100.0, 80.0, 40.0))]);
        let geometries = HashMap::from([(
            id.clone(),
            VisualGeometry::from_matrix(bounds[&id], Affine2::IDENTITY),
        )]);
        let group = hit_rotation_handle(Vec2::new(140.0, 76.0), &[id], &geometries, 8.0, 24.0);
        assert!(group.is_some());
        assert!((angle_delta(170.0, -170.0) - 20.0).abs() < f64::EPSILON);
        assert_eq!(normalize_degrees(375.0), 15.0);
    }

    #[test]
    fn click_creation_uses_useful_defaults() {
        assert_eq!(
            defaulted_create_bounds(CanvasTool::Text, Vec2::new(4.0, 5.0), Vec2::new(4.0, 5.0)),
            Bounds::new(4.0, 5.0, 160.0, 40.0)
        );
    }

    #[test]
    fn shift_corner_resize_preserves_aspect_ratio() {
        let resized = resize_bounds_with_aspect(
            Bounds::new(10.0, 20.0, 200.0, 100.0),
            ResizeHandle::SouthEast,
            Vec2::new(20.0, 80.0),
        );
        assert!((resized.width / resized.height - 2.0).abs() < f64::EPSILON);
        assert_eq!(resized.x, 10.0);
        assert_eq!(resized.y, 20.0);
    }

    #[test]
    fn svg_path_supports_the_full_editor_command_set() {
        let data = "M 0 0 L 100 0 H 90 V 10 C 80 10 80 20 70 20 S 60 30 50 30 Q 40 30 40 40 T 30 50 A 10 10 0 0 1 20 60 Z";
        let segments = PathParser::from(data)
            .collect::<Result<Vec<_>, _>>()
            .expect("valid SVG path");
        let path = build_svg_path(
            &segments,
            GpBounds::new(point(px(10.0), px(20.0)), size(px(200.0), px(100.0))),
            (0.0, 0.0, 100.0, 100.0),
            25.0,
            PathBuilder::fill(),
        );
        assert!(path.is_some());
    }

    #[test]
    fn overlay_subtree_is_always_painted_last() {
        let mut document = Document::empty("Test");
        let current = document.root_page_id.clone();
        let overlay = Node::root_frame("Overlay");
        let child = Node::rectangle(
            "Dialog",
            overlay.id.clone(),
            Layout::new(20.0, 20.0, 80.0, 60.0),
        );
        document.nodes.insert(overlay.id.clone(), overlay.clone());
        document.nodes.insert(child.id.clone(), child.clone());
        let base_order = paint_order(&document);
        let order = paint_order_with_overlay(&document, &base_order, Some(&overlay.id));
        assert!(order.iter().position(|id| id == &current).unwrap() < order.len() - 2);
        assert_eq!(order[order.len() - 2..], [overlay.id, child.id]);
    }

    #[test]
    fn overlay_preview_maps_hover_and_click_to_the_centered_artboard() {
        let mut document = Document::empty("Test");
        let mut overlay = Node::root_frame("Overlay");
        overlay.layout.x = 1_000.0;
        overlay.layout.y = 800.0;
        overlay.layout.width = 400.0;
        overlay.layout.height = 200.0;
        let overlay_id = overlay.id.clone();
        document.nodes.insert(overlay_id.clone(), overlay);
        let viewport = Rc::new(Cell::new(GpBounds::new(
            point(px(0.0), px(0.0)),
            size(px(1_000.0), px(800.0)),
        )));
        let mut canvas = NativeCanvas::new_with_viewport(document, Camera::default(), viewport);
        canvas.preview = true;
        canvas.preview_overlay = Some(overlay_id);
        let bounds = absolute_bounds(&canvas.document);

        let world = canvas
            .preview_world_at(Vec2::new(500.0, 400.0), &bounds)
            .unwrap();
        assert!((world.x - 1_200.0).abs() < 0.01);
        assert!((world.y - 900.0).abs() < 0.01);
    }

    #[test]
    fn in_view_nodes_excludes_offscreen_layers() {
        let mut document = Document::empty("Test");
        let page = document.root_page_id.clone();
        let visible = Node::rectangle("Visible", page.clone(), Layout::new(20.0, 20.0, 80.0, 40.0));
        let outside = Node::rectangle("Outside", page, Layout::new(900.0, 20.0, 80.0, 40.0));
        document.nodes.insert(visible.id.clone(), visible.clone());
        document.nodes.insert(outside.id.clone(), outside.clone());
        let bounds = absolute_bounds(&document);
        let viewport = GpBounds::new(point(px(0.0), px(0.0)), size(px(500.0), px(400.0)));

        let nodes = in_view_nodes(&document, &bounds, Camera::default(), viewport, None);
        assert!(nodes.contains(&visible.id));
        assert!(!nodes.contains(&outside.id));
    }

    #[test]
    fn view_box_parser_accepts_svg_spacing_and_rejects_zero_size() {
        assert_eq!(parse_view_box("-10, 5 200 100"), (-10.0, 5.0, 200.0, 100.0));
        assert_eq!(parse_view_box("0 0 0 100"), (0.0, 0.0, 100.0, 100.0));
    }

    #[test]
    fn gpui_scroll_delta_moves_canvas_with_the_content() {
        let mut camera = Camera::default();
        apply_scroll_delta(
            &mut camera,
            Vec2::new(100.0, 80.0),
            Vec2::new(24.0, -16.0),
            false,
        );
        assert_eq!(camera.pan, Vec2::new(24.0, -16.0));
    }

    #[test]
    fn positive_gpui_zoom_delta_zooms_in_around_pointer() {
        let mut camera = Camera::default();
        let pointer = Vec2::new(240.0, 160.0);
        let world_before = camera.screen_to_world(pointer);
        apply_scroll_delta(&mut camera, pointer, Vec2::new(0.0, 40.0), true);
        let world_after = camera.screen_to_world(pointer);
        assert!(camera.zoom > 1.0);
        assert!((world_before.x - world_after.x).abs() < 1e-9);
        assert!((world_before.y - world_after.y).abs() < 1e-9);
    }

    #[test]
    fn pinch_zooms_around_the_gesture_center() {
        let mut camera = Camera::default();
        let center = Vec2::new(320.0, 180.0);
        let world_before = camera.screen_to_world(center);
        apply_pinch_delta(&mut camera, center, 0.2);
        let world_after = camera.screen_to_world(center);
        assert!((camera.zoom - 1.2).abs() < 1e-9);
        assert!((world_before.x - world_after.x).abs() < 1e-9);
        assert!((world_before.y - world_after.y).abs() < 1e-9);
    }

    #[test]
    fn selection_and_transform_handles_stay_screen_sized_across_zoom_levels() {
        let mut document = Document::empty("Zoom interaction");
        let page = document.root_page_id.clone();
        let node = Node::rectangle("Card", page, Layout::new(120.0, 90.0, 160.0, 80.0));
        let id = node.id.clone();
        document.nodes.insert(id.clone(), node);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);
        let geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);

        for zoom in [0.1, 0.25, 0.5, 1.0, 2.0, 4.0] {
            let camera = Camera::new(Vec2::new(37.0, -19.0), zoom);
            let world = Vec2::new(180.0, 120.0);
            let screen = camera.world_to_screen(world);
            let mapped = camera.screen_to_world(screen);
            assert!((mapped.x - world.x).abs() < 1e-8);
            assert!((mapped.y - world.y).abs() < 1e-8);
            assert_eq!(
                hit_test(&document, &bounds, &order, mapped),
                Some(id.clone())
            );

            let east = Vec2::new(280.0 + HANDLE_SCREEN_PX * 0.4 / zoom, 130.0);
            assert!(hit_resize_handle(
                east,
                std::slice::from_ref(&id),
                &bounds,
                &geometries,
                HANDLE_SCREEN_PX / zoom,
            )
            .is_some());
        }
    }

    #[test]
    fn parent_rotation_moves_child_hit_geometry() {
        let mut document = Document::empty("Parent transform");
        let page = document.root_page_id.clone();
        let mut parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        parent.rotation = 90.0;
        let parent_id = parent.id.clone();
        let child = Node::rectangle(
            "Child",
            parent_id.clone(),
            Layout::new(0.0, 0.0, 20.0, 20.0),
        );
        let child_id = child.id.clone();
        document.nodes.insert(parent_id, parent);
        document.nodes.insert(child_id.clone(), child);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);

        assert_eq!(
            hit_test(&document, &bounds, &order, Vec2::new(90.0, 10.0)),
            Some(child_id)
        );
    }

    #[test]
    fn rotated_hit_testing_rejects_empty_aabb_corners() {
        let mut document = Document::empty("Rotated hit");
        let page = document.root_page_id.clone();
        let mut node = Node::rectangle("Diamond", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        node.rotation = 45.0;
        let node_id = node.id.clone();
        document.nodes.insert(node_id.clone(), node);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);

        assert_ne!(
            hit_test(&document, &bounds, &order, Vec2::new(0.0, 0.0)),
            Some(node_id)
        );
    }

    #[test]
    fn parent_motion_translation_and_scale_propagate_to_children() {
        let mut document = Document::empty("Parent motion");
        let page = document.root_page_id.clone();
        let parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        let parent_id = parent.id.clone();
        let child = Node::rectangle(
            "Child",
            parent_id.clone(),
            Layout::new(0.0, 0.0, 20.0, 20.0),
        );
        let child_id = child.id.clone();
        document.nodes.insert(parent_id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);
        let bounds = absolute_bounds(&document);
        let frames = HashMap::from([(
            parent_id,
            MotionFrame {
                opacity: 1.0,
                x: 10.0,
                y: 20.0,
                scale_x: 2.0,
                scale_y: 2.0,
                rotate: 0.0,
                fill: None,
                corners: loora_engine::Corners::default(),
                stroke: None,
            },
        )]);

        let geometry = visual_geometries(&document, &bounds, &frames, None)[&child_id];

        assert_eq!(geometry.bounds, Bounds::new(-40.0, -30.0, 40.0, 40.0));
    }

    #[test]
    fn hit_testing_respects_rounded_overflow_corners() {
        let mut document = Document::empty("Rounded hit clip");
        let page = document.root_page_id.clone();
        let mut clip = Node::frame("Clip", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        clip.style.overflow = Overflow::Hidden;
        clip.style.corners = loora_engine::Corners::uniform(40.0);
        let clip_id = clip.id.clone();
        let child = Node::rectangle(
            "Child",
            clip_id.clone(),
            Layout::new(0.0, 0.0, 100.0, 100.0),
        );
        let child_id = child.id.clone();
        document.nodes.insert(clip_id, clip);
        document.nodes.insert(child_id.clone(), child);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);

        assert_ne!(
            hit_test(&document, &bounds, &order, Vec2::new(5.0, 5.0)),
            Some(child_id)
        );
    }

    #[test]
    fn style_fixture_transformed_child_is_hittable_at_its_painted_center() {
        let document = crate::style_fixture::style_fixture_document();
        let child_id = NodeId::from("fixture_transform_accent");
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);
        let geometry = visual_geometries(&document, &bounds, &HashMap::new(), None)[&child_id];
        let center = Vec2::new(
            geometry.bounds.x + geometry.bounds.width * 0.5,
            geometry.bounds.y + geometry.bounds.height * 0.5,
        );

        assert_eq!(hit_test(&document, &bounds, &order, center), Some(child_id));
    }

    #[test]
    fn rotated_selection_handles_follow_the_painted_geometry() {
        let mut document = Document::empty("Rotated selection");
        let page = document.root_page_id.clone();
        let mut node = Node::rectangle("Rotated", page, Layout::new(0.0, 0.0, 100.0, 50.0));
        node.rotation = 90.0;
        let id = node.id.clone();
        document.nodes.insert(id.clone(), node);
        let bounds = absolute_bounds(&document);
        let geometry = visual_geometries(&document, &bounds, &HashMap::new(), None)[&id];
        let east = Vec2::new(
            (geometry.corners[1].x + geometry.corners[2].x) * 0.5,
            (geometry.corners[1].y + geometry.corners[2].y) * 0.5,
        );
        let top = Vec2::new(
            (geometry.corners[0].x + geometry.corners[1].x) * 0.5,
            (geometry.corners[0].y + geometry.corners[1].y) * 0.5,
        );
        let center = Vec2::new(
            geometry.corners.iter().map(|point| point.x).sum::<f64>() / 4.0,
            geometry.corners.iter().map(|point| point.y).sum::<f64>() / 4.0,
        );
        let outward = Vec2::new(top.x - center.x, top.y - center.y);
        let length = (outward.x.powi(2) + outward.y.powi(2)).sqrt();
        let outward = Vec2::new(outward.x / length, outward.y / length);
        let rotation_handle = Vec2::new(top.x + outward.x * 24.0, top.y + outward.y * 24.0);

        let (handle, _, basis) = hit_resize_handle(
            east,
            std::slice::from_ref(&id),
            &bounds,
            &visual_geometries(&document, &bounds, &HashMap::new(), None),
            1.0,
        )
        .expect("painted east handle should be interactive");
        assert_eq!(handle, ResizeHandle::East);
        let local_delta = basis.project(Vec2::new(0.0, 10.0));
        assert!((local_delta.x - 10.0).abs() < 0.001);
        assert!(local_delta.y.abs() < 0.001);
        assert!(hit_rotation_handle(
            rotation_handle,
            std::slice::from_ref(&id),
            &visual_geometries(&document, &bounds, &HashMap::new(), None),
            1.0,
            24.0,
        )
        .is_some());
    }

    #[test]
    fn marquee_uses_transformed_shape_instead_of_empty_aabb_corners() {
        let geometry = VisualGeometry::from_matrix(
            Bounds::new(0.0, 0.0, 100.0, 100.0),
            Affine2::around(
                Vec2::new(50.0, 50.0),
                Vec2::default(),
                Vec2::new(1.0, 1.0),
                45.0,
            ),
        );

        assert!(!quad_intersects_bounds(
            geometry.corners,
            Bounds::new(-20.0, -20.0, 5.0, 5.0),
        ));
        assert!(quad_intersects_bounds(
            geometry.corners,
            Bounds::new(45.0, 45.0, 10.0, 10.0),
        ));
    }

    #[test]
    fn complex_page_raster_survives_drag_start() {
        let document = crate::style_fixture::style_fixture_document();
        let page = document.root_page_id.clone();
        let bounds = absolute_bounds(&document);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
        assert!(canvas.page_rasters.contains_key(&page));
        let original_image = canvas.page_rasters[&page].image.clone();

        let dragged = NodeId::from("fixture_transform_card");
        let original = bounds[&dragged];
        canvas.drag = Some(DragState::Move {
            start_world: Vec2::new(original.x, original.y),
            ids: vec![dragged.clone()],
            originals: HashMap::from([(dragged, original)]),
            delta: Vec2::new(10.0, 5.0),
            duplicate: false,
        });
        let preview_bounds = canvas.preview_bounds();
        canvas.sync_page_rasters(&document, &HashMap::new(), &preview_bounds);

        assert!(canvas.page_rasters.contains_key(&page));
        assert!(!Arc::ptr_eq(
            &original_image,
            &canvas.page_rasters[&page].image
        ));
    }

    fn next_batch_complex_document() -> (Document, NodeId, NodeId, NodeId) {
        let mut document = Document::empty("Interaction raster");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 320.0;
            page_node.layout.height = 140.0;
            page_node
                .style
                .set_solid_fill(Some(Color::rgb(255, 255, 255)));
        }
        let mut gradient = Node::rectangle(
            "Gradient",
            page.clone(),
            Layout::new(20.0, 20.0, 80.0, 80.0),
        );
        gradient.id = NodeId::from("interaction_gradient");
        gradient.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                loora_engine::GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 0, 0),
                    token_id: None,
                },
                loora_engine::GradientStop {
                    offset: 1.0,
                    color: Color::rgb(0, 0, 255),
                    token_id: None,
                },
            ],
        }];
        let gradient_id = gradient.id.clone();
        let mut text = Node::text(
            "Editable",
            page.clone(),
            Layout::new(140.0, 35.0, 140.0, 48.0),
            "Edit me",
        );
        text.id = NodeId::from("interaction_text");
        text.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                loora_engine::GradientStop {
                    offset: 0.0,
                    color: Color::rgb(20, 20, 20),
                    token_id: None,
                },
                loora_engine::GradientStop {
                    offset: 1.0,
                    color: Color::rgb(90, 90, 90),
                    token_id: None,
                },
            ],
        }];
        let text_id = text.id.clone();
        document.nodes.insert(gradient_id.clone(), gradient);
        document.nodes.insert(text_id.clone(), text);
        (document, page, gradient_id, text_id)
    }

    #[test]
    fn next_batch_move_drag_reuses_raster_between_pointer_updates() {
        let (document, page, id, _) = next_batch_complex_document();
        let bounds = absolute_bounds(&document);
        let original = bounds[&id];
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.drag = Some(DragState::Move {
            start_world: Vec2::new(original.x, original.y),
            ids: vec![id.clone()],
            originals: HashMap::from([(id, original)]),
            delta: Vec2::new(10.0, 0.0),
            duplicate: false,
        });
        let preview_bounds = canvas.preview_bounds();
        canvas.sync_page_rasters(&document, &HashMap::new(), &preview_bounds);
        let first = canvas.page_rasters[&page].image.clone();
        let first_overlay = canvas.page_rasters[&page].overlay.clone().unwrap();
        if let Some(DragState::Move { delta, .. }) = canvas.drag.as_mut() {
            *delta = Vec2::new(20.0, 0.0);
        }
        let started = Instant::now();
        let preview_bounds = canvas.preview_bounds();
        canvas.sync_page_rasters(&document, &HashMap::new(), &preview_bounds);
        eprintln!("cached move raster update took {:?}", started.elapsed());

        assert!(Arc::ptr_eq(&first, &canvas.page_rasters[&page].image));
        assert!(Arc::ptr_eq(
            &first_overlay,
            canvas.page_rasters[&page].overlay.as_ref().unwrap()
        ));
    }

    #[test]
    fn next_batch_text_edit_keeps_complex_page_rasterized() {
        let (document, page, _, text_id) = next_batch_complex_document();
        let bounds = absolute_bounds(&document);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
        assert!(canvas.page_rasters.contains_key(&page));
        canvas.text_edit = Some(NativeTextEdit {
            id: text_id,
            anchor: 0,
            caret: 0,
            caret_visible: true,
        });
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);

        assert!(canvas.page_rasters.contains_key(&page));
    }

    #[test]
    fn next_editor_small_zoom_delta_reuses_page_raster() {
        let (document, page, _, _) = next_batch_complex_document();
        let bounds = absolute_bounds(&document);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
        let first = canvas.page_rasters[&page].image.clone();

        canvas.camera.zoom = 1.01;
        let started = Instant::now();
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
        eprintln!("small zoom raster update took {:?}", started.elapsed());

        assert!(Arc::ptr_eq(&first, &canvas.page_rasters[&page].image));
    }

    #[test]
    fn zoom_raster_covers_retina_device_pixels() {
        let zoom = 0.7;
        let display_scale = 2.0;
        let raster_scale = raster_scale_for_zoom(zoom, display_scale);

        assert!(
            raster_scale >= zoom as f32 * display_scale,
            "raster scale {raster_scale} undersamples {zoom}x zoom on a {display_scale}x display"
        );
    }

    #[test]
    fn continuous_zoom_does_not_cross_many_raster_buckets() {
        let scales = (35..=200)
            .map(|percent| raster_scale_for_zoom(percent as f64 / 100.0, 2.0))
            .collect::<Vec<_>>();
        let changes = scales
            .windows(2)
            .filter(|pair| pair[0].to_bits() != pair[1].to_bits())
            .count();

        assert!(
            changes <= 2,
            "continuous zoom crossed {changes} raster buckets: {scales:?}"
        );
    }

    #[gpui::test]
    fn zoom_upgrade_keeps_current_raster_while_sharper_pixels_render(cx: &mut TestAppContext) {
        let (document, page, _, _) = next_batch_complex_document();
        let bounds = absolute_bounds(&document);
        let canvas = cx.new(|cx| NativeCanvas::new(document.clone(), Camera::default(), cx));
        let first = canvas.update(cx, |canvas, _| {
            canvas.display_scale = 2.0;
            canvas.camera.zoom = 0.35;
            canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
            canvas.page_rasters[&page].image.clone()
        });

        canvas.update(cx, |canvas, cx| {
            canvas.camera.zoom = 0.7;
            canvas.sync_page_rasters_with_context(&document, &HashMap::new(), &bounds, Some(cx));
            assert!(Arc::ptr_eq(&first, &canvas.page_rasters[&page].image));
            assert!(canvas.page_raster_jobs.contains_key(&page));
        });
        cx.run_until_parked();

        let (upgraded, scale) = canvas.update(cx, |canvas, _| {
            (
                canvas.page_rasters[&page].image.clone(),
                canvas.page_rasters[&page].scale,
            )
        });
        assert!(!Arc::ptr_eq(&first, &upgraded));
        assert_eq!(scale, 2.0);
    }

    #[gpui::test]
    fn next_editor_unrelated_page_edit_reuses_unchanged_raster(cx: &mut TestAppContext) {
        let mut document = Document::empty("Page-local raster cache");
        let first_page = document.root_page_id.clone();
        document.nodes.get_mut(&first_page).unwrap().layout = Layout::new(0.0, 0.0, 120.0, 120.0);
        let mut second_page_node = Node::root_frame("Second");
        second_page_node.layout = Layout::new(200.0, 0.0, 120.0, 120.0);
        let second_page = second_page_node.id.clone();
        document.nodes.insert(second_page.clone(), second_page_node);
        let mut first_card = Node::rectangle(
            "First card",
            first_page.clone(),
            Layout::new(20.0, 20.0, 80.0, 80.0),
        );
        first_card.rotation = 12.0;
        document.nodes.insert(first_card.id.clone(), first_card);
        let mut second_card = Node::rectangle(
            "Second card",
            second_page.clone(),
            Layout::new(20.0, 20.0, 80.0, 80.0),
        );
        second_card.rotation = -12.0;
        let second_card_id = second_card.id.clone();
        document.nodes.insert(second_card_id.clone(), second_card);

        let canvas = cx.new(|cx| NativeCanvas::new(document.clone(), Camera::default(), cx));
        let (first_image, second_image) = canvas.update(cx, |canvas, _| {
            let bounds = absolute_bounds(&document);
            canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
            (
                canvas.page_rasters[&first_page].image.clone(),
                canvas.page_rasters[&second_page].image.clone(),
            )
        });

        let mut updated = document.clone();
        updated
            .nodes
            .get_mut(&second_card_id)
            .unwrap()
            .style
            .set_solid_fill(Some(Color::rgb(255, 80, 80)));
        canvas.update(cx, |canvas, cx| {
            canvas.set_scene(
                Arc::new(updated.clone()),
                1,
                Camera::default(),
                Vec::new(),
                Vec::new(),
                CanvasTool::Select,
                false,
                None,
                None,
                CanvasPalette::default(),
                cx,
            );
            let bounds = absolute_bounds(&updated);
            canvas.sync_page_rasters(&updated, &HashMap::new(), &bounds);

            assert!(Arc::ptr_eq(
                &first_image,
                &canvas.page_rasters[&first_page].image
            ));
            assert!(!Arc::ptr_eq(
                &second_image,
                &canvas.page_rasters[&second_page].image
            ));
        });
    }

    #[test]
    fn next_batch_rotated_layout_badges_follow_the_container() {
        let mut document = Document::empty("Rotated layout controls");
        let page = document.root_page_id.clone();
        let mut stack = Node::frame("Stack", page, Layout::new(100.0, 80.0, 240.0, 160.0));
        stack.layout.mode = LayoutMode::Flex;
        stack.rotation = 90.0;
        stack.layout.gap = 20.0;
        let stack_id = stack.id.clone();
        document.nodes.insert(stack_id.clone(), stack);
        for (index, x) in [12.0, 92.0].into_iter().enumerate() {
            let mut child = Node::rectangle(
                format!("Child {index}"),
                stack_id.clone(),
                Layout::new(x, 12.0, 60.0, 48.0),
            );
            child.layout.position = loora_engine::LayoutPosition::Flow;
            child.order = index as f64 * 1024.0;
            document.nodes.insert(child.id.clone(), child);
        }
        let bounds = absolute_bounds(&document);
        let geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);
        let (_, badges) = layout_badges(
            std::slice::from_ref(&stack_id),
            &document,
            &bounds,
            &geometries,
            1.0,
        )
        .unwrap();
        let badge_center = Vec2::new(
            badges[0].bounds.x + badges[0].bounds.width * 0.5,
            badges[0].bounds.y + badges[0].bounds.height * 0.5,
        );
        let raw_center = gap_badge_position(&document.nodes[&stack_id], &document, &bounds)
            .unwrap()
            .0;
        let expected = geometries[&stack_id].matrix.apply(raw_center);

        assert!(point_distance(badge_center, expected) < 0.001);
    }

    #[test]
    fn next_batch_multi_resize_uses_the_painted_group_bounds() {
        let mut document = Document::empty("Transformed multi selection");
        let page = document.root_page_id.clone();
        let mut rotated =
            Node::rectangle("Rotated", page.clone(), Layout::new(0.0, 0.0, 100.0, 100.0));
        rotated.rotation = 45.0;
        let rotated_id = rotated.id.clone();
        let plain = Node::rectangle("Plain", page, Layout::new(200.0, 0.0, 100.0, 100.0));
        let plain_id = plain.id.clone();
        document.nodes.insert(rotated_id.clone(), rotated);
        document.nodes.insert(plain_id.clone(), plain);
        let selection = vec![rotated_id, plain_id];
        let bounds = absolute_bounds(&document);
        let geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);
        let visual = selection_visual_geometry(&selection, &geometries).unwrap();
        let handles = visual.handles();
        let (_, group, _) =
            hit_resize_handle(handles[3], &selection, &bounds, &geometries, 1.0).unwrap();

        assert!((group.x - visual.corners[0].x).abs() < 0.001);
        assert!((group.right() - visual.corners[2].x).abs() < 0.001);
    }

    #[test]
    fn next_batch_multi_rotation_moves_members_around_the_group_center() {
        let mut document = Document::empty("Multi rotation");
        let page = document.root_page_id.clone();
        let left = Node::rectangle("Left", page.clone(), Layout::new(0.0, 0.0, 100.0, 100.0));
        let left_id = left.id.clone();
        let right = Node::rectangle("Right", page, Layout::new(200.0, 0.0, 100.0, 100.0));
        let right_id = right.id.clone();
        document.nodes.insert(left_id.clone(), left);
        document.nodes.insert(right_id.clone(), right);
        let bounds = absolute_bounds(&document);
        let selection = vec![left_id.clone(), right_id.clone()];
        let original_geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);
        let transform =
            multi_transform(&selection, &document, &bounds, &original_geometries).unwrap();
        let rotated_bounds = rotate_multi_transform(&transform, Vec2::new(150.0, 50.0), 90.0);
        let mut preview_bounds = bounds.clone();
        preview_bounds.extend(
            rotated_bounds
                .iter()
                .map(|(id, bounds)| (id.clone(), *bounds)),
        );
        let drag = DragState::Rotate {
            center: Vec2::new(150.0, 50.0),
            start_angle: 0.0,
            originals: HashMap::from([(left_id.clone(), 0.0), (right_id.clone(), 0.0)]),
            current: HashMap::from([(left_id.clone(), 90.0), (right_id, 90.0)]),
            bounds: Some(MultiRotateBounds {
                current: rotated_bounds,
                members: transform,
            }),
        };
        let geometries =
            visual_geometries(&document, &preview_bounds, &HashMap::new(), Some(&drag));
        let center = geometries[&left_id].bounds;

        assert!((center.x + center.width * 0.5 - 150.0).abs() < 0.001);
        assert!((center.y + center.height * 0.5 + 50.0).abs() < 0.001);
    }

    #[test]
    fn drag_preview_raster_moves_gradient_pixels_without_dropping_style() {
        let mut document = Document::empty("Gradient drag");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 240.0;
            page_node.layout.height = 100.0;
            page_node
                .style
                .set_solid_fill(Some(Color::rgb(255, 255, 255)));
        }
        let mut gradient = Node::rectangle(
            "Gradient",
            page.clone(),
            Layout::new(20.0, 20.0, 40.0, 40.0),
        );
        gradient.id = NodeId::from("drag_gradient");
        gradient.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                loora_engine::GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 0, 0),
                    token_id: None,
                },
                loora_engine::GradientStop {
                    offset: 1.0,
                    color: Color::rgb(0, 0, 255),
                    token_id: None,
                },
            ],
        }];
        let id = gradient.id.clone();
        document.nodes.insert(id.clone(), gradient);
        let bounds = absolute_bounds(&document);
        let original = bounds[&id];
        let drag = DragState::Move {
            start_world: Vec2::new(original.x, original.y),
            ids: vec![id.clone()],
            originals: HashMap::from([(id.clone(), original)]),
            delta: Vec2::new(120.0, 0.0),
            duplicate: false,
        };
        let mut preview_bounds = bounds.clone();
        translate_subtree(&document, &id, 120.0, 0.0, &mut preview_bounds);
        let preview = raster_preview_document(&document, &preview_bounds, Some(&drag)).unwrap();
        let image = scene_raster::render_page(&preview, &page, &HashMap::new(), 1.0).unwrap();
        let old_center = image.get_pixel(40, 40).0;
        let moved_center = image.get_pixel(160, 40).0;

        assert!(old_center[0] > 245 && old_center[1] > 245 && old_center[2] > 245);
        assert!(moved_center[0] > 40 && moved_center[2] > 40);
        assert!(moved_center[1] < 40);
        assert_eq!(moved_center[3], 255);
    }

    #[test]
    fn layout_metric_badges_stay_screen_sized_and_draggable() {
        let mut document = Document::empty("Layout controls");
        let page = document.root_page_id.clone();
        let mut stack = Node::frame("Stack", page, Layout::new(100.0, 80.0, 320.0, 180.0));
        stack.layout.mode = LayoutMode::Flex;
        stack.layout.gap = 16.0;
        stack.layout.padding = Insets::uniform(12.0);
        let stack_id = stack.id.clone();
        document.nodes.insert(stack_id.clone(), stack);
        for (index, x) in [12.0, 88.0].into_iter().enumerate() {
            let mut child = Node::rectangle(
                format!("Child {index}"),
                stack_id.clone(),
                Layout::new(x, 12.0, 60.0, 48.0),
            );
            child.layout.position = loora_engine::LayoutPosition::Flow;
            child.order = index as f64 * 1024.0;
            document.nodes.insert(child.id.clone(), child);
        }
        let bounds = absolute_bounds(&document);
        let geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);
        let (_, at_half) = layout_badges(
            std::slice::from_ref(&stack_id),
            &document,
            &bounds,
            &geometries,
            0.5,
        )
        .unwrap();
        let (_, at_double) = layout_badges(
            std::slice::from_ref(&stack_id),
            &document,
            &bounds,
            &geometries,
            2.0,
        )
        .unwrap();

        assert_eq!(at_half.len(), 5);
        assert_eq!(at_double.len(), 5);
        assert!((at_half[0].bounds.width * 0.5 - at_double[0].bounds.width * 2.0).abs() < 0.01);
        assert!(at_half
            .iter()
            .any(|badge| matches!(badge.kind, LayoutBadgeKind::Gap(FlexDirection::Row))));
        assert_eq!(
            resized_padding(
                Insets::uniform(12.0),
                PaddingEdge::Left,
                Vec2::new(18.0, 50.0),
                320.0,
                180.0,
            ),
            Insets {
                left: 30.0,
                ..Insets::uniform(12.0)
            }
        );
    }

    #[test]
    fn large_scene_index_covers_every_node_without_quadratic_tree_scans() {
        let mut document = Document::empty("Large scene");
        let page = document.root_page_id.clone();
        for index in 0..5_000 {
            let mut node = Node::rectangle(
                format!("Node {index}"),
                page.clone(),
                Layout::new(
                    (index % 100) as f64 * 12.0,
                    (index / 100) as f64 * 12.0,
                    10.0,
                    10.0,
                ),
            );
            node.order = index as f64;
            document.nodes.insert(node.id.clone(), node);
        }
        let started = Instant::now();
        let order = paint_order(&document);
        let bounds = absolute_bounds(&document);
        eprintln!(
            "indexed {} nodes in {:?}",
            document.nodes.len(),
            started.elapsed()
        );
        assert_eq!(order.len(), document.nodes.len());
        assert_eq!(bounds.len(), document.nodes.len());
    }

    #[test]
    fn flex_drag_shows_an_insertion_guide_before_the_target_child() {
        let mut document = Document::empty("Guide");
        let page = document.root_page_id.clone();
        let mut stack = Node::frame("Stack", page, Layout::new(100.0, 80.0, 240.0, 100.0));
        stack.layout.mode = loora_engine::LayoutMode::Flex;
        let stack_id = stack.id.clone();
        document.nodes.insert(stack_id.clone(), stack);
        let mut dragged =
            Node::rectangle("A", stack_id.clone(), Layout::new(10.0, 10.0, 50.0, 40.0));
        dragged.layout.position = loora_engine::LayoutPosition::Flow;
        let dragged_id = dragged.id.clone();
        document.nodes.insert(dragged_id.clone(), dragged);
        let mut target = Node::rectangle("B", stack_id, Layout::new(80.0, 10.0, 50.0, 40.0));
        target.layout.position = loora_engine::LayoutPosition::Flow;
        target.order = 2048.0;
        document.nodes.insert(target.id.clone(), target);
        let bounds = absolute_bounds(&document);

        let order = paint_order(&document);
        let guide = flow_drop_guide(
            &document,
            &order,
            &dragged_id,
            Vec2::new(170.0, 110.0),
            &bounds,
        )
        .unwrap();
        assert_eq!(guide.axis, GuideAxis::Vertical);
        assert!((guide.position - 180.0).abs() < f64::EPSILON);
    }
}
