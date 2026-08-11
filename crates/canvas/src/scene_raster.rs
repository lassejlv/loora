use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, OnceLock};

use base64::Engine as _;
use image::RgbaImage;
use loora_engine::{
    Color, Document, Node, NodeId, NodeKind, Overflow, Paint, ShapeKind, StrokeStyle, TextAlign,
    TextDecoration,
};

use crate::motion::MotionFrame;

pub(crate) fn page_needs_raster(
    document: &Document,
    page_id: &NodeId,
    motion_frames: &HashMap<NodeId, MotionFrame>,
) -> bool {
    descendants(document, page_id).into_iter().any(|node| {
        let motion = motion_frames.get(&node.id);
        let transformed_container = !children(document, &node.id).is_empty()
            && (node.rotation.abs() > f32::EPSILON
                || motion.is_some_and(|frame| {
                    frame.x.abs() > f32::EPSILON
                        || frame.y.abs() > f32::EPSILON
                        || (frame.scale_x - 1.0).abs() > f32::EPSILON
                        || (frame.scale_y - 1.0).abs() > f32::EPSILON
                        || frame.rotate.abs() > f32::EPSILON
                }));
        let complex_text = node.kind == NodeKind::Text
            && (node
                .style
                .fills
                .iter()
                .any(|paint| !matches!(paint, Paint::Solid { .. }))
                || !node.text_runs.is_empty());
        let complex_overflow = node.style.overflow != Overflow::Visible
            && (node.style.corners.max() > f32::EPSILON
                || node.rotation.abs() > f32::EPSILON
                || motion.is_some_and(|frame| {
                    (frame.scale_x - 1.0).abs() > f32::EPSILON
                        || (frame.scale_y - 1.0).abs() > f32::EPSILON
                        || frame.rotate.abs() > f32::EPSILON
                }));
        complex_overflow
            || node
                .style
                .blend_mode
                .as_deref()
                .is_some_and(|mode| mode != "normal")
            || complex_text
            || transformed_container
            || (node.rotation.abs() > f32::EPSILON && node.style.corners.max() > f32::EPSILON)
    })
}

pub(crate) fn render_page(
    document: &Document,
    page_id: &NodeId,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    scale: f32,
) -> Result<RgbaImage, String> {
    let svg = render_page_svg(document, page_id, motion_frames)?;
    rasterize_page(document, page_id, scale, &svg)
}

pub(crate) fn render_page_layers(
    document: &Document,
    page_id: &NodeId,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    scale: f32,
    roots: &[NodeId],
) -> Result<(RgbaImage, RgbaImage), String> {
    let (subtree, ancestors) = interaction_sets(document, page_id, roots);
    let background = render_page_svg_with_filter(
        document,
        page_id,
        motion_frames,
        SceneFilter::Exclude(subtree.clone()),
    )?;
    let overlay = render_page_svg_with_filter(
        document,
        page_id,
        motion_frames,
        SceneFilter::Isolate { subtree, ancestors },
    )?;
    Ok((
        rasterize_page(document, page_id, scale, &background)?,
        rasterize_page(document, page_id, scale, &overlay)?,
    ))
}

pub(crate) fn render_page_without_subtrees(
    document: &Document,
    page_id: &NodeId,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    scale: f32,
    roots: &[NodeId],
) -> Result<RgbaImage, String> {
    let (subtree, _) = interaction_sets(document, page_id, roots);
    let svg = render_page_svg_with_filter(
        document,
        page_id,
        motion_frames,
        SceneFilter::Exclude(subtree),
    )?;
    rasterize_page(document, page_id, scale, &svg)
}

fn rasterize_page(
    document: &Document,
    page_id: &NodeId,
    scale: f32,
    svg: &str,
) -> Result<RgbaImage, String> {
    let page = document
        .nodes
        .get(page_id)
        .ok_or_else(|| format!("missing page {page_id}"))?;
    let width = page.layout.width.max(1.0);
    let height = page.layout.height.max(1.0);
    let options = resvg::usvg::Options {
        fontdb: shared_font_database(),
        ..resvg::usvg::Options::default()
    };
    let tree = resvg::usvg::Tree::from_str(svg, &options)
        .map_err(|error| format!("parse canvas SVG: {error}"))?;
    let raster_scale = scale.clamp(0.5, 4.0);
    let pixel_width = (width * raster_scale as f64).ceil().clamp(1.0, 8192.0) as u32;
    let pixel_height = (height * raster_scale as f64).ceil().clamp(1.0, 8192.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(pixel_width, pixel_height)
        .ok_or_else(|| "canvas page is too large to rasterize".to_string())?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(raster_scale, raster_scale),
        &mut pixmap.as_mut(),
    );
    let mut bytes = pixmap.data().to_vec();
    unpremultiply_rgba(&mut bytes);
    RgbaImage::from_raw(pixel_width, pixel_height, bytes)
        .ok_or_else(|| "invalid canvas raster buffer".to_string())
}

