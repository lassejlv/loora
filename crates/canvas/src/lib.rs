//! Native GPUI canvas surface for Loora.
//!
//! This crate deliberately depends on the document engine, not on `loora-ui`.
//! The desktop shell remains responsible for history, persistence and panels;
//! this surface owns drawing and pointer interactions.

mod motion;

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use gpui::{
    canvas, div, fill, font, linear_color_stop, linear_gradient, outline, point, px, quad, size,
    App, Background, BorderStyle, Bounds as GpBounds, BoxShadow, ContentMask, Context,
    Corners as GpCorners, Edges, EventEmitter, FontWeight, Hsla, InteractiveElement, IntoElement,
    MouseButton, MouseDownEvent, MouseExitEvent, MouseMoveEvent, MouseUpEvent, ParentElement,
    Path as GpPath, PathBuilder, PinchEvent, Pixels, Point, Render, RenderImage, Rgba,
    ScrollWheelEvent, ShapedLine, SharedString, Styled, TextAlign as GpTextAlign, TextRun, Window,
};
use loora_engine::{
    Bounds, Camera, Color, Document, ImageFit, Node, NodeId, NodeKind, Overflow, Paint, ShapeKind,
    TextAlign as EngineTextAlign, Vec2,
};
use svgtypes::{PathParser, PathSegment};

use motion::{MotionFrame, MotionRuntime};

const SNAP_SCREEN_PX: f64 = 6.0;
const HANDLE_SCREEN_PX: f64 = 8.0;
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
    ResizeCommitted(Vec<(NodeId, Bounds)>),
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
        originals: HashMap<NodeId, Bounds>,
        group: Bounds,
        current: HashMap<NodeId, Bounds>,
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

