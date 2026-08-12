use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gpui::{Bounds as GpBounds, Pixels, RenderImage, Task};
use loora_engine::{Bounds, Camera, Document, Layout, Node, NodeId, Vec2};

use crate::geometry::{is_descendant_of, root_page_for_node, DragState};
use crate::motion::MotionFrame;
use crate::scene_raster;

pub(crate) const RASTER_TILE_DEVICE_PX: f64 = 256.0;

pub(crate) fn raster_preview_document(
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

pub(crate) fn move_raster_can_split(document: &Document, roots: &[NodeId]) -> bool {
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

pub(crate) fn apply_preview_node_bounds(
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

pub(crate) fn raster_geometry_key(
    document: &Document,
    page_id: &NodeId,
) -> Vec<(NodeId, Layout, u32)> {
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
#[derive(Clone)]
pub(crate) struct PageRaster {
    pub(crate) generation: u64,
    pub(crate) scale: f32,
    pub(crate) motion_frames: Vec<(NodeId, MotionFrame)>,
    pub(crate) geometry: Vec<(NodeId, Layout, u32)>,
    pub(crate) mode: PageRasterMode,
    pub(crate) tiles: Vec<PageRasterTile>,
    // Kept as the representative image for cache identity checks.
    #[cfg(test)]
    pub(crate) image: Arc<RenderImage>,
    #[cfg(test)]
    pub(crate) overlay: Option<Arc<RenderImage>>,
}

impl PageRaster {
    pub(crate) fn retain_regions(&mut self, regions: &[PageRasterRegion]) {
        self.tiles.retain(|tile| regions.contains(&tile.region));
        self.sort_and_refresh(regions);
    }

    pub(crate) fn merge_tiles(&mut self, tiles: Vec<PageRasterTile>, regions: &[PageRasterRegion]) {
        self.tiles.retain(|tile| regions.contains(&tile.region));
        for tile in tiles {
            if let Some(existing) = self
                .tiles
                .iter_mut()
                .find(|existing| existing.region == tile.region)
            {
                *existing = tile;
            } else {
                self.tiles.push(tile);
            }
        }
        self.sort_and_refresh(regions);
    }

    pub(crate) fn sort_and_refresh(&mut self, regions: &[PageRasterRegion]) {
        self.tiles.sort_by_key(|tile| {
            regions
                .iter()
                .position(|region| *region == tile.region)
                .unwrap_or(usize::MAX)
        });
        #[cfg(test)]
        if let Some(first) = self.tiles.first() {
            self.image = first.image.clone();
            self.overlay = first.overlay.clone();
        }
    }
}

#[derive(Clone)]
pub(crate) struct PageRasterTile {
    pub(crate) region: PageRasterRegion,
    pub(crate) image: Arc<RenderImage>,
    pub(crate) overlay: Option<Arc<RenderImage>>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PageRasterRegion {
    pub(crate) column: i32,
    pub(crate) row: i32,
    pub(crate) bounds: Bounds,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct PageRasterKey {
    pub(crate) generation: u64,
    pub(crate) scale_bits: u32,
    pub(crate) motion_frames: Vec<(NodeId, MotionFrame)>,
    pub(crate) geometry: Vec<(NodeId, Layout, u32)>,
    pub(crate) mode: PageRasterMode,
    pub(crate) regions: Vec<PageRasterRegion>,
}

pub(crate) struct PageRasterJob {
    pub(crate) key: PageRasterKey,
    pub(crate) _task: Task<()>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PageRasterMode {
    Full,
    Move(Vec<NodeId>),
    TextEdit(NodeId),
}

pub(crate) fn render_page_raster(
    document: &Document,
    page_id: &NodeId,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    scale: f32,
    mode: &PageRasterMode,
    regions: &[PageRasterRegion],
) -> Result<Vec<(PageRasterRegion, image::RgbaImage, Option<image::RgbaImage>)>, String> {
    let bounds = regions
        .iter()
        .map(|region| region.bounds)
        .collect::<Vec<_>>();
    match mode {
        PageRasterMode::Move(roots) => scene_raster::render_page_layer_regions(
            document,
            page_id,
            motion_frames,
            scale,
            roots,
            &bounds,
        )
        .map(|(backgrounds, overlays)| {
            regions
                .iter()
                .copied()
                .zip(backgrounds)
                .zip(overlays)
                .map(|((region, background), overlay)| (region, background, Some(overlay)))
                .collect()
        }),
        PageRasterMode::TextEdit(id) => scene_raster::render_page_regions_without_subtrees(
            document,
            page_id,
            motion_frames,
            scale,
            std::slice::from_ref(id),
            &bounds,
        )
        .map(|images| {
            regions
                .iter()
                .copied()
                .zip(images)
                .map(|(region, image)| (region, image, None))
                .collect()
        }),
        PageRasterMode::Full => {
            scene_raster::render_page_regions(document, page_id, motion_frames, scale, &bounds).map(
                |images| {
                    regions
                        .iter()
                        .copied()
                        .zip(images)
                        .map(|(region, image)| (region, image, None))
                        .collect()
                },
            )
        }
    }
}

pub(crate) fn page_raster_from_pixels(
    key: PageRasterKey,
    pixels: Vec<(PageRasterRegion, image::RgbaImage, Option<image::RgbaImage>)>,
) -> PageRaster {
    let tiles = pixels
        .into_iter()
        .map(|(region, pixels, overlay)| {
            let image = Arc::new(RenderImage::new(smallvec::smallvec![image::Frame::new(
                pixels,
            )]));
            let overlay = overlay.map(|pixels| {
                Arc::new(RenderImage::new(smallvec::smallvec![image::Frame::new(
                    pixels,
                )]))
            });
            PageRasterTile {
                region,
                image,
                overlay,
            }
        })
        .collect::<Vec<_>>();
    #[cfg(test)]
    let image = tiles
        .first()
        .expect("page raster always has a visible tile")
        .image
        .clone();
    #[cfg(test)]
    let overlay = tiles.first().and_then(|tile| tile.overlay.clone());
    PageRaster {
        generation: key.generation,
        scale: f32::from_bits(key.scale_bits),
        motion_frames: key.motion_frames,
        geometry: key.geometry,
        mode: key.mode,
        tiles,
        #[cfg(test)]
        image,
        #[cfg(test)]
        overlay,
    }
}

pub(crate) fn changed_raster_pages(
    previous: &Document,
    current: &Document,
    excluded_subtree: Option<&NodeId>,
) -> HashSet<NodeId> {
    let ids = previous
        .nodes
        .keys()
        .chain(current.nodes.keys())
        .cloned()
        .collect::<HashSet<_>>();
    let mut pages = HashSet::new();
    for id in ids {
        if excluded_subtree.is_some_and(|excluded| {
            &id == excluded
                || is_descendant_of(previous, &id, excluded)
                || is_descendant_of(current, &id, excluded)
        }) {
            continue;
        }
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

pub(crate) fn raster_scale_for_zoom(zoom: f64, display_scale: f32) -> f32 {
    let required = (zoom as f32 * display_scale.max(1.0)).clamp(0.5, 16.0);
    [0.5, 1.0, 2.0, 4.0, 8.0, 16.0]
        .into_iter()
        .find(|scale| *scale >= required)
        .unwrap_or(16.0)
}
pub(crate) fn visible_page_raster_regions(
    page: Bounds,
    camera: Camera,
    viewport: GpBounds<Pixels>,
    scale: f32,
) -> Vec<PageRasterRegion> {
    let viewport_width = f32::from(viewport.size.width) as f64;
    let viewport_height = f32::from(viewport.size.height) as f64;
    let screen_width = if viewport_width > 0.0 {
        viewport_width
    } else {
        1200.0
    };
    let screen_height = if viewport_height > 0.0 {
        viewport_height
    } else {
        800.0
    };
    let top_left = camera.screen_to_world(Vec2::new(0.0, 0.0));
    let bottom_right = camera.screen_to_world(Vec2::new(screen_width, screen_height));
    let visible = Bounds::new(
        top_left.x.min(bottom_right.x),
        top_left.y.min(bottom_right.y),
        (bottom_right.x - top_left.x).abs(),
        (bottom_right.y - top_left.y).abs(),
    );
    let Some(visible) = intersect_bounds_option(page, visible) else {
        return Vec::new();
    };
    page_raster_regions(
        page.width,
        page.height,
        Bounds::new(
            visible.x - page.x,
            visible.y - page.y,
            visible.width,
            visible.height,
        ),
        scale,
    )
}

pub(crate) fn page_raster_regions(
    page_width: f64,
    page_height: f64,
    visible: Bounds,
    scale: f32,
) -> Vec<PageRasterRegion> {
    let tile_size = RASTER_TILE_DEVICE_PX / scale.max(0.5) as f64;
    let local_left = visible.x.max(0.0);
    let local_top = visible.y.max(0.0);
    let local_right = (visible.x + visible.width).min(page_width);
    let local_bottom = (visible.y + visible.height).min(page_height);
    let max_column = ((page_width / tile_size).ceil() as i32 - 1).max(0);
    let max_row = ((page_height / tile_size).ceil() as i32 - 1).max(0);
    let first_column = ((local_left / tile_size).floor() as i32 - 1).clamp(0, max_column);
    let last_column = ((local_right / tile_size).ceil() as i32).clamp(0, max_column);
    let first_row = ((local_top / tile_size).floor() as i32 - 1).clamp(0, max_row);
    let last_row = ((local_bottom / tile_size).ceil() as i32).clamp(0, max_row);
    let mut regions = Vec::new();
    for row in first_row..=last_row {
        for column in first_column..=last_column {
            let x = column as f64 * tile_size;
            let y = row as f64 * tile_size;
            regions.push(PageRasterRegion {
                column,
                row,
                bounds: Bounds::new(
                    x,
                    y,
                    tile_size.min(page_width - x).max(0.0),
                    tile_size.min(page_height - y).max(0.0),
                ),
            });
        }
    }
    regions
}

pub(crate) fn intersect_bounds_option(left: Bounds, right: Bounds) -> Option<Bounds> {
    let x = left.x.max(right.x);
    let y = left.y.max(right.y);
    let right_edge = (left.x + left.width).min(right.x + right.width);
    let bottom = (left.y + left.height).min(right.y + right.height);
    (right_edge > x && bottom > y).then(|| Bounds::new(x, y, right_edge - x, bottom - y))
}