fn shared_font_database() -> Arc<resvg::usvg::fontdb::Database> {
    static DATABASE: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();
    DATABASE
        .get_or_init(|| {
            let mut database = resvg::usvg::fontdb::Database::new();
            database.load_system_fonts();
            Arc::new(database)
        })
        .clone()
}

pub(crate) fn render_page_svg(
    document: &Document,
    page_id: &NodeId,
    motion_frames: &HashMap<NodeId, MotionFrame>,
) -> Result<String, String> {
    render_page_svg_with_filter(document, page_id, motion_frames, SceneFilter::Full)
}

fn render_page_svg_with_filter(
    document: &Document,
    page_id: &NodeId,
    motion_frames: &HashMap<NodeId, MotionFrame>,
    filter: SceneFilter,
) -> Result<String, String> {
    let page = document
        .nodes
        .get(page_id)
        .ok_or_else(|| format!("missing page {page_id}"))?;
    let mut renderer = SvgRenderer {
        document,
        motion_frames,
        defs: String::new(),
        next_id: 0,
        visiting: HashSet::new(),
        filter,
    };
    let body = renderer.node(page_id, true)?;
    let width = page.layout.width.max(1.0);
    let height = page.layout.height.max(1.0);
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\"><defs>{}</defs>{}</svg>",
        number(width),
        number(height),
        number(width),
        number(height),
        renderer.defs,
        body,
    ))
}

fn interaction_sets(
    document: &Document,
    page_id: &NodeId,
    roots: &[NodeId],
) -> (HashSet<NodeId>, HashSet<NodeId>) {
    let roots = roots.iter().cloned().collect::<HashSet<_>>();
    let subtree = document
        .nodes
        .values()
        .filter(|node| {
            let mut current = Some(&node.id);
            while let Some(id) = current {
                if roots.contains(id) {
                    return true;
                }
                current = document
                    .nodes
                    .get(id)
                    .and_then(|candidate| candidate.parent_id.as_ref());
            }
            false
        })
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    let mut ancestors = HashSet::from([page_id.clone()]);
    for root in roots {
        let mut parent = document
            .nodes
            .get(&root)
            .and_then(|node| node.parent_id.as_ref());
        while let Some(id) = parent {
            ancestors.insert(id.clone());
            parent = document
                .nodes
                .get(id)
                .and_then(|node| node.parent_id.as_ref());
        }
    }
    (subtree, ancestors)
}

enum SceneFilter {
    Full,
    Exclude(HashSet<NodeId>),
    Isolate {
        subtree: HashSet<NodeId>,
        ancestors: HashSet<NodeId>,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NodeRenderMode {
    Full,
    Ancestor,
    Skip,
}

struct SvgRenderer<'a> {
    document: &'a Document,
    motion_frames: &'a HashMap<NodeId, MotionFrame>,
    defs: String,
    next_id: usize,
    visiting: HashSet<NodeId>,
    filter: SceneFilter,
}

impl SvgRenderer<'_> {
    fn node(&mut self, id: &NodeId, root: bool) -> Result<String, String> {
        let render_mode = self.node_render_mode(id);
        if render_mode == NodeRenderMode::Skip {
            return Ok(String::new());
        }
        if !self.visiting.insert(id.clone()) {
            return Ok(String::new());
        }
        let Some(node) = self.document.nodes.get(id) else {
            self.visiting.remove(id);
            return Ok(String::new());
        };
        if node.hidden {
            self.visiting.remove(id);
            return Ok(String::new());
        }
        let width = node.layout.width.max(0.0);
        let height = node.layout.height.max(0.0);
        let motion = self.motion_frames.get(id);
        let x = if root { 0.0 } else { node.layout.x };
        let y = if root { 0.0 } else { node.layout.y };
        let tx = motion.map_or(0.0, |frame| frame.x as f64);
        let ty = motion.map_or(0.0, |frame| frame.y as f64);
        let scale_x = motion.map_or(1.0, |frame| frame.scale_x.max(0.01) as f64);
        let scale_y = motion.map_or(1.0, |frame| frame.scale_y.max(0.01) as f64);
        let rotation = node.rotation as f64 + motion.map_or(0.0, |frame| frame.rotate as f64);
        let transform = format!(
            "translate({} {}) translate({} {}) rotate({}) scale({} {}) translate({} {})",
            number(x),
            number(y),
            number(width * 0.5 + tx),
            number(height * 0.5 + ty),
            number(rotation),
            number(scale_x),
            number(scale_y),
            number(-width * 0.5),
            number(-height * 0.5),
        );
        let opacity = motion
            .map_or(node.style.opacity, |frame| frame.opacity)
            .clamp(0.0, 1.0);
        let blend = normalized_blend_mode(node.style.blend_mode.as_deref());
        let blend_style = if blend != "normal" {
            format!(" style=\"mix-blend-mode:{blend}\"")
        } else {
            String::new()
        };
        let own = if render_mode == NodeRenderMode::Full {
            let own = self.own_graphics(node, motion)?;
            self.with_shadow(node, own)
        } else {
            String::new()
        };
        let mut child_markup = String::new();
        for child in children(self.document, id) {
            child_markup.push_str(&self.node(&child.id, false)?);
        }
        if node.style.overflow != Overflow::Visible && !child_markup.is_empty() {
            let clip_id = self.unique_id("clip");
            self.defs.push_str(&format!(
                "<clipPath id=\"{clip_id}\" clipPathUnits=\"userSpaceOnUse\">{}</clipPath>",
                rounded_shape(node, width, height, "white", "", false),
            ));
            child_markup = format!("<g clip-path=\"url(#{clip_id})\">{child_markup}</g>");
        }
        self.visiting.remove(id);
        Ok(format!(
            "<g transform=\"{transform}\" opacity=\"{}\"{blend_style}>{own}{child_markup}</g>",
            number(opacity as f64),
        ))
    }

