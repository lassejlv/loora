use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::ops::Range;
use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use gpui::{
    canvas, div, prelude::FluentBuilder, px, relative, Bounds as GpBounds, Context,
    ElementInputHandler, Entity, EntityInputHandler, EventEmitter, FocusHandle, InteractiveElement,
    IntoElement, MouseButton, MouseDownEvent, MouseExitEvent, MouseMoveEvent, MouseUpEvent,
    ParentElement, PinchEvent, Pixels, Point, Render, RenderImage, ScrollWheelEvent, SharedString,
    StatefulInteractiveElement, Styled, UTF16Selection, Window,
};
use loora_engine::{
    AnimationTrigger, Bounds, Camera, Document, FlexDirection, NodeId, NodeKind, Paint,
    TextAlign as EngineTextAlign, Vec2,
};

use crate::assets::*;
use crate::geometry::*;
use crate::motion::{MotionFrame, MotionRuntime, PlaybackSnapshot};
use crate::raster::*;
use crate::scene::{in_view_nodes, paint_scene, prepare_scene};
use crate::scene_raster;
use crate::text::*;
use crate::types::*;

pub struct NativeCanvas {
    pub(crate) document: Arc<Document>,
    pub(crate) world_bounds: HashMap<NodeId, Bounds>,
    pub(crate) paint_order: Arc<Vec<NodeId>>,
    pub(crate) revision: u64,
    pub(crate) camera: Camera,
    pub(crate) selection: Vec<NodeId>,
    pub(crate) agent_nodes: Vec<NodeId>,
    pub(crate) tool: CanvasTool,
    pub(crate) preview: bool,
    pub(crate) preview_overlay: Option<NodeId>,
    pub(crate) text_edit: Option<NativeTextEdit>,
    pub(crate) input_focus: Option<FocusHandle>,
    pub(crate) text_selecting: bool,
    pub(crate) palette: CanvasPalette,
    pub(crate) images: HashMap<String, Arc<RenderImage>>,
    pub(crate) image_opacity_variants: HashMap<NodeId, OpacityImage>,
    pub(crate) gradient_fills: HashMap<(NodeId, usize), GradientRaster>,
    pub(crate) rotated_images: HashMap<NodeId, RotatedImage>,
    pub(crate) page_rasters: HashMap<NodeId, PageRaster>,
    pub(crate) page_generations: HashMap<NodeId, u64>,
    pub(crate) page_raster_jobs: HashMap<NodeId, PageRasterJob>,
    pub(crate) display_scale: f32,
    pub(crate) viewport: Rc<Cell<GpBounds<Pixels>>>,
    pub(crate) drag: Option<DragState>,
    pub(crate) guides: Vec<Guide>,
    pub(crate) hovered: Option<NodeId>,
    pub(crate) pressed: Option<NodeId>,
    pub(crate) focused: Option<NodeId>,
    pub(crate) motion: MotionRuntime,
    pub(crate) timeline_bounds: Rc<Cell<GpBounds<Pixels>>>,
    pub(crate) timeline_scrubbing: bool,
    pub(crate) space_pan: bool,
    pub(crate) pointer_world: Option<Vec2>,
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
            input_focus: None,
            text_selecting: false,
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
            let changed_pages = changed_raster_pages(
                &self.document,
                &document,
                self.text_edit.as_ref().map(|edit| &edit.id),
            );
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

