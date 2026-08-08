//! Import Loora web/canvas export JSON (`schema: "loora.canvas"`) into native [`Document`].

use std::collections::HashMap;

use serde_json::Value;

use crate::extras::{
    AnimationKeyframe, AnimationTrigger, Breakpoint, CanvasAction, CanvasTheme, DesignToken,
    DimensionPatch, DocumentAnimation, Interaction, InteractionTrigger, LayoutPatch,
    MotionTransform, NodeAnimation, OverrideMap, OverridePatch, PageViewport, ResponsiveMap,
    StateCondition, StateDefinition, StateValue, StylePatch, TextRun, Transition, TypographyPatch,
    VectorPath, VisualState, VisualStates,
};
use crate::id::NodeId;
use crate::model::{
    Color, Corners, Document, FlexDirection, ImageFit, Insets, Layout, LayoutAlign, LayoutJustify,
    LayoutMode, LayoutPosition, Node, NodeKind, Overflow, Paint, Shadow, ShapeKind, SizeMode,
    Stroke, StrokeStyle, Style, TextAlign, TextDecoration, TextTransform, Typography,
};

#[derive(Clone, Copy, Debug)]
enum Dim {
    Px(f64),
    Percent(f64),
    Hug,
    Fill,
}

#[derive(Clone, Debug)]
struct PendingLayout {
    x: f64,
    y: f64,
    width: Dim,
    height: Dim,
    mode: LayoutMode,
    direction: FlexDirection,
    align: LayoutAlign,
    justify: LayoutJustify,
    gap: f32,
    wrap: bool,
    columns: u32,
    padding: Insets,
    position: LayoutPosition,
    min_width: Option<f64>,
    max_width: Option<f64>,
    min_height: Option<f64>,
    max_height: Option<f64>,
    aspect_ratio: Option<f64>,
    align_self: Option<LayoutAlign>,
    grow: f32,
    shrink: Option<f32>,
    viewport_width: Option<f64>,
    viewport_min_height: Option<f64>,
}

/// Parse a design file: native Document JSON, or wrapped `loora.canvas` export.
pub fn parse_design_bytes(bytes: &[u8]) -> Result<Document, String> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|e| format!("invalid JSON: {e}"))?;
    if is_canvas_export(&value) {
        return convert_canvas_export(&value);
    }
    serde_json::from_value(value).map_err(|e| format!("invalid Loora document: {e}"))
}

/// Document id for duplicate detection (native or canvas-wrapped).
pub fn peek_design_id(bytes: &[u8]) -> Result<String, String> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|e| format!("invalid JSON: {e}"))?;
    if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
        return Ok(id.to_string());
    }
    if let Some(id) = value
        .pointer("/document/id")
        .and_then(|v| v.as_str())
    {
        return Ok(id.to_string());
    }
    Err("missing document id".into())
}

fn is_canvas_export(value: &Value) -> bool {
    matches!(
        value.get("schema").and_then(|s| s.as_str()),
        Some("loora.canvas")
    ) || (value.get("document").is_some()
        && value
            .get("document")
            .and_then(|d| d.get("schemaVersion"))
            .is_some())
}

fn convert_canvas_export(root: &Value) -> Result<Document, String> {
    let doc = root
        .get("document")
        .ok_or_else(|| "canvas export missing document".to_string())?;

    let id = doc
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("imported")
        .to_string();
    let name = doc
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported")
        .to_string();

    let tokens = convert_tokens(doc.get("tokens"));
    let token_colors: HashMap<String, Color> = tokens
        .iter()
        .map(|t| (t.id.clone(), t.color))
        .collect();

    let breakpoints = convert_breakpoints(doc.get("breakpoints"));
    let animations = convert_animations(doc.get("animations"));
    let themes = convert_themes(doc.get("themes"));

    let raw_nodes = doc
        .get("nodes")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "canvas export missing nodes".to_string())?;

    let mut pending: HashMap<String, PendingLayout> = HashMap::new();
    let mut nodes: HashMap<NodeId, Node> = HashMap::new();
    let mut page_ids: Vec<(f64, String)> = Vec::new();
    let mut ellipse_ids: Vec<NodeId> = Vec::new();
    // component_id → variant → (master_node_id → patch)
    let mut variant_table: HashMap<String, HashMap<String, OverrideMap>> = HashMap::new();

    for (key, raw) in raw_nodes {
        let node_id = raw
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or(key)
            .to_string();
        let (mut node, layout, is_ellipse) = convert_node(raw, &token_colors)?;
        if node.is_root_frame() {
            page_ids.push((node.order, node_id.clone()));
        }
        if is_ellipse {
            ellipse_ids.push(NodeId::from_static(node_id.clone()));
        }
        if node.kind == NodeKind::Component {
            if let Some(table) = convert_variant_overrides(raw.get("variantOverrides"), &token_colors)
            {
                variant_table.insert(node_id.clone(), table);
            }
        }
        // Instance overrides keyed by master node ids.
        node.overrides = convert_override_map(raw.get("overrides"), &token_colors);
        pending.insert(node_id.clone(), layout);
        nodes.insert(NodeId::from_static(node_id), node);
    }

    if nodes.is_empty() {
        return Err("canvas export has no nodes".into());
    }

    page_ids.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let root_page_id = page_ids
        .first()
        .map(|(_, id)| NodeId::from_static(id.clone()))
        .or_else(|| {
            nodes
                .values()
                .find(|n| n.is_root_frame())
                .map(|n| n.id.clone())
        })
        .ok_or_else(|| "canvas export has no root frame".to_string())?;

    resolve_sizes(&mut nodes, &pending, &root_page_id);
    for id in &ellipse_ids {
        if let Some(node) = nodes.get_mut(id) {
            let r = (node.layout.width.min(node.layout.height) * 0.5) as f32;
            node.style.corners = Corners::uniform(r.max(0.0));
        }
    }
    expand_instances(&mut nodes, &variant_table);
    for (comp_id, table) in variant_table {
        if let Some(node) = nodes.get_mut(&NodeId::from_static(comp_id)) {
            if node.kind == NodeKind::Component {
                // Keep variant name list in sync with override keys.
                for name in table.keys() {
                    if !node.component_variants.iter().any(|v| v == name) {
                        node.component_variants.push(name.clone());
                    }
                }
                if node.component_variants.is_empty() {
                    node.component_variants.push("Default".into());
                }
                node.variant_overrides = table;
            }
        }
    }
    place_pages_side_by_side(&mut nodes, &page_ids);

    let mut document = Document {
        schema_version: doc
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .unwrap_or(2) as u32,
        id,
        name,
        nodes,
        root_page_id,
        breakpoints,
        tokens,
        animations,
        themes,
        active_theme_id: doc
            .get("activeThemeId")
            .and_then(Value::as_str)
            .unwrap_or("default")
            .to_string(),
        metadata: doc.get("metadata").cloned().unwrap_or(Value::Null),
    };
    finalize_layout(&mut document);
    Ok(document)
}

/// Materialize component trees under each empty instance.
fn expand_instances(
    nodes: &mut HashMap<NodeId, Node>,
    variant_table: &HashMap<String, HashMap<String, OverrideMap>>,
) {
    let instances: Vec<Node> = nodes
        .values()
        .filter(|n| n.kind == NodeKind::Instance)
        .cloned()
        .collect();

    for inst in instances {
        let already_has_children = nodes
            .values()
            .any(|n| n.parent_id.as_ref() == Some(&inst.id));
        if already_has_children {
            continue;
        }
        let Some(component_key) = inst.component_id.clone() else {
            continue;
        };
        let component_id = NodeId::from_static(component_key.clone());
        let Some(master) = nodes.get(&component_id).cloned() else {
            continue;
        };

        // Match instance box to the resolved component master.
        if let Some(node) = nodes.get_mut(&inst.id) {
            node.layout.width = master.layout.width.max(1.0);
            node.layout.height = master.layout.height.max(1.0);
            if node.style.fills.is_empty() {
                node.style = master.style.clone();
            }
            node.layout.mode = master.layout.mode;
            node.layout.direction = master.layout.direction;
            node.layout.align = master.layout.align;
            node.layout.justify = master.layout.justify;
            node.layout.gap = master.layout.gap;
            node.layout.padding = master.layout.padding;
            node.layout.wrap = master.layout.wrap;
            node.layout.columns = master.layout.columns;
        }

        let subtree = collect_descendants(nodes, &component_id);
        if subtree.is_empty() {
            continue;
        }

        let mut id_map: HashMap<NodeId, NodeId> = HashMap::new();
        for old_id in &subtree {
            let prefix = old_id.as_str().split('_').next().unwrap_or("node");
            let mut new_id = NodeId::new(prefix);
            while nodes.contains_key(&new_id) || id_map.values().any(|v| v == &new_id) {
                new_id = NodeId::new(prefix);
            }
            id_map.insert(old_id.clone(), new_id);
        }

        for old_id in &subtree {
            let Some(src) = nodes.get(old_id).cloned() else {
                continue;
            };
            let mut clone = src;
            clone.id = id_map[old_id].clone();
            clone.origin_id = Some(old_id.as_str().to_string());
            clone.parent_id = match &clone.parent_id {
                Some(pid) if *pid == component_id => Some(inst.id.clone()),
                Some(pid) => Some(id_map.get(pid).cloned().unwrap_or_else(|| pid.clone())),
                None => Some(inst.id.clone()),
            };
            nodes.insert(clone.id.clone(), clone);
        }

        // Apply component variant overrides onto the materialized tree.
        if let Some(variant) = inst.variant.as_deref() {
            if let Some(patches) = variant_table
                .get(&component_key)
                .and_then(|v| v.get(variant))
            {
                apply_override_map_to_tree(nodes, patches, &id_map, Some(&inst.id), &component_id);
            }
        }

        // Apply instance-level overrides (keys are master node ids).
        if !inst.overrides.is_empty() {
            apply_override_map_to_tree(
                nodes,
                &inst.overrides,
                &id_map,
                Some(&inst.id),
                &component_id,
            );
        }
    }
}