    fn node_render_mode(&self, id: &NodeId) -> NodeRenderMode {
        match &self.filter {
            SceneFilter::Full => NodeRenderMode::Full,
            SceneFilter::Exclude(excluded) => {
                if excluded.contains(id) {
                    NodeRenderMode::Skip
                } else {
                    NodeRenderMode::Full
                }
            }
            SceneFilter::Isolate { subtree, ancestors } => {
                if subtree.contains(id) {
                    NodeRenderMode::Full
                } else if ancestors.contains(id) {
                    NodeRenderMode::Ancestor
                } else {
                    NodeRenderMode::Skip
                }
            }
        }
    }

    fn own_graphics(
        &mut self,
        node: &Node,
        motion: Option<&MotionFrame>,
    ) -> Result<String, String> {
        let width = node.layout.width.max(0.0);
        let height = node.layout.height.max(0.0);
        if node.kind == NodeKind::Text {
            return Ok(self.text(node, motion));
        }
        if node.kind == NodeKind::Vector && !node.paths.is_empty() {
            return Ok(vector_markup(node, width, height));
        }
        let paints = motion
            .and_then(|frame| frame.fill)
            .map(|color| vec![Paint::solid(color)])
            .unwrap_or_else(|| node.style.fills.clone());
        let mut output = String::new();
        if paints.is_empty() && node.style.stroke.is_some() {
            output.push_str(&rounded_shape(
                node,
                width,
                height,
                "none",
                &stroke_markup(node),
                true,
            ));
        } else {
            let count = paints.len();
            for (index, paint) in paints.iter().rev().enumerate() {
                let fill = self.paint(paint);
                let stroke = if index + 1 == count {
                    stroke_markup(node)
                } else {
                    String::new()
                };
                output.push_str(&rounded_shape(
                    node,
                    width,
                    height,
                    &fill.value,
                    &format!(" fill-opacity=\"{}\"{stroke}", number(fill.opacity as f64)),
                    true,
                ));
            }
        }
        if node.kind == NodeKind::Image {
            if let Some(path) = node.image_path.as_deref() {
                if let Some(uri) = image_data_uri(path) {
                    let preserve = match node.image_fit {
                        loora_engine::ImageFit::Cover => "xMidYMid slice",
                        loora_engine::ImageFit::Contain => "xMidYMid meet",
                        loora_engine::ImageFit::Fill => "none",
                    };
                    output.push_str(&format!(
                        "<image x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" href=\"{}\" preserveAspectRatio=\"{preserve}\"/>",
                        number(width),
                        number(height),
                        xml_escape(&uri),
                    ));
                }
            }
        }
        Ok(output)
    }