    pub fn set_input_focus(&mut self, focus: FocusHandle) {
        self.input_focus = Some(focus);
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

    pub(crate) fn toggle_motion_playback(&mut self, cx: &mut Context<Self>) {
        self.motion.toggle_playback(Instant::now());
        cx.notify();
    }

    pub(crate) fn restart_motion_playback(&mut self, cx: &mut Context<Self>) {
        self.motion.restart(Instant::now());
        cx.notify();
    }

    pub(crate) fn scrub_motion_at(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let bounds = self.timeline_bounds.get();
        let width = f32::from(bounds.size.width).max(1.0);
        let progress = (f32::from(position.x - bounds.origin.x) / width).clamp(0.0, 1.0);
        self.motion.scrub(&self.document, progress, Instant::now());
        cx.notify();
    }

    pub(crate) fn on_timeline_down(
        &mut self,
        event: &MouseDownEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.timeline_scrubbing = true;
        self.scrub_motion_at(event.position, cx);
        cx.stop_propagation();
    }

    pub(crate) fn on_timeline_move(
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

    pub(crate) fn on_timeline_up(
        &mut self,
        _event: &MouseUpEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.timeline_scrubbing = false;
        cx.stop_propagation();
    }

    pub(crate) fn sync_images(&mut self, document: &Document) {
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

    pub(crate) fn sync_gradient_fills(
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

    pub(crate) fn sync_rotated_images(&mut self, document: &Document) {
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

    pub(crate) fn sync_image_opacity_variants(
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
    pub(crate) fn sync_page_rasters(
        &mut self,
        document: &Document,
        motion_frames: &HashMap<NodeId, MotionFrame>,
        preview_bounds: &HashMap<NodeId, Bounds>,
    ) {
        self.sync_page_rasters_with_context(document, motion_frames, preview_bounds, None);
    }

    pub(crate) fn sync_page_rasters_with_context(
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
            let Some(page_bounds) = preview_bounds.get(&page_id).copied() else {
                continue;
            };
            let regions = if self.preview_overlay.as_ref() == Some(&page_id) {
                page_raster_regions(
                    page_bounds.width,
                    page_bounds.height,
                    Bounds::new(0.0, 0.0, page_bounds.width, page_bounds.height),
                    scale,
                )
            } else {
                visible_page_raster_regions(page_bounds, self.camera, self.viewport.get(), scale)
            };
            if regions.is_empty() {
                continue;
            }
            let key = PageRasterKey {
                generation,
                scale_bits: scale.to_bits(),
                motion_frames: motion_key.clone(),
                geometry: geometry.clone(),
                mode: mode.clone(),
                regions,
            };
            active.insert(page_id.clone());
            let content_matches = self.page_rasters.get(&page_id).is_some_and(|cached| {
                cached.generation == generation
                    && cached.motion_frames == motion_key
                    && cached.geometry == geometry
                    && cached.mode == mode
            });
            let source_document = if matches!(mode, PageRasterMode::Full) {
                raster_document.clone()
            } else {
                document.clone()
            };
            if content_matches {
                let same_scale = self.page_rasters[&page_id].scale.to_bits() == scale.to_bits();
                let missing = same_scale.then(|| {
                    key.regions
                        .iter()
                        .copied()
                        .filter(|region| {
                            !self.page_rasters[&page_id]
                                .tiles
                                .iter()
                                .any(|tile| tile.region == *region)
                        })
                        .collect::<Vec<_>>()
                });
                if missing.as_ref().is_some_and(Vec::is_empty) {
                    self.page_rasters
                        .get_mut(&page_id)
                        .unwrap()
                        .retain_regions(&key.regions);
                    continue;
                }
                if let Some(cx) = cx.as_deref_mut() {
                    self.schedule_page_raster(
                        source_document,
                        page_id.clone(),
                        motion_frames.clone(),
                        key.clone(),
                        missing.unwrap_or_else(|| key.regions.clone()),
                        same_scale,
                        cx,
                    );
                }
                continue;
            }
            self.page_raster_jobs.remove(&page_id);
            let rendered = render_page_raster(
                &source_document,
                &page_id,
                motion_frames,
                scale,
                &mode,
                &key.regions,
            );
            match rendered {
                Ok(pixels) => {
                    self.page_rasters
                        .insert(page_id, page_raster_from_pixels(key, pixels));
                }
                Err(_) => {
                    self.page_rasters.remove(&page_id);
                }
            }
        }
        self.page_rasters.retain(|id, _| active.contains(id));
        self.page_raster_jobs.retain(|id, _| active.contains(id));
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn schedule_page_raster(
        &mut self,
        document: Document,
        page_id: NodeId,
        motion_frames: HashMap<NodeId, MotionFrame>,
        key: PageRasterKey,
        render_regions: Vec<PageRasterRegion>,
        merge: bool,
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
            let rendered_regions = render_regions.clone();
            let rendered = cx
                .background_executor()
                .spawn(async move {
                    render_page_raster(
                        &document,
                        &render_page_id,
                        &motion_frames,
                        f32::from_bits(render_key.scale_bits),
                        &render_key.mode,
                        &rendered_regions,
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
                if let Ok(pixels) = rendered {
                    let rendered = page_raster_from_pixels(job_key.clone(), pixels);
                    if merge {
                        if let Some(current) =
                            this.page_rasters.get_mut(&job_page_id).filter(|current| {
                                current.generation == job_key.generation
                                    && current.scale.to_bits() == job_key.scale_bits
                                    && current.motion_frames == job_key.motion_frames
                                    && current.geometry == job_key.geometry
                                    && current.mode == job_key.mode
                            })
                        {
                            current.merge_tiles(rendered.tiles, &job_key.regions);
                        }
                    } else {
                        this.page_rasters.insert(job_page_id.clone(), rendered);
                    }
                    cx.notify();
                }
            })
            .ok();
        });
        self.page_raster_jobs
            .insert(page_id, PageRasterJob { key, _task: task });
    }

    pub(crate) fn viewport_local(&self, position: Point<Pixels>) -> Vec2 {
        let viewport = self.viewport.get();
        Vec2::new(
            f32::from(position.x - viewport.origin.x) as f64,
            f32::from(position.y - viewport.origin.y) as f64,
        )
    }

    pub(crate) fn text_index_at_position(
        &self,
        id: &NodeId,
        position: Point<Pixels>,
        closest_boundary: bool,
        window: &mut Window,
    ) -> Option<usize> {
        let node = self.document.nodes.get(id)?;
        let text = node.text.as_deref().unwrap_or("");
        let world = self.world_bounds.get(id).copied()?;
        let bounds = world_to_screen(world, self.camera, self.viewport.get());
        if text.is_empty() {
            return Some(0);
        }
        let typography = node.effective_typography();
        let scale = self.camera.zoom as f32;
        let line_height = px(resolved_line_height(&typography).max(1.0) * scale);
        let y = f32::from(position.y - bounds.origin.y);
        if y <= 0.0 {
            return Some(0);
        }
        let lines = text.split('\n').collect::<Vec<_>>();
        let line_index = (y / f32::from(line_height)).floor() as usize;
        if line_index >= lines.len() {
            return Some(text.len());
        }
        let line_text = lines[line_index];
        let line_start = lines
            .iter()
            .take(line_index)
            .map(|line| line.len() + 1)
            .sum::<usize>();
        let line_start_char = text[..line_start].chars().count();
        let runs = text_runs_for_line(
            node,
            &typography,
            line_text,
            line_start_char,
            Some(typography.color),
            1.0,
        );
        let shaped = window.text_system().shape_line(
            SharedString::from(line_text.to_owned()),
            px((typography.size * scale).max(1.0)),
            &runs,
            None,
        );
        let align_offset = match typography.align {
            EngineTextAlign::Left | EngineTextAlign::Justify => px(0.0),
            EngineTextAlign::Center => (bounds.size.width - shaped.width()).max(px(0.0)) / 2.0,
            EngineTextAlign::Right => (bounds.size.width - shaped.width()).max(px(0.0)),
        };
        let x = (position.x - bounds.origin.x - align_offset).max(px(0.0));
        let index = if closest_boundary {
            shaped.closest_index_for_x(x)
        } else {
            shaped.index_for_x(x).unwrap_or(line_text.len())
        };
        Some(line_start + index)
    }

    pub(crate) fn preview_world_at(
        &self,
        screen: Vec2,
        all_bounds: &HashMap<NodeId, Bounds>,
    ) -> Option<Vec2> {
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

    pub(crate) fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(focus) = &self.input_focus {
            focus.focus(window, cx);
        }
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

        if let Some(edit) = self.text_edit.clone() {
            let clicked_edit = all_bounds
                .get(&edit.id)
                .is_some_and(|bounds| bounds.contains(world));
            if clicked_edit {
                let text = self
                    .document
                    .nodes
                    .get(&edit.id)
                    .and_then(|node| node.text.as_deref())
                    .unwrap_or("");
                let caret = self
                    .text_index_at_position(&edit.id, event.position, true, window)
                    .unwrap_or(text.len());
                let (anchor, caret) = if event.click_count >= 2 {
                    let range = word_range_at(text, caret);
                    (range.start, range.end)
                } else if event.modifiers.shift {
                    (edit.anchor, caret)
                } else {
                    (caret, caret)
                };
                if let Some(current) = self.text_edit.as_mut() {
                    current.anchor = anchor;
                    current.caret = caret;
                    current.marked_range = None;
                    current.caret_visible = true;
                }
                self.text_selecting = true;
                cx.emit(CanvasEvent::TextSelectionChanged {
                    id: edit.id,
                    anchor,
                    caret,
                });
                cx.stop_propagation();
                cx.notify();
                return;
            }
            self.text_edit = None;
            self.text_selecting = false;
            cx.emit(CanvasEvent::EndTextEdit);
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
                        NodeKind::Text => {
                            let text = node.text.as_deref().unwrap_or("");
                            let index = self
                                .text_index_at_position(&hit, event.position, false, window)
                                .unwrap_or(text.len());
                            let range = word_range_at(text, index);
                            cx.emit(CanvasEvent::BeginTextEdit {
                                id: hit,
                                anchor: range.start,
                                caret: range.end,
                            });
                        }
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

    pub(crate) fn on_mouse_move(
        &mut self,
        event: &MouseMoveEvent,
        window: &mut Window,
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
        if self.text_selecting {
            if let Some(edit) = self.text_edit.clone() {
                if let Some(caret) =
                    self.text_index_at_position(&edit.id, event.position, true, window)
                {
                    if let Some(current) = self.text_edit.as_mut() {
                        current.caret = caret;
                        current.marked_range = None;
                        current.caret_visible = true;
                    }
                    cx.emit(CanvasEvent::TextSelectionChanged {
                        id: edit.id,
                        anchor: edit.anchor,
                        caret,
                    });
                    cx.notify();
                }
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

    pub(crate) fn on_mouse_up(
        &mut self,
        event: &MouseUpEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !matches!(event.button, MouseButton::Left | MouseButton::Middle) {
            return;
        }
        if self.preview {
            if event.button == MouseButton::Left && self.pressed.take().is_some() {
                cx.notify();
            }
            return;
        }
        if self.text_selecting {
            self.text_selecting = false;
            cx.stop_propagation();
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

    pub(crate) fn on_mouse_exit(
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

    pub(crate) fn on_scroll(
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

    pub(crate) fn on_pinch(
        &mut self,
        event: &PinchEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.preview {
            return;
        }
        let local = self.viewport_local(event.position);
        apply_pinch_delta(&mut self.camera, local, event.delta as f64);
        cx.emit(CanvasEvent::CameraChanged(self.camera));
        cx.stop_propagation();
        cx.notify();
    }

    pub(crate) fn preview_bounds(&self) -> HashMap<NodeId, Bounds> {
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
        let paint_entity = entity.clone();
        let input_focus = self.input_focus.clone();
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
                    move |bounds, scene, window, cx| {
                        if let Some(focus) = input_focus.as_ref() {
                            window.handle_input(
                                focus,
                                ElementInputHandler::new(scene.viewport, paint_entity.clone()),
                                cx,
                            );
                        }
                        paint_scene(bounds, scene, window, cx);
                    },
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

impl EntityInputHandler for NativeCanvas {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        adjusted_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let edit = self.text_edit.as_ref()?;
        let text = self
            .document
            .nodes
            .get(&edit.id)?
            .text
            .as_deref()
            .unwrap_or("");
        let range = utf16_range_to_utf8(text, range_utf16);
        adjusted_range.replace(utf8_range_to_utf16(text, range.clone()));
        Some(text[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let edit = self.text_edit.as_ref()?;
        let text = self
            .document
            .nodes
            .get(&edit.id)?
            .text
            .as_deref()
            .unwrap_or("");
        let range = if edit.anchor <= edit.caret {
            edit.anchor..edit.caret
        } else {
            edit.caret..edit.anchor
        };
        Some(UTF16Selection {
            range: utf8_range_to_utf16(text, range),
            reversed: edit.anchor > edit.caret,
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        let edit = self.text_edit.as_ref()?;
        let text = self
            .document
            .nodes
            .get(&edit.id)?
            .text
            .as_deref()
            .unwrap_or("");
        edit.marked_range
            .clone()
            .map(|range| utf8_range_to_utf16(text, range))
    }

    fn unmark_text(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(edit) = self.text_edit.as_mut() else {
            return;
        };
        edit.marked_range = None;
        cx.emit(CanvasEvent::TextSelectionChanged {
            id: edit.id.clone(),
            anchor: edit.anchor,
            caret: edit.caret,
        });
        cx.notify();
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(edit) = self.text_edit.clone() else {
            return;
        };
        let mut text = self
            .document
            .nodes
            .get(&edit.id)
            .and_then(|node| node.text.clone())
            .unwrap_or_default();
        let range = range_utf16
            .map(|range| utf16_range_to_utf8(&text, range))
            .or(edit.marked_range)
            .unwrap_or_else(|| sorted_range(edit.anchor, edit.caret));
        let new_text = new_text.replace('\r', "\n");
        text.replace_range(range.clone(), &new_text);
        let caret = range.start + new_text.len();
        if let Some(node) = Arc::make_mut(&mut self.document).nodes.get_mut(&edit.id) {
            node.text = Some(text.clone());
        }
        self.text_edit = Some(NativeTextEdit {
            id: edit.id.clone(),
            anchor: caret,
            caret,
            caret_visible: true,
            marked_range: None,
        });
        cx.emit(CanvasEvent::TextEdited {
            id: edit.id,
            text,
            anchor: caret,
            caret,
            marked_range: None,
        });
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        selected_range_utf16: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(edit) = self.text_edit.clone() else {
            return;
        };
        let mut text = self
            .document
            .nodes
            .get(&edit.id)
            .and_then(|node| node.text.clone())
            .unwrap_or_default();
        let range = range_utf16
            .map(|range| utf16_range_to_utf8(&text, range))
            .or(edit.marked_range)
            .unwrap_or_else(|| sorted_range(edit.anchor, edit.caret));
        text.replace_range(range.clone(), new_text);
        let marked_range =
            (!new_text.is_empty()).then_some(range.start..range.start + new_text.len());
        let selected = selected_range_utf16
            .map(|range| utf16_range_to_utf8(new_text, range))
            .unwrap_or_else(|| new_text.len()..new_text.len());
        let anchor = range.start + selected.start;
        let caret = range.start + selected.end;
        if let Some(node) = Arc::make_mut(&mut self.document).nodes.get_mut(&edit.id) {
            node.text = Some(text.clone());
        }
        self.text_edit = Some(NativeTextEdit {
            id: edit.id.clone(),
            anchor,
            caret,
            caret_visible: true,
            marked_range: marked_range.clone(),
        });
        cx.emit(CanvasEvent::TextEdited {
            id: edit.id,
            text,
            anchor,
            caret,
            marked_range,
        });
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        _element_bounds: GpBounds<Pixels>,
        window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<GpBounds<Pixels>> {
        let edit = self.text_edit.as_ref()?;
        let node = self.document.nodes.get(&edit.id)?;
        let text = node.text.as_deref().unwrap_or("");
        let range = utf16_range_to_utf8(text, range_utf16);
        let bounds = world_to_screen(
            *self.world_bounds.get(&edit.id)?,
            self.camera,
            self.viewport.get(),
        );
        let query = NativeTextEdit {
            id: edit.id.clone(),
            anchor: range.start,
            caret: range.end,
            caret_visible: true,
            marked_range: None,
        };
        prepare_node_text(
            node,
            bounds,
            self.viewport.get(),
            self.camera.zoom as f32,
            (Some(node.effective_typography().color), 1.0),
            Some(&query),
            node.rotation,
            window,
        )
        .into_iter()
        .find_map(|line| line.selection.or(line.caret))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        let edit = self.text_edit.as_ref()?;
        let text = self
            .document
            .nodes
            .get(&edit.id)?
            .text
            .as_deref()
            .unwrap_or("");
        let index = self.text_index_at_position(&edit.id, point, false, window)?;
        Some(utf8_offset_to_utf16(text, index))
    }

    fn set_selected_text_range(
        &mut self,
        range_utf16: Range<usize>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(edit) = self.text_edit.clone() else {
            return;
        };
        let text = self
            .document
            .nodes
            .get(&edit.id)
            .and_then(|node| node.text.as_deref())
            .unwrap_or("");
        let range = utf16_range_to_utf8(text, range_utf16);
        if let Some(current) = self.text_edit.as_mut() {
            current.anchor = range.start;
            current.caret = range.end;
            current.marked_range = None;
        }
        cx.emit(CanvasEvent::TextSelectionChanged {
            id: edit.id,
            anchor: range.start,
            caret: range.end,
        });
        cx.notify();
    }

    fn text_length_utf16(
        &mut self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        let edit = self.text_edit.as_ref()?;
        let text = self
            .document
            .nodes
            .get(&edit.id)?
            .text
            .as_deref()
            .unwrap_or("");
        Some(text.encode_utf16().count())
    }

    fn accepts_text_input(&self, _window: &mut Window, _cx: &mut Context<Self>) -> bool {
        self.text_edit.is_some()
    }
}

pub(crate) fn active_trigger_state(
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

pub(crate) fn preview_playback_button(
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

pub(crate) fn preview_playback_controls(
    entity: Entity<NativeCanvas>,
    playback: PlaybackSnapshot,
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