pub struct NativeCanvas {
    document: Document,
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
    viewport: Rc<Cell<GpBounds<Pixels>>>,
    drag: Option<DragState>,
    guides: Vec<Guide>,
    hovered: Option<NodeId>,
    pressed: Option<NodeId>,
    focused: Option<NodeId>,
    motion: MotionRuntime,
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
        Self {
            document,
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
            viewport,
            drag: None,
            guides: Vec::new(),
            hovered: None,
            pressed: None,
            focused: None,
            motion: MotionRuntime::default(),
            space_pan: false,
            pointer_world: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_scene(
        &mut self,
        document: Document,
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
        let document_changed = self.revision != revision || self.document != document;
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
            self.sync_images(&document);
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

    fn viewport_local(&self, position: Point<Pixels>) -> Vec2 {
        let viewport = self.viewport.get();
        Vec2::new(
            f32::from(position.x - viewport.origin.x) as f64,
            f32::from(position.y - viewport.origin.y) as f64,
        )
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
        let all_bounds = absolute_bounds(&self.document);

        if self.preview {
            if event.button == MouseButton::Left {
                let preview_world = if let Some(overlay) = self.preview_overlay.as_ref() {
                    let Some(overlay_bounds) = all_bounds.get(overlay).copied() else {
                        return;
                    };
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
                    let overlay_world = self.camera.screen_to_world(original_screen);
                    if !overlay_bounds.contains(overlay_world) {
                        cx.emit(CanvasEvent::OverlayCloseRequested);
                        cx.stop_propagation();
                        return;
                    }
                    overlay_world
                } else {
                    world
                };
                let hit = hit_test(&self.document, &all_bounds, preview_world);
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
                hit: hit_test(&self.document, &all_bounds, world),
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

        if let Some((handle, group)) = hit_resize_handle(
            world,
            &self.selection,
            &all_bounds,
            HANDLE_SCREEN_PX / self.camera.zoom,
        ) {
            let originals = self
                .selection
                .iter()
                .filter_map(|id| {
                    all_bounds
                        .get(id)
                        .copied()
                        .map(|bounds| (id.clone(), bounds))
                })
                .collect::<HashMap<_, _>>();
            self.drag = Some(DragState::Resize {
                start_world: world,
                handle,
                originals: originals.clone(),
                group,
                current: originals,
            });
            cx.stop_propagation();
            return;
        }

        if let Some(hit) = hit_test(&self.document, &all_bounds, world) {
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
        let all_bounds = absolute_bounds(&self.document);
        if self.preview {
            let hit = hit_test(&self.document, &all_bounds, world);
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
        let snap_bounds = match &self.drag {
            Some(DragState::Move { ids, .. }) => all_bounds
                .iter()
                .filter(|(id, _)| {
                    !ids.iter()
                        .any(|root| is_descendant_or_self(id, root, &self.document))
                })
                .map(|(id, bounds)| (id.clone(), *bounds))
                .collect(),
            _ => all_bounds.clone(),
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
                originals,
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
                    snap_move(raw, ids, originals, &snap_bounds, self.camera.zoom);
                *delta = snapped;
                self.guides = guides;
            }
            Some(DragState::Resize {
                start_world,
                handle,
                originals,
                group,
                current,
            }) => {
                let delta = Vec2::new(world.x - start_world.x, world.y - start_world.y);
                let resized_group = if event.modifiers.shift {
                    resize_bounds_with_aspect(*group, *handle, delta)
                } else {
                    resize_bounds(*group, *handle, delta)
                };
                *current = scale_group(originals, *group, resized_group);
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
                if let Some(guide) = flow_drop_guide(&self.document, id, world, &all_bounds) {
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
                cx.emit(CanvasEvent::ResizeCommitted(members));
            }
            Some(DragState::Marquee {
                start_world,
                current_world,
            }) => {
                let marquee = normalized_bounds(start_world, current_world);
                let all_bounds = absolute_bounds(&self.document);
                let mut selection = selectable_nodes(&self.document)
                    .into_iter()
                    .filter(|id| {
                        all_bounds
                            .get(id)
                            .is_some_and(|bounds| intersects(*bounds, marquee))
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
        let mut bounds = absolute_bounds(&self.document);
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
            _ => {}
        }
        bounds
    }
}

impl Render for NativeCanvas {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let now = Instant::now();
        let animating = self.motion.tick(
            &self.document,
            self.revision,
            self.preview,
            self.hovered.as_ref(),
            self.pressed.as_ref(),
            self.focused.as_ref(),
            now,
            cx.reduce_motion(),
        );
        if animating {
            window.request_animation_frame();
        }
        let document = self.document.clone();
        let motion_frames = self.motion.frames().clone();
        let camera = self.camera;
        let selection = self.selection.clone();
        let agent_nodes = self.agent_nodes.clone();
        let palette = self.palette;
        let guides = self.guides.clone();
        let preview_bounds = self.preview_bounds();
        let images = self.images.clone();
        let drag = self.drag.clone();
        let viewport = self.viewport.clone();
        let preview = self.preview;
        let preview_overlay = self.preview_overlay.clone();
        let text_edit = self.text_edit.clone();

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
                            &motion_frames,
                            &preview_bounds,
                            camera,
                            selection,
                            agent_nodes,
                            guides,
                            drag,
                            palette,
                            &images,
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
    }
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
}

#[derive(Clone)]
struct PreparedVectorPath {
    fill: Option<(GpPath<Pixels>, Hsla)>,
    stroke: Option<(GpPath<Pixels>, Hsla)>,
}

#[derive(Clone)]
struct PreparedNode {
    kind: NodeKind,
    shape_kind: ShapeKind,
    bounds: GpBounds<Pixels>,
    clip: GpBounds<Pixels>,
    fill: Background,
    border: Option<(Hsla, Pixels, BorderStyle)>,
    corners: GpCorners<Pixels>,
    text: Vec<PreparedText>,
    image: Option<Arc<RenderImage>>,
    image_fit: ImageFit,
    shadows: Vec<BoxShadow>,
    vector_paths: Vec<PreparedVectorPath>,
    rotation: f32,
    overlay_root: bool,
}

struct PreparedScene {
    nodes: Vec<PreparedNode>,
    labels: Vec<PreparedText>,
    selection: Vec<GpBounds<Pixels>>,
    agents: Vec<GpBounds<Pixels>>,
    guides: Vec<(GuideAxis, Pixels, Pixels, Pixels)>,
    marquee: Option<GpBounds<Pixels>>,
    create: Option<GpBounds<Pixels>>,
    overlay_scrim: bool,
    palette: CanvasPalette,
    viewport: GpBounds<Pixels>,
}

#[allow(clippy::too_many_arguments)]
fn prepare_scene(
    document: &Document,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    world_bounds: &HashMap<NodeId, Bounds>,
    camera: Camera,
    selection: Vec<NodeId>,
    agent_nodes: Vec<NodeId>,
    guides: Vec<Guide>,
    drag: Option<DragState>,
    palette: CanvasPalette,
    images: &HashMap<String, Arc<RenderImage>>,
    preview: bool,
    preview_overlay: Option<NodeId>,
    text_edit: Option<NativeTextEdit>,
    viewport: GpBounds<Pixels>,
    window: &mut Window,
) -> PreparedScene {
    let mut nodes = Vec::new();
    let mut labels = Vec::new();
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
    for id in paint_order_with_overlay(document, preview_overlay.as_ref()) {
        let Some(node) = document.nodes.get(&id) else {
            continue;
        };
        let Some(bounds) = world_bounds.get(&id).copied() else {
            continue;
        };
        let belongs_to_overlay = preview_overlay
            .as_ref()
            .is_some_and(|overlay| &id == overlay || is_descendant_of(document, &id, overlay));
        let mut screen = world_to_screen(bounds, camera, viewport);
        let overlay_scale = if belongs_to_overlay {
            if let Some((overlay_center, scale)) = overlay_transform {
                screen = overlay_screen_bounds(screen, overlay_center, scale, viewport.center());
                scale
            } else {
                1.0
            }
        } else {
            1.0
        };
        let motion = motion_frames.get(&id);
        if let Some(motion) = motion {
            let transform_scale = camera.zoom as f32 * overlay_scale;
            let center = screen.center()
                + point(
                    px(motion.x * transform_scale),
                    px(motion.y * transform_scale),
                );
            let scaled = size(
                screen.size.width * motion.scale_x.max(0.01),
                screen.size.height * motion.scale_y.max(0.01),
            );
            screen = GpBounds::new(
                point(
                    center.x - scaled.width / 2.0,
                    center.y - scaled.height / 2.0,
                ),
                scaled,
            );
        }
        if !screen.intersects(&viewport) || node_or_ancestor_hidden(document, node) {
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
        let opacity = motion
            .map_or(node.style.opacity, |motion| motion.opacity)
            .clamp(0.0, 1.0);
        let motion_fill = motion.and_then(|motion| motion.fill);
        let fill = if node.kind == NodeKind::Text {
            color_hsla(fallback_fill(node.kind), opacity).into()
        } else {
            motion_fill
                .map(|color| color_hsla(color, opacity).into())
                .unwrap_or_else(|| node_background(node, opacity))
        };
        let border = motion
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
            });
        let scale = camera.zoom as f32 * overlay_scale;
        let motion_corners = motion.map_or(node.style.corners, |motion| motion.corners);
        let corners = if node.shape_kind == ShapeKind::Ellipse {
            GpCorners::all(screen.size.width.min(screen.size.height) / 2.0)
        } else {
            GpCorners {
                top_left: px(motion_corners.tl * scale),
                top_right: px(motion_corners.tr * scale),
                bottom_right: px(motion_corners.br * scale),
                bottom_left: px(motion_corners.bl * scale),
            }
        };
        let text = prepare_node_text(
            node,
            screen,
            clip,
            scale,
            (motion_fill, opacity),
            text_edit.as_ref().filter(|edit| edit.id == id),
            window,
        );
        if node.is_root_frame() {
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
            });
        }
        let shadows = node
            .style
            .shadows
            .iter()
            .map(|shadow| BoxShadow {
                color: color_hsla(shadow.color, opacity),
                offset: point(px(shadow.x * scale), px(shadow.y * scale)),
                blur_radius: px((shadow.blur * scale).max(0.0)),
                spread_radius: px(shadow.spread * scale),
                inset: shadow.inset,
            })
            .collect();
        let rotation = node.rotation + motion.map_or(0.0, |motion| motion.rotate);
        let vector_paths = if node.kind == NodeKind::Vector {
            prepare_vector_paths(node, screen, opacity, rotation)
        } else {
            Vec::new()
        };
        nodes.push(PreparedNode {
            kind: node.kind,
            shape_kind: node.shape_kind,
            bounds: screen,
            clip,
            fill,
            border,
            corners,
            text,
            image: node
                .image_path
                .as_ref()
                .and_then(|path| images.get(path))
                .cloned(),
            image_fit: node.image_fit,
            shadows,
            vector_paths,
            rotation,
            overlay_root: preview_overlay.as_ref() == Some(&id),
        });
    }

    let selection = selection
        .iter()
        .filter_map(|id| world_bounds.get(id).copied())
        .map(|bounds| world_to_screen(bounds, camera, viewport))
        .collect();
    let agents = agent_nodes
        .iter()
        .filter_map(|id| world_bounds.get(id).copied())
        .map(|bounds| world_to_screen(bounds, camera, viewport))
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
        agents,
        guides,
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
                                let _ = text.line.paint(
                                    text.origin,
                                    text.line_height,
                                    text.align,
                                    Some(text.width),
                                    window,
                                    cx,
                                );
                                if let Some(caret) = text.caret {
                                    window.paint_quad(fill(caret, rgba(0xff, 0xff, 0xff, 0xff)));
                                }
                            },
                        );
                    }
                });
            }
            for bounds in scene.agents {
                window.paint_quad(outline(bounds, scene.palette.agent, BorderStyle::Dashed));
            }
            for bounds in scene.selection {
                paint_selection(bounds, scene.palette.selection, window);
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
    if node.rotation.abs() > f32::EPSILON && node.kind != NodeKind::Image {
        let points = rotated_rect_points(node.bounds, node.rotation);
        let mut fill_builder = PathBuilder::fill();
        fill_builder.add_polygon(&points, true);
        if let Ok(path) = fill_builder.build() {
            window.paint_path(path, node.fill);
        }
        if border_width > px(0.0) {
            let mut stroke_builder = PathBuilder::stroke(border_width);
            stroke_builder.add_polygon(&points, true);
            if let Ok(path) = stroke_builder.build() {
                window.paint_path(path, border_color);
            }
        }
    } else {
        window.paint_quad(quad(
            node.bounds,
            node.corners,
            node.fill,
            Edges::all(border_width),
            border_color,
            border_style,
        ));
    }

    if node.kind == NodeKind::Image {
        if let Some(image) = &node.image {
            let image_bounds = fitted_image_bounds(node.bounds, image, node.image_fit);
            let _ = window.paint_image(
                node.bounds,
                image_bounds,
                node.corners,
                image.clone(),
                0,
                false,
            );
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
    window.paint_inset_shadows(node.bounds, node.corners, &node.shadows);
}

fn rotated_rect_points(bounds: GpBounds<Pixels>, rotation: f32) -> [Point<Pixels>; 4] {
    let center = bounds.center();
    [
        point(bounds.left(), bounds.top()),
        point(bounds.right(), bounds.top()),
        point(bounds.right(), bounds.bottom()),
        point(bounds.left(), bounds.bottom()),
    ]
    .map(|point| rotate_point(point, center, rotation))
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

fn paint_selection(bounds: GpBounds<Pixels>, color: Hsla, window: &mut Window) {
    window.paint_quad(outline(bounds, color, BorderStyle::Solid));
    for position in handle_positions(bounds) {
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
    window: &mut Window,
) -> Vec<PreparedText> {
    if node.kind != NodeKind::Text {
        return Vec::new();
    }
    let typography = node.typography.clone().unwrap_or_default();
    let (color, opacity) = paint;
    let font_size = px((typography.size * scale).max(1.));
    let line_height = px(typography
        .line_height
        .unwrap_or(typography.size * 1.25)
        .max(1.)
        * scale);
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
    text.split('\n')
        .enumerate()
        .map(|(index, line)| {
            let line_start = byte_offset;
            let line_end = line_start + line.len();
            byte_offset = line_end + 1;
            let shared = SharedString::from(line.to_owned());
            let mut text_font = font(if typography.family == "System" {
                ".SystemUIFont"
            } else {
                typography.family.as_str()
            });
            text_font.weight = FontWeight(typography.weight as f32);
            let run = TextRun {
                len: shared.len(),
                font: text_font,
                color: color_hsla(color.unwrap_or(typography.color), opacity),
                ..Default::default()
            };
            let line = window
                .text_system()
                .shape_line(shared, font_size, &[run], None);
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
            PreparedText {
                line,
                origin,
                line_height,
                align,
                width: bounds.size.width,
                clip,
                selection,
                caret,
            }
        })
        .collect()
}

fn fallback_fill(kind: NodeKind) -> Color {
    match kind {
        NodeKind::Image => Color::rgb(0x2a, 0x2a, 0x2e),
        NodeKind::Vector => Color::rgba(0.7, 0.7, 0.75, 0.18),
        _ => Color::rgba(0.0, 0.0, 0.0, 0.0),
    }
}

fn node_background(node: &Node, opacity: f32) -> Background {
    match node.style.fills.first() {
        Some(Paint::Solid { color, .. }) => color_hsla(*color, opacity).into(),
        Some(Paint::LinearGradient { angle, stops }) if stops.len() >= 2 => {
            let first = &stops[0];
            let last = &stops[stops.len() - 1];
            linear_gradient(
                *angle,
                linear_color_stop(color_hsla(first.color, opacity), first.offset),
                linear_color_stop(color_hsla(last.color, opacity), last.offset),
            )
        }
        Some(Paint::LinearGradient { stops, .. }) | Some(Paint::RadialGradient { stops, .. }) => {
            stops
                .first()
                .map(|stop| color_hsla(stop.color, opacity).into())
                .unwrap_or_else(|| color_hsla(fallback_fill(node.kind), opacity).into())
        }
        None => color_hsla(fallback_fill(node.kind), opacity).into(),
    }
}

fn load_render_image(path: &Path) -> Option<Arc<RenderImage>> {
    let mut image = image::open(path).ok()?.into_rgba8();
    for pixel in image.as_mut().chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let frame = image::Frame::new(image);
    Some(Arc::new(RenderImage::new(smallvec::smallvec![frame])))
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

fn world_x(value: f64, camera: Camera, viewport: GpBounds<Pixels>) -> Pixels {
    viewport.origin.x + px((value * camera.zoom + camera.pan.x) as f32)
}

fn world_y(value: f64, camera: Camera, viewport: GpBounds<Pixels>) -> Pixels {
    viewport.origin.y + px((value * camera.zoom + camera.pan.y) as f32)
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
    fn visit(document: &Document, parent: Option<&NodeId>, output: &mut Vec<NodeId>) {
        let mut children = document
            .nodes
            .values()
            .filter(|node| node.parent_id.as_ref() == parent)
            .collect::<Vec<_>>();
        children.sort_by(|left, right| {
            left.order
                .total_cmp(&right.order)
                .then_with(|| left.id.as_str().cmp(right.id.as_str()))
        });
        for node in children {
            output.push(node.id.clone());
            visit(document, Some(&node.id), output);
        }
    }
    let mut output = Vec::new();
    visit(document, None, &mut output);
    output
}

fn paint_order_with_overlay(document: &Document, overlay: Option<&NodeId>) -> Vec<NodeId> {
    let mut order = paint_order(document);
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

fn hit_test(document: &Document, bounds: &HashMap<NodeId, Bounds>, world: Vec2) -> Option<NodeId> {
    paint_order(document)
        .into_iter()
        .rev()
        .find(|id| {
            document.nodes.get(id).is_some_and(|node| {
                !node_or_ancestor_hidden(document, node)
                    && !node.locked
                    && !node.is_root_frame()
                    && bounds.get(id).is_some_and(|bounds| bounds.contains(world))
            })
        })
        .or_else(|| {
            paint_order(document).into_iter().rev().find(|id| {
                document.nodes.get(id).is_some_and(|node| {
                    !node_or_ancestor_hidden(document, node)
                        && !node.locked
                        && bounds.get(id).is_some_and(|bounds| bounds.contains(world))
                })
            })
        })
}

fn flow_drop_guide(
    document: &Document,
    dragged: &NodeId,
    world: Vec2,
    bounds: &HashMap<NodeId, Bounds>,
) -> Option<Guide> {
    let stack = paint_order(document).into_iter().rev().find_map(|id| {
        let node = document.nodes.get(&id)?;
        (node.is_container()
            && matches!(
                node.layout.mode,
                loora_engine::LayoutMode::Flex | loora_engine::LayoutMode::Grid
            )
            && !is_descendant_or_self(&id, dragged, document)
            && bounds.get(&id).is_some_and(|bounds| bounds.contains(world)))
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

fn hit_resize_handle(
    world: Vec2,
    selection: &[NodeId],
    bounds: &HashMap<NodeId, Bounds>,
    radius: f64,
) -> Option<(ResizeHandle, Bounds)> {
    let group = selection_bounds(selection, bounds)?;
    let points = [
        (ResizeHandle::NorthWest, Vec2::new(group.x, group.y)),
        (
            ResizeHandle::North,
            Vec2::new(group.x + group.width / 2.0, group.y),
        ),
        (ResizeHandle::NorthEast, Vec2::new(group.right(), group.y)),
        (
            ResizeHandle::East,
            Vec2::new(group.right(), group.y + group.height / 2.0),
        ),
        (
            ResizeHandle::SouthEast,
            Vec2::new(group.right(), group.bottom()),
        ),
        (
            ResizeHandle::South,
            Vec2::new(group.x + group.width / 2.0, group.bottom()),
        ),
        (ResizeHandle::SouthWest, Vec2::new(group.x, group.bottom())),
        (
            ResizeHandle::West,
            Vec2::new(group.x, group.y + group.height / 2.0),
        ),
    ];
    points
        .into_iter()
        .find(|(_, point)| {
            (world.x - point.x).abs() <= radius && (world.y - point.y).abs() <= radius
        })
        .map(|(handle, _)| (handle, group))
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
        });
    }
    if let Some((_, position, target)) = best_y {
        guides.push(Guide {
            axis: GuideAxis::Horizontal,
            position,
            from: moved.x.min(target.x),
            to: moved.right().max(target.right()),
        });
    }
    (snapped, guides)
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

fn intersects(left: Bounds, right: Bounds) -> bool {
    left.x <= right.right()
        && left.right() >= right.x
        && left.y <= right.bottom()
        && left.bottom() >= right.y
}

fn handle_positions(bounds: GpBounds<Pixels>) -> [Point<Pixels>; 8] {
    let center = bounds.center();
    [
        bounds.origin,
        point(center.x, bounds.top()),
        bounds.top_right(),
        point(bounds.right(), center.y),
        bounds.bottom_right(),
        point(center.x, bounds.bottom()),
        bounds.bottom_left(),
        point(bounds.left(), center.y),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use loora_engine::{Layout, Node};

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
        let order = paint_order_with_overlay(&document, Some(&overlay.id));
        assert!(order.iter().position(|id| id == &current).unwrap() < order.len() - 2);
        assert_eq!(order[order.len() - 2..], [overlay.id, child.id]);
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

        let guide =
            flow_drop_guide(&document, &dragged_id, Vec2::new(170.0, 110.0), &bounds).unwrap();
        assert_eq!(guide.axis, GuideAxis::Vertical);
        assert!((guide.position - 180.0).abs() < f64::EPSILON);
    }
}