    fn text(&mut self, node: &Node, motion: Option<&MotionFrame>) -> String {
        let typography = node.effective_typography();
        let text = node.display_text();
        let width = node.layout.width.max(0.0);
        let (x, anchor) = match typography.align {
            TextAlign::Left | TextAlign::Justify => (0.0, "start"),
            TextAlign::Center => (width * 0.5, "middle"),
            TextAlign::Right => (width, "end"),
        };
        let base_paint = motion
            .and_then(|frame| frame.fill)
            .map(Paint::solid)
            .or_else(|| node.style.fills.first().cloned())
            .unwrap_or_else(|| Paint::solid(typography.color));
        let base_fill = self.paint(&base_paint);
        let base_decoration = decoration_name(typography.decoration);
        let line_height = typography.size * typography.line_height.unwrap_or(1.25);
        let mut char_offset = 0usize;
        let mut lines = String::new();
        for (line_index, line) in text.split('\n').enumerate() {
            let line_chars = line.chars().count();
            let mut boundaries = vec![0, line_chars];
            for run in &node.text_runs {
                let start = run.start.max(char_offset).min(char_offset + line_chars);
                let end = run.end.max(char_offset).min(char_offset + line_chars);
                boundaries.push(start.saturating_sub(char_offset));
                boundaries.push(end.saturating_sub(char_offset));
            }
            boundaries.sort_unstable();
            boundaries.dedup();
            let mut spans = String::new();
            for range in boundaries.windows(2) {
                if range[0] >= range[1] {
                    continue;
                }
                let global_start = char_offset + range[0];
                let global_end = char_offset + range[1];
                let styled = node
                    .text_runs
                    .iter()
                    .rev()
                    .find(|run| run.start <= global_start && run.end >= global_end);
                let patch = styled.and_then(|run| run.typography.as_ref());
                let family = patch
                    .and_then(|patch| patch.family.as_deref())
                    .unwrap_or(&typography.family);
                let size = patch
                    .and_then(|patch| patch.size)
                    .unwrap_or(typography.size);
                let weight = patch
                    .and_then(|patch| patch.weight)
                    .unwrap_or(typography.weight);
                let letter_spacing = patch
                    .and_then(|patch| patch.letter_spacing)
                    .unwrap_or(typography.letter_spacing);
                let decoration = patch
                    .and_then(|patch| patch.decoration.as_deref())
                    .unwrap_or(base_decoration);
                let text = line
                    .chars()
                    .skip(range[0])
                    .take(range[1] - range[0])
                    .collect::<String>();
                let run_fill = styled
                    .and_then(|run| run.color)
                    .map(SvgPaint::from_color)
                    .unwrap_or_else(|| base_fill.clone());
                spans.push_str(&format!(
                    "<tspan font-family=\"{}\" font-size=\"{}\" font-weight=\"{}\" letter-spacing=\"{}\" text-decoration=\"{}\" fill=\"{}\" fill-opacity=\"{}\">{}</tspan>",
                    xml_escape(family),
                    number(size as f64),
                    weight,
                    number(letter_spacing as f64),
                    decoration,
                    run_fill.value,
                    number(run_fill.opacity as f64),
                    xml_escape(&text),
                ));
            }
            if spans.is_empty() {
                spans = xml_escape(line);
            }
            lines.push_str(&format!(
                "<text x=\"{}\" y=\"{}\" text-anchor=\"{anchor}\" font-family=\"{}\" font-size=\"{}\" font-weight=\"{}\" letter-spacing=\"{}\" text-decoration=\"{base_decoration}\" fill=\"{}\" fill-opacity=\"{}\">{spans}</text>",
                number(x),
                number(typography.size as f64 + line_height as f64 * line_index as f64),
                xml_escape(&typography.family),
                number(typography.size as f64),
                typography.weight,
                number(typography.letter_spacing as f64),
                base_fill.value,
                number(base_fill.opacity as f64),
            ));
            char_offset += line_chars + 1;
        }
        lines
    }

    fn paint(&mut self, paint: &Paint) -> SvgPaint {
        match paint {
            Paint::Solid { color, .. } => SvgPaint::from_color(*color),
            Paint::LinearGradient { angle, stops } => {
                let id = self.unique_id("linear");
                let radians = angle.to_radians();
                let dx = radians.sin() * 50.0;
                let dy = -radians.cos() * 50.0;
                self.defs.push_str(&format!(
                    "<linearGradient id=\"{id}\" x1=\"{}%\" y1=\"{}%\" x2=\"{}%\" y2=\"{}%\">",
                    number((50.0 - dx) as f64),
                    number((50.0 - dy) as f64),
                    number((50.0 + dx) as f64),
                    number((50.0 + dy) as f64),
                ));
                push_stops(&mut self.defs, stops);
                self.defs.push_str("</linearGradient>");
                SvgPaint {
                    value: format!("url(#{id})"),
                    opacity: 1.0,
                }
            }
            Paint::RadialGradient { cx, cy, stops, .. } => {
                let id = self.unique_id("radial");
                let percent = |value: f32| {
                    if value.abs() <= 1.0 {
                        value * 100.0
                    } else {
                        value
                    }
                };
                self.defs.push_str(&format!(
                    "<radialGradient id=\"{id}\" cx=\"{}%\" cy=\"{}%\" r=\"75%\">",
                    number(percent(*cx) as f64),
                    number(percent(*cy) as f64),
                ));
                push_stops(&mut self.defs, stops);
                self.defs.push_str("</radialGradient>");
                SvgPaint {
                    value: format!("url(#{id})"),
                    opacity: 1.0,
                }
            }
        }
    }