fn apply_override_map_to_tree(
    nodes: &mut HashMap<NodeId, Node>,
    patches: &OverrideMap,
    id_map: &HashMap<NodeId, NodeId>,
    instance_id: Option<&NodeId>,
    component_id: &NodeId,
) {
    for (master_key, patch) in patches {
        let master_id = NodeId::from_static(master_key.clone());
        let target = if &master_id == component_id {
            instance_id.cloned()
        } else {
            id_map.get(&master_id).cloned()
        };
        let Some(target) = target else {
            continue;
        };
        if let Some(node) = nodes.get(&target).cloned() {
            let next = node.apply_override_patch(patch);
            nodes.insert(target, next);
        }
    }
}

fn collect_descendants(nodes: &HashMap<NodeId, Node>, root: &NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut stack: Vec<NodeId> = nodes
        .values()
        .filter(|n| n.parent_id.as_ref() == Some(root))
        .map(|n| n.id.clone())
        .collect();
    while let Some(id) = stack.pop() {
        out.push(id.clone());
        for child in nodes.values().filter(|n| n.parent_id.as_ref() == Some(&id)) {
            stack.push(child.id.clone());
        }
    }
    // Parents before children.
    out.sort_by_key(|id| {
        let mut depth = 0usize;
        let mut cur = id.clone();
        while let Some(parent) = nodes.get(&cur).and_then(|n| n.parent_id.clone()) {
            depth += 1;
            cur = parent;
            if depth > 10_000 {
                break;
            }
        }
        depth
    });
    out
}

fn place_pages_side_by_side(nodes: &mut HashMap<NodeId, Node>, page_ids: &[(f64, String)]) {
    let mut cursor_x = 0.0_f64;
    const PAGE_GAP: f64 = 80.0;
    for (_, id) in page_ids {
        let page_id = NodeId::from_static(id.clone());
        if let Some(page) = nodes.get_mut(&page_id) {
            page.layout.x = cursor_x;
            page.layout.y = 0.0;
            cursor_x += page.layout.width + PAGE_GAP;
        }
    }
}

fn finalize_layout(document: &mut Document) {
    // Use the engine's flex solver so flow children get real x/y.
    let mut engine = crate::engine::CanvasEngine::new(document.clone());
    engine.resolve_all_stacks();
    *document = engine.document().clone();

    // Grow page heights to fit stacked content.
    let page_ids: Vec<NodeId> = document
        .nodes
        .values()
        .filter(|n| n.is_root_frame())
        .map(|n| n.id.clone())
        .collect();
    for page_id in page_ids {
        let mut max_bottom = 0.0_f64;
        for child in document.nodes.values().filter(|n| n.parent_id.as_ref() == Some(&page_id))
        {
            if child.hidden {
                continue;
            }
            max_bottom = max_bottom.max(child.layout.y + child.layout.height);
        }
        if let Some(page) = document.nodes.get_mut(&page_id) {
            let pad = page.layout.padding.bottom as f64;
            let needed = (max_bottom + pad).max(page.layout.height).max(900.0);
            page.layout.height = needed;
        }
    }

    // One more pass after page heights change (fill children).
    let mut engine = crate::engine::CanvasEngine::new(document.clone());
    engine.resolve_all_stacks();
    *document = engine.document().clone();
}

