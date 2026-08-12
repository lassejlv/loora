use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gpui::{
    fill, font, outline, point, px, quad, size, App, Background, BorderStyle, Bounds as GpBounds,
    BoxShadow, ContentMask, Corners as GpCorners, Edges, Hsla, Path as GpPath, PathBuilder, Pixels,
    Point, RenderImage, ShapedLine, SharedString, TextAlign as GpTextAlign, TextRun,
    TransformationMatrix, Window,
};
use loora_engine::{
    Bounds, Camera, Color, Document, ImageFit, Node, NodeId, NodeKind, Paint, ShapeKind, Vec2,
};
use svgtypes::{PathParser, PathSegment};

use crate::assets::{color_hsla, node_opacity, GradientRaster, OpacityImage, RotatedImage};
use crate::geometry::*;
use crate::motion::MotionFrame;
use crate::raster::{PageRaster, PageRasterMode};
use crate::text::*;
use crate::types::*;

#[derive(Clone)]
pub(crate) struct PreparedVectorPath {
    pub(crate) fill: Option<(GpPath<Pixels>, Hsla)>,
    pub(crate) stroke: Option<(GpPath<Pixels>, Hsla)>,
}
#[derive(Clone)]
pub(crate) struct PreparedNode {
    pub(crate) kind: NodeKind,
    pub(crate) shape_kind: ShapeKind,
    pub(crate) bounds: GpBounds<Pixels>,
    pub(crate) corners_points: [Point<Pixels>; 4],
    pub(crate) clip: GpBounds<Pixels>,
    pub(crate) fills: Vec<PreparedFill>,
    pub(crate) border: Option<(Hsla, Pixels, BorderStyle)>,
    pub(crate) corners: GpCorners<Pixels>,
    pub(crate) text: Vec<PreparedText>,
    pub(crate) image: Option<Arc<RenderImage>>,
    pub(crate) image_bounds: Option<GpBounds<Pixels>>,
    pub(crate) image_overlay: Option<PreparedImageOverlay>,
    pub(crate) raster_tiles: Vec<PreparedRasterTile>,
    pub(crate) image_fit: ImageFit,
    pub(crate) shadows: Vec<BoxShadow>,
    pub(crate) vector_paths: Vec<PreparedVectorPath>,
    pub(crate) rotation: f32,
    pub(crate) overlay_root: bool,
}

#[derive(Clone)]
pub(crate) struct PreparedImageOverlay {
    pub(crate) image: Arc<RenderImage>,
    pub(crate) bounds: GpBounds<Pixels>,
    pub(crate) clip: GpBounds<Pixels>,
}

#[derive(Clone)]
pub(crate) struct PreparedRasterTile {
    pub(crate) image: Arc<RenderImage>,
    pub(crate) bounds: GpBounds<Pixels>,
    pub(crate) clip: GpBounds<Pixels>,
    pub(crate) overlay: Option<PreparedImageOverlay>,
}

#[derive(Clone)]
pub(crate) enum PreparedFill {
    Background(Background),
    Image(Arc<RenderImage>),
}

pub(crate) fn fallback_fill(kind: NodeKind) -> Color {
    match kind {
        NodeKind::Image => Color::rgb(0x2a, 0x2a, 0x2e),
        NodeKind::Vector => Color::rgba(0.7, 0.7, 0.75, 0.18),
        _ => Color::rgba(0.0, 0.0, 0.0, 0.0),
    }
}