    fn with_shadow(&mut self, node: &Node, markup: String) -> String {
        if markup.is_empty() {
            return markup;
        }
        let mut filtered = markup;
        for shadow in node.style.shadows.iter().filter(|shadow| shadow.inset) {
            let id = self.unique_id("inset-shadow");
            self.defs.push_str(&format!(
                "<filter id=\"{id}\" x=\"-100%\" y=\"-100%\" width=\"300%\" height=\"300%\">"
            ));
            let source = if shadow.spread.abs() > f32::EPSILON {
                let operator = if shadow.spread > 0.0 {
                    "erode"
                } else {
                    "dilate"
                };
                self.defs.push_str(&format!(
                    "<feMorphology in=\"SourceAlpha\" operator=\"{operator}\" radius=\"{}\" result=\"inset-source\"/>",
                    number(shadow.spread.abs() as f64),
                ));
                "inset-source"
            } else {
                "SourceAlpha"
            };
            self.defs.push_str(&format!(
                "<feOffset in=\"{source}\" dx=\"{}\" dy=\"{}\" result=\"inset-offset\"/><feGaussianBlur in=\"inset-offset\" stdDeviation=\"{}\" result=\"inset-blur\"/><feComposite in=\"SourceAlpha\" in2=\"inset-blur\" operator=\"out\" result=\"inset-inverse\"/><feFlood flood-color=\"{}\" flood-opacity=\"{}\" result=\"inset-color\"/><feComposite in=\"inset-color\" in2=\"inset-inverse\" operator=\"in\" result=\"inset-shadow\"/><feComposite in=\"inset-shadow\" in2=\"SourceGraphic\" operator=\"over\"/></filter>",
                number(shadow.x as f64),
                number(shadow.y as f64),
                number((shadow.blur * 0.5).max(0.0) as f64),
                color_hex(shadow.color),
                number(shadow.color.a.clamp(0.0, 1.0) as f64),
            ));
            filtered = format!("<g filter=\"url(#{id})\">{filtered}</g>");
        }
        let shadows = node
            .style
            .shadows
            .iter()
            .filter(|shadow| !shadow.inset)
            .collect::<Vec<_>>();
        if shadows.is_empty() {
            return filtered;
        }
        let id = self.unique_id("shadow");
        self.defs.push_str(&format!(
            "<filter id=\"{id}\" x=\"-100%\" y=\"-100%\" width=\"300%\" height=\"300%\">"
        ));
        for shadow in shadows {
            self.defs.push_str(&format!(
                "<feDropShadow dx=\"{}\" dy=\"{}\" stdDeviation=\"{}\" flood-color=\"{}\" flood-opacity=\"{}\"/>",
                number(shadow.x as f64),
                number(shadow.y as f64),
                number((shadow.blur * 0.5).max(0.0) as f64),
                color_hex(shadow.color),
                number(shadow.color.a.clamp(0.0, 1.0) as f64),
            ));
        }
        self.defs.push_str("</filter>");
        format!("<g filter=\"url(#{id})\">{filtered}</g>")
    }

    fn unique_id(&mut self, prefix: &str) -> String {
        let id = format!("{prefix}-{}", self.next_id);
        self.next_id += 1;
        id
    }
}

#[derive(Clone)]
struct SvgPaint {
    value: String,
    opacity: f32,
}

impl SvgPaint {
    fn from_color(color: Color) -> Self {
        Self {
            value: color_hex(color),
            opacity: color.a.clamp(0.0, 1.0),
        }
    }
}

fn rounded_shape(
    node: &Node,
    width: f64,
    height: f64,
    fill: &str,
    attributes: &str,
    preserve_kind: bool,
) -> String {
    if preserve_kind && node.shape_kind == ShapeKind::Ellipse {
        return format!(
            "<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\" fill=\"{fill}\"{attributes}/>",
            number(width * 0.5),
            number(height * 0.5),
            number(width * 0.5),
            number(height * 0.5),
        );
    }
    if preserve_kind && node.shape_kind == ShapeKind::Line {
        return format!(
            "<line x1=\"0\" y1=\"{}\" x2=\"{}\" y2=\"{}\" fill=\"none\"{attributes}/>",
            number(height * 0.5),
            number(width),
            number(height * 0.5),
        );
    }
    let corners = node.style.corners;
    if corners.is_uniform() {
        return format!(
            "<rect x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" rx=\"{}\" fill=\"{fill}\"{attributes}/>",
            number(width),
            number(height),
            number((corners.tl as f64).min(width * 0.5).min(height * 0.5)),
        );
    }
    format!(
        "<path d=\"{}\" fill=\"{fill}\"{attributes}/>",
        rounded_rect_path(width, height, corners),
    )
}

