//! Canonical Canvas V2 HTML/CSS compiler.
//!
//! The desktop canvas and HTML export both use this module. Browser layout is
//! deliberately the source of truth for flex, grid, text metrics, responsive
//! sizing, gradients and motion; the GPUI shell does not repaint document
//! nodes itself.

use std::collections::{HashMap, HashSet};

use crate::{
    AnimationTrigger, Color, Document, FlexDirection, ImageFit, Layout, LayoutAlign,
    LayoutJustify, LayoutMode, LayoutPosition, MotionTransform, Node,
    NodeAnimation, NodeId, NodeKind, Overflow, Paint, Shadow, ShapeKind, SizeMode, Stroke,
    StrokeStyle, StylePatch, TextAlign, TextDecoration, TextTransform,
    TypographyPatch, VisualState,
};

/// View-only choices applied while compiling. None of these mutate the design.
#[derive(Clone, Debug, Default)]
pub struct HtmlCanvasOptions {
    /// Force every artboard through one responsive width (breakpoint preview).
    pub viewport_width: Option<f64>,
    /// Resolve token modes through this theme instead of the document default.
    pub theme_id: Option<String>,
    /// Runtime visibility overrides used by preview interactions.
    pub hidden_nodes: HashSet<NodeId>,
    /// When present, only this page is visible in interactive preview.
    pub current_page_id: Option<NodeId>,
    /// Optional preview overlay page rendered above the current page.
    pub overlay_page_id: Option<NodeId>,
    /// Adds interaction metadata and enables motion on the compiled surface.
    pub preview: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CompiledCanvas {
    pub markup: String,
    pub css: String,
}

/// Compile page artboards into editable DOM and scoped CSS.
pub fn compile_canvas(document: &Document, options: &HtmlCanvasOptions) -> CompiledCanvas {
    let index = child_index(document);
    let mut pages: Vec<&Node> = document
        .nodes
        .values()
        .filter(|node| node.kind == NodeKind::Page)
        .collect();
    pages.sort_by(|left, right| {
        left.order
            .total_cmp(&right.order)
            .then_with(|| left.id.as_str().cmp(right.id.as_str()))
    });

    let theme_id = options
        .theme_id
        .as_deref()
        .unwrap_or(&document.active_theme_id);
    let mut markup = String::new();
    let mut css = String::from(EDITOR_PREFLIGHT);
    css.push_str(&font_imports(document));
    css.push_str(&token_declarations(document, theme_id));
    css.push_str(&animation_keyframes(document));

    for page in pages {
        let overlay_page = options.preview
            && options.overlay_page_id.as_ref() == Some(&page.id);
        let current_page = options
            .current_page_id
            .as_ref()
            .is_none_or(|current| current == &page.id);
        if options.preview && !current_page && !overlay_page {
            continue;
        }
        let width = options
            .viewport_width
            .or_else(|| (page.layout.width > 1.0).then_some(page.layout.width))
            .or_else(|| page.viewport.map(|viewport| viewport.width))
            .unwrap_or(1.0)
            .max(1.0);
        let resolved_page = resolved_node(document, page, width);
        let page_width = options.viewport_width.unwrap_or(resolved_page.layout.width).max(1.0);
        let viewport_min_height = resolved_page
            .viewport
            .map(|viewport| viewport.min_height)
            .unwrap_or(1.0);
        let page_height = if resolved_page.layout.height_mode == SizeMode::Fixed {
            resolved_page.layout.height.max(1.0)
        } else {
            resolved_page.layout.height.max(viewport_min_height)
        };
        let page_clips = matches!(
            resolved_page.style.overflow,
            Overflow::Hidden | Overflow::Auto
        );
        let host_height = if page_clips {
            // Hug pages normally grow with content; clipping needs a fixed box.
            format!(
                "height:{}px;min-height:{}px;overflow:hidden",
                number(page_height),
                number(page_height)
            )
        } else if resolved_page.layout.height_mode == SizeMode::Hug {
            format!("min-height:{}px", number(page_height))
        } else {
            format!(
                "height:{}px;min-height:{}px",
                number(page_height),
                number(page_height)
            )
        };
        let page_class = node_class(&page.id);
        markup.push_str(&format!(
            "<section class=\"loora-page-host{}\" data-loora-page-host=\"{}\"{} style=\"left:{}px;top:{}px;width:{}px;{}\"><div class=\"loora-page-label\" data-loora-page-label=\"{}\">{}</div>",
            if overlay_page { " loora-overlay-page-host" } else { "" },
            html_attr(page.id.as_str()),
            if overlay_page { " data-loora-overlay-page=\"true\"" } else { "" },
            number(resolved_page.layout.x),
            number(resolved_page.layout.y),
            number(page_width),
            host_height,
            html_attr(page.id.as_str()),
            html_text(&page.name),
        ));
        {
            let context = RenderContext {
                document,
                viewport_width: width,
                index: &index,
                options,
            };
            let mut output = RenderOutput {
                markup: &mut markup,
                css: &mut css,
            };
            render_node(&context, &resolved_page, None, true, &mut output);
        }
        markup.push_str("</section>");

        // Page roots live inside an absolutely positioned host on the editor
        // surface. Their children still use the exact Canvas layout contract.
        let page_size_css = if page_clips {
            format!(
                "height:{}px!important;min-height:{}px!important;overflow:{}!important",
                number(page_height),
                number(page_height),
                match resolved_page.style.overflow {
                    Overflow::Hidden => "hidden",
                    Overflow::Auto => "auto",
                    Overflow::Visible => "visible",
                }
            )
        } else if resolved_page.layout.height_mode == SizeMode::Hug {
            format!(
                "height:auto!important;min-height:{}px!important",
                number(viewport_min_height)
            )
        } else {
            "height:100%!important;min-height:0!important".into()
        };
        css.push_str(&format!(
            ".{page_class}{{position:relative!important;left:0!important;top:0!important;width:100%!important;{page_size_css}}}"
        ));
    }

    CompiledCanvas { markup, css }
}

/// A self-contained browser document using the same compiler as the editor.
pub fn standalone_html(document: &Document, options: &HtmlCanvasOptions) -> String {
    let compiled = compile_canvas(document, options);
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>{}</style></head><body><div id=\"loora-export\"><div id=\"loora-scene\">{}</div></div></body></html>",
        compiled.css, compiled.markup
    )
}