pub(crate) fn node_fills(
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

pub(crate) struct PreparedGuideLabel {
    pub(crate) line: ShapedLine,
    pub(crate) origin: Point<Pixels>,
    pub(crate) background: GpBounds<Pixels>,
}

pub(crate) struct PreparedLayoutBadge {
    pub(crate) bounds: GpBounds<Pixels>,
    pub(crate) line: ShapedLine,
    pub(crate) origin: Point<Pixels>,
    pub(crate) metric: bool,
}

pub(crate) struct PreparedSelection {
    pub(crate) corners: [Point<Pixels>; 4],
    pub(crate) handles: [Point<Pixels>; 8],
}

pub(crate) struct PreparedScene {
    pub(crate) nodes: Vec<PreparedNode>,
    pub(crate) labels: Vec<PreparedText>,
    pub(crate) selection: Vec<PreparedSelection>,
    pub(crate) rotation_handle: Option<(Point<Pixels>, Point<Pixels>)>,
    pub(crate) agents: Vec<[Point<Pixels>; 4]>,
    pub(crate) guides: Vec<(GuideAxis, Pixels, Pixels, Pixels)>,
    pub(crate) guide_labels: Vec<PreparedGuideLabel>,
    pub(crate) layout_badges: Vec<PreparedLayoutBadge>,
    pub(crate) marquee: Option<GpBounds<Pixels>>,
    pub(crate) create: Option<GpBounds<Pixels>>,
    pub(crate) overlay_scrim: bool,
    pub(crate) palette: CanvasPalette,
    pub(crate) viewport: GpBounds<Pixels>,
}

pub(crate) fn in_view_nodes(
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
pub(crate) fn prepare_scene(
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
                marked: None,
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
        let image = page_raster
            .is_none()
            .then(|| {
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
            })
            .flatten();
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
        let raster_tiles = page_raster
            .map(|raster| {
                let delta = match (&raster.mode, &drag) {
                    (PageRasterMode::Move(roots), Some(DragState::Move { delta, .. }))
                        if !roots.contains(&id) =>
                    {
                        *delta
                    }
                    _ => Vec2::default(),
                };
                raster
                    .tiles
                    .iter()
                    .map(|tile| {
                        let tile_world = Bounds::new(
                            geometry.bounds.x + tile.region.bounds.x,
                            geometry.bounds.y + tile.region.bounds.y,
                            tile.region.bounds.width,
                            tile.region.bounds.height,
                        );
                        let mut bounds = world_to_screen(tile_world, camera, viewport);
                        if belongs_to_overlay {
                            if let Some((overlay_center, scale)) = overlay_transform {
                                bounds = overlay_screen_bounds(
                                    bounds,
                                    overlay_center,
                                    scale,
                                    viewport.center(),
                                );
                            }
                        }
                        let tile_clip = bounds.intersect(&clip).intersect(&viewport);
                        let overlay = tile.overlay.as_ref().map(|image| PreparedImageOverlay {
                            image: image.clone(),
                            bounds: GpBounds::new(
                                bounds.origin
                                    + point(
                                        px((delta.x * camera.zoom) as f32),
                                        px((delta.y * camera.zoom) as f32),
                                    ),
                                bounds.size,
                            ),
                            clip: tile_clip,
                        });
                        PreparedRasterTile {
                            image: tile.image.clone(),
                            bounds,
                            clip: tile_clip,
                            overlay,
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let image_overlay = None;
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
            raster_tiles,
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

pub(crate) fn paint_scene(
    _bounds: GpBounds<Pixels>,
    scene: PreparedScene,
    window: &mut Window,
    cx: &mut App,
) {
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
                                if let Some(marked) = text.marked {
                                    window.paint_quad(fill(
                                        GpBounds::new(
                                            point(marked.origin.x, marked.bottom() - px(1.0)),
                                            size(marked.size.width, px(1.0)),
                                        ),
                                        rgba(0xff, 0xff, 0xff, 0xb8),
                                    ));
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

pub(crate) fn paint_node(node: &PreparedNode, window: &mut Window) {
    window.paint_drop_shadows(node.bounds, node.corners, &node.shadows);

    if !node.raster_tiles.is_empty() {
        for tile in &node.raster_tiles {
            window.with_content_mask(Some(ContentMask { bounds: tile.clip }), |window| {
                let _ = window.paint_image(
                    tile.bounds,
                    tile.bounds,
                    GpCorners::all(px(0.0)),
                    tile.image.clone(),
                    0,
                    false,
                );
            });
            if let Some(overlay) = &tile.overlay {
                window.with_content_mask(
                    Some(ContentMask {
                        bounds: overlay.clip,
                    }),
                    |window| {
                        let _ = window.paint_image(
                            overlay.bounds,
                            overlay.bounds,
                            GpCorners::all(px(0.0)),
                            overlay.image.clone(),
                            0,
                            false,
                        );
                    },
                );
            }
        }
        return;
    }

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

pub(crate) fn rotate_point(
    value: Point<Pixels>,
    center: Point<Pixels>,
    rotation: f32,
) -> Point<Pixels> {
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

pub(crate) fn overlay_screen_bounds(
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

pub(crate) fn overlay_screen_point(
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

pub(crate) fn fitted_image_bounds(
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

pub(crate) fn paint_selection(selection: PreparedSelection, color: Hsla, window: &mut Window) {
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

pub(crate) fn paint_dashed_polygon(corners: [Point<Pixels>; 4], color: Hsla, window: &mut Window) {
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

pub(crate) fn prepare_vector_paths(
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

pub(crate) fn parse_view_box(value: &str) -> (f64, f64, f64, f64) {
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

pub(crate) fn build_svg_path(
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
