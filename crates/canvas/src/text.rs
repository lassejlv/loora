use std::ops::Range;

use gpui::{
    font, point, px, size, Bounds as GpBounds, FontWeight, Hsla, Pixels, Point, ShapedLine,
    SharedString, StrikethroughStyle, TextAlign as GpTextAlign, TextRun, UnderlineStyle, Window,
};
use loora_engine::{
    Bounds, Color, Document, Node, NodeId, NodeKind, TextAlign as EngineTextAlign, TextDecoration,
};
use std::collections::HashMap;

use crate::assets::color_hsla;
use crate::types::NativeTextEdit;

#[derive(Clone)]
pub(crate) struct PreparedText {
    pub(crate) line: ShapedLine,
    pub(crate) origin: Point<Pixels>,
    pub(crate) line_height: Pixels,
    pub(crate) align: GpTextAlign,
    pub(crate) width: Pixels,
    pub(crate) clip: GpBounds<Pixels>,
    pub(crate) selection: Option<GpBounds<Pixels>>,
    pub(crate) marked: Option<GpBounds<Pixels>>,
    pub(crate) caret: Option<GpBounds<Pixels>>,
    pub(crate) rotation: f32,
    pub(crate) rotation_center: Point<Pixels>,
    pub(crate) svg: Option<SharedString>,
    pub(crate) svg_color: Hsla,
}
pub(crate) fn prepare_node_text(
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
            let marked = text_edit
                .and_then(|edit| edit.marked_range.as_ref())
                .and_then(|marked| {
                    let start = marked.start.max(line_start).min(line_end);
                    let end = marked.end.max(line_start).min(line_end);
                    (start < end).then(|| {
                        let left = line.x_for_index(start - line_start);
                        let right = line.x_for_index(end - line_start);
                        GpBounds::from_corners(
                            point(origin.x + align_offset + left, origin.y),
                            point(origin.x + align_offset + right, origin.y + line_height),
                        )
                    })
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
                marked,
                caret,
                rotation,
                rotation_center: bounds.center(),
                svg,
                svg_color: color_hsla(color.unwrap_or(typography.color), opacity),
            }
        })
        .collect()
}

pub(crate) fn resolved_line_height(typography: &loora_engine::Typography) -> f32 {
    typography.size * typography.line_height.unwrap_or(1.25)
}

pub(crate) fn root_page_label_is_frontmost(
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

pub(crate) fn text_paint_color(node: &Node, motion_fill: Option<Color>) -> Option<Color> {
    motion_fill.or_else(|| node.style.solid_fill())
}

pub(crate) fn should_use_text_svg(
    rotation: f32,
    letter_spacing: f32,
    text_edit: Option<&NativeTextEdit>,
) -> bool {
    text_edit.is_none() && (rotation.abs() > f32::EPSILON || letter_spacing.abs() > f32::EPSILON)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn styled_text_svg(
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

pub(crate) fn text_runs_for_line(
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
pub(crate) fn word_range_at(text: &str, index: usize) -> Range<usize> {
    if text.is_empty() {
        return 0..0;
    }
    let mut index = index.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    if index == text.len() {
        index = text[..index]
            .char_indices()
            .next_back()
            .map_or(0, |(offset, _)| offset);
    }
    let selected = text[index..].chars().next().unwrap();
    let class = |ch: char| {
        if ch.is_alphanumeric() || ch == '_' {
            0
        } else if ch.is_whitespace() {
            1
        } else {
            2
        }
    };
    let selected_class = class(selected);
    let mut start = index;
    for (offset, ch) in text[..index].char_indices().rev() {
        if class(ch) != selected_class {
            break;
        }
        start = offset;
    }
    let mut end = index + selected.len_utf8();
    for (_, ch) in text[end..].char_indices() {
        if class(ch) != selected_class {
            break;
        }
        end += ch.len_utf8();
    }
    start..end
}

pub(crate) fn sorted_range(anchor: usize, caret: usize) -> Range<usize> {
    anchor.min(caret)..anchor.max(caret)
}

pub(crate) fn utf16_offset_to_utf8(text: &str, offset: usize) -> usize {
    let mut utf8 = 0;
    let mut utf16 = 0;
    for ch in text.chars() {
        if utf16 >= offset {
            break;
        }
        utf16 += ch.len_utf16();
        utf8 += ch.len_utf8();
    }
    utf8
}

pub(crate) fn utf8_offset_to_utf16(text: &str, offset: usize) -> usize {
    let mut offset = offset.min(text.len());
    while offset > 0 && !text.is_char_boundary(offset) {
        offset -= 1;
    }
    text[..offset].encode_utf16().count()
}

pub(crate) fn utf16_range_to_utf8(text: &str, range: Range<usize>) -> Range<usize> {
    utf16_offset_to_utf8(text, range.start)..utf16_offset_to_utf8(text, range.end)
}

pub(crate) fn utf8_range_to_utf16(text: &str, range: Range<usize>) -> Range<usize> {
    utf8_offset_to_utf16(text, range.start)..utf8_offset_to_utf16(text, range.end)
}