/// SVG export of the active page via an XHTML foreignObject (same CSS as the editor).
pub fn export_page_svg(document: &Document, page_id: Option<&NodeId>) -> String {
    let page_id = page_id
        .cloned()
        .unwrap_or_else(|| document.root_page_id.clone());
    let options = HtmlCanvasOptions {
        preview: true,
        current_page_id: Some(page_id.clone()),
        ..HtmlCanvasOptions::default()
    };
    let compiled = compile_canvas(document, &options);
    let (width, height) = document
        .nodes
        .get(&page_id)
        .map(|page| {
            let width = page.layout.width.max(1.0);
            let height = if page.layout.height_mode == SizeMode::Hug {
                page.layout
                    .height
                    .max(page.viewport.map(|v| v.min_height).unwrap_or(1.0))
                    .max(1.0)
            } else {
                page.layout.height.max(1.0)
            };
            (width, height)
        })
        .unwrap_or((1440.0, 900.0));
    format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8"?>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">"#,
            r#"<foreignObject x="0" y="0" width="100%" height="100%">"#,
            r#"<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:{width}px;height:{height}px;overflow:hidden;background:#fff">"#,
            r#"<style>.loora-page-host{{left:0!important;top:0!important;}}{css}</style>"#,
            r#"<div id="loora-scene" style="position:relative;width:{width}px;height:{height}px">{markup}</div>"#,
            r#"</div></foreignObject></svg>"#
        ),
        width = number(width),
        height = number(height),
        css = compiled.css,
        markup = compiled.markup,
    )
}

struct RenderContext<'a> {
    document: &'a Document,
    viewport_width: f64,
    index: &'a HashMap<Option<NodeId>, Vec<NodeId>>,
    options: &'a HtmlCanvasOptions,
}

struct RenderOutput<'a> {
    markup: &'a mut String,
    css: &'a mut String,
}

fn render_node(
    context: &RenderContext<'_>,
    node: &Node,
    parent: Option<&Node>,
    page_root: bool,
    output: &mut RenderOutput<'_>,
) {
    let resolved = if page_root {
        node.clone()
    } else {
        resolved_node(context.document, node, context.viewport_width)
    };
    let mut hidden = resolved.hidden || context.options.hidden_nodes.contains(&resolved.id);
    if let Some(parent_id) = &resolved.parent_id {
        hidden |= context.options.hidden_nodes.contains(parent_id);
    }

    let class = node_class(&resolved.id);
    let parent_layout = parent.map(|parent| &parent.layout);
    let mut declarations = layout_declarations(&resolved.layout, parent_layout, page_root);
    declarations.extend(style_declarations(&resolved));
    enforce_clip_box(&mut declarations, &resolved);
    if hidden {
        declarations.push("display:none".into());
    }
    output
        .css
        .push_str(&format!(".{class}{{{}}}", declarations.join(";")));
    output.css.push_str(&motion_declarations(
        context.document,
        &resolved,
        &class,
        context.options.preview,
    ));

    let tag = semantic_tag(&resolved);
    let interactions = serde_json::to_string(&resolved.interactions).unwrap_or_else(|_| "[]".into());
    let states = serde_json::to_string(&resolved.states).unwrap_or_else(|_| "{}".into());
    let parent_id = resolved.parent_id.as_ref().map(NodeId::as_str).unwrap_or_default();
    let content_editable =
        resolved.kind == NodeKind::Text && !resolved.locked && !context.options.preview;
    output.markup.push_str(&format!(
        "<{tag} class=\"loora-node {class}\" data-loora-node=\"{}\" data-loora-kind=\"{}\" data-loora-parent=\"{}\" data-loora-position=\"{}\" data-loora-locked=\"{}\" data-loora-interactions=\"{}\" data-loora-states=\"{}\"{}>",
        html_attr(resolved.id.as_str()),
        kind_name(resolved.kind),
        html_attr(parent_id),
        if resolved.layout.position == LayoutPosition::Flow { "flow" } else { "absolute" },
        resolved.locked,
        html_attr(&interactions),
        html_attr(&states),
        if content_editable { " data-loora-editable=\"true\"" } else { "" },
    ));

    match resolved.kind {
        NodeKind::Text => render_text(&resolved, output.markup),
        NodeKind::Image => {
            let source = resolved.image_path.as_deref().unwrap_or_default();
            output.markup.push_str(&format!(
                "<img class=\"loora-image-content\" src=\"{}\" alt=\"{}\" draggable=\"false\">",
                html_attr(&asset_url(source)),
                html_attr(&resolved.image_alt),
            ));
        }
        NodeKind::Vector => render_vector(&resolved, output.markup),
        _ => {
            if let Some(children) = context.index.get(&Some(resolved.id.clone())) {
                for child_id in children {
                    if let Some(child) = context.document.nodes.get(child_id) {
                        render_node(context, child, Some(&resolved), false, output);
                    }
                }
            }
        }
    }
    output.markup.push_str(&format!("</{tag}>"));
}

fn render_text(node: &Node, markup: &mut String) {
    let text = node.display_text();
    if node.text_runs.is_empty() {
        markup.push_str(&html_text(&text));
        return;
    }

    let chars: Vec<char> = text.chars().collect();
    let mut boundaries = vec![0, chars.len()];
    for run in &node.text_runs {
        boundaries.push(run.start.min(chars.len()));
        boundaries.push(run.end.min(chars.len()));
    }
    boundaries.sort_unstable();
    boundaries.dedup();
    for pair in boundaries.windows(2) {
        let start = pair[0];
        let end = pair[1];
        if start >= end {
            continue;
        }
        let run = node
            .text_runs
            .iter()
            .rev()
            .find(|run| run.start <= start && run.end >= end);
        let mut style = Vec::new();
        if let Some(run) = run {
            if let Some(color) = run.color {
                style.push(format!("color:{}", color_css(color)));
            } else if let Some(token) = &run.color_token {
                style.push(format!("color:{}", token_css(token, Color::rgb(0xf1, 0xf2, 0xf6))));
            }
            if let Some(typography) = &run.typography {
                style.extend(typography_patch_declarations(typography));
            }
        }
        let content: String = chars[start..end].iter().collect();
        markup.push_str(&format!(
            "<span{}>{}</span>",
            if style.is_empty() {
                String::new()
            } else {
                format!(" style=\"{}\"", html_attr(&style.join(";")))
            },
            html_text(&content)
        ));
    }
}

fn render_vector(node: &Node, markup: &mut String) {
    markup.push_str(&format!(
        "<svg class=\"loora-vector-content\" viewBox=\"{}\" aria-hidden=\"true\">",
        html_attr(node.vector_view_box.as_deref().unwrap_or("0 0 100 100"))
    ));
    for path in &node.paths {
        let fill = path
            .fill_token
            .as_deref()
            .map(|token| token_css(token, path.fill.unwrap_or(Color::rgb(0x00, 0x00, 0x00))))
            .or_else(|| path.fill.map(color_css))
            .unwrap_or_else(|| "none".into());
        let stroke = path
            .stroke_token
            .as_deref()
            .map(|token| token_css(token, path.stroke.unwrap_or(Color::rgb(0x00, 0x00, 0x00))))
            .or_else(|| path.stroke.map(color_css))
            .unwrap_or_else(|| "none".into());
        markup.push_str(&format!(
            "<path d=\"{}\" fill=\"{}\" stroke=\"{}\"{}></path>",
            html_attr(&path.d),
            html_attr(&fill),
            html_attr(&stroke),
            path.stroke_width
                .map(|width| format!(" stroke-width=\"{}\"", number(width as f64)))
                .unwrap_or_default(),
        ));
    }
    markup.push_str("</svg>");
}