fn rounded_rect_path(width: f64, height: f64, corners: loora_engine::Corners) -> String {
    let limit = width.min(height) * 0.5;
    let tl = (corners.tl as f64).clamp(0.0, limit);
    let tr = (corners.tr as f64).clamp(0.0, limit);
    let br = (corners.br as f64).clamp(0.0, limit);
    let bl = (corners.bl as f64).clamp(0.0, limit);
    format!(
        "M {} 0 H {} A {} {} 0 0 1 {} {} V {} A {} {} 0 0 1 {} {} H {} A {} {} 0 0 1 0 {} V {} A {} {} 0 0 1 {} 0 Z",
        number(tl),
        number(width - tr),
        number(tr),
        number(tr),
        number(width),
        number(tr),
        number(height - br),
        number(br),
        number(br),
        number(width - br),
        number(height),
        number(bl),
        number(bl),
        number(bl),
        number(height - bl),
        number(tl),
        number(tl),
        number(tl),
        number(tl),
    )
}

fn vector_markup(node: &Node, width: f64, height: f64) -> String {
    let (vx, vy, vw, vh) = parse_view_box(node.vector_view_box.as_deref().unwrap_or("0 0 100 100"));
    let mut output = format!(
        "<g transform=\"scale({} {}) translate({} {})\">",
        number(width / vw),
        number(height / vh),
        number(-vx),
        number(-vy),
    );
    for path in &node.paths {
        let fill = path.fill.map(color_hex).unwrap_or_else(|| "none".into());
        let fill_opacity = path.fill.map_or(1.0, |color| color.a);
        let stroke = path.stroke.map_or_else(String::new, |color| {
            format!(
                " stroke=\"{}\" stroke-opacity=\"{}\" stroke-width=\"{}\"",
                color_hex(color),
                number(color.a as f64),
                number(path.stroke_width.unwrap_or(1.0) as f64),
            )
        });
        output.push_str(&format!(
            "<path d=\"{}\" fill=\"{fill}\" fill-opacity=\"{}\"{stroke}/>",
            xml_escape(&path.d),
            number(fill_opacity as f64),
        ));
    }
    output.push_str("</g>");
    output
}

fn stroke_markup(node: &Node) -> String {
    node.style
        .stroke
        .as_ref()
        .map_or_else(String::new, |stroke| {
            let dash = match stroke.style {
                StrokeStyle::Solid => String::new(),
                StrokeStyle::Dashed => format!(
                    " stroke-dasharray=\"{} {}\"",
                    number(stroke.width.max(1.0) as f64 * 3.0),
                    number(stroke.width.max(1.0) as f64 * 2.0),
                ),
                StrokeStyle::Dotted => format!(
                    " stroke-dasharray=\"0 {}\" stroke-linecap=\"round\"",
                    number(stroke.width.max(1.0) as f64 * 2.0),
                ),
            };
            format!(
                " stroke=\"{}\" stroke-opacity=\"{}\" stroke-width=\"{}\"{dash}",
                color_hex(stroke.color),
                number(stroke.color.a.clamp(0.0, 1.0) as f64),
                number(stroke.width.max(0.0) as f64),
            )
        })
}

fn push_stops(output: &mut String, stops: &[loora_engine::GradientStop]) {
    for stop in stops {
        output.push_str(&format!(
            "<stop offset=\"{}%\" stop-color=\"{}\" stop-opacity=\"{}\"/>",
            number(stop.offset.clamp(0.0, 1.0) as f64 * 100.0),
            color_hex(stop.color),
            number(stop.color.a.clamp(0.0, 1.0) as f64),
        ));
    }
}

fn children<'a>(document: &'a Document, parent: &NodeId) -> Vec<&'a Node> {
    let mut children = document
        .nodes
        .values()
        .filter(|node| node.parent_id.as_ref() == Some(parent))
        .collect::<Vec<_>>();
    children.sort_by(|left, right| {
        left.order
            .total_cmp(&right.order)
            .then_with(|| left.id.as_str().cmp(right.id.as_str()))
    });
    children
}

fn descendants<'a>(document: &'a Document, root: &NodeId) -> Vec<&'a Node> {
    let mut result = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(id) = stack.pop() {
        let Some(node) = document.nodes.get(&id) else {
            continue;
        };
        result.push(node);
        stack.extend(
            children(document, &id)
                .into_iter()
                .map(|child| child.id.clone()),
        );
    }
    result
}

fn image_data_uri(value: &str) -> Option<String> {
    if value.starts_with("data:") {
        return Some(value.to_string());
    }
    let path = Path::new(value);
    let mime = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    };
    let bytes = std::fs::read(path).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn normalized_blend_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("normal") {
        "multiply" => "multiply",
        "screen" => "screen",
        "overlay" => "overlay",
        "darken" => "darken",
        "lighten" => "lighten",
        "color-dodge" | "color_dodge" => "color-dodge",
        "color-burn" | "color_burn" => "color-burn",
        "hard-light" | "hard_light" => "hard-light",
        "soft-light" | "soft_light" => "soft-light",
        "difference" => "difference",
        "exclusion" => "exclusion",
        "hue" => "hue",
        "saturation" => "saturation",
        "color" => "color",
        "luminosity" => "luminosity",
        _ => "normal",
    }
}

