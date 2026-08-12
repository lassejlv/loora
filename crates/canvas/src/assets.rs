use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use gpui::{Hsla, RenderImage, Rgba};
use loora_engine::{Color, Document, ImageFit, Node, NodeId, Paint};

use crate::motion::MotionFrame;

#[derive(Clone)]
pub(crate) struct RotatedImage {
    pub(crate) image: Arc<RenderImage>,
    pub(crate) width_ratio: f32,
    pub(crate) height_ratio: f32,
}

#[derive(Clone)]
pub(crate) struct GradientRaster {
    pub(crate) alpha: u8,
    pub(crate) image: Arc<RenderImage>,
}

#[derive(Clone)]
pub(crate) struct OpacityImage {
    pub(crate) alpha: u8,
    pub(crate) image: Arc<RenderImage>,
    pub(crate) source: Arc<RenderImage>,
}
pub(crate) const GRADIENT_RASTER_SIZE: u32 = 192;

pub(crate) fn render_gradient_image(paint: &Paint, opacity: f32) -> Option<Arc<RenderImage>> {
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

pub(crate) fn normalize_gradient_position(value: f32) -> f32 {
    if value.abs() > 1.0 {
        value / 100.0
    } else {
        value
    }
    .clamp(0.0, 1.0)
}

pub(crate) fn sample_gradient(stops: &[loora_engine::GradientStop], offset: f32) -> Option<Color> {
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

pub(crate) fn load_render_image(path: &Path) -> Option<Arc<RenderImage>> {
    let mut image = image::open(path).ok()?.into_rgba8();
    for pixel in image.as_mut().chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let frame = image::Frame::new(image);
    Some(Arc::new(RenderImage::new(smallvec::smallvec![frame])))
}

pub(crate) fn render_image_with_opacity(
    source: &Arc<RenderImage>,
    opacity: f32,
) -> Arc<RenderImage> {
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

pub(crate) fn load_rotated_image(
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

pub(crate) fn rotate_rgba(source: &image::RgbaImage, rotation: f32) -> image::RgbaImage {
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
pub(crate) fn color_hsla(color: Color, opacity: f32) -> Hsla {
    Rgba {
        r: color.r,
        g: color.g,
        b: color.b,
        a: color.a * opacity,
    }
    .into()
}

pub(crate) fn node_opacity(
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