fn child_index(document: &Document) -> HashMap<Option<NodeId>, Vec<NodeId>> {
    let mut index: HashMap<Option<NodeId>, Vec<NodeId>> = HashMap::new();
    for node in document.nodes.values() {
        index
            .entry(node.parent_id.clone())
            .or_default()
            .push(node.id.clone());
    }
    for children in index.values_mut() {
        children.sort_by(|left, right| {
            let left_node = &document.nodes[left];
            let right_node = &document.nodes[right];
            left_node
                .order
                .total_cmp(&right_node.order)
                .then_with(|| left.as_str().cmp(right.as_str()))
        });
    }
    index
}

fn resolved_node(document: &Document, source: &Node, width: f64) -> Node {
    let mut node = source.clone();
    let mut breakpoints = document.breakpoints.clone();
    breakpoints.sort_by(|left, right| left.min_width.total_cmp(&right.min_width));
    for breakpoint in breakpoints {
        if breakpoint.min_width > width {
            break;
        }
        if let Some(patch) = source.responsive.get(&breakpoint.id) {
            node = node.apply_override_patch(patch);
        }
    }
    node
}

fn layout_declarations(layout: &Layout, parent: Option<&Layout>, page_root: bool) -> Vec<String> {
    let positioned = page_root || layout.position == LayoutPosition::Absolute;
    let effective_parent = (!positioned).then_some(parent).flatten();
    let mut declarations = vec![
        "box-sizing:border-box".into(),
        format!("position:{}", if positioned { "absolute" } else { "relative" }),
    ];
    if positioned {
        declarations.push(format!("left:{}px", number(layout.x)));
        declarations.push(format!("top:{}px", number(layout.y)));
    }
    declarations.extend(axis_declarations(layout, effective_parent, true));
    declarations.extend(axis_declarations(layout, effective_parent, false));

    if let Some(align) = layout.align_self {
        if effective_parent.is_some() {
            declarations.push(format!("align-self:{}", align_css(align, true)));
        }
    }
    let main_width = effective_parent.is_some_and(|parent| {
        parent.mode == LayoutMode::Flex && parent.direction == FlexDirection::Row
    });
    let main_height = effective_parent.is_some_and(|parent| {
        parent.mode == LayoutMode::Flex && parent.direction == FlexDirection::Column
    });
    if let Some(value) = layout.min_width {
        declarations.push(format!("min-width:{}px", number(value)));
    } else if main_width && layout.width_mode == SizeMode::Fill {
        declarations.push("min-width:0".into());
    }
    if let Some(value) = layout.max_width {
        declarations.push(format!("max-width:{}px", number(value)));
    }
    if let Some(value) = layout.min_height {
        declarations.push(format!("min-height:{}px", number(value)));
    } else if main_height && layout.height_mode == SizeMode::Fill {
        declarations.push("min-height:0".into());
    }
    if let Some(value) = layout.max_height {
        declarations.push(format!("max-height:{}px", number(value)));
    }
    if let Some(value) = layout.aspect_ratio {
        declarations.push(format!("aspect-ratio:{}", number(value)));
    }

    match layout.mode {
        LayoutMode::Absolute => {}
        LayoutMode::Flex => {
            declarations.push("display:flex".into());
            declarations.push(format!(
                "flex-direction:{}",
                if layout.direction == FlexDirection::Column {
                    "column"
                } else {
                    "row"
                }
            ));
            declarations.push(format!(
                "flex-wrap:{}",
                if layout.wrap { "wrap" } else { "nowrap" }
            ));
            declarations.push(format!("gap:{}px", number(layout.gap as f64)));
            declarations.push(format!("align-items:{}", align_css(layout.align, true)));
            declarations.push(format!("justify-content:{}", justify_css(layout.justify, true)));
        }
        LayoutMode::Grid => {
            declarations.push("display:grid".into());
            declarations.push(format!(
                "grid-template-columns:repeat({},minmax(0,1fr))",
                layout.columns.max(1)
            ));
            declarations.push(format!("gap:{}px", number(layout.gap as f64)));
            declarations.push(format!("align-items:{}", align_css(layout.align, false)));
            match layout.justify {
                LayoutJustify::SpaceBetween | LayoutJustify::SpaceAround => declarations.push(
                    format!("justify-content:{}", justify_css(layout.justify, false)),
                ),
                _ => declarations.push(format!(
                    "justify-items:{}",
                    justify_css(layout.justify, false)
                )),
            }
        }
    }
    let padding = layout.padding;
    declarations.push(format!(
        "padding:{}px {}px {}px {}px",
        number(padding.top as f64),
        number(padding.right as f64),
        number(padding.bottom as f64),
        number(padding.left as f64)
    ));
    declarations
}

fn axis_declarations(layout: &Layout, parent: Option<&Layout>, width_axis: bool) -> Vec<String> {
    let property = if width_axis { "width" } else { "height" };
    let mode = if width_axis {
        layout.width_mode
    } else {
        layout.height_mode
    };
    let value = if width_axis { layout.width } else { layout.height };
    let percent = if width_axis {
        layout.width_percent
    } else {
        layout.height_percent
    };
    let flex_main = parent.is_some_and(|parent| {
        parent.mode == LayoutMode::Flex
            && ((width_axis && parent.direction == FlexDirection::Row)
                || (!width_axis && parent.direction == FlexDirection::Column))
    });
    let in_layout = parent.is_some_and(|parent| {
        matches!(parent.mode, LayoutMode::Flex | LayoutMode::Grid)
    });

    if !in_layout {
        return vec![format!(
            "{property}:{}",
            size_css(mode, value, percent, width_axis)
        )];
    }
    match mode {
        SizeMode::Hug => vec![format!("{property}:fit-content")],
        SizeMode::Fill if flex_main => vec![
            format!("flex-grow:{}", number(layout.grow.max(1.0) as f64)),
            format!("flex-shrink:{}", number(layout.shrink.unwrap_or(1.0) as f64)),
            "flex-basis:0%".into(),
        ],
        SizeMode::Fill => vec![format!(
            "{}:stretch",
            if parent.is_some_and(|parent| parent.mode == LayoutMode::Grid) && width_axis {
                "justify-self"
            } else {
                "align-self"
            }
        )],
        _ => {
            let mut output = vec![format!(
                "{property}:{}",
                size_css(mode, value, percent, width_axis)
            )];
            if flex_main {
                output.push(format!("flex-grow:{}", number(layout.grow as f64)));
                output.push(format!(
                    "flex-shrink:{}",
                    number(layout.shrink.unwrap_or(0.0) as f64)
                ));
                output.push("flex-basis:auto".into());
            }
            output
        }
    }
}