fn decoration_name(value: TextDecoration) -> &'static str {
    match value {
        TextDecoration::None => "none",
        TextDecoration::Underline => "underline",
        TextDecoration::LineThrough => "line-through",
    }
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

fn color_hex(color: Color) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        (color.r.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.g.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.b.clamp(0.0, 1.0) * 255.0).round() as u8,
    )
}

fn number(value: f64) -> String {
    let mut output = format!("{value:.4}");
    while output.contains('.') && output.ends_with('0') {
        output.pop();
    }
    if output.ends_with('.') {
        output.pop();
    }
    output
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn unpremultiply_rgba(bytes: &mut [u8]) {
    for pixel in bytes.chunks_exact_mut(4) {
        let alpha = pixel[3] as u16;
        if alpha == 0 || alpha == 255 {
            continue;
        }
        for channel in &mut pixel[..3] {
            *channel = ((*channel as u16 * 255 + alpha / 2) / alpha).min(255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use loora_engine::{Corners, GradientStop, Layout, Shadow, TextRun, TypographyPatch};

    #[test]
    fn complex_svg_keeps_clip_blend_gradient_and_rich_text() {
        let mut document = Document::empty("Style fixture");
        let page = document.root_page_id.clone();
        let mut clip = Node::frame("Clip", page.clone(), Layout::new(20.0, 20.0, 180.0, 120.0));
        clip.style.overflow = Overflow::Hidden;
        clip.style.corners = Corners::uniform(24.0);
        clip.rotation = 8.0;
        let clip_id = clip.id.clone();
        let mut blend = Node::rectangle(
            "Blend",
            clip_id.clone(),
            Layout::new(100.0, 30.0, 120.0, 80.0),
        );
        blend.style.blend_mode = Some("multiply".into());
        blend.style.set_solid_fill(Some(Color::rgb(255, 0, 0)));
        let mut text = Node::text(
            "Gradient text",
            page.clone(),
            Layout::new(20.0, 180.0, 320.0, 60.0),
            "Rich text",
        );
        text.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 0, 0),
                    token_id: None,
                },
                GradientStop {
                    offset: 1.0,
                    color: Color::rgb(0, 0, 255),
                    token_id: None,
                },
            ],
        }];
        text.text_runs.push(TextRun {
            start: 0,
            end: 4,
            typography: Some(TypographyPatch {
                weight: Some(700),
                letter_spacing: Some(2.0),
                ..TypographyPatch::default()
            }),
            color: None,
            color_token: None,
        });
        document.nodes.insert(clip_id, clip);
        document.nodes.insert(blend.id.clone(), blend);
        document.nodes.insert(text.id.clone(), text);

        let svg = render_page_svg(&document, &page, &HashMap::new()).unwrap();

        assert!(svg.contains("<clipPath"));
        assert!(svg.contains("mix-blend-mode:multiply"));
        assert!(svg.contains("<linearGradient"));
        assert!(svg.contains("font-weight=\"700\""));
        assert!(svg.contains("letter-spacing=\"2\""));
        assert!(resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).is_ok());
    }

    #[test]
    fn rounded_rotated_overflow_masks_child_pixels() {
        let mut document = Document::empty("Rounded clip");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 100.0;
            page_node.layout.height = 100.0;
            page_node.style.fills.clear();
        }
        let mut clip = Node::frame("Clip", page.clone(), Layout::new(10.0, 10.0, 80.0, 80.0));
        clip.style.overflow = Overflow::Hidden;
        clip.style.corners = Corners::uniform(30.0);
        clip.rotation = 12.0;
        let clip_id = clip.id.clone();
        let mut child = Node::rectangle(
            "Child",
            clip_id.clone(),
            Layout::new(-20.0, -20.0, 120.0, 120.0),
        );
        child.style.set_solid_fill(Some(Color::rgb(255, 0, 0)));
        document.nodes.insert(clip_id, clip);
        document.nodes.insert(child.id.clone(), child);

        let image = render_page(&document, &page, &HashMap::new(), 1.0).unwrap();

        assert_eq!(image.get_pixel(10, 10).0[3], 0);
        assert!(image.get_pixel(50, 50).0[3] > 0);
    }

    #[test]
    fn gradient_text_raster_contains_both_gradient_ends() {
        let mut document = Document::empty("Gradient text");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 400.0;
            page_node.layout.height = 100.0;
            page_node.style.fills.clear();
        }
        let mut text = Node::text(
            "Gradient",
            page.clone(),
            Layout::new(10.0, 10.0, 380.0, 80.0),
            "MMMMMMMM",
        );
        text.typography.as_mut().unwrap().size = 60.0;
        text.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 0, 0),
                    token_id: None,
                },
                GradientStop {
                    offset: 1.0,
                    color: Color::rgb(0, 0, 255),
                    token_id: None,
                },
            ],
        }];
        document.nodes.insert(text.id.clone(), text);

        let image = render_page(&document, &page, &HashMap::new(), 1.0).unwrap();
        let has_red = image
            .pixels()
            .any(|pixel| pixel.0[3] > 0 && pixel.0[0] as i16 > pixel.0[2] as i16 + 40);
        let has_blue = image
            .pixels()
            .any(|pixel| pixel.0[3] > 0 && pixel.0[2] as i16 > pixel.0[0] as i16 + 40);

        assert!(has_red && has_blue);
    }

    #[test]
    fn multiply_blend_composites_against_prior_siblings() {
        let mut document = Document::empty("Blend");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 100.0;
            page_node.layout.height = 100.0;
            page_node.style.fills.clear();
        }
        let mut blue = Node::rectangle("Blue", page.clone(), Layout::new(10.0, 10.0, 80.0, 80.0));
        blue.style.set_solid_fill(Some(Color::rgb(0, 0, 255)));
        blue.order = 0.0;
        let mut red = Node::rectangle("Red", page.clone(), Layout::new(10.0, 10.0, 80.0, 80.0));
        red.style.set_solid_fill(Some(Color::rgb(255, 0, 0)));
        red.style.blend_mode = Some("multiply".into());
        red.order = 1024.0;
        document.nodes.insert(blue.id.clone(), blue);
        document.nodes.insert(red.id.clone(), red);

        let image = render_page(&document, &page, &HashMap::new(), 1.0).unwrap();
        let pixel = image.get_pixel(50, 50).0;

        assert!(pixel[0] < 8 && pixel[1] < 8 && pixel[2] < 8);
        assert_eq!(pixel[3], 255);
    }

    #[test]
    fn next_batch_inset_shadow_darkens_the_inside_edge() {
        let mut document = Document::empty("Inset shadow");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 100.0;
            page_node.layout.height = 100.0;
            page_node.style.fills.clear();
        }
        let mut card = Node::rectangle("Card", page.clone(), Layout::new(10.0, 10.0, 80.0, 80.0));
        card.style.set_solid_fill(Some(Color::rgb(255, 255, 255)));
        card.style.shadows.push(Shadow {
            color: Color::rgba(0.0, 0.0, 0.0, 0.75),
            x: 0.0,
            y: 0.0,
            blur: 10.0,
            spread: 2.0,
            inset: true,
            token_id: None,
        });
        document.nodes.insert(card.id.clone(), card);

        let image = render_page(&document, &page, &HashMap::new(), 1.0).unwrap();
        let edge = image.get_pixel(14, 50).0;
        let center = image.get_pixel(50, 50).0;

        assert!(edge[0] as u16 + 20 < center[0] as u16);
        assert!(edge[1] as u16 + 20 < center[1] as u16);
        assert!(edge[2] as u16 + 20 < center[2] as u16);
    }

    #[test]
    fn interaction_layers_keep_complex_style_on_the_overlay() {
        let mut document = Document::empty("Interaction layers");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 100.0;
            page_node.layout.height = 100.0;
            page_node
                .style
                .set_solid_fill(Some(Color::rgb(255, 255, 255)));
        }
        let mut gradient = Node::rectangle(
            "Gradient",
            page.clone(),
            Layout::new(10.0, 10.0, 80.0, 80.0),
        );
        gradient.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 0, 0),
                    token_id: None,
                },
                GradientStop {
                    offset: 1.0,
                    color: Color::rgb(0, 0, 255),
                    token_id: None,
                },
            ],
        }];
        let gradient_id = gradient.id.clone();
        document.nodes.insert(gradient_id.clone(), gradient);

        let (background, overlay) =
            render_page_layers(&document, &page, &HashMap::new(), 1.0, &[gradient_id]).unwrap();
        let background_center = background.get_pixel(50, 50).0;
        let overlay_left = overlay.get_pixel(20, 50).0;
        let overlay_right = overlay.get_pixel(80, 50).0;

        assert_eq!(background_center, [255, 255, 255, 255]);
        assert!(overlay_left[3] > 0 && overlay_left[0] > overlay_left[2]);
        assert!(overlay_right[3] > 0 && overlay_right[2] > overlay_right[0]);
    }

    #[test]
    fn permanent_style_fixture_renders_as_a_real_page() {
        let document = crate::style_fixture::style_fixture_document();
        let page = document.root_page_id.clone();

        assert!(page_needs_raster(&document, &page, &HashMap::new()));
        let image = render_page(&document, &page, &HashMap::new(), 0.5).unwrap();

        assert_eq!((image.width(), image.height()), (600, 380));
        assert!(image.pixels().filter(|pixel| pixel.0[3] > 0).count() > 150_000);
    }
}
