use std::collections::{HashMap, HashSet};

use gpui::{point, px, size, Bounds as GpBounds, Pixels, Point};
use loora_engine::{
    Bounds, Camera, Document, FlexDirection, Insets, LayoutMode, Node, NodeId, Overflow, ShapeKind,
    Vec2,
};

use crate::motion::MotionFrame;
use crate::types::{CanvasTool, ResizeHandle, MIN_NODE_SIZE, SNAP_SCREEN_PX};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Affine2 {
    pub(crate) xx: f64,
    pub(crate) xy: f64,
    pub(crate) yx: f64,
    pub(crate) yy: f64,
    pub(crate) tx: f64,
    pub(crate) ty: f64,
}

impl Affine2 {
    pub(crate) const IDENTITY: Self = Self {
        xx: 1.0,
        xy: 0.0,
        yx: 0.0,
        yy: 1.0,
        tx: 0.0,
        ty: 0.0,
    };

    pub(crate) fn translate(x: f64, y: f64) -> Self {
        Self {
            tx: x,
            ty: y,
            ..Self::IDENTITY
        }
    }

    pub(crate) fn rotate(degrees: f64) -> Self {
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

    pub(crate) fn scale(x: f64, y: f64) -> Self {
        Self {
            xx: x,
            yy: y,
            ..Self::IDENTITY
        }
    }

    /// Compose two transforms so `other` is applied first, followed by `self`.
    pub(crate) fn compose(self, other: Self) -> Self {
        Self {
            xx: self.xx * other.xx + self.xy * other.yx,
            xy: self.xx * other.xy + self.xy * other.yy,
            yx: self.yx * other.xx + self.yy * other.yx,
            yy: self.yx * other.xy + self.yy * other.yy,
            tx: self.xx * other.tx + self.xy * other.ty + self.tx,
            ty: self.yx * other.tx + self.yy * other.ty + self.ty,
        }
    }

    pub(crate) fn around(center: Vec2, translate: Vec2, scale: Vec2, rotation: f64) -> Self {
        Self::translate(center.x + translate.x, center.y + translate.y)
            .compose(Self::rotate(rotation))
            .compose(Self::scale(scale.x, scale.y))
            .compose(Self::translate(-center.x, -center.y))
    }

    pub(crate) fn apply(self, value: Vec2) -> Vec2 {
        Vec2::new(
            self.xx * value.x + self.xy * value.y + self.tx,
            self.yx * value.x + self.yy * value.y + self.ty,
        )
    }

    pub(crate) fn apply_vector(self, value: Vec2) -> Vec2 {
        Vec2::new(
            self.xx * value.x + self.xy * value.y,
            self.yx * value.x + self.yy * value.y,
        )
    }

    pub(crate) fn inverse(self) -> Option<Self> {
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
pub(crate) fn apply_scroll_delta(camera: &mut Camera, local: Vec2, delta: Vec2, zoom: bool) {
    if zoom {
        camera.zoom_at(local, (delta.y * 0.003).exp());
    } else {
        camera.pan_by(delta.x, delta.y);
    }
}

pub(crate) fn apply_pinch_delta(camera: &mut Camera, local: Vec2, delta: f64) {
    camera.zoom_at(local, (1.0 + delta).max(0.01));
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GuideAxis {
    Vertical,
    Horizontal,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Guide {
    pub(crate) axis: GuideAxis,
    pub(crate) position: f64,
    pub(crate) from: f64,
    pub(crate) to: f64,
    pub(crate) label: Option<f64>,
}

#[derive(Clone, Debug)]
pub(crate) enum DragState {
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
pub(crate) struct MultiTransform {
    pub(crate) members: HashMap<NodeId, MultiTransformMember>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct MultiTransformMember {
    pub(crate) original: Bounds,
    pub(crate) visual_center: Vec2,
    pub(crate) parent_inverse: Affine2,
}

#[derive(Clone, Debug)]
pub(crate) struct MultiRotateBounds {
    pub(crate) current: HashMap<NodeId, Bounds>,
    pub(crate) members: MultiTransform,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ResizeBasis {
    pub(crate) x_axis: Vec2,
    pub(crate) y_axis: Vec2,
    pub(crate) x_scale: f64,
    pub(crate) y_scale: f64,
}

impl ResizeBasis {
    pub(crate) const IDENTITY: Self = Self {
        x_axis: Vec2 { x: 1.0, y: 0.0 },
        y_axis: Vec2 { x: 0.0, y: 1.0 },
        x_scale: 1.0,
        y_scale: 1.0,
    };

    pub(crate) fn project(self, delta: Vec2) -> Vec2 {
        Vec2::new(
            (delta.x * self.x_axis.x + delta.y * self.x_axis.y) / self.x_scale.max(0.000_001),
            (delta.x * self.y_axis.x + delta.y * self.y_axis.y) / self.y_scale.max(0.000_001),
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PaddingEdge {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Clone, Debug)]
pub(crate) enum LayoutBadgeKind {
    Gap(FlexDirection),
    Padding(PaddingEdge),
}

#[derive(Clone, Debug)]
pub(crate) struct LayoutBadge {
    pub(crate) bounds: Bounds,
    pub(crate) label: String,
    pub(crate) kind: LayoutBadgeKind,
}
pub(crate) fn world_to_screen(
    bounds: Bounds,
    camera: Camera,
    viewport: GpBounds<Pixels>,
) -> GpBounds<Pixels> {
    let origin = camera.world_to_screen(Vec2::new(bounds.x, bounds.y));
    GpBounds::new(
        viewport.origin + point(px(origin.x as f32), px(origin.y as f32)),
        size(
            px((bounds.width * camera.zoom) as f32),
            px((bounds.height * camera.zoom) as f32),
        ),
    )
}

pub(crate) fn world_point_to_screen(
    value: Vec2,
    camera: Camera,
    viewport: GpBounds<Pixels>,
) -> Point<Pixels> {
    let screen = camera.world_to_screen(value);
    viewport.origin + point(px(screen.x as f32), px(screen.y as f32))
}

pub(crate) fn world_x(value: f64, camera: Camera, viewport: GpBounds<Pixels>) -> Pixels {
    viewport.origin.x + px((value * camera.zoom + camera.pan.x) as f32)
}

pub(crate) fn world_y(value: f64, camera: Camera, viewport: GpBounds<Pixels>) -> Pixels {
    viewport.origin.y + px((value * camera.zoom + camera.pan.y) as f32)
}
#[derive(Clone, Copy, Debug)]
pub(crate) struct VisualGeometry {
    pub(crate) matrix: Affine2,
    pub(crate) bounds: Bounds,
    pub(crate) aabb: Bounds,
    pub(crate) corners: [Vec2; 4],
    pub(crate) rotation: f32,
}

impl VisualGeometry {
    pub(crate) fn from_matrix(base: Bounds, matrix: Affine2) -> Self {
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

    pub(crate) fn local_point(self, world: Vec2) -> Option<Vec2> {
        self.matrix.inverse().map(|inverse| inverse.apply(world))
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct SelectionGeometry {
    pub(crate) corners: [Vec2; 4],
}

impl SelectionGeometry {
    pub(crate) fn center(self) -> Vec2 {
        Vec2::new(
            self.corners.iter().map(|point| point.x).sum::<f64>() / 4.0,
            self.corners.iter().map(|point| point.y).sum::<f64>() / 4.0,
        )
    }

    pub(crate) fn aabb(self) -> Bounds {
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

    pub(crate) fn handles(self) -> [Vec2; 8] {
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

    pub(crate) fn rotation_handle(self, offset: f64) -> (Vec2, Vec2) {
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

pub(crate) fn selection_visual_geometry(
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

pub(crate) fn midpoint(left: Vec2, right: Vec2) -> Vec2 {
    Vec2::new((left.x + right.x) * 0.5, (left.y + right.y) * 0.5)
}

pub(crate) fn unit_vector(value: Vec2) -> Option<Vec2> {
    let length = (value.x.powi(2) + value.y.powi(2)).sqrt();
    (length > f64::EPSILON).then(|| Vec2::new(value.x / length, value.y / length))
}

pub(crate) fn point_distance(left: Vec2, right: Vec2) -> f64 {
    ((right.x - left.x).powi(2) + (right.y - left.y).powi(2)).sqrt()
}

pub(crate) fn visual_geometries(
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
pub(crate) fn resolve_visual_geometry(
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

pub(crate) fn absolute_bounds(document: &Document) -> HashMap<NodeId, Bounds> {
    let mut cache = HashMap::new();
    for id in document.nodes.keys() {
        let _ = resolve_absolute(document, id, &mut cache, &mut HashSet::new());
    }
    cache
}

pub(crate) fn resolve_absolute(
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

pub(crate) fn paint_order(document: &Document) -> Vec<NodeId> {
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

pub(crate) fn paint_order_with_overlay(
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

pub(crate) fn is_descendant_of(document: &Document, id: &NodeId, ancestor: &NodeId) -> bool {
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

pub(crate) fn root_page_for_node(document: &Document, id: &NodeId) -> Option<NodeId> {
    let mut current = document.nodes.get(id)?;
    loop {
        if current.is_root_frame() {
            return Some(current.id.clone());
        }
        let parent_id = current.parent_id.as_ref()?;
        current = document.nodes.get(parent_id)?;
    }
}
pub(crate) fn inherited_clip(
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

pub(crate) fn node_or_ancestor_hidden(document: &Document, node: &Node) -> bool {
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

pub(crate) fn hit_test(
    document: &Document,
    bounds: &HashMap<NodeId, Bounds>,
    paint_order: &[NodeId],
    world: Vec2,
) -> Option<NodeId> {
    hit_test_with_motion(document, bounds, paint_order, world, &HashMap::new())
}

pub(crate) fn hit_test_with_motion(
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

pub(crate) fn point_inside_ancestor_clips(
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

pub(crate) fn point_inside_node_shape(node: &Node, bounds: Bounds, point: Vec2) -> bool {
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

pub(crate) fn flow_drop_guide(
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

pub(crate) fn selectable_nodes(document: &Document) -> Vec<NodeId> {
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

pub(crate) fn top_level_selection(selection: &[NodeId], document: &Document) -> Vec<NodeId> {
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

pub(crate) fn is_descendant_or_self(id: &NodeId, root: &NodeId, document: &Document) -> bool {
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

pub(crate) fn translate_subtree(
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

pub(crate) fn selection_bounds(ids: &[NodeId], bounds: &HashMap<NodeId, Bounds>) -> Option<Bounds> {
    ids.iter()
        .filter_map(|id| bounds.get(id).copied())
        .reduce(union_bounds)
}

pub(crate) fn multi_transform(
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

pub(crate) fn layout_badges(
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

pub(crate) fn metric_badge(
    center: Vec2,
    label: String,
    kind: LayoutBadgeKind,
    zoom: f64,
) -> LayoutBadge {
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

pub(crate) fn gap_badge_position(
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

pub(crate) fn padding_edge_label(edge: PaddingEdge) -> &'static str {
    match edge {
        PaddingEdge::Top => "T",
        PaddingEdge::Right => "R",
        PaddingEdge::Bottom => "B",
        PaddingEdge::Left => "L",
    }
}

pub(crate) fn hit_layout_badge(
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

pub(crate) fn resized_padding(
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

pub(crate) fn hit_resize_handle(
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

pub(crate) fn hit_rotation_handle(
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

pub(crate) fn angle_from(center: Vec2, point: Vec2) -> f64 {
    (point.y - center.y).atan2(point.x - center.x).to_degrees()
}

pub(crate) fn angle_delta(start: f64, current: f64) -> f64 {
    let mut delta = current - start;
    while delta > 180.0 {
        delta -= 360.0;
    }
    while delta < -180.0 {
        delta += 360.0;
    }
    delta
}

pub(crate) fn normalize_degrees(value: f32) -> f32 {
    let value = value % 360.0;
    if value > 180.0 {
        value - 360.0
    } else if value <= -180.0 {
        value + 360.0
    } else {
        value
    }
}

pub(crate) fn resize_bounds(bounds: Bounds, handle: ResizeHandle, delta: Vec2) -> Bounds {
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

pub(crate) fn resize_bounds_with_aspect(
    bounds: Bounds,
    handle: ResizeHandle,
    delta: Vec2,
) -> Bounds {
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

pub(crate) fn scale_group(
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

pub(crate) fn scale_multi_transform(
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

pub(crate) fn rotate_multi_transform(
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

pub(crate) fn snap_move(
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

pub(crate) fn axis_gap(
    first_start: f64,
    first_end: f64,
    second_start: f64,
    second_end: f64,
) -> Option<f64> {
    if first_end <= second_start {
        Some(second_start - first_end)
    } else if second_end <= first_start {
        Some(first_start - second_end)
    } else {
        None
    }
}

pub(crate) fn normalized_bounds(first: Vec2, second: Vec2) -> Bounds {
    Bounds::new(
        first.x.min(second.x),
        first.y.min(second.y),
        (first.x - second.x).abs(),
        (first.y - second.y).abs(),
    )
}

pub(crate) fn defaulted_create_bounds(tool: CanvasTool, start: Vec2, end: Vec2) -> Bounds {
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

pub(crate) fn union_bounds(left: Bounds, right: Bounds) -> Bounds {
    let x = left.x.min(right.x);
    let y = left.y.min(right.y);
    Bounds::new(
        x,
        y,
        left.right().max(right.right()) - x,
        left.bottom().max(right.bottom()) - y,
    )
}

pub(crate) fn intersect_bounds(left: Bounds, right: Bounds) -> Bounds {
    let x = left.x.max(right.x);
    let y = left.y.max(right.y);
    Bounds::new(
        x,
        y,
        (left.right().min(right.right()) - x).max(0.0),
        (left.bottom().min(right.bottom()) - y).max(0.0),
    )
}

pub(crate) fn quad_intersects_bounds(quad: [Vec2; 4], bounds: Bounds) -> bool {
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