fn size_css(mode: SizeMode, value: f64, percent: Option<f64>, width_axis: bool) -> String {
    match mode {
        SizeMode::Fixed => format!("{}px", number(value)),
        SizeMode::Percent => format!("{}%", number(percent.unwrap_or(0.0))),
        SizeMode::Fill => "100%".into(),
        SizeMode::Hug if width_axis => "fit-content".into(),
        SizeMode::Hug => "auto".into(),
    }
}

/// Hug/fit-content boxes grow with their children, so `overflow:hidden` becomes a
/// no-op. When clipping is on, pin the authored width/height so content can clip.
fn enforce_clip_box(declarations: &mut Vec<String>, node: &Node) {
    if !matches!(node.style.overflow, Overflow::Hidden | Overflow::Auto) {
        return;
    }
    let hug_width = node.layout.width_mode == SizeMode::Hug
        || declarations
            .iter()
            .any(|decl| decl.starts_with("width:fit-content") || decl == "width:auto");
    let hug_height = node.layout.height_mode == SizeMode::Hug
        || declarations.iter().any(|decl| {
            decl.starts_with("height:fit-content")
                || decl == "height:auto"
                || decl.starts_with("height:auto")
        });
    if hug_width {
        declarations.retain(|decl| !decl.starts_with("width:"));
        declarations.push(format!(
            "width:{}px",
            number(node.layout.width.max(1.0))
        ));
    }
    if hug_height {
        declarations.retain(|decl| !decl.starts_with("height:") && !decl.starts_with("min-height:"));
        declarations.push(format!(
            "height:{}px",
            number(node.layout.height.max(1.0))
        ));
    }
}

fn style_declarations(node: &Node) -> Vec<String> {
    let style = &node.style;
    let mut declarations = vec![
        format!("opacity:{}", number(style.opacity as f64)),
        format!(
            "overflow:{}",
            match style.overflow {
                Overflow::Visible => "visible",
                Overflow::Hidden => "hidden",
                Overflow::Auto => "auto",
            }
        ),
    ];
    if node.rotation.abs() > f32::EPSILON {
        declarations.push(format!("transform:rotate({}deg)", number(node.rotation as f64)));
        declarations.push("transform-origin:center".into());
    }
    if node.kind == NodeKind::Text {
        if let Some(Paint::Solid { color, token_id }) = style.fills.first() {
            declarations.push(format!(
                "color:{}",
                token_id
                    .as_deref()
                    .map(|token| token_css(token, *color))
                    .unwrap_or_else(|| color_css(*color))
            ));
        }
    } else if !style.fills.is_empty() {
        declarations.push(format!(
            "background:{}",
            style.fills.iter().map(paint_css).collect::<Vec<_>>().join(",")
        ));
    }
    if let Some(stroke) = &style.stroke {
        declarations.push(stroke_css(stroke));
    }
    let corners = style.corners;
    declarations.push(format!(
        "border-radius:{}px {}px {}px {}px",
        number(corners.tl as f64),
        number(corners.tr as f64),
        number(corners.br as f64),
        number(corners.bl as f64),
    ));
    if !style.shadows.is_empty() {
        declarations.push(format!(
            "box-shadow:{}",
            style.shadows.iter().map(shadow_css).collect::<Vec<_>>().join(",")
        ));
    }
    if let Some(blend) = &style.blend_mode {
        declarations.push(format!("mix-blend-mode:{}", css_keyword(blend)));
    }
    if let Some(typography) = &node.typography {
        declarations.extend([
            format!("font-family:{}", font_family_css(&typography.family)),
            format!("font-size:{}px", number(typography.size as f64)),
            format!("font-weight:{}", typography.weight),
            format!(
                "line-height:{}",
                number(typography.line_height.unwrap_or(1.25) as f64)
            ),
            format!("letter-spacing:{}px", number(typography.letter_spacing as f64)),
            format!(
                "text-align:{}",
                match typography.align {
                    TextAlign::Left => "left",
                    TextAlign::Center => "center",
                    TextAlign::Right => "right",
                    TextAlign::Justify => "justify",
                }
            ),
            format!(
                "white-space:{}",
                if typography.wrap { "pre-wrap" } else { "nowrap" }
            ),
            format!(
                "text-decoration:{}",
                match typography.decoration {
                    TextDecoration::None => "none",
                    TextDecoration::Underline => "underline",
                    TextDecoration::LineThrough => "line-through",
                }
            ),
            format!(
                "text-transform:{}",
                match typography.transform {
                    TextTransform::None => "none",
                    TextTransform::Uppercase => "uppercase",
                    TextTransform::Lowercase => "lowercase",
                    TextTransform::Capitalize => "capitalize",
                }
            ),
        ]);
    }
    match node.kind {
        NodeKind::Image => declarations.push(format!(
            "object-fit:{}",
            match node.image_fit {
                ImageFit::Cover => "cover",
                ImageFit::Contain => "contain",
                ImageFit::Fill => "fill",
            }
        )),
        NodeKind::Rectangle if node.shape_kind == ShapeKind::Ellipse => {
            declarations.push("border-radius:50%".into());
        }
        NodeKind::Rectangle if node.shape_kind == ShapeKind::Line => {
            declarations.push("height:0".into());
            declarations.push("background:none".into());
        }
        _ => {}
    }
    declarations
}