fn convert_tokens(value: Option<&Value>) -> Vec<DesignToken> {
    let Some(obj) = value.and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, token) in obj {
        let token_type = token
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("color")
            .to_string();
        let value = token.get("value").cloned().unwrap_or(Value::Null);
        let color = if token_type == "color" {
            parse_color_value(Some(&value), &HashMap::new())
                .unwrap_or(Color::rgb(0x80, 0x80, 0x80))
        } else {
            Color::rgb(0x80, 0x80, 0x80)
        };
        out.push(DesignToken {
            id: token
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or(key)
                .to_string(),
            name: token
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(key)
                .to_string(),
            color,
            token_type,
            value,
            modes: token
                .get("modes")
                .and_then(Value::as_object)
                .map(|modes| {
                    modes
                        .iter()
                        .map(|(id, value)| (id.clone(), value.clone()))
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn convert_breakpoints(value: Option<&Value>) -> Vec<Breakpoint> {
    let Some(arr) = value.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|bp| {
            let id = bp.get("id")?.as_str()?.to_string();
            let name = bp
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&id)
                .to_string();
            let min_width = bp
                .get("minWidth")
                .or_else(|| bp.get("min_width"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            Some(Breakpoint {
                id,
                name,
                min_width,
                preview_width: bp
                    .get("previewWidth")
                    .or_else(|| bp.get("preview_width"))
                    .and_then(Value::as_f64)
                    .unwrap_or(min_width),
            })
        })
        .collect()
}

fn convert_animations(value: Option<&Value>) -> Vec<DocumentAnimation> {
    let Some(obj) = value.and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut out: Vec<DocumentAnimation> = obj
        .iter()
        .map(|(key, anim)| DocumentAnimation {
            id: anim
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or(key)
                .to_string(),
            name: anim
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(key)
                .to_string(),
            duration_ms: anim
                .get("duration")
                .and_then(|v| v.as_f64())
                .unwrap_or(300.0) as f32,
            easing: anim
                .get("easing")
                .and_then(Value::as_str)
                .unwrap_or("ease-out")
                .to_string(),
            cubic_bezier: parse_cubic_bezier(anim.get("easing")),
            delay_ms: anim.get("delay").and_then(Value::as_f64).unwrap_or(0.0) as f32,
            keyframes: anim
                .get("keyframes")
                .and_then(Value::as_array)
                .map(|frames| {
                    frames
                        .iter()
                        .filter_map(|frame| {
                            Some(AnimationKeyframe {
                                offset: frame.get("offset")?.as_f64()? as f32,
                                opacity: frame
                                    .get("opacity")
                                    .and_then(Value::as_f64)
                                    .map(|value| value as f32),
                                transform: parse_motion_transform(frame.get("transform")),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
            iterations: anim
                .get("iterations")
                .and_then(Value::as_f64)
                .unwrap_or(1.0) as f32,
            infinite: anim.get("iterations").and_then(Value::as_str) == Some("infinite"),
            direction: anim
                .get("direction")
                .and_then(Value::as_str)
                .unwrap_or("normal")
                .to_string(),
            fill: anim
                .get("fill")
                .and_then(Value::as_str)
                .unwrap_or("none")
                .to_string(),
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn convert_themes(value: Option<&Value>) -> Vec<CanvasTheme> {
    let Some(themes) = value.and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut out: Vec<_> = themes
        .iter()
        .map(|(key, theme)| CanvasTheme {
            id: theme
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or(key)
                .to_string(),
            name: theme
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(key)
                .to_string(),
        })
        .collect();
    out.sort_by(|left, right| left.id.cmp(&right.id));
    out
}

fn parse_cubic_bezier(value: Option<&Value>) -> Option<[f32; 4]> {
    let values = value?.get("cubicBezier")?.as_array()?;
    if values.len() != 4 {
        return None;
    }
    Some([
        values[0].as_f64()? as f32,
        values[1].as_f64()? as f32,
        values[2].as_f64()? as f32,
        values[3].as_f64()? as f32,
    ])
}

fn parse_motion_transform(value: Option<&Value>) -> Option<MotionTransform> {
    let value = value?.as_object()?;
    let number = |key: &str| value.get(key).and_then(Value::as_f64).map(|v| v as f32);
    let transform = MotionTransform {
        x: number("x"),
        y: number("y"),
        scale: number("scale"),
        scale_x: number("scaleX"),
        scale_y: number("scaleY"),
        rotate: number("rotate"),
        skew_x: number("skewX"),
        skew_y: number("skewY"),
    };
    (transform != MotionTransform::default()).then_some(transform)
}

fn convert_node(
    raw: &Value,
    tokens: &HashMap<String, Color>,
) -> Result<(Node, PendingLayout, bool), String> {
    let id = raw
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "node missing id".to_string())?;
    let type_name = raw.get("type").and_then(|v| v.as_str()).unwrap_or("frame");
    let shape_kind = match raw.get("shape").and_then(Value::as_str) {
        Some("ellipse") => ShapeKind::Ellipse,
        Some("line") => ShapeKind::Line,
        _ => ShapeKind::Rectangle,
    };
    let is_ellipse = shape_kind == ShapeKind::Ellipse;
    let kind = match type_name {
        "page" | "frame" | "group" => NodeKind::Frame,
        "text" => NodeKind::Text,
        "shape" => NodeKind::Rectangle,
        "component" => NodeKind::Component,
        "instance" => NodeKind::Instance,
        "image" => NodeKind::Image,
        "vector" => NodeKind::Vector,
        other => return Err(format!("unsupported node type: {other}")),
    };

    let is_root_frame = kind == NodeKind::Frame
        && raw
            .get("parentId")
            .and_then(Value::as_str)
            .is_none();
    let pending = convert_pending_layout(
        raw.get("layout"),
        is_root_frame,
        raw.get("viewport"),
    );
    let style = convert_style(raw.get("style"), tokens);
    let text = raw
        .get("text")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let typography = convert_typography(raw.get("style"), tokens, text.as_deref());

    let mut node = Node {
        id: NodeId::from_static(id),
        kind,
        name: raw
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(if is_ellipse { "Ellipse" } else { "Layer" })
            .to_string(),
        parent_id: raw
            .get("parentId")
            .and_then(|v| v.as_str())
            .map(NodeId::from_static),
        order: raw.get("order").and_then(|v| v.as_f64()).unwrap_or(1024.0),
        hidden: raw.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false),
        locked: raw.get("locked").and_then(|v| v.as_bool()).unwrap_or(false),
        layout: Layout::new(pending.x, pending.y, 1.0, 1.0),
        style,
        text,
        font_size: typography
            .as_ref()
            .map(|t| t.size)
            .unwrap_or(16.0),
        typography,
        image_path: raw.get("src").and_then(Value::as_str).map(str::to_string),
        image_alt: raw
            .get("alt")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        image_fit: match raw.get("fit").and_then(Value::as_str) {
            Some("contain") => ImageFit::Contain,
            Some("fill") => ImageFit::Fill,
            _ => ImageFit::Cover,
        },
        rotation: raw.get("rotation").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
        responsive: convert_responsive(raw.get("responsive"), tokens),
        visual_states: convert_visual_states(raw.get("visualStates"), tokens),
        transition: convert_transition(raw.get("transition")),
        animations: convert_node_animations(raw.get("animations")),
        interactions: convert_interactions(raw.get("interactions")),
        component_id: raw
            .get("componentId")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        variant: raw
            .get("variant")
            .or_else(|| raw.get("defaultVariant"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        overrides: Default::default(),
        paths: convert_vector_paths(raw.get("paths"), tokens),
        component_variants: raw
            .get("variants")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        variant_overrides: Default::default(),
        origin_id: None,
        shape_kind,
        semantic_tag: raw
            .get("semanticTag")
            .and_then(Value::as_str)
            .map(str::to_string),
        text_runs: convert_text_runs(raw.get("runs"), tokens),
        vector_view_box: raw
            .get("viewBox")
            .and_then(Value::as_str)
            .map(str::to_string),
        viewport: raw.get("viewport").and_then(convert_page_viewport),
        states: convert_states(raw.get("states")),
        default_variant: raw
            .get("defaultVariant")
            .and_then(Value::as_str)
            .map(str::to_string),
        metadata: raw.get("metadata").cloned().unwrap_or(Value::Null),
    };

    // Seed layout fields that don't depend on resolved size.
    apply_pending_meta(&mut node.layout, &pending);

    Ok((node, pending, is_ellipse))
}

fn convert_page_viewport(value: &Value) -> Option<PageViewport> {
    Some(PageViewport {
        width: value.get("width")?.as_f64()?,
        min_height: value
            .get("minHeight")
            .or_else(|| value.get("min_height"))?
            .as_f64()?,
    })
}

fn convert_states(value: Option<&Value>) -> HashMap<String, StateDefinition> {
    let Some(states) = value.and_then(Value::as_object) else {
        return HashMap::new();
    };
    states
        .iter()
        .filter_map(|(key, value)| {
            let initial = convert_state_value(value.get("initial")?)?;
            Some((
                key.clone(),
                StateDefinition {
                    id: value
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or(key)
                        .to_string(),
                    name: value
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(key)
                        .to_string(),
                    state_type: value
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("string")
                        .to_string(),
                    initial,
                },
            ))
        })
        .collect()
}

fn convert_text_runs(value: Option<&Value>, tokens: &HashMap<String, Color>) -> Vec<TextRun> {
    let Some(runs) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    runs.iter()
        .filter_map(|run| {
            Some(TextRun {
                start: run.get("start")?.as_u64()? as usize,
                end: run.get("end")?.as_u64()? as usize,
                typography: run
                    .get("typography")
                    .map(convert_typography_patch)
                    .filter(|patch| patch != &TypographyPatch::default()),
                color: resolve_color(run.get("color"), tokens),
                color_token: color_token_id(run.get("color")),
            })
        })
        .collect()
}

fn convert_typography_patch(value: &Value) -> TypographyPatch {
    TypographyPatch {
        family: value.get("family").and_then(Value::as_str).map(str::to_string),
        size: value.get("size").and_then(Value::as_f64).map(|v| v as f32),
        weight: value
            .get("weight")
            .and_then(Value::as_u64)
            .map(|v| v as u16),
        line_height: value
            .get("lineHeight")
            .or_else(|| value.get("line_height"))
            .and_then(Value::as_f64)
            .map(|v| v as f32),
        letter_spacing: value
            .get("letterSpacing")
            .or_else(|| value.get("letter_spacing"))
            .and_then(Value::as_f64)
            .map(|v| v as f32),
        align: value.get("align").and_then(Value::as_str).map(str::to_string),
        wrap: value.get("wrap").and_then(Value::as_bool),
        decoration: value
            .get("decoration")
            .and_then(Value::as_str)
            .map(str::to_string),
        transform: value
            .get("transform")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn convert_vector_paths(value: Option<&Value>, tokens: &HashMap<String, Color>) -> Vec<VectorPath> {
    let Some(paths) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    paths
        .iter()
        .filter_map(|path| {
            Some(VectorPath {
                d: path.get("d")?.as_str()?.to_string(),
                fill: resolve_color(path.get("fill"), tokens),
                fill_token: color_token_id(path.get("fill")),
                stroke: resolve_color(path.get("stroke"), tokens),
                stroke_token: color_token_id(path.get("stroke")),
                stroke_width: path
                    .get("strokeWidth")
                    .or_else(|| path.get("stroke_width"))
                    .and_then(Value::as_f64)
                    .map(|v| v as f32),
            })
        })
        .collect()
}

fn convert_visual_states(
    value: Option<&Value>,
    tokens: &HashMap<String, Color>,
) -> Option<VisualStates> {
    let value = value?.as_object()?;
    let convert = |state: Option<&Value>| -> Option<VisualState> {
        let state = state?;
        let style = state.get("style");
        let transform = parse_motion_transform(state.get("transform"));
        let fill = style
            .and_then(|value| value.get("fills"))
            .and_then(Value::as_array)
            .and_then(|fills| fills.first())
            .and_then(|paint| convert_paint(paint, tokens))
            .and_then(|paint| paint.solid_color());
        Some(VisualState {
            opacity: style
                .and_then(|value| value.get("opacity"))
                .and_then(Value::as_f64)
                .map(|v| v as f32),
            scale: transform.as_ref().and_then(|value| value.scale),
            fill,
            transform,
            style: style
                .map(|value| convert_style_patch(value, tokens))
                .filter(|patch| !patch.is_empty()),
        })
    };
    let states = VisualStates {
        hover: convert(value.get("hover")),
        press: convert(value.get("press")),
        focus: convert(value.get("focus")),
    };
    (states != VisualStates::default()).then_some(states)
}

fn convert_node_animations(value: Option<&Value>) -> Vec<NodeAnimation> {
    let Some(animations) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    animations
        .iter()
        .filter_map(|animation| {
            Some(NodeAnimation {
                animation_id: animation
                    .get("animationId")
                    .or_else(|| animation.get("animation_id"))?
                    .as_str()?
                    .to_string(),
                trigger: match animation.get("trigger").and_then(Value::as_str) {
                    Some("in-view") | Some("in_view") => AnimationTrigger::InView,
                    Some("always") => AnimationTrigger::Always,
                    Some("hover") => AnimationTrigger::Hover,
                    Some("press") => AnimationTrigger::Press,
                    _ => AnimationTrigger::Load,
                },
                delay_ms: animation
                    .get("delay")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0) as f32,
                once: animation
                    .get("once")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

fn convert_interactions(value: Option<&Value>) -> Vec<Interaction> {
    let Some(arr) = value.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let trigger = match item.get("trigger").and_then(|v| v.as_str()) {
                Some("double-click") | Some("double_click") => InteractionTrigger::DoubleClick,
                Some("hover") => InteractionTrigger::Hover,
                Some("hover-end") | Some("hover_end") => InteractionTrigger::HoverEnd,
                Some("submit") => InteractionTrigger::Submit,
                Some("change") => InteractionTrigger::Change,
                Some("input") => InteractionTrigger::Input,
                Some("focus") => InteractionTrigger::Focus,
                Some("blur") => InteractionTrigger::Blur,
                Some("state-change") | Some("state_change") => InteractionTrigger::StateChange,
                _ => InteractionTrigger::Click,
            };
            let actions = item
                .get("actions")
                .and_then(|v| v.as_array())?
                .iter()
                .filter_map(|action| match action.get("type").and_then(|v| v.as_str()) {
                    Some("open_url") | Some("openUrl") | Some("open-url") => {
                        let url = action.get("url")?.as_str()?.to_string();
                        Some(CanvasAction::OpenUrl {
                            url,
                            target: action
                                .get("target")
                                .and_then(|v| v.as_str())
                                .unwrap_or("_blank")
                                .to_string(),
                        })
                    }
                    Some("navigate") => {
                        let page_id = action
                            .get("pageId")
                            .or_else(|| action.get("page_id"))?
                            .as_str()?
                            .to_string();
                        Some(CanvasAction::Navigate { page_id })
                    }
                    Some("visibility") => Some(CanvasAction::Visibility {
                        node_id: action
                            .get("nodeId")
                            .or_else(|| action.get("node_id"))?
                            .as_str()?
                            .to_string(),
                        value: action
                            .get("value")?
                            .as_str()?
                            .to_string(),
                    }),
                    Some("open-overlay") | Some("open_overlay") => {
                        Some(CanvasAction::OpenOverlay {
                            page_id: action
                                .get("pageId")
                                .or_else(|| action.get("page_id"))?
                                .as_str()?
                                .to_string(),
                        })
                    }
                    Some("close-overlay") | Some("close_overlay") => {
                        Some(CanvasAction::CloseOverlay)
                    }
                    Some("set-variant") | Some("set_variant") => Some(CanvasAction::SetVariant {
                        instance_id: action
                            .get("instanceId")
                            .or_else(|| action.get("instance_id"))?
                            .as_str()?
                            .to_string(),
                        variant: action.get("variant")?.as_str()?.to_string(),
                    }),
                    Some("set-state") | Some("set_state") => Some(CanvasAction::SetState {
                        state_id: action
                            .get("stateId")
                            .or_else(|| action.get("state_id"))?
                            .as_str()?
                            .to_string(),
                        value: convert_state_value(action.get("value")?)?,
                    }),
                    Some("toggle-state") | Some("toggle_state") => {
                        Some(CanvasAction::ToggleState {
                            state_id: action
                                .get("stateId")
                                .or_else(|| action.get("state_id"))?
                                .as_str()?
                                .to_string(),
                        })
                    }
                    Some("increment-state") | Some("increment_state") => {
                        Some(CanvasAction::IncrementState {
                            state_id: action
                                .get("stateId")
                                .or_else(|| action.get("state_id"))?
                                .as_str()?
                                .to_string(),
                            amount: action.get("amount")?.as_f64()?,
                        })
                    }
                    Some("set-theme") | Some("set_theme") => Some(CanvasAction::SetTheme {
                        theme_id: action
                            .get("themeId")
                            .or_else(|| action.get("theme_id"))?
                            .as_str()?
                            .to_string(),
                    }),
                    _ => None,
                })
                .collect::<Vec<_>>();
            if actions.is_empty() {
                None
            } else {
                Some(Interaction {
                    trigger,
                    state_id: item
                        .get("stateId")
                        .or_else(|| item.get("state_id"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    when: item
                        .get("when")
                        .and_then(Value::as_array)
                        .map(|conditions| {
                            conditions
                                .iter()
                                .filter_map(convert_state_condition)
                                .collect()
                        })
                        .unwrap_or_default(),
                    actions,
                })
            }
        })
        .collect()
}

fn convert_state_value(value: &Value) -> Option<StateValue> {
    if let Some(value) = value.as_str() {
        Some(StateValue::String(value.to_string()))
    } else if let Some(value) = value.as_f64() {
        Some(StateValue::Number(value))
    } else {
        value.as_bool().map(StateValue::Boolean)
    }
}

fn convert_state_condition(value: &Value) -> Option<StateCondition> {
    Some(StateCondition {
        state_id: value
            .get("stateId")
            .or_else(|| value.get("state_id"))?
            .as_str()?
            .to_string(),
        operator: value.get("operator")?.as_str()?.to_string(),
        value: convert_state_value(value.get("value")?)?,
    })
}

fn convert_override_map(value: Option<&Value>, tokens: &HashMap<String, Color>) -> OverrideMap {
    let Some(obj) = value.and_then(|v| v.as_object()) else {
        return OverrideMap::new();
    };
    let mut map = OverrideMap::new();
    for (key, patch) in obj {
        if let Some(converted) = convert_override_patch(patch, tokens) {
            map.insert(key.clone(), converted);
        }
    }
    map
}

fn convert_variant_overrides(
    value: Option<&Value>,
    tokens: &HashMap<String, Color>,
) -> Option<HashMap<String, OverrideMap>> {
    let obj = value.and_then(|v| v.as_object())?;
    let mut out = HashMap::new();
    for (variant, nodes) in obj {
        let map = convert_override_map(Some(nodes), tokens);
        if !map.is_empty() {
            out.insert(variant.clone(), map);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn convert_override_patch(value: &Value, tokens: &HashMap<String, Color>) -> Option<OverridePatch> {
    let mut patch = OverridePatch::default();
    if let Some(text) = value.get("text").and_then(|v| v.as_str()) {
        patch.text = Some(text.to_string());
    }
    if let Some(name) = value.get("name").and_then(|v| v.as_str()) {
        patch.name = Some(name.to_string());
    }
    patch.hidden = value.get("hidden").and_then(Value::as_bool);
    patch.locked = value.get("locked").and_then(Value::as_bool);
    patch.layout_patch = value
        .get("layout")
        .map(convert_layout_patch)
        .filter(|layout| !layout.is_empty());
    patch.style_patch = value
        .get("style")
        .map(|style| convert_style_patch(style, tokens))
        .filter(|style| !style.is_empty());
    if let Some(opacity) = value
        .pointer("/style/opacity")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
    {
        patch.opacity = Some(opacity);
    }
    if let Some(rotation) = value.get("rotation").and_then(|v| v.as_f64()) {
        patch.rotation = Some(rotation as f32);
    }
    patch.semantic_tag = value
        .get("semanticTag")
        .and_then(Value::as_str)
        .map(str::to_string);
    if value.get("runs").is_some() {
        patch.text_runs = Some(convert_text_runs(value.get("runs"), tokens));
    }
    patch.image_path = value.get("src").and_then(Value::as_str).map(str::to_string);
    patch.image_alt = value.get("alt").and_then(Value::as_str).map(str::to_string);
    if value.get("interactions").is_some() {
        patch.interactions = Some(convert_interactions(value.get("interactions")));
    }
    patch.variant = value
        .get("variant")
        .and_then(Value::as_str)
        .map(str::to_string);
    patch.visual_states = convert_visual_states(value.get("visualStates"), tokens);
    patch.transition = convert_transition(value.get("transition"));
    if value.get("animations").is_some() {
        patch.animations = Some(convert_node_animations(value.get("animations")));
    }
    if patch.text.is_none()
        && patch.name.is_none()
        && patch.style.is_none()
        && patch.style_patch.is_none()
        && patch.opacity.is_none()
        && patch.rotation.is_none()
        && patch.layout.is_none()
        && patch.layout_patch.is_none()
        && patch.typography.is_none()
        && patch.hidden.is_none()
        && patch.locked.is_none()
        && patch.semantic_tag.is_none()
        && patch.text_runs.is_none()
        && patch.image_path.is_none()
        && patch.image_alt.is_none()
        && patch.interactions.is_none()
        && patch.variant.is_none()
        && patch.visual_states.is_none()
        && patch.transition.is_none()
        && patch.animations.is_none()
    {
        None
    } else {
        Some(patch)
    }
}

fn convert_layout_patch(value: &Value) -> LayoutPatch {
    let Some(object) = value.as_object() else {
        return LayoutPatch::default();
    };
    let optional_number = |key: &str| {
        object
            .contains_key(key)
            .then(|| object.get(key).and_then(Value::as_f64))
    };
    LayoutPatch {
        position: object.get("position").and_then(|value| match value.as_str()? {
            "flow" => Some(LayoutPosition::Flow),
            "absolute" => Some(LayoutPosition::Absolute),
            _ => None,
        }),
        x: object.get("x").and_then(Value::as_f64),
        y: object.get("y").and_then(Value::as_f64),
        width: object.get("width").map(parse_dimension_patch),
        height: object.get("height").map(parse_dimension_patch),
        min_width: optional_number("minWidth"),
        max_width: optional_number("maxWidth"),
        min_height: optional_number("minHeight"),
        max_height: optional_number("maxHeight"),
        aspect_ratio: optional_number("aspectRatio"),
        mode: object.get("mode").and_then(|value| match value.as_str()? {
            "absolute" => Some(LayoutMode::Absolute),
            "flex" => Some(LayoutMode::Flex),
            "grid" => Some(LayoutMode::Grid),
            _ => None,
        }),
        direction: object.get("direction").and_then(|value| match value.as_str()? {
            "row" => Some(FlexDirection::Row),
            "column" => Some(FlexDirection::Column),
            _ => None,
        }),
        wrap: object.get("wrap").and_then(Value::as_bool),
        gap: object.get("gap").and_then(Value::as_f64).map(|v| v as f32),
        padding: object.get("padding").map(|value| parse_insets(Some(value))),
        align: object.get("align").and_then(parse_align_value),
        justify: object.get("justify").and_then(|value| match value.as_str()? {
            "start" => Some(LayoutJustify::Start),
            "center" => Some(LayoutJustify::Center),
            "end" => Some(LayoutJustify::End),
            "space-between" | "space_between" => Some(LayoutJustify::SpaceBetween),
            "space-around" | "space_around" => Some(LayoutJustify::SpaceAround),
            _ => None,
        }),
        columns: object
            .get("columns")
            .and_then(Value::as_u64)
            .map(|v| v as u32),
        align_self: object
            .contains_key("alignSelf")
            .then(|| object.get("alignSelf").and_then(parse_align_value)),
        grow: object.get("grow").and_then(Value::as_f64).map(|v| v as f32),
        shrink: object
            .contains_key("shrink")
            .then(|| object.get("shrink").and_then(Value::as_f64).map(|v| v as f32)),
    }
}

fn parse_dimension_patch(value: &Value) -> DimensionPatch {
    match parse_dim(Some(value)) {
        Dim::Px(value) => DimensionPatch {
            mode: SizeMode::Fixed,
            value: Some(value),
        },
        Dim::Percent(value) => DimensionPatch {
            mode: SizeMode::Percent,
            value: Some(value),
        },
        Dim::Fill => DimensionPatch {
            mode: SizeMode::Fill,
            value: None,
        },
        Dim::Hug => DimensionPatch {
            mode: SizeMode::Hug,
            value: None,
        },
    }
}

fn convert_style_patch(value: &Value, tokens: &HashMap<String, Color>) -> StylePatch {
    let Some(object) = value.as_object() else {
        return StylePatch::default();
    };
    StylePatch {
        fills: object.get("fills").and_then(Value::as_array).map(|fills| {
            fills
                .iter()
                .filter_map(|paint| convert_paint(paint, tokens))
                .collect()
        }),
        stroke: object.contains_key("stroke").then(|| {
            object
                .get("stroke")
                .and_then(|stroke| convert_stroke(stroke, tokens))
        }),
        corners: object
            .get("radius")
            .or_else(|| object.get("corners"))
            .map(parse_corners),
        shadows: object.get("shadows").and_then(Value::as_array).map(|shadows| {
            shadows
                .iter()
                .map(|shadow| convert_shadow(shadow, tokens))
                .collect()
        }),
        opacity: object
            .get("opacity")
            .and_then(Value::as_f64)
            .map(|v| v as f32),
        overflow: object.get("overflow").and_then(|value| match value.as_str()? {
            "visible" => Some(Overflow::Visible),
            "hidden" => Some(Overflow::Hidden),
            "auto" => Some(Overflow::Auto),
            _ => None,
        }),
        blend_mode: object
            .contains_key("blendMode")
            .then(|| object.get("blendMode").and_then(Value::as_str).map(str::to_string)),
        typography: object
            .get("typography")
            .map(convert_typography_patch)
            .filter(|patch| patch != &TypographyPatch::default()),
    }
}

fn apply_pending_meta(layout: &mut Layout, pending: &PendingLayout) {
    layout.mode = pending.mode;
    layout.direction = pending.direction;
    layout.align = pending.align;
    layout.justify = pending.justify;
    layout.gap = pending.gap;
    layout.wrap = pending.wrap;
    layout.columns = pending.columns;
    layout.padding = pending.padding;
    layout.position = pending.position;
    layout.min_width = pending.min_width;
    layout.max_width = pending.max_width;
    layout.min_height = pending.min_height.or(pending.viewport_min_height);
    layout.max_height = pending.max_height;
    layout.aspect_ratio = pending.aspect_ratio;
    layout.align_self = pending.align_self;
    layout.grow = pending.grow;
    layout.shrink = pending.shrink;
    layout.width_mode = match pending.width {
        Dim::Fill => SizeMode::Fill,
        Dim::Hug => SizeMode::Hug,
        Dim::Percent(_) => SizeMode::Percent,
        Dim::Px(_) => {
            if pending.grow > 0.0 {
                SizeMode::Fill
            } else {
                SizeMode::Fixed
            }
        }
    };
    layout.width_percent = match pending.width {
        Dim::Percent(value) => Some(value),
        _ => None,
    };
    layout.height_mode = match pending.height {
        Dim::Fill => SizeMode::Fill,
        Dim::Hug => SizeMode::Hug,
        Dim::Percent(_) => SizeMode::Percent,
        Dim::Px(_) => SizeMode::Fixed,
    };
    layout.height_percent = match pending.height {
        Dim::Percent(value) => Some(value),
        _ => None,
    };
}

fn convert_pending_layout(
    layout: Option<&Value>,
    is_root_frame: bool,
    viewport: Option<&Value>,
) -> PendingLayout {
    let layout = layout.unwrap_or(&Value::Null);
    let width = parse_dim(layout.get("width"));
    let height = parse_dim(layout.get("height"));

    let viewport_width = if is_root_frame {
        viewport
            .and_then(|value| value.get("width"))
            .and_then(Value::as_f64)
    } else {
        None
    };
    let viewport_min_height = if is_root_frame {
        viewport
            .and_then(|value| value.get("minHeight").or_else(|| value.get("height")))
            .and_then(Value::as_f64)
    } else {
        None
    };

    PendingLayout {
        x: layout.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0),
        y: layout.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0),
        width,
        height,
        mode: match layout.get("mode").and_then(|v| v.as_str()) {
            Some("flex") => LayoutMode::Flex,
            Some("grid") => LayoutMode::Grid,
            _ => LayoutMode::Absolute,
        },
        direction: match layout.get("direction").and_then(|v| v.as_str()) {
            Some("column") => FlexDirection::Column,
            _ => FlexDirection::Row,
        },
        align: parse_align(layout.get("align")),
        justify: parse_justify(layout.get("justify")),
        gap: layout.get("gap").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
        wrap: layout.get("wrap").and_then(|v| v.as_bool()).unwrap_or(false),
        columns: layout
            .get("columns")
            .and_then(|v| v.as_u64())
            .unwrap_or(2) as u32,
        padding: parse_insets(layout.get("padding")),
        position: match layout.get("position").and_then(|v| v.as_str()) {
            Some("flow") => LayoutPosition::Flow,
            _ => LayoutPosition::Absolute,
        },
        min_width: layout.get("minWidth").and_then(|v| v.as_f64()),
        max_width: layout.get("maxWidth").and_then(|v| v.as_f64()),
        min_height: layout.get("minHeight").and_then(|v| v.as_f64()),
        max_height: layout.get("maxHeight").and_then(|v| v.as_f64()),
        aspect_ratio: layout.get("aspectRatio").and_then(|v| v.as_f64()),
        align_self: layout.get("alignSelf").and_then(parse_align_value),
        grow: layout
            .get("grow")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32,
        shrink: layout
            .get("shrink")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32),
        viewport_width,
        viewport_min_height,
    }
}

fn parse_align_value(value: &Value) -> Option<LayoutAlign> {
    match value.as_str()? {
        "start" => Some(LayoutAlign::Start),
        "center" => Some(LayoutAlign::Center),
        "end" => Some(LayoutAlign::End),
        "stretch" => Some(LayoutAlign::Stretch),
        _ => None,
    }
}

fn parse_dim(value: Option<&Value>) -> Dim {
    let Some(value) = value else {
        return Dim::Hug;
    };
    if let Some(n) = value.as_f64() {
        return Dim::Px(n);
    }
    match value.get("unit").and_then(|v| v.as_str()) {
        Some("px") => Dim::Px(value.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0)),
        Some("percent") => {
            Dim::Percent(value.get("value").and_then(Value::as_f64).unwrap_or(0.0))
        }
        Some("fill") => Dim::Fill,
        _ => Dim::Hug,
    }
}

fn parse_align(value: Option<&Value>) -> LayoutAlign {
    match value.and_then(|v| v.as_str()) {
        Some("center") => LayoutAlign::Center,
        Some("end") => LayoutAlign::End,
        Some("stretch") => LayoutAlign::Stretch,
        // Canvas V2 leaves this optional and its browser renderer defaults
        // flex/grid cross-axis alignment to stretch.
        _ => LayoutAlign::Stretch,
    }
}

fn parse_justify(value: Option<&Value>) -> LayoutJustify {
    match value.and_then(|v| v.as_str()) {
        Some("center") => LayoutJustify::Center,
        Some("end") => LayoutJustify::End,
        Some("space-between") | Some("space_between") => LayoutJustify::SpaceBetween,
        Some("space-around") | Some("space_around") => LayoutJustify::SpaceAround,
        _ => LayoutJustify::Start,
    }
}

fn parse_insets(value: Option<&Value>) -> Insets {
    let Some(value) = value else {
        return Insets::default();
    };
    if let Some(n) = value.as_f64() {
        return Insets::uniform(n as f32);
    }
    Insets {
        top: value.get("top").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
        right: value.get("right").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
        bottom: value.get("bottom").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
        left: value.get("left").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
    }
}

fn parse_corners(value: &Value) -> Corners {
    if let Some(radius) = value.as_f64() {
        return Corners::uniform(radius as f32);
    }
    if let Some(values) = value.as_array() {
        if values.len() == 4 {
            return Corners {
                tl: values[0].as_f64().unwrap_or(0.0) as f32,
                tr: values[1].as_f64().unwrap_or(0.0) as f32,
                br: values[2].as_f64().unwrap_or(0.0) as f32,
                bl: values[3].as_f64().unwrap_or(0.0) as f32,
            };
        }
    }
    Corners {
        tl: value
            .get("tl")
            .or_else(|| value.get("topLeft"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0) as f32,
        tr: value
            .get("tr")
            .or_else(|| value.get("topRight"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0) as f32,
        br: value
            .get("br")
            .or_else(|| value.get("bottomRight"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0) as f32,
        bl: value
            .get("bl")
            .or_else(|| value.get("bottomLeft"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0) as f32,
    }
}

fn convert_stroke(value: &Value, tokens: &HashMap<String, Color>) -> Option<Stroke> {
    let width = value.get("width").and_then(Value::as_f64).unwrap_or(0.0) as f32;
    if width <= 0.0 {
        return None;
    }
    Some(Stroke {
        color: resolve_color(value.get("color"), tokens)?,
        token_id: color_token_id(value.get("color")),
        width,
        style: match value.get("style").and_then(Value::as_str) {
            Some("dashed") => StrokeStyle::Dashed,
            Some("dotted") => StrokeStyle::Dotted,
            _ => StrokeStyle::Solid,
        },
    })
}

fn convert_shadow(value: &Value, tokens: &HashMap<String, Color>) -> Shadow {
    Shadow {
        color: resolve_color(value.get("color"), tokens)
            .unwrap_or(Color::rgba(0.0, 0.0, 0.0, 0.25)),
        token_id: color_token_id(value.get("color")),
        x: value.get("x").and_then(Value::as_f64).unwrap_or(0.0) as f32,
        y: value.get("y").and_then(Value::as_f64).unwrap_or(0.0) as f32,
        blur: value.get("blur").and_then(Value::as_f64).unwrap_or(0.0) as f32,
        spread: value
            .get("spread")
            .and_then(Value::as_f64)
            .unwrap_or(0.0) as f32,
        inset: value.get("inset").and_then(Value::as_bool).unwrap_or(false),
    }
}

fn convert_style(style: Option<&Value>, tokens: &HashMap<String, Color>) -> Style {
    let style = style.unwrap_or(&Value::Null);
    let fills = style
        .get("fills")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|fill| convert_paint(fill, tokens))
                .collect()
        })
        .unwrap_or_default();

    let stroke = style
        .get("stroke")
        .and_then(|stroke| convert_stroke(stroke, tokens));

    let corners = style
        .get("radius")
        .or_else(|| style.get("corners"))
        .map(parse_corners)
        .unwrap_or_default();

    let shadows = style
        .get("shadows")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|shadow| convert_shadow(shadow, tokens))
                .collect()
        })
        .unwrap_or_default();

    let overflow = match style.get("overflow").and_then(|v| v.as_str()) {
        Some("hidden") => Overflow::Hidden,
        Some("auto") => Overflow::Auto,
        _ => Overflow::Visible,
    };

    Style {
        fills,
        stroke,
        corners,
        opacity: style
            .get("opacity")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0) as f32,
        shadows,
        overflow,
        blend_mode: style
            .get("blendMode")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn convert_paint(fill: &Value, tokens: &HashMap<String, Color>) -> Option<Paint> {
    match fill.get("type").and_then(|v| v.as_str()).unwrap_or("solid") {
        "solid" => Some(Paint::Solid {
            color: resolve_color(fill.get("color"), tokens)?,
            token_id: color_token_id(fill.get("color")),
        }),
        "linear_gradient" | "linear-gradient" | "linearGradient" => {
            let angle = fill.get("angle").and_then(|v| v.as_f64()).unwrap_or(180.0) as f32;
            let stops: Vec<crate::model::GradientStop> = fill
                .get("stops")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|stop| {
                            Some(crate::model::GradientStop {
                                offset: stop
                                    .get("offset")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(0.0) as f32,
                                color: resolve_color(stop.get("color"), tokens)?,
                                token_id: color_token_id(stop.get("color")),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            if stops.is_empty() {
                None
            } else {
                Some(Paint::LinearGradient { angle, stops })
            }
        }
        "radial_gradient" | "radial-gradient" | "radialGradient" => {
            let stops: Vec<crate::model::GradientStop> = fill
                .get("stops")
                .and_then(Value::as_array)
                .map(|stops| {
                    stops
                        .iter()
                        .filter_map(|stop| {
                            Some(crate::model::GradientStop {
                                offset: stop.get("offset")?.as_f64()? as f32,
                                color: resolve_color(stop.get("color"), tokens)?,
                                token_id: color_token_id(stop.get("color")),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            (!stops.is_empty()).then(|| Paint::RadialGradient {
                cx: fill.get("cx").and_then(Value::as_f64).unwrap_or(0.5) as f32,
                cy: fill.get("cy").and_then(Value::as_f64).unwrap_or(0.5) as f32,
                size: fill.get("size").and_then(Value::as_str).map(str::to_string),
                stops,
            })
        }
        _ => resolve_color(fill.get("color"), tokens).map(|color| Paint::Solid {
            color,
            token_id: color_token_id(fill.get("color")),
        }),
    }
}

fn convert_typography(
    style: Option<&Value>,
    tokens: &HashMap<String, Color>,
    text: Option<&str>,
) -> Option<Typography> {
    let typo = style?.get("typography")?;
    if !typo.is_object() && text.is_none() {
        return None;
    }
    let fill_color = style
        .and_then(|s| s.get("fills"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|fill| resolve_color(fill.get("color"), tokens));
    Some(Typography {
        family: typo
            .get("family")
            .and_then(|v| v.as_str())
            .unwrap_or("System")
            .trim()
            .to_string(),
        size: typo.get("size").and_then(|v| v.as_f64()).unwrap_or(16.0) as f32,
        weight: typo
            .get("weight")
            .and_then(|v| v.as_u64())
            .unwrap_or(400) as u16,
        line_height: typo.get("lineHeight").and_then(|v| v.as_f64()).map(|v| v as f32),
        letter_spacing: typo
            .get("letterSpacing")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32,
        color: fill_color.unwrap_or(Color::rgb(0xf1, 0xf2, 0xf6)),
        color_token: style
            .and_then(|value| value.get("fills"))
            .and_then(Value::as_array)
            .and_then(|fills| fills.first())
            .and_then(|paint| color_token_id(paint.get("color"))),
        align: match typo.get("align").and_then(|v| v.as_str()) {
            Some("center") => TextAlign::Center,
            Some("right") | Some("end") => TextAlign::Right,
            Some("justify") => TextAlign::Justify,
            _ => TextAlign::Left,
        },
        transform: match typo.get("transform").and_then(Value::as_str) {
            Some("uppercase") => TextTransform::Uppercase,
            Some("lowercase") => TextTransform::Lowercase,
            Some("capitalize") => TextTransform::Capitalize,
            _ => TextTransform::None,
        },
        decoration: match typo.get("decoration").and_then(Value::as_str) {
            Some("underline") => TextDecoration::Underline,
            Some("line-through") | Some("line_through") => TextDecoration::LineThrough,
            _ => TextDecoration::None,
        },
        wrap: typo.get("wrap").and_then(Value::as_bool).unwrap_or(true),
    })
}

fn convert_transition(value: Option<&Value>) -> Option<Transition> {
    let value = value?;
    if value.is_null() {
        return None;
    }
    Some(Transition {
        duration_ms: value
            .get("duration")
            .and_then(|v| v.as_f64())
            .unwrap_or(300.0) as f32,
        easing: value
            .get("easing")
            .and_then(|v| v.as_str())
            .unwrap_or(if parse_cubic_bezier(value.get("easing")).is_some() {
                "cubic-bezier"
            } else {
                "ease-out"
            })
            .to_string(),
        delay_ms: value.get("delay").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
        cubic_bezier: parse_cubic_bezier(value.get("easing")),
        properties: value
            .get("properties")
            .and_then(Value::as_array)
            .map(|properties| {
                properties
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_else(|| vec!["all".into()]),
    })
}

fn convert_responsive(
    value: Option<&Value>,
    tokens: &HashMap<String, Color>,
) -> ResponsiveMap {
    let Some(obj) = value.and_then(|v| v.as_object()) else {
        return ResponsiveMap::new();
    };
    let mut map = ResponsiveMap::new();
    for (bp, patch) in obj {
        if let Some(override_patch) = convert_override_patch(patch, tokens) {
            map.insert(bp.clone(), override_patch);
        }
    }
    map
}

fn resolve_color(value: Option<&Value>, tokens: &HashMap<String, Color>) -> Option<Color> {
    let value = value?;
    if let Some(token) = value.get("token").and_then(|v| v.as_str()) {
        return tokens.get(token).copied().or_else(|| {
            // Unresolved token — soft gray so import still succeeds.
            Some(Color::rgb(0x80, 0x80, 0x80))
        });
    }
    parse_color_value(Some(value), tokens)
}

fn color_token_id(value: Option<&Value>) -> Option<String> {
    value?
        .get("token")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn parse_color_value(value: Option<&Value>, tokens: &HashMap<String, Color>) -> Option<Color> {
    let value = value?;
    if let Some(s) = value.as_str() {
        return parse_css_color(s);
    }
    if value.get("token").is_some() {
        return resolve_color(Some(value), tokens);
    }
    let r = value.get("r")?.as_f64()? as f32;
    let g = value.get("g")?.as_f64()? as f32;
    let b = value.get("b")?.as_f64()? as f32;
    let a = value.get("a").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
    // Canvas may use 0–255 or 0–1; treat >1 as 0–255.
    if r > 1.0 || g > 1.0 || b > 1.0 {
        Some(Color::rgba(r / 255.0, g / 255.0, b / 255.0, a))
    } else {
        Some(Color::rgba(r, g, b, a))
    }
}

fn parse_css_color(input: &str) -> Option<Color> {
    let s = input.trim();
    if let Some(hex) = s.strip_prefix('#') {
        return match hex.len() {
            6 => {
                let n = u32::from_str_radix(hex, 16).ok()?;
                Some(Color::rgb(
                    ((n >> 16) & 0xff) as u8,
                    ((n >> 8) & 0xff) as u8,
                    (n & 0xff) as u8,
                ))
            }
            8 => {
                let n = u32::from_str_radix(hex, 16).ok()?;
                Some(Color::rgba(
                    ((n >> 24) & 0xff) as f32 / 255.0,
                    ((n >> 16) & 0xff) as f32 / 255.0,
                    ((n >> 8) & 0xff) as f32 / 255.0,
                    (n & 0xff) as f32 / 255.0,
                ))
            }
            3 => {
                let n = u32::from_str_radix(hex, 16).ok()?;
                let r = ((n >> 8) & 0xf) as u8;
                let g = ((n >> 4) & 0xf) as u8;
                let b = (n & 0xf) as u8;
                Some(Color::rgb(r * 17, g * 17, b * 17))
            }
            _ => None,
        };
    }
    if let Some(inner) = s
        .strip_prefix("rgba(")
        .or_else(|| s.strip_prefix("rgb("))
        .and_then(|s| s.strip_suffix(')'))
    {
        let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
        if parts.len() >= 3 {
            let r: f32 = parts[0].parse().ok()?;
            let g: f32 = parts[1].parse().ok()?;
            let b: f32 = parts[2].parse().ok()?;
            let a: f32 = if parts.len() >= 4 {
                parts[3].parse().unwrap_or(1.0)
            } else {
                1.0
            };
            return Some(Color::rgba(r / 255.0, g / 255.0, b / 255.0, a));
        }
    }
    None
}

fn resolve_sizes(
    nodes: &mut HashMap<NodeId, Node>,
    pending: &HashMap<String, PendingLayout>,
    root_page_id: &NodeId,
) {
    // Resolve each page tree; also resolve orphan components with a synthetic parent size.
    let page_ids: Vec<NodeId> = nodes
        .values()
        .filter(|n| n.is_root_frame())
        .map(|n| n.id.clone())
        .collect();

    for page_id in &page_ids {
        let pending_page = pending
            .get(page_id.as_str())
            .cloned()
            .unwrap_or_else(|| PendingLayout {
                x: 0.0,
                y: 0.0,
                width: Dim::Px(1440.0),
                height: Dim::Px(900.0),
                mode: LayoutMode::Flex,
                direction: FlexDirection::Column,
                align: LayoutAlign::Stretch,
                justify: LayoutJustify::Start,
                gap: 0.0,
                wrap: false,
                columns: 2,
                padding: Insets::default(),
                position: LayoutPosition::Absolute,
                min_width: None,
                max_width: None,
                min_height: None,
                max_height: None,
                aspect_ratio: None,
                align_self: None,
                grow: 0.0,
                shrink: None,
                viewport_width: Some(1440.0),
                viewport_min_height: Some(900.0),
            });
        let viewport_width = pending_page.viewport_width.unwrap_or(1440.0);
        let viewport_height = pending_page.viewport_min_height.unwrap_or(900.0);
        let w = match pending_page.width {
            Dim::Px(value) => value,
            Dim::Percent(value) => viewport_width * value / 100.0,
            Dim::Fill | Dim::Hug => viewport_width,
        };
        let h = match pending_page.height {
            Dim::Px(value) => value,
            Dim::Percent(value) => viewport_height * value / 100.0,
            Dim::Fill | Dim::Hug => viewport_height,
        };
        if let Some(page) = nodes.get_mut(page_id) {
            page.layout.width = w;
            page.layout.height = h;
            apply_pending_meta(&mut page.layout, &pending_page);
        }
        resolve_subtree(nodes, pending, page_id, w, h);
    }

    // Orphan components / roots not under a page.
    let orphans: Vec<NodeId> = nodes
        .values()
        .filter(|n| n.parent_id.is_none() && !n.is_root_frame())
        .map(|n| n.id.clone())
        .collect();
    for id in orphans {
        let Some(p) = pending.get(id.as_str()).cloned() else {
            resolve_subtree(nodes, pending, &id, 1440.0, 900.0);
            continue;
        };
        let estimate = estimate_hug(nodes.get(&id));
        let (mut w, mut h) =
            concrete_dim(&p.width, &p.height, 1440.0, 900.0, Some(estimate));
        w = w.max(1.0);
        h = h.max(1.0);
        if let Some(node) = nodes.get_mut(&id) {
            node.layout.x = p.x;
            node.layout.y = p.y;
            node.layout.width = w;
            node.layout.height = h;
            apply_pending_meta(&mut node.layout, &p);
        }
        resolve_subtree(nodes, pending, &id, w, h);
        if matches!(p.width, Dim::Hug) || matches!(p.height, Dim::Hug) {
            if let Some((nw, nh)) = measure_from_children(nodes, &id, &p) {
                if let Some(node) = nodes.get_mut(&id) {
                    if matches!(p.width, Dim::Hug) {
                        node.layout.width = nw.max(1.0);
                    }
                    if matches!(p.height, Dim::Hug) {
                        node.layout.height = nh.max(1.0);
                    }
                }
                let (fw, fh) = nodes
                    .get(&id)
                    .map(|n| (n.layout.width, n.layout.height))
                    .unwrap_or((w, h));
                resolve_subtree(nodes, pending, &id, fw, fh);
            }
        }
        let _ = root_page_id;
    }
}

fn resolve_subtree(
    nodes: &mut HashMap<NodeId, Node>,
    pending: &HashMap<String, PendingLayout>,
    parent_id: &NodeId,
    parent_w: f64,
    parent_h: f64,
) {
    let parent_pad = nodes
        .get(parent_id)
        .map(|n| n.layout.padding)
        .unwrap_or_default();
    let inner_w = (parent_w - parent_pad.left as f64 - parent_pad.right as f64).max(0.0);
    let inner_h = (parent_h - parent_pad.top as f64 - parent_pad.bottom as f64).max(0.0);

    let child_ids: Vec<NodeId> = nodes
        .values()
        .filter(|n| n.parent_id.as_ref() == Some(parent_id))
        .map(|n| n.id.clone())
        .collect();

    // Bottom-up: resolve hug children that are containers first by recursion after sizing.
    for child_id in &child_ids {
        let Some(p) = pending.get(child_id.as_str()) else {
            continue;
        };
        let estimate = estimate_hug(nodes.get(child_id));
        let (mut w, mut h) =
            concrete_dim(&p.width, &p.height, inner_w, inner_h, Some(estimate));
        if let Some(min) = p.min_width {
            w = w.max(min);
        }
        if let Some(max) = p.max_width {
            w = w.min(max);
        }
        w = w.max(1.0);
        h = h.max(1.0);

        if let Some(node) = nodes.get_mut(child_id) {
            node.layout.x = p.x;
            node.layout.y = p.y;
            node.layout.width = w;
            node.layout.height = h;
            apply_pending_meta(&mut node.layout, p);
        }

        resolve_subtree(nodes, pending, child_id, w, h);

        // If this node was hug, remeasure from children after they resolved.
        if matches!(p.width, Dim::Hug) || matches!(p.height, Dim::Hug) {
            if let Some((nw, nh)) = measure_from_children(nodes, child_id, p) {
                if let Some(node) = nodes.get_mut(child_id) {
                    if matches!(p.width, Dim::Hug) {
                        node.layout.width = nw.max(1.0);
                    }
                    if matches!(p.height, Dim::Hug) {
                        node.layout.height = nh.max(1.0);
                    }
                }
                let (fw, fh) = nodes
                    .get(child_id)
                    .map(|n| (n.layout.width, n.layout.height))
                    .unwrap_or((w, h));
                // Re-resolve children against updated hug size (fill descendants).
                if matches!(p.width, Dim::Hug) || matches!(p.height, Dim::Hug) {
                    resolve_subtree(nodes, pending, child_id, fw, fh);
                }
            }
        }
    }
}

fn estimate_hug(node: Option<&Node>) -> (f64, f64) {
    let Some(node) = node else {
        return (120.0, 40.0);
    };
    if node.kind == NodeKind::Text {
        return node.estimate_text_size();
    }
    if node.kind == NodeKind::Rectangle {
        return (24.0, 24.0);
    }
    (120.0, 40.0)
}

fn concrete_dim(
    width: &Dim,
    height: &Dim,
    parent_w: f64,
    parent_h: f64,
    hug_estimate: Option<(f64, f64)>,
) -> (f64, f64) {
    let (ew, eh) = hug_estimate.unwrap_or((120.0, 40.0));
    let w = match width {
        Dim::Px(v) => *v,
        Dim::Percent(v) => parent_w * *v / 100.0,
        Dim::Fill => parent_w.max(1.0),
        Dim::Hug => ew,
    };
    let h = match height {
        Dim::Px(v) => *v,
        Dim::Percent(v) => parent_h * *v / 100.0,
        Dim::Fill => parent_h.max(1.0),
        Dim::Hug => eh,
    };
    (w, h)
}

fn measure_from_children(
    nodes: &HashMap<NodeId, Node>,
    parent_id: &NodeId,
    pending: &PendingLayout,
) -> Option<(f64, f64)> {
    let parent = nodes.get(parent_id)?;
    let children: Vec<&Node> = nodes
        .values()
        .filter(|n| n.parent_id.as_ref() == Some(parent_id) && !n.hidden)
        .collect();
    if children.is_empty() {
        return None;
    }
    let pad = parent.layout.padding;
    let gap = pending.gap as f64;
    let is_row = pending.direction == FlexDirection::Row
        && matches!(pending.mode, LayoutMode::Flex | LayoutMode::Grid);

    if matches!(pending.mode, LayoutMode::Absolute) {
        let mut max_r = 0.0_f64;
        let mut max_b = 0.0_f64;
        for child in &children {
            max_r = max_r.max(child.layout.x + child.layout.width);
            max_b = max_b.max(child.layout.y + child.layout.height);
        }
        return Some((
            max_r + pad.right as f64,
            max_b + pad.bottom as f64,
        ));
    }

    if is_row {
        let main: f64 = children.iter().map(|c| c.layout.width).sum::<f64>()
            + gap * children.len().saturating_sub(1) as f64;
        let cross = children
            .iter()
            .map(|c| c.layout.height)
            .fold(0.0_f64, f64::max);
        Some((
            main + pad.left as f64 + pad.right as f64,
            cross + pad.top as f64 + pad.bottom as f64,
        ))
    } else {
        let main: f64 = children.iter().map(|c| c.layout.height).sum::<f64>()
            + gap * children.len().saturating_sub(1) as f64;
        let cross = children
            .iter()
            .map(|c| c.layout.width)
            .fold(0.0_f64, f64::max);
        Some((
            cross + pad.left as f64 + pad.right as f64,
            main + pad.top as f64 + pad.bottom as f64,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_canvas_export_wrapper() {
        let json = r##"{
          "schema": "loora.canvas",
          "version": 2,
          "document": {
            "schemaVersion": 2,
            "id": "doc_canvas_1",
            "name": "Export Sample",
            "breakpoints": [{"id":"mobile","name":"Mobile","minWidth":0}],
            "tokens": {
              "accent": {"id":"accent","name":"Accent","type":"color","value":"#1e3dea"}
            },
            "nodes": {
              "page_1": {
                "id":"page_1","type":"page","name":"Home","parentId":null,
                "order":1024,"hidden":false,"locked":false,"rotation":0,
                "layout":{"position":"absolute","x":0,"y":0,"width":{"unit":"px","value":1440},"height":{"unit":"hug"},"mode":"flex","direction":"column"},
                "style":{"fills":[{"type":"solid","color":{"token":"accent"}}],"radius":0,"shadows":[],"opacity":1},
                "viewport":{"width":1440,"minHeight":900}
              },
              "frame_1": {
                "id":"frame_1","type":"frame","name":"Hero","parentId":"page_1",
                "order":1024,"hidden":false,"locked":false,"rotation":0,
                "layout":{"position":"flow","x":0,"y":0,"width":{"unit":"fill"},"height":{"unit":"hug"},"mode":"flex","direction":"row","padding":{"top":16,"right":16,"bottom":16,"left":16},"gap":8,"align":"center"},
                "style":{"fills":[],"radius":8,"shadows":[{"x":0,"y":8,"blur":24,"spread":0,"color":"rgba(0,0,0,0.4)"}],"opacity":1}
              },
              "text_1": {
                "id":"text_1","type":"text","name":"Title","parentId":"frame_1",
                "order":1024,"hidden":false,"locked":false,"rotation":0,
                "text":"Hello",
                "layout":{"position":"flow","x":0,"y":0,"width":{"unit":"hug"},"height":{"unit":"hug"},"mode":"absolute"},
                "style":{"fills":[{"type":"solid","color":{"token":"accent"}}],"radius":0,"shadows":[],"opacity":1,
                  "typography":{"family":"Inter","size":24,"weight":600,"lineHeight":1.2,"align":"left"}}
              }
            }
          }
        }"##;

        let doc = parse_design_bytes(json.as_bytes()).unwrap();
        assert_eq!(doc.id, "doc_canvas_1");
        assert_eq!(doc.name, "Export Sample");
        assert_eq!(doc.nodes.len(), 3);
        assert_eq!(doc.root_page_id.as_str(), "page_1");
        assert_eq!(doc.tokens.len(), 1);
        let page = doc.nodes.get(&NodeId::from_static("page_1")).unwrap();
        assert_eq!(page.kind, NodeKind::Frame);
        assert!(page.is_root_frame());
        assert!((page.layout.width - 1440.0).abs() < f64::EPSILON);
        let frame = doc.nodes.get(&NodeId::from_static("frame_1")).unwrap();
        assert!(frame.layout.width > 100.0);
        assert_eq!(frame.style.corners.tl, 8.0);
        assert_eq!(frame.style.shadows.len(), 1);
        let text = doc.nodes.get(&NodeId::from_static("text_1")).unwrap();
        assert_eq!(text.text.as_deref(), Some("Hello"));
        assert!(text.typography.is_some());
    }

    #[test]
    fn peek_id_from_canvas_wrapper() {
        let json = br#"{"schema":"loora.canvas","version":2,"document":{"id":"abc","schemaVersion":2,"name":"X","nodes":{}}}"#;
        assert_eq!(peek_design_id(json).unwrap(), "abc");
    }
}