fn motion_declarations(document: &Document, node: &Node, class: &str, enabled: bool) -> String {
    let mut output = String::new();
    if let Some(transition) = &node.transition {
        output.push_str(&format!(
            ".{class}{{transition-property:{};transition-duration:{}ms;transition-timing-function:{};transition-delay:{}ms}}",
            if transition.properties.is_empty() { "all".into() } else { transition.properties.iter().map(|value| css_keyword(value)).collect::<Vec<_>>().join(",") },
            number(transition.duration_ms as f64),
            easing_css(&transition.easing, transition.cubic_bezier),
            number(transition.delay_ms as f64),
        ));
    }
    if let Some(states) = &node.visual_states {
        if let Some(state) = &states.hover {
            output.push_str(&format!(".{class}:hover{{{}}}", visual_state_css(state, node.kind == NodeKind::Text)));
        }
        if let Some(state) = &states.press {
            output.push_str(&format!(".{class}:active{{{}}}", visual_state_css(state, node.kind == NodeKind::Text)));
        }
        if let Some(state) = &states.focus {
            output.push_str(&format!(".{class}[data-loora-focused=\"true\"]{{{}}}", visual_state_css(state, node.kind == NodeKind::Text)));
        }
    }
    if enabled {
        let mut base = Vec::new();
        let mut hover = Vec::new();
        let mut press = Vec::new();
        for attachment in &node.animations {
            let Some(animation) = document
                .animations
                .iter()
                .find(|animation| animation.id == attachment.animation_id)
            else {
                continue;
            };
            let declaration = animation_css(animation, attachment);
            match attachment.trigger {
                AnimationTrigger::Hover => hover.push(declaration),
                AnimationTrigger::Press => press.push(declaration),
                AnimationTrigger::Load | AnimationTrigger::InView | AnimationTrigger::Always => {
                    base.push(declaration)
                }
            }
        }
        if !base.is_empty() {
            output.push_str(&format!(".{class}{{animation:{}}}", base.join(",")));
        }
        if !hover.is_empty() {
            output.push_str(&format!(".{class}:hover{{animation:{}}}", hover.join(",")));
        }
        if !press.is_empty() {
            output.push_str(&format!(".{class}:active{{animation:{}}}", press.join(",")));
        }
    }
    output
}

fn visual_state_css(state: &VisualState, text: bool) -> String {
    let mut declarations = Vec::new();
    if let Some(opacity) = state.opacity {
        declarations.push(format!("opacity:{}", number(opacity as f64)));
    }
    if let Some(fill) = state.fill {
        declarations.push(format!(
            "{}:{}",
            if text { "color" } else { "background" },
            color_css(fill)
        ));
    }
    if let Some(style) = &state.style {
        declarations.extend(style_patch_css(style, text));
    }
    let mut transforms = Vec::new();
    if let Some(scale) = state.scale {
        transforms.push(format!("scale({})", number(scale as f64)));
    }
    if let Some(transform) = state.transform {
        transforms.extend(transform_parts(transform));
    }
    if !transforms.is_empty() {
        declarations.push(format!("transform:{}", transforms.join(" ")));
    }
    declarations.join(";")
}

fn style_patch_css(style: &StylePatch, text: bool) -> Vec<String> {
    let mut declarations = Vec::new();
    if let Some(opacity) = style.opacity {
        declarations.push(format!("opacity:{}", number(opacity as f64)));
    }
    if let Some(overflow) = style.overflow {
        declarations.push(format!(
            "overflow:{}",
            match overflow {
                Overflow::Visible => "visible",
                Overflow::Hidden => "hidden",
                Overflow::Auto => "auto",
            }
        ));
    }
    if let Some(fills) = &style.fills {
        if text {
            if let Some(Paint::Solid { color, token_id }) = fills.first() {
                declarations.push(format!(
                    "color:{}",
                    token_id
                        .as_deref()
                        .map(|token| token_css(token, *color))
                        .unwrap_or_else(|| color_css(*color))
                ));
            }
        } else if fills.is_empty() {
            declarations.push("background:none".into());
        } else {
            declarations.push(format!(
                "background:{}",
                fills.iter().map(paint_css).collect::<Vec<_>>().join(",")
            ));
        }
    }
    if let Some(stroke) = &style.stroke {
        declarations.push(
            stroke
                .as_ref()
                .map(stroke_css)
                .unwrap_or_else(|| "border:none".into()),
        );
    }
    if let Some(corners) = style.corners {
        declarations.push(format!(
            "border-radius:{}px {}px {}px {}px",
            number(corners.tl as f64),
            number(corners.tr as f64),
            number(corners.br as f64),
            number(corners.bl as f64),
        ));
    }
    if let Some(shadows) = &style.shadows {
        declarations.push(if shadows.is_empty() {
            "box-shadow:none".into()
        } else {
            format!(
                "box-shadow:{}",
                shadows.iter().map(shadow_css).collect::<Vec<_>>().join(",")
            )
        });
    }
    if let Some(blend) = &style.blend_mode {
        declarations.push(
            blend
                .as_deref()
                .map(|value| format!("mix-blend-mode:{}", css_keyword(value)))
                .unwrap_or_else(|| "mix-blend-mode:normal".into()),
        );
    }
    if let Some(typography) = &style.typography {
        declarations.extend(typography_patch_declarations(typography));
    }
    declarations
}

fn typography_patch_declarations(typography: &TypographyPatch) -> Vec<String> {
    let mut declarations = Vec::new();
    if let Some(family) = &typography.family {
        declarations.push(format!("font-family:{}", font_family_css(family)));
    }
    if let Some(value) = typography.size {
        declarations.push(format!("font-size:{}px", number(value as f64)));
    }
    if let Some(value) = typography.weight {
        declarations.push(format!("font-weight:{value}"));
    }
    if let Some(value) = typography.line_height {
        declarations.push(format!("line-height:{}", number(value as f64)));
    }
    if let Some(value) = typography.letter_spacing {
        declarations.push(format!("letter-spacing:{}px", number(value as f64)));
    }
    if let Some(value) = &typography.align {
        declarations.push(format!("text-align:{}", css_keyword(value)));
    }
    if let Some(value) = typography.wrap {
        declarations.push(format!("white-space:{}", if value { "pre-wrap" } else { "nowrap" }));
    }
    if let Some(value) = &typography.decoration {
        declarations.push(format!("text-decoration:{}", css_keyword(value)));
    }
    if let Some(value) = &typography.transform {
        declarations.push(format!("text-transform:{}", css_keyword(value)));
    }
    declarations
}

fn animation_keyframes(document: &Document) -> String {
    let mut output = String::new();
    for animation in &document.animations {
        output.push_str(&format!("@keyframes {}{{", animation_name(&animation.id)));
        for frame in &animation.keyframes {
            let mut declarations = Vec::new();
            if let Some(opacity) = frame.opacity {
                declarations.push(format!("opacity:{}", number(opacity as f64)));
            }
            if let Some(transform) = frame.transform {
                declarations.push(format!("transform:{}", transform_parts(transform).join(" ")));
            }
            output.push_str(&format!(
                "{}%{{{}}}",
                number(frame.offset.clamp(0.0, 1.0) as f64 * 100.0),
                declarations.join(";")
            ));
        }
        output.push('}');
    }
    output
}

fn animation_css(animation: &crate::DocumentAnimation, attachment: &NodeAnimation) -> String {
    format!(
        "{} {}ms {} {}ms {} {} {}",
        animation_name(&animation.id),
        number(animation.duration_ms as f64),
        easing_css(&animation.easing, animation.cubic_bezier),
        number((animation.delay_ms + attachment.delay_ms) as f64),
        if animation.infinite {
            "infinite".into()
        } else {
            number(animation.iterations.max(1.0) as f64)
        },
        css_keyword(&animation.direction),
        css_keyword(&animation.fill),
    )
}

fn transform_parts(transform: MotionTransform) -> Vec<String> {
    let mut output = Vec::new();
    if transform.x.is_some() || transform.y.is_some() {
        output.push(format!(
            "translate({}px,{}px)",
            number(transform.x.unwrap_or(0.0) as f64),
            number(transform.y.unwrap_or(0.0) as f64)
        ));
    }
    if let Some(value) = transform.scale {
        output.push(format!("scale({})", number(value as f64)));
    }
    if transform.scale_x.is_some() || transform.scale_y.is_some() {
        output.push(format!(
            "scale({},{})",
            number(transform.scale_x.unwrap_or(1.0) as f64),
            number(transform.scale_y.unwrap_or(1.0) as f64)
        ));
    }
    if let Some(value) = transform.rotate {
        output.push(format!("rotate({}deg)", number(value as f64)));
    }
    if let Some(value) = transform.skew_x {
        output.push(format!("skewX({}deg)", number(value as f64)));
    }
    if let Some(value) = transform.skew_y {
        output.push(format!("skewY({}deg)", number(value as f64)));
    }
    output
}

fn token_declarations(document: &Document, theme_id: &str) -> String {
    let declarations = document
        .tokens
        .iter()
        .map(|token| {
            let value = token.modes.get(theme_id).unwrap_or(&token.value);
            let value = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            format!("--loora-token-{}:{}", css_ident(&token.id), css_value(&value))
        })
        .collect::<Vec<_>>()
        .join(";");
    format!(":root{{{declarations}}}")
}

fn paint_css(paint: &Paint) -> String {
    match paint {
        Paint::Solid { color, token_id } => token_id
            .as_deref()
            .map(|token| token_css(token, *color))
            .unwrap_or_else(|| color_css(*color)),
        Paint::LinearGradient { angle, stops } => format!(
            "linear-gradient({}deg,{})",
            number(*angle as f64),
            stops
                .iter()
                .map(|stop| format!(
                    "{} {}%",
                    stop.token_id
                        .as_deref()
                        .map(|token| token_css(token, stop.color))
                        .unwrap_or_else(|| color_css(stop.color)),
                    number(stop.offset as f64 * 100.0)
                ))
                .collect::<Vec<_>>()
                .join(",")
        ),
        Paint::RadialGradient { cx, cy, size, stops } => format!(
            "radial-gradient({} at {}% {}%,{})",
            size.as_deref().map(css_keyword).unwrap_or_else(|| "farthest-corner".into()),
            number(*cx as f64 * 100.0),
            number(*cy as f64 * 100.0),
            stops
                .iter()
                .map(|stop| format!(
                    "{} {}%",
                    stop.token_id
                        .as_deref()
                        .map(|token| token_css(token, stop.color))
                        .unwrap_or_else(|| color_css(stop.color)),
                    number(stop.offset as f64 * 100.0)
                ))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

fn stroke_css(stroke: &Stroke) -> String {
    let color = stroke
        .token_id
        .as_deref()
        .map(|token| token_css(token, stroke.color))
        .unwrap_or_else(|| color_css(stroke.color));
    format!(
        "border:{}px {} {}",
        number(stroke.width as f64),
        match stroke.style {
            StrokeStyle::Solid => "solid",
            StrokeStyle::Dashed => "dashed",
            StrokeStyle::Dotted => "dotted",
        },
        color
    )
}

fn shadow_css(shadow: &Shadow) -> String {
    let color = shadow
        .token_id
        .as_deref()
        .map(|token| token_css(token, shadow.color))
        .unwrap_or_else(|| color_css(shadow.color));
    format!(
        "{}{}px {}px {}px {}px {}",
        if shadow.inset { "inset " } else { "" },
        number(shadow.x as f64),
        number(shadow.y as f64),
        number(shadow.blur as f64),
        number(shadow.spread as f64),
        color
    )
}

fn color_css(color: Color) -> String {
    format!(
        "rgba({},{},{},{})",
        (color.r.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.g.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.b.clamp(0.0, 1.0) * 255.0).round() as u8,
        number(color.a.clamp(0.0, 1.0) as f64)
    )
}

fn token_css(token: &str, fallback: Color) -> String {
    format!("var(--loora-token-{}, {})", css_ident(token), color_css(fallback))
}

fn font_family_css(value: &str) -> String {
    let generic = [
        "serif",
        "sans-serif",
        "monospace",
        "cursive",
        "fantasy",
        "system-ui",
        "ui-serif",
        "ui-sans-serif",
        "ui-monospace",
        "ui-rounded",
        "emoji",
    ];
    let families: Vec<String> = value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            let bare = part.trim_matches(['\'', '"']);
            if generic.iter().any(|generic| generic.eq_ignore_ascii_case(bare)) {
                bare.to_string()
            } else {
                format!("\"{}\"", bare.replace('"', "\\\""))
            }
        })
        .collect();
    if families.is_empty() {
        "system-ui".into()
    } else {
        families.join(",")
    }
}

fn font_imports(document: &Document) -> String {
    let mut families = std::collections::BTreeSet::new();
    for node in document.nodes.values() {
        if let Some(family) = node
            .typography
            .as_ref()
            .map(|t| t.family.as_str())
            .filter(|family| !family.is_empty())
        {
            let primary = family
                .split(',')
                .next()
                .unwrap_or(family)
                .trim()
                .trim_matches(['\'', '"']);
            if primary.is_empty() {
                continue;
            }
            let system = matches!(
                primary.to_ascii_lowercase().as_str(),
                "system-ui"
                    | "sans-serif"
                    | "serif"
                    | "monospace"
                    | "-apple-system"
                    | "blinkmacsystemfont"
                    | "segoe ui"
                    | "arial"
                    | "helvetica"
            );
            if !system {
                families.insert(primary.to_string());
            }
        }
    }
    if families.is_empty() {
        return String::new();
    }
    let query = families
        .into_iter()
        .map(|family| {
            format!(
                "family={}:wght@400;500;600;700",
                family.replace(' ', "+")
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    format!("@import url('https://fonts.googleapis.com/css2?{query}&display=swap');\n")
}

fn easing_css(easing: &str, cubic: Option<[f32; 4]>) -> String {
    if let Some([a, b, c, d]) = cubic {
        return format!(
            "cubic-bezier({},{},{},{})",
            number(a as f64),
            number(b as f64),
            number(c as f64),
            number(d as f64)
        );
    }
    css_keyword(easing)
}

fn align_css(value: LayoutAlign, flex: bool) -> &'static str {
    match value {
        LayoutAlign::Start if flex => "flex-start",
        LayoutAlign::End if flex => "flex-end",
        LayoutAlign::Start => "start",
        LayoutAlign::Center => "center",
        LayoutAlign::End => "end",
        LayoutAlign::Stretch => "stretch",
    }
}

fn justify_css(value: LayoutJustify, flex: bool) -> &'static str {
    match value {
        LayoutJustify::Start if flex => "flex-start",
        LayoutJustify::End if flex => "flex-end",
        LayoutJustify::Start => "start",
        LayoutJustify::Center => "center",
        LayoutJustify::End => "end",
        LayoutJustify::SpaceBetween => "space-between",
        LayoutJustify::SpaceAround => "space-around",
    }
}

fn semantic_tag(node: &Node) -> &'static str {
    if node.kind == NodeKind::Page {
        return "main";
    }
    if node.kind != NodeKind::Frame {
        return "div";
    }
    match node.semantic_tag.as_deref() {
        Some("section") => "section",
        Some("article") => "article",
        Some("header") => "header",
        Some("footer") => "footer",
        Some("nav") => "nav",
        Some("main") => "main",
        Some("aside") => "aside",
        Some("a") => "a",
        Some("button") => "button",
        Some("form") => "form",
        _ => "div",
    }
}

fn kind_name(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Page => "page",
        NodeKind::Frame => "frame",
        NodeKind::Rectangle => "shape",
        NodeKind::Text => "text",
        NodeKind::Image => "image",
        NodeKind::Component => "component",
        NodeKind::Instance => "instance",
        NodeKind::Vector => "vector",
    }
}

fn node_class(id: &NodeId) -> String {
    format!("loora-{}", css_ident(id.as_str()))
}

fn animation_name(id: &str) -> String {
    format!("loora-motion-{}", css_ident(id))
}

fn css_ident(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
            output.push(character);
        } else {
            output.push_str(&format!("_u{:x}_", character as u32));
        }
    }
    output
}

fn css_keyword(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .collect()
}

fn css_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(';', "\\3b ")
        .replace('{', "\\7b ")
        .replace('}', "\\7d ")
}

fn html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn html_attr(value: &str) -> String {
    html_text(value)
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn number(value: f64) -> String {
    if !value.is_finite() {
        return "0".into();
    }
    let value = if value.abs() < 0.000_001 { 0.0 } else { value };
    let mut output = format!("{value:.4}");
    while output.contains('.') && output.ends_with('0') {
        output.pop();
    }
    if output.ends_with('.') {
        output.pop();
    }
    output
}

fn asset_url(source: &str) -> String {
    if source.is_empty()
        || source.starts_with("http://")
        || source.starts_with("https://")
        || source.starts_with("data:")
        || source.starts_with("loora-asset:")
    {
        return source.to_string();
    }
    let encoded = source
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("loora-asset://local/{encoded}")
}

// Compact embedded Tailwind-compatible preflight plus the editor surface.
// Canvas node declarations are compiled, so a runtime Tailwind/JIT dependency
// is neither needed nor allowed to fetch code from a CDN.
const EDITOR_PREFLIGHT: &str = r#"
*,::before,::after{box-sizing:border-box;border:0 solid;margin:0;padding:0}
html,body,#loora-app{width:100%;height:100%;overflow:hidden}
html{-webkit-text-size-adjust:100%;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{background:var(--loora-surface-bg,#0f0f10);color:var(--loora-surface-fg,#f1f2f6)}
img,svg{display:block;max-width:100%}button,input,textarea{font:inherit;color:inherit;background:transparent}
#loora-surface{position:absolute;inset:0;overflow:hidden;background:var(--loora-surface-bg,#0f0f10);touch-action:none}
#loora-surface[data-tool="hand"]{cursor:grab}#loora-surface[data-tool="frame"],#loora-surface[data-tool="text"],#loora-surface[data-tool="rectangle"],#loora-surface[data-tool="shapes"],#loora-surface[data-tool="image"],#loora-surface[data-tool="component"]{cursor:crosshair}
#loora-surface.loora-space-pan{cursor:grab}
#loora-scene{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.loora-page-host{position:absolute}.loora-page-label{position:absolute;left:0;top:-25px;height:18px;color:var(--loora-page-label,rgba(255,255,255,.58));font:500 12px/18px system-ui;white-space:nowrap;pointer-events:auto}
.loora-node{transform-origin:center;user-select:none}.loora-node[data-loora-kind="text"]{cursor:inherit}.loora-node[data-loora-editing="true"]{user-select:text;cursor:text;outline:none}
.loora-image-content,.loora-vector-content{width:100%;height:100%;display:block}.loora-image-content{object-fit:inherit}.loora-vector-content{overflow:visible}
.loora-node[data-loora-selected="true"]{outline:2px solid #6f8cff;outline-offset:1px}
.loora-group-box{position:absolute;border:1.5px solid #6f8cff;pointer-events:none;z-index:2147483644;box-sizing:border-box}
.loora-resize-handle{position:absolute;width:9px;height:9px;border:1.5px solid #6f8cff;background:#fff;border-radius:2px;z-index:2147483647;pointer-events:auto;transform:translate(-50%,-50%) scale(var(--loora-inverse-zoom,1))}
.loora-resize-handle[data-handle="nw"],.loora-resize-handle[data-handle="se"]{cursor:nwse-resize}
.loora-resize-handle[data-handle="ne"],.loora-resize-handle[data-handle="sw"]{cursor:nesw-resize}
.loora-resize-handle[data-handle="n"],.loora-resize-handle[data-handle="s"]{cursor:ns-resize}
.loora-resize-handle[data-handle="e"],.loora-resize-handle[data-handle="w"]{cursor:ew-resize}
.loora-guide{position:absolute;pointer-events:none;z-index:2147483645;background:#ff4bd2}
.loora-guide-v{width:1px;transform:scaleX(var(--loora-inverse-zoom,1));transform-origin:0 0}
.loora-guide-h{height:1px;transform:scaleY(var(--loora-inverse-zoom,1));transform-origin:0 0}
.loora-guide-label{position:absolute;pointer-events:none;z-index:2147483646;padding:1px 5px;border-radius:4px;background:#ff4bd2;color:#1a0014;font:600 10px/14px system-ui;white-space:nowrap;transform:translate(-50%,-50%) scale(var(--loora-inverse-zoom,1))}
.loora-overlay-scrim{position:absolute;background:rgba(0,0,0,.58);z-index:2147483640;pointer-events:auto}.loora-overlay-page-host{z-index:2147483641;transform-origin:0 0}.loora-overlay-page-host>.loora-page-label{display:none}
.loora-preview .loora-node{cursor:pointer}.loora-preview .loora-node[data-loora-locked="true"]{cursor:default}
@media(prefers-reduced-motion:reduce){.loora-node{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Layout, Node, PageViewport};

    #[test]
    fn text_fill_compiles_to_glyph_color_not_box_background() {
        let mut document = Document::empty("HTML");
        let page = document.root_page_id.clone();
        let mut text = Node::text("Headline", page, Layout::new(20.0, 20.0, 320.0, 60.0), "Hello");
        text.style.fills = vec![Paint::solid(Color::rgb(0xff, 0xff, 0xff))];
        let id = text.id.clone();
        document.nodes.insert(id.clone(), text);

        let compiled = compile_canvas(&document, &HtmlCanvasOptions::default());
        let rule = format!(".{}", node_class(&id));
        let start = compiled.css.find(&rule).unwrap();
        let end = compiled.css[start..].find('}').unwrap() + start;
        let node_rule = &compiled.css[start..end];
        assert!(node_rule.contains("color:rgba(255,255,255,1)"));
        assert!(!node_rule.contains("background:rgba(255,255,255,1)"));
        assert!(compiled.markup.contains("Hello"));
    }

    #[test]
    fn editor_surface_uses_a_plain_background() {
        assert!(EDITOR_PREFLIGHT.contains("#loora-surface{position:absolute"));
        assert!(EDITOR_PREFLIGHT.contains("var(--loora-surface-bg,#0f0f10)"));
        assert!(!EDITOR_PREFLIGHT.contains("background-image"));
        assert!(!EDITOR_PREFLIGHT.contains("radial-gradient"));
        assert!(EDITOR_PREFLIGHT.contains("cursor:nwse-resize"));
    }

    #[test]
    fn fixed_page_size_wins_over_imported_viewport_minimum() {
        let mut document = Document::empty("Resizable page");
        let page_id = document.root_page_id.clone();
        let page = document.nodes.get_mut(&page_id).unwrap();
        page.layout.width = 640.0;
        page.layout.height = 360.0;
        page.layout.width_mode = SizeMode::Fixed;
        page.layout.height_mode = SizeMode::Fixed;
        page.viewport = Some(PageViewport {
            width: 1440.0,
            min_height: 900.0,
        });

        let compiled = compile_canvas(&document, &HtmlCanvasOptions::default());
        assert!(compiled
            .markup
            .contains("width:640px;height:360px;min-height:360px"));
        assert!(!compiled.css.contains("min-height:900px!important"));
    }

    #[test]
    fn flex_fill_and_hug_compile_to_browser_layout() {
        let mut document = Document::empty("Layout");
        let page = document.root_page_id.clone();
        let mut row = Node::frame("Row", page, Layout::new(0.0, 0.0, 800.0, 100.0));
        row.layout.mode = LayoutMode::Flex;
        row.layout.direction = FlexDirection::Row;
        let row_id = row.id.clone();
        document.nodes.insert(row_id.clone(), row);
        let mut child = Node::frame("Fill", row_id, Layout::new(0.0, 0.0, 1.0, 30.0));
        child.layout.position = LayoutPosition::Flow;
        child.layout.width_mode = SizeMode::Fill;
        child.layout.height_mode = SizeMode::Hug;
        let id = child.id.clone();
        document.nodes.insert(id.clone(), child);

        let compiled = compile_canvas(&document, &HtmlCanvasOptions::default());
        let start = compiled.css.find(&format!(".{}", node_class(&id))).unwrap();
        let end = compiled.css[start..].find('}').unwrap() + start;
        let node_rule = &compiled.css[start..end];
        assert!(node_rule.contains("flex-grow:1"));
        assert!(node_rule.contains("flex-basis:0%"));
        assert!(node_rule.contains("height:fit-content"));
    }

    #[test]
    fn hug_overflow_hidden_pins_a_clip_box() {
        let mut document = Document::empty("Clip");
        let page = document.root_page_id.clone();
        let mut frame = Node::frame("Hug", page, Layout::new(40.0, 40.0, 120.0, 80.0));
        frame.layout.width_mode = SizeMode::Hug;
        frame.layout.height_mode = SizeMode::Hug;
        frame.style.overflow = Overflow::Hidden;
        let id = frame.id.clone();
        document.nodes.insert(id.clone(), frame);

        let compiled = compile_canvas(&document, &HtmlCanvasOptions::default());
        let start = compiled.css.find(&format!(".{}", node_class(&id))).unwrap();
        let end = compiled.css[start..].find('}').unwrap() + start;
        let node_rule = &compiled.css[start..end];
        assert!(node_rule.contains("overflow:hidden"));
        assert!(node_rule.contains("width:120px"));
        assert!(node_rule.contains("height:80px"));
        assert!(!node_rule.contains("width:fit-content"));
        assert!(!node_rule.contains("height:auto"));
    }

    #[test]
    fn clipped_hug_page_overrides_auto_height() {
        let mut document = Document::empty("Clipped page");
        let page_id = document.root_page_id.clone();
        {
            let page = document.nodes.get_mut(&page_id).unwrap();
            page.layout.width = 640.0;
            page.layout.height = 360.0;
            page.layout.width_mode = SizeMode::Fixed;
            page.layout.height_mode = SizeMode::Hug;
            page.style.overflow = Overflow::Hidden;
        }

        let compiled = compile_canvas(&document, &HtmlCanvasOptions::default());
        let page_class = node_class(&page_id);
        assert!(compiled
            .markup
            .contains("height:360px;min-height:360px;overflow:hidden"));
        assert!(compiled.css.contains(&format!(
            ".{page_class}{{position:relative!important;left:0!important;top:0!important;width:100%!important;height:360px!important;min-height:360px!important;overflow:hidden!important}}"
        )));
    }

    #[test]
    fn editor_preflight_includes_smart_guide_styles() {
        assert!(EDITOR_PREFLIGHT.contains(".loora-guide{"));
        assert!(EDITOR_PREFLIGHT.contains(".loora-guide-v{"));
        assert!(EDITOR_PREFLIGHT.contains(".loora-guide-h{"));
        assert!(EDITOR_PREFLIGHT.contains(".loora-guide-label{"));
        assert!(EDITOR_PREFLIGHT.contains("#loora-surface.loora-space-pan{cursor:grab}"));
    }

    #[test]
    fn export_page_svg_wraps_foreign_object() {
        let document = Document::empty("Export");
        let svg = export_page_svg(&document, None);
        assert!(svg.contains("<svg xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(svg.contains("<foreignObject"));
        assert!(svg.contains("loora-page-host"));
    }
}
