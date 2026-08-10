use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use loora_engine::{
    export_page_svg, standalone_html, AnimationKeyframe, AnimationTrigger, ApplyOptions,
    CanvasEngine, CanvasTheme, Color, Corners, DesignStore, DesignToken, Document,
    DocumentAnimation, FlexDirection, GradientStop, HtmlCanvasOptions, ImageFit, Insets, Layout,
    LayoutAlign, LayoutJustify, LayoutMode, LayoutPosition, MotionTransform, Node, NodeAnimation,
    NodeId, NodeKind, Operation, Overflow, PageViewport, Paint, Shadow, ShapeKind, SizeMode,
    StateValue, Stroke, StrokeStyle, Style, TextAlign, TextDecoration, TextTransform, Transaction,
    Transition, Typography, VisualState, VisualStates, DEFAULT_ORDER_STEP,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum UiEffect {
    #[default]
    None,
    DocumentChanged,
    DocumentReplaced,
    FocusNodes(Vec<String>),
    FocusCanvas,
}

#[derive(Clone, Debug)]
pub struct Execution {
    pub value: Value,
    pub effect: UiEffect,
}

impl Execution {
    fn new(value: Value) -> Self {
        Self {
            value,
            effect: UiEffect::None,
        }
    }

    fn with_effect(value: Value, effect: UiEffect) -> Self {
        Self { value, effect }
    }
}

pub fn execute_tool(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    name: &str,
    arguments: &Value,
) -> Result<Execution, String> {
    match name {
        "getUsage" => Ok(Execution::new(json!({
            "local": true,
            "used": 0,
            "included": null,
            "remaining": null,
            "resetAt": null,
            "message": "Local MCP calls are unlimited and never leave this device."
        }))),
        "listDesigns" => list_designs(engine, store),
        "getDesignContext" => get_design_context(engine, store, arguments),
        "readTree" => read_tree(engine, store, arguments),
        "readNode" => read_node(engine, store, arguments),
        "searchNodes" => search_nodes(engine, store, arguments),
        "createPage" => create_page(engine, store, arguments),
        "insertNodes" => insert_nodes(engine, store, arguments),
        "patchNodes" => patch_nodes(engine, store, arguments),
        "moveNodes" => move_nodes(engine, store, arguments),
        "deleteNodes" => delete_nodes(engine, store, arguments),
        "createComponent" => create_component(engine, store, arguments),
        "createInstance" => create_instance(engine, store, arguments),
        "setTokens" => set_tokens(engine, store, arguments),
        "setAnimations" => set_animations(engine, store, arguments),
        "animateNodes" => animate_nodes(engine, store, arguments),
        "exportCode" => export_code(engine, store, arguments),
        "getScreenshot" => get_screenshot(engine, store, arguments),
        "viewNode" => view_node(engine, store, arguments),
        "viewPage" => view_page(engine, store, arguments),
        "viewCanvas" => view_canvas(engine, store, arguments),
        "createDesign" => create_design(engine, store, arguments),
        "renameDesign" => rename_design(engine, store, arguments),
        "deleteDesign" => delete_design(engine, store, arguments),
        "listBranches" => list_branches(store, arguments),
        "createBranch" => create_branch(engine, store, arguments),
        "proposeBranch" => set_branch_status(store, arguments, "proposed"),
        "reopenBranch" => set_branch_status(store, arguments, "open"),
        "compareBranch" => compare_branch(store, arguments),
        "applyBranch" => apply_branch(engine, store, arguments),
        "closeBranch" => close_branch(store, arguments),
        "listVersions" => list_versions(engine, store, arguments),
        "listAssets" => list_assets(store),
        _ => Err(format!("Unknown local MCP tool {name}")),
    }
}

fn list_designs(engine: &CanvasEngine, store: &DesignStore) -> Result<Execution, String> {
    let active_id = &engine.document().id;
    let designs = store
        .list()
        .map_err(|error| format!("list local designs: {error}"))?
        .into_iter()
        .map(|design| {
            json!({
                "id": design.id,
                "name": design.name,
                "active": design.id == *active_id,
                "updatedAt": design.updated_at,
                "url": format!("loora://design/{}", design.id),
            })
        })
        .collect::<Vec<_>>();
    Ok(Execution::new(json!({"designs": designs, "local": true})))
}

fn get_design_context(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let document = load_target_document(engine, store, arguments)?;
    let depth = arguments.get("depth").and_then(Value::as_u64).unwrap_or(4) as usize;
    let pages = page_ids(&document)
        .into_iter()
        .filter_map(|id| document.nodes.get(&id))
        .map(node_summary)
        .collect::<Vec<_>>();
    let components = sorted_nodes(&document)
        .into_iter()
        .filter(|node| node.kind == NodeKind::Component)
        .map(node_summary)
        .collect::<Vec<_>>();
    let tree = build_forest(&document, None, depth, None);
    Ok(Execution::new(json!({
        "target": {
            "designId": document.id,
            "draftId": arguments.get("draftId").cloned().unwrap_or(Value::Null),
            "local": true,
        },
        "design": {"id": document.id, "name": document.name},
        "revision": document_revision(&document),
        "responsive": {"breakpoints": document.breakpoints},
        "tokens": document.tokens,
        "themes": document.themes,
        "activeThemeId": document.active_theme_id,
        "pages": pages,
        "components": components,
        "tree": tree,
    })))
}

fn read_tree(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let document = load_target_document(engine, store, arguments)?;
    let depth = arguments.get("depth").and_then(Value::as_u64).unwrap_or(6) as usize;
    let root = arguments.get("root").map(node_id_from_ref).transpose()?;
    let tree = match root {
        Some(root) => vec![tree_node(&document, &root, depth, None)?],
        None => build_forest(&document, None, depth, None),
    };
    Ok(Execution::new(json!({
        "designId": document.id,
        "revision": document_revision(&document),
        "tree": tree,
    })))
}

fn read_node(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let document = load_target_document(engine, store, arguments)?;
    let id = node_id_from_ref(required(arguments, "ref")?)?;
    let node = document
        .nodes
        .get(&id)
        .ok_or_else(|| format!("Node {id} was not found"))?;
    Ok(Execution::new(json!({
        "designId": document.id,
        "revision": document_revision(&document),
        "ref": node_ref(&id),
        "node": node,
        "absoluteBounds": absolute_bounds(&document, &id),
    })))
}

fn search_nodes(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let document = load_target_document(engine, store, arguments)?;
    let query = string(arguments, "query")?.to_lowercase();
    let types = arguments
        .get("types")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let matches = sorted_nodes(&document)
        .into_iter()
        .filter(|node| {
            (types.is_empty() || types.contains(tool_node_type(node)))
                && (node.name.to_lowercase().contains(&query)
                    || node
                        .text
                        .as_deref()
                        .is_some_and(|text| text.to_lowercase().contains(&query)))
        })
        .map(node_summary)
        .collect::<Vec<_>>();
    Ok(Execution::new(
        json!({"matches": matches, "count": matches.len()}),
    ))
}

fn create_page(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let mut page = Node::root_frame(string(arguments, "name")?);
        page.layout.x = number_or(arguments, "x", 0.0);
        page.layout.y = number_or(arguments, "y", 0.0);
        page.layout.width = number_or(arguments, "width", 1440.0).max(1.0);
        page.layout.height = number_or(arguments, "minHeight", 900.0).max(1.0);
        page.viewport = Some(PageViewport {
            width: page.layout.width,
            min_height: page.layout.height,
        });
        if let Some(layout) = arguments.get("layout") {
            apply_layout_patch(&mut page.layout, layout)?;
        }
        if let Some(style) = arguments.get("style") {
            apply_style_and_typography(&mut page, style, working.document())?;
        }
        page.states = parse_states(arguments.get("states"))?;
        page.order = next_order(working.document(), None);
        let page_id = page.id.clone();
        let mut operations = vec![Operation::Insert { node: page }];
        let mut refs = HashMap::new();
        if let Some(children) = arguments.get("children").and_then(Value::as_array) {
            append_descriptors(
                working.document(),
                &page_id,
                children,
                &mut operations,
                &mut refs,
            )?;
        }
        working
            .apply(
                Transaction::new("MCP: create page", operations),
                ApplyOptions::default(),
            )
            .map_err(|error| error.to_string())?;
        working.reflow();
        Ok((
            json!({"page": node_ref(&page_id), "refs": refs}),
            Some(UiEffect::FocusNodes(vec![page_id.to_string()])),
        ))
    })
}

fn insert_nodes(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let parent = node_id_from_ref(required(arguments, "parent")?)?;
        if !working.document().nodes.contains_key(&parent) {
            return Err(format!("Parent node {parent} was not found"));
        }
        let descriptors = required(arguments, "nodes")?
            .as_array()
            .ok_or("nodes must be an array")?;
        let mut operations = Vec::new();
        let mut refs = HashMap::new();
        append_descriptors(
            working.document(),
            &parent,
            descriptors,
            &mut operations,
            &mut refs,
        )?;
        let created = operations
            .iter()
            .filter_map(|operation| match operation {
                Operation::Insert { node } => Some(node.id.to_string()),
                _ => None,
            })
            .collect::<Vec<_>>();
        working
            .apply(
                Transaction::new("MCP: insert nodes", operations),
                ApplyOptions::default(),
            )
            .map_err(|error| error.to_string())?;
        working.reflow();
        Ok((json!({"created": created, "refs": refs}), None))
    })
}

fn patch_nodes(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let changes = required(arguments, "changes")?
            .as_array()
            .ok_or("changes must be an array")?;
        let mut document = working.document().clone();
        let tokens = document.tokens.clone();
        let theme_id = document.active_theme_id.clone();
        let mut changed = Vec::new();
        for change in changes {
            let id = node_id_from_ref(required(change, "ref")?)?;
            let patch = required(change, "patch")?;
            let node = document
                .nodes
                .get_mut(&id)
                .ok_or_else(|| format!("Node {id} was not found"))?;
            apply_node_patch(node, patch, &tokens, &theme_id)?;
            changed.push(id.to_string());
        }
        working.replace_document(document);
        Ok((json!({"changed": changed}), None))
    })
}

fn move_nodes(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let changes = required(arguments, "changes")?
            .as_array()
            .ok_or("changes must be an array")?;
        let mut document = working.document().clone();
        let mut moved = Vec::new();
        for change in changes {
            let id = NodeId::from(string(change, "nodeId")?);
            if id == document.root_page_id {
                return Err("The active root page cannot be moved".into());
            }
            let parent_id = match change.get("parentId") {
                Some(Value::String(parent)) => {
                    let parent = NodeId::from(parent.as_str());
                    if !document.nodes.contains_key(&parent) {
                        return Err(format!("Parent node {parent} was not found"));
                    }
                    Some(parent)
                }
                Some(Value::Null) | None => None,
                _ => return Err("parentId must be a node id or null".into()),
            };
            if parent_id
                .as_ref()
                .is_some_and(|parent| is_descendant(&document, parent, &id))
            {
                return Err(format!("Cannot move {id} inside its own descendant"));
            }
            let fallback_order = next_order(&document, parent_id.as_ref());
            let node = document
                .nodes
                .get_mut(&id)
                .ok_or_else(|| format!("Node {id} was not found"))?;
            node.parent_id = parent_id;
            node.order = change
                .get("order")
                .and_then(Value::as_f64)
                .unwrap_or(fallback_order);
            moved.push(id.to_string());
        }
        working.replace_document(document);
        Ok((json!({"moved": moved}), None))
    })
}

fn delete_nodes(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    if arguments.get("confirmed").and_then(Value::as_bool) != Some(true) {
        return Err("deleteNodes requires confirmed: true".into());
    }
    mutate_target(engine, store, arguments, |working| {
        let ids = required(arguments, "nodeIds")?
            .as_array()
            .ok_or("nodeIds must be an array")?
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(NodeId::from)
                    .ok_or("nodeIds must contain strings")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut deleted = Vec::new();
        for id in ids {
            if id == *working.root_page_id() {
                return Err("The active root page cannot be deleted".into());
            }
            if working.node(&id).is_some() {
                working
                    .delete_node(&id)
                    .map_err(|error| error.to_string())?;
                deleted.push(id.to_string());
            }
        }
        working.reflow();
        Ok((json!({"deleted": deleted}), None))
    })
}

fn create_component(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let parent = working.root_page_id().clone();
        let mut component = Node::component(
            string(arguments, "name")?,
            parent.clone(),
            Layout::new(
                0.0,
                0.0,
                number_or(arguments, "width", 320.0),
                number_or(arguments, "height", 200.0),
            ),
        );
        if let Some(layout) = arguments.get("layout") {
            apply_layout_patch(&mut component.layout, layout)?;
        }
        if let Some(style) = arguments.get("style") {
            apply_style_and_typography(&mut component, style, working.document())?;
        }
        component.states = parse_states(arguments.get("states"))?;
        if let Some(variants) = arguments.get("variants").and_then(Value::as_array) {
            component.component_variants = variants
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            component.default_variant = component.component_variants.first().cloned();
            component.variant = component.default_variant.clone();
        }
        component.order = next_order(working.document(), Some(&parent));
        let component_id = component.id.clone();
        let mut operations = vec![Operation::Insert { node: component }];
        let mut refs = HashMap::new();
        if let Some(children) = arguments.get("children").and_then(Value::as_array) {
            append_descriptors(
                working.document(),
                &component_id,
                children,
                &mut operations,
                &mut refs,
            )?;
        }
        working
            .apply(
                Transaction::new("MCP: create component", operations),
                ApplyOptions::default(),
            )
            .map_err(|error| error.to_string())?;
        working.reflow();
        Ok((
            json!({"component": node_ref(&component_id), "refs": refs}),
            Some(UiEffect::FocusNodes(vec![component_id.to_string()])),
        ))
    })
}

fn create_instance(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let parent = node_id_from_ref(required(arguments, "parent")?)?;
        let component = NodeId::from(string(arguments, "componentId")?);
        let mut instance = Node::instance(
            arguments
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Instance"),
            parent.clone(),
            Layout::new(0.0, 0.0, 320.0, 200.0),
            component.to_string(),
        );
        if let Some(layout) = arguments.get("layout") {
            apply_layout_patch(&mut instance.layout, layout)?;
        }
        if let Some(style) = arguments.get("style") {
            apply_style_and_typography(&mut instance, style, working.document())?;
        }
        instance.variant = arguments
            .get("variant")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| Some("Default".into()));
        instance.order = next_order(working.document(), Some(&parent));
        let id = instance.id.clone();
        working
            .apply(
                Transaction::new(
                    "MCP: create instance",
                    vec![Operation::Insert { node: instance }],
                ),
                ApplyOptions::default(),
            )
            .map_err(|error| error.to_string())?;
        working.reflow();
        Ok((
            json!({"instance": node_ref(&id)}),
            Some(UiEffect::FocusNodes(vec![id.to_string()])),
        ))
    })
}

fn set_tokens(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let mut document = working.document().clone();
        if let Some(themes) = arguments.get("themes").and_then(Value::as_array) {
            document.themes = themes
                .iter()
                .map(|theme| {
                    Ok(CanvasTheme {
                        id: string(theme, "id")?.to_owned(),
                        name: string(theme, "name")?.to_owned(),
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
        }
        if let Some(tokens) = arguments.get("tokens").and_then(Value::as_array) {
            document.tokens = tokens
                .iter()
                .map(parse_token)
                .collect::<Result<Vec<_>, _>>()?;
        }
        if let Some(theme) = arguments.get("activeThemeId").and_then(Value::as_str) {
            if !document
                .themes
                .iter()
                .any(|candidate| candidate.id == theme)
            {
                return Err(format!("Theme {theme} does not exist in this design"));
            }
            document.active_theme_id = theme.to_owned();
        }
        rebind_document_token_colors(&mut document);
        let value = json!({
            "themes": document.themes,
            "tokens": document.tokens,
            "activeThemeId": document.active_theme_id,
        });
        working.replace_document(document);
        Ok((value, None))
    })
}

fn set_animations(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let mut document = working.document().clone();
        if let Some(remove) = arguments.get("remove").and_then(Value::as_array) {
            let ids = remove
                .iter()
                .filter_map(Value::as_str)
                .collect::<HashSet<_>>();
            document
                .animations
                .retain(|animation| !ids.contains(animation.id.as_str()));
        }
        if let Some(presets) = arguments.get("presets").and_then(Value::as_array) {
            for preset in presets.iter().filter_map(Value::as_str) {
                let animation = animation_preset(preset)?;
                upsert_animation(&mut document.animations, animation);
            }
        }
        if let Some(animations) = arguments.get("animations").and_then(Value::as_array) {
            for value in animations {
                upsert_animation(&mut document.animations, parse_animation(value)?);
            }
        }
        let animations = document.animations.clone();
        working.replace_document(document);
        Ok((json!({"animations": animations}), None))
    })
}

fn animate_nodes(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    mutate_target(engine, store, arguments, |working| {
        let refs = required(arguments, "refs")?
            .as_array()
            .ok_or("refs must be an array")?
            .iter()
            .map(node_id_from_ref)
            .collect::<Result<Vec<_>, _>>()?;
        let mut document = working.document().clone();
        let transition = arguments
            .get("transition")
            .map(parse_transition)
            .transpose()?;
        for (index, id) in refs.iter().enumerate() {
            let node = document
                .nodes
                .get_mut(id)
                .ok_or_else(|| format!("Node {id} was not found"))?;
            if arguments.get("clear").and_then(Value::as_bool) == Some(true) {
                node.visual_states = None;
                node.transition = None;
                node.animations.clear();
                continue;
            }
            let mut states = node.visual_states.clone().unwrap_or_default();
            if let Some(hover) = arguments.get("hover") {
                states.hover = Some(parse_visual_state(hover)?);
            }
            if let Some(press) = arguments.get("press") {
                states.press = Some(parse_visual_state(press)?);
            }
            if let Some(focus) = arguments.get("focus") {
                states.focus = Some(parse_visual_state(focus)?);
            }
            if states != VisualStates::default() {
                node.visual_states = Some(states);
            }
            if let Some(transition) = &transition {
                node.transition = Some(transition.clone());
            }
            if let Some(play) = arguments.get("play") {
                let values = play
                    .as_array()
                    .cloned()
                    .unwrap_or_else(|| vec![play.clone()]);
                node.animations = values
                    .iter()
                    .map(parse_node_animation)
                    .collect::<Result<Vec<_>, _>>()?;
                if let Some(stagger) = arguments.get("stagger").and_then(Value::as_f64) {
                    for animation in &mut node.animations {
                        animation.delay_ms += duration_ms(stagger) * index as f32;
                    }
                }
            }
        }
        working.replace_document(document);
        Ok((json!({"animated": refs}), None))
    })
}

fn export_code(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let document = load_target_document(engine, store, arguments)?;
    let format = arguments
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or("html");
    let code = if format == "svg" {
        let page = arguments
            .get("pageId")
            .and_then(Value::as_str)
            .map(NodeId::from);
        export_page_svg(&document, page.as_ref())
    } else {
        standalone_html(&document, &HtmlCanvasOptions::default())
    };
    Ok(Execution::new(json!({
        "format": if format == "svg" { "svg" } else { "html" },
        "code": code,
        "local": true,
    })))
}

fn get_screenshot(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let document = load_target_document(engine, store, arguments)?;
    let page = arguments
        .get("pageId")
        .and_then(Value::as_str)
        .map(NodeId::from);
    let svg = export_page_svg(&document, page.as_ref());
    let encoded = base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());
    Ok(Execution::new(json!({
        "mimeType": "image/svg+xml",
        "data": encoded,
        "width": arguments.get("width").cloned().unwrap_or(Value::Null),
        "local": true,
        "_mcpContent": [
            {"type": "image", "mimeType": "image/svg+xml", "data": encoded},
            {"type": "text", "text": "Vector screenshot rendered from the live local canvas."}
        ]
    })))
}

fn view_node(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    ensure_active_target(engine, store, arguments)?;
    let id = node_id_from_ref(required(arguments, "ref")?)?;
    if !engine.document().nodes.contains_key(&id) {
        return Err(format!("Node {id} was not found"));
    }
    Ok(Execution::with_effect(
        json!({"focused": node_ref(&id)}),
        UiEffect::FocusNodes(vec![id.to_string()]),
    ))
}

fn view_page(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    ensure_active_target(engine, store, arguments)?;
    let id = NodeId::from(string(arguments, "pageId")?);
    if !page_ids(engine.document()).contains(&id) {
        return Err(format!("Page {id} was not found"));
    }
    Ok(Execution::with_effect(
        json!({"focused": node_ref(&id)}),
        UiEffect::FocusNodes(vec![id.to_string()]),
    ))
}

fn view_canvas(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    ensure_active_target(engine, store, arguments)?;
    Ok(Execution::with_effect(
        json!({"focused": "canvas"}),
        UiEffect::FocusCanvas,
    ))
}

fn create_design(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let document = store
        .create(string(arguments, "name")?)
        .map_err(|error| format!("create local design: {error}"))?;
    let id = document.id.clone();
    let name = document.name.clone();
    engine.replace_document(document);
    Ok(Execution::with_effect(
        json!({"design": {"id": id, "name": name, "url": format!("loora://design/{id}")}}),
        UiEffect::DocumentReplaced,
    ))
}

fn rename_design(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let design_id = string(arguments, "designId")?.to_owned();
    let name = string(arguments, "name")?.to_owned();
    let active = engine.document().id == design_id;
    let mut document = if active {
        engine.document().clone()
    } else {
        store
            .load(&design_id)
            .map_err(|error| format!("load design {design_id}: {error}"))?
    };
    document.name = name.clone();
    bump_document_revision(&mut document);
    store
        .save(&document)
        .map_err(|error| format!("save renamed design: {error}"))?;
    if active {
        engine.replace_document(document);
    }
    Ok(Execution::with_effect(
        json!({"design": {"id": design_id, "name": name}}),
        if active {
            UiEffect::DocumentChanged
        } else {
            UiEffect::None
        },
    ))
}

fn delete_design(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    if arguments.get("confirmed").and_then(Value::as_bool) != Some(true) {
        return Err("deleteDesign requires confirmed: true".into());
    }
    let design_id = string(arguments, "designId")?.to_owned();
    let active = engine.document().id == design_id;
    store
        .delete(&design_id)
        .map_err(|error| format!("delete local design: {error}"))?;
    let effect = if active {
        let replacement = store
            .load_or_create_default()
            .map_err(|error| format!("open a replacement design: {error}"))?;
        engine.replace_document(replacement);
        UiEffect::DocumentReplaced
    } else {
        UiEffect::None
    };
    Ok(Execution::with_effect(
        json!({"deleted": design_id}),
        effect,
    ))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct BranchRecord {
    id: String,
    name: String,
    status: String,
    description: Option<String>,
    base_revision: u64,
    revision: u64,
    created_at: u64,
    document: Document,
}

fn list_branches(store: &DesignStore, arguments: &Value) -> Result<Execution, String> {
    let design_id = string(arguments, "designId")?;
    let branches = read_branches(store, design_id)?
        .into_iter()
        .map(|branch| branch_summary(&branch))
        .collect::<Vec<_>>();
    Ok(Execution::new(json!({"branches": branches})))
}

fn create_branch(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let design_id = string(arguments, "designId")?;
    let document = if engine.document().id == design_id {
        engine.document().clone()
    } else {
        store
            .load(design_id)
            .map_err(|error| format!("load design {design_id}: {error}"))?
    };
    let record = BranchRecord {
        id: NodeId::new("draft").to_string(),
        name: string(arguments, "name")?.to_owned(),
        status: "open".into(),
        description: None,
        base_revision: document_revision(&document),
        revision: 0,
        created_at: now_secs(),
        document,
    };
    write_branch(store, design_id, &record)?;
    Ok(Execution::new(json!({"branch": branch_summary(&record)})))
}

fn set_branch_status(
    store: &DesignStore,
    arguments: &Value,
    status: &str,
) -> Result<Execution, String> {
    let design_id = string(arguments, "designId")?;
    let draft_id = string(arguments, "draftId")?;
    let mut branch = read_branch(store, design_id, draft_id)?;
    branch.status = status.into();
    if status == "proposed" {
        branch.description = arguments
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    write_branch(store, design_id, &branch)?;
    Ok(Execution::new(json!({"branch": branch_summary(&branch)})))
}

fn compare_branch(store: &DesignStore, arguments: &Value) -> Result<Execution, String> {
    let design_id = string(arguments, "designId")?;
    let branch = read_branch(store, design_id, string(arguments, "draftId")?)?;
    let main = store
        .load(design_id)
        .map_err(|error| format!("load design {design_id}: {error}"))?;
    let main_ids = main.nodes.keys().cloned().collect::<HashSet<_>>();
    let draft_ids = branch
        .document
        .nodes
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    let added = draft_ids
        .difference(&main_ids)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let removed = main_ids
        .difference(&draft_ids)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let changed = main_ids
        .intersection(&draft_ids)
        .filter(|id| main.nodes.get(*id) != branch.document.nodes.get(*id))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    Ok(Execution::new(json!({
        "draftId": branch.id,
        "mainRevision": document_revision(&main),
        "draftRevision": branch.revision,
        "added": added,
        "removed": removed,
        "changed": changed,
    })))
}

fn apply_branch(
    engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let design_id = string(arguments, "designId")?;
    let draft_id = string(arguments, "draftId")?;
    let mut branch = read_branch(store, design_id, draft_id)?;
    let main = store
        .load(design_id)
        .map_err(|error| format!("load design {design_id}: {error}"))?;
    let expected_main = arguments
        .get("expectedMainRevision")
        .and_then(Value::as_u64)
        .ok_or("expectedMainRevision must be an integer")?;
    let expected_draft = arguments
        .get("expectedDraftRevision")
        .and_then(Value::as_u64)
        .ok_or("expectedDraftRevision must be an integer")?;
    if expected_main != document_revision(&main) || expected_draft != branch.revision {
        return Err(format!(
            "Branch revisions changed (main {}, draft {}); compare again before applying",
            document_revision(&main),
            branch.revision
        ));
    }
    let mut merged = branch.document.clone();
    merged.id = design_id.to_owned();
    bump_document_revision(&mut merged);
    store
        .save(&merged)
        .map_err(|error| format!("apply local branch: {error}"))?;
    branch.status = "applied".into();
    write_branch(store, design_id, &branch)?;
    let active = engine.document().id == design_id;
    if active {
        engine.replace_document(merged);
    }
    Ok(Execution::with_effect(
        json!({"applied": draft_id, "revision": document_revision(&branch.document) + 1}),
        if active {
            UiEffect::DocumentReplaced
        } else {
            UiEffect::None
        },
    ))
}

fn close_branch(store: &DesignStore, arguments: &Value) -> Result<Execution, String> {
    if arguments.get("confirmed").and_then(Value::as_bool) != Some(true) {
        return Err("closeBranch requires confirmed: true".into());
    }
    set_branch_status(store, arguments, "closed")
}

fn list_versions(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Execution, String> {
    let document = load_target_document(engine, store, arguments)?;
    let limit = arguments.get("limit").and_then(Value::as_u64).unwrap_or(25);
    Ok(Execution::new(json!({
        "versions": [{
            "revision": document_revision(&document),
            "name": document.name,
            "current": true,
            "local": true,
        }],
        "limit": limit,
        "note": "Local Loora currently keeps the live document and undo history in memory; persisted version snapshots are not created automatically."
    })))
}

fn list_assets(store: &DesignStore) -> Result<Execution, String> {
    let assets = store
        .list_assets()
        .map_err(|error| format!("list local assets: {error}"))?
        .into_iter()
        .map(|path| {
            json!({
                "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("asset"),
                "path": path,
                "url": format!("file://{}", path.display()),
            })
        })
        .collect::<Vec<_>>();
    Ok(Execution::new(json!({"assets": assets, "local": true})))
}

fn mutate_target<F>(
    active_engine: &mut CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
    mutate: F,
) -> Result<Execution, String>
where
    F: FnOnce(&mut CanvasEngine) -> Result<(Value, Option<UiEffect>), String>,
{
    let design_id = string(arguments, "designId")?.to_owned();
    let draft_id = arguments.get("draftId").and_then(Value::as_str);
    let active = draft_id.is_none() && active_engine.document().id == design_id;
    let document = if let Some(draft_id) = draft_id {
        read_branch(store, &design_id, draft_id)?.document
    } else if active {
        active_engine.document().clone()
    } else {
        store
            .load(&design_id)
            .map_err(|error| format!("load design {design_id}: {error}"))?
    };
    let mut working = CanvasEngine::new(document);
    let (value, requested_effect) = mutate(&mut working)?;
    let mut document = working.into_document();
    bump_document_revision(&mut document);
    let revision = document_revision(&document);

    if let Some(draft_id) = draft_id {
        let mut branch = read_branch(store, &design_id, draft_id)?;
        branch.document = document;
        branch.revision = branch.revision.saturating_add(1);
        write_branch(store, &design_id, &branch)?;
        return Ok(Execution::new(merge_revision(value, branch.revision)));
    }

    store
        .save(&document)
        .map_err(|error| format!("save local design {design_id}: {error}"))?;
    let effect = if active {
        active_engine.replace_document(document);
        requested_effect.unwrap_or(UiEffect::DocumentChanged)
    } else {
        UiEffect::None
    };
    Ok(Execution::with_effect(
        merge_revision(value, revision),
        effect,
    ))
}

fn merge_revision(mut value: Value, revision: u64) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("revision".into(), json!(revision));
        value
    } else {
        json!({"result": value, "revision": revision})
    }
}

fn load_target_document(
    engine: &CanvasEngine,
    store: &DesignStore,
    arguments: &Value,
) -> Result<Document, String> {
    let design_id = string(arguments, "designId")?;
    if let Some(draft_id) = arguments.get("draftId").and_then(Value::as_str) {
        return Ok(read_branch(store, design_id, draft_id)?.document);
    }
    if engine.document().id == design_id {
        Ok(engine.document().clone())
    } else {
        store
            .load(design_id)
            .map_err(|error| format!("load design {design_id}: {error}"))
    }
}

fn ensure_active_target(
    engine: &CanvasEngine,
    _store: &DesignStore,
    arguments: &Value,
) -> Result<(), String> {
    if arguments.get("draftId").is_some() {
        return Err("View tools can only focus the open Main canvas".into());
    }
    let design_id = string(arguments, "designId")?;
    if engine.document().id != design_id {
        return Err(format!(
            "Design {design_id} is not open in the desktop app; open it before using a view tool"
        ));
    }
    Ok(())
}

fn append_descriptors(
    document: &Document,
    parent: &NodeId,
    descriptors: &[Value],
    operations: &mut Vec<Operation>,
    refs: &mut HashMap<String, String>,
) -> Result<(), String> {
    let base_order = next_order_with_operations(document, parent, operations);
    for (index, descriptor) in descriptors.iter().enumerate() {
        let mut node = node_from_descriptor(document, parent, descriptor)?;
        node.order = base_order + index as f64 * DEFAULT_ORDER_STEP;
        let id = node.id.clone();
        if let Some(alias) = descriptor.get("ref").and_then(Value::as_str) {
            refs.insert(alias.to_owned(), id.to_string());
        }
        operations.push(Operation::Insert { node });
        if let Some(children) = descriptor.get("children").and_then(Value::as_array) {
            append_descriptors(document, &id, children, operations, refs)?;
        }
    }
    Ok(())
}

fn node_from_descriptor(
    document: &Document,
    parent: &NodeId,
    descriptor: &Value,
) -> Result<Node, String> {
    let kind = string(descriptor, "type")?;
    let name = descriptor
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(match kind {
            "text" => "Text",
            "shape" => "Shape",
            "image" => "Image",
            "vector" => "Vector",
            "instance" => "Instance",
            "group" => "Group",
            _ => "Frame",
        });
    let default_size = match kind {
        "text" => (200.0, 40.0),
        "image" => (320.0, 240.0),
        "shape" | "vector" => (120.0, 120.0),
        _ => (320.0, 200.0),
    };
    let mut layout = Layout::new(0.0, 0.0, default_size.0, default_size.1);
    if let Some(value) = descriptor.get("layout") {
        apply_layout_patch(&mut layout, value)?;
    }
    // Structured MCP inserts participate in parent layout unless absolute is opted into.
    // Forgetting `position: "flow"` previously left every child Absolute at (0,0).
    let position_explicit = descriptor
        .get("layout")
        .and_then(|layout| layout.get("position"))
        .is_some();
    if !position_explicit {
        layout.position = LayoutPosition::Flow;
    }
    let mut node = match kind {
        "frame" | "group" => Node::frame(name, parent.clone(), layout),
        "text" => Node::text(
            name,
            parent.clone(),
            layout,
            descriptor
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("Text"),
        ),
        "shape" => Node::rectangle(name, parent.clone(), layout),
        "vector" => Node::vector(name, parent.clone(), layout),
        "image" => Node::image(name, parent.clone(), layout),
        "instance" => Node::instance(
            name,
            parent.clone(),
            layout,
            string(descriptor, "componentId")?,
        ),
        other => return Err(format!("Unsupported node descriptor type {other}")),
    };
    if kind == "group" {
        node.style = Style::default();
    }
    let style = descriptor.get("style");
    let fills_specified = style.and_then(|value| value.get("fills")).is_some();
    // Frame defaults include an opaque fill used by the manual frame tool. MCP
    // layout frames omit fills intentionally and must stay transparent.
    if matches!(kind, "frame" | "group") && !fills_specified {
        node.style.fills.clear();
        if style.and_then(|value| value.get("radius")).is_none() {
            node.style.corners = Corners::uniform(0.0);
        }
    }
    apply_descriptor_fields(&mut node, descriptor, document)?;
    Ok(node)
}

fn apply_descriptor_fields(
    node: &mut Node,
    descriptor: &Value,
    document: &Document,
) -> Result<(), String> {
    if let Some(style) = descriptor.get("style") {
        apply_style_and_typography(node, style, document)?;
    }
    if let Some(hidden) = descriptor.get("hidden").and_then(Value::as_bool) {
        node.hidden = hidden;
    }
    if let Some(locked) = descriptor.get("locked").and_then(Value::as_bool) {
        node.locked = locked;
    }
    if let Some(rotation) = descriptor.get("rotation").and_then(Value::as_f64) {
        node.rotation = rotation as f32;
    }
    if let Some(tag) = descriptor.get("semanticTag").and_then(Value::as_str) {
        node.semantic_tag = Some(tag.into());
    }
    if let Some(shape) = descriptor.get("shape").and_then(Value::as_str) {
        node.shape_kind = match shape {
            "ellipse" => ShapeKind::Ellipse,
            "line" => ShapeKind::Line,
            _ => ShapeKind::Rectangle,
        };
    }
    if let Some(src) = descriptor.get("src").and_then(Value::as_str) {
        node.image_path = Some(src.into());
    }
    if let Some(alt) = descriptor.get("alt").and_then(Value::as_str) {
        node.image_alt = alt.into();
    }
    if let Some(fit) = descriptor.get("fit").and_then(Value::as_str) {
        node.image_fit = match fit {
            "contain" => ImageFit::Contain,
            "fill" => ImageFit::Fill,
            _ => ImageFit::Cover,
        };
    }
    if let Some(variant) = descriptor.get("variant").and_then(Value::as_str) {
        node.variant = Some(variant.into());
    }
    if let Some(view_box) = descriptor.get("viewBox").and_then(Value::as_str) {
        node.vector_view_box = Some(view_box.into());
    }
    if let Some(paths) = descriptor.get("paths") {
        node.paths = parse_paths(paths, &document.tokens, &document.active_theme_id)?;
    }
    node.interactions =
        parse_json_with_camel_case(descriptor.get("interactions"))?.unwrap_or_default();
    node.responsive = parse_json_with_camel_case(descriptor.get("responsive"))?.unwrap_or_default();
    Ok(())
}

fn apply_node_patch(
    node: &mut Node,
    patch: &Value,
    tokens: &[DesignToken],
    theme_id: &str,
) -> Result<(), String> {
    if let Some(name) = patch.get("name").and_then(Value::as_str) {
        node.name = name.into();
    }
    if let Some(hidden) = patch.get("hidden").and_then(Value::as_bool) {
        node.hidden = hidden;
    }
    if let Some(locked) = patch.get("locked").and_then(Value::as_bool) {
        node.locked = locked;
    }
    if let Some(order) = patch.get("order").and_then(Value::as_f64) {
        node.order = order;
    }
    if let Some(text) = patch.get("text").and_then(Value::as_str) {
        node.text = Some(text.into());
    }
    if let Some(rotation) = patch.get("rotation").and_then(Value::as_f64) {
        node.rotation = rotation as f32;
    }
    if let Some(layout) = patch.get("layout") {
        apply_layout_patch(&mut node.layout, layout)?;
    }
    if let Some(style) = patch.get("style") {
        apply_style_patch(&mut node.style, style, tokens, theme_id)?;
        if let Some(typography) = style.get("typography") {
            let current = node.typography.clone().unwrap_or_default();
            node.typography = Some(parse_typography(typography, current, tokens, theme_id)?);
            node.font_size = node.typography.as_ref().unwrap().size;
        }
    }
    if let Some(tag) = patch.get("semanticTag").and_then(Value::as_str) {
        node.semantic_tag = Some(tag.into());
    }
    if let Some(src) = patch.get("src") {
        node.image_path = src.as_str().map(str::to_owned);
    }
    if let Some(alt) = patch.get("alt").and_then(Value::as_str) {
        node.image_alt = alt.into();
    }
    if let Some(fit) = patch.get("fit").and_then(Value::as_str) {
        node.image_fit = match fit {
            "contain" => ImageFit::Contain,
            "fill" => ImageFit::Fill,
            _ => ImageFit::Cover,
        };
    }
    if let Some(component) = patch.get("componentId") {
        node.component_id = component.as_str().map(str::to_owned);
    }
    if let Some(variant) = patch.get("variant") {
        node.variant = variant.as_str().map(str::to_owned);
    }
    if let Some(shape) = patch.get("shape").and_then(Value::as_str) {
        node.shape_kind = match shape {
            "ellipse" => ShapeKind::Ellipse,
            "line" => ShapeKind::Line,
            _ => ShapeKind::Rectangle,
        };
    }
    if let Some(paths) = patch.get("paths") {
        node.paths = parse_paths(paths, tokens, theme_id)?;
    }
    if let Some(view_box) = patch.get("viewBox") {
        node.vector_view_box = view_box.as_str().map(str::to_owned);
    }
    if let Some(viewport) = patch.get("viewport") {
        node.viewport = parse_json_with_camel_case(Some(viewport))?;
    }
    if let Some(states) = patch.get("states") {
        node.states = parse_states(Some(states))?;
    }
    if let Some(metadata) = patch.get("metadata") {
        node.metadata = metadata.clone();
    }
    if let Some(variants) = patch.get("variants").and_then(Value::as_array) {
        node.component_variants = variants
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
    }
    if let Some(default_variant) = patch.get("defaultVariant") {
        node.default_variant = default_variant.as_str().map(str::to_owned);
    }
    if let Some(value) = patch.get("interactions") {
        node.interactions = parse_json_with_camel_case(Some(value))?.unwrap_or_default();
    }
    if let Some(value) = patch.get("responsive") {
        node.responsive = parse_json_with_camel_case(Some(value))?.unwrap_or_default();
    }
    if let Some(value) = patch.get("visualStates") {
        node.visual_states = Some(parse_visual_states(value)?);
    }
    if let Some(value) = patch.get("transition") {
        node.transition = Some(parse_transition(value)?);
    }
    if let Some(value) = patch.get("animations") {
        node.animations = value
            .as_array()
            .ok_or("animations must be an array")?
            .iter()
            .map(parse_node_animation)
            .collect::<Result<Vec<_>, _>>()?;
    }
    Ok(())
}

fn apply_layout_patch(layout: &mut Layout, value: &Value) -> Result<(), String> {
    let value = parse_json_value(value)?;
    if let Some(position) = value.get("position").and_then(Value::as_str) {
        layout.position = if position == "flow" {
            LayoutPosition::Flow
        } else {
            LayoutPosition::Absolute
        };
    }
    if let Some(x) = value.get("x").and_then(Value::as_f64) {
        layout.x = x;
    }
    if let Some(y) = value.get("y").and_then(Value::as_f64) {
        layout.y = y;
    }
    if let Some(width) = value.get("width") {
        apply_length(width, true, layout)?;
    }
    if let Some(height) = value.get("height") {
        apply_length(height, false, layout)?;
    }
    if let Some(mode) = value.get("mode").and_then(Value::as_str) {
        layout.mode = match mode {
            "flex" => LayoutMode::Flex,
            "grid" => LayoutMode::Grid,
            _ => LayoutMode::Absolute,
        };
    }
    if let Some(direction) = value.get("direction").and_then(Value::as_str) {
        layout.direction = if direction == "column" {
            FlexDirection::Column
        } else {
            FlexDirection::Row
        };
    }
    if let Some(value) = value.get("align").and_then(Value::as_str) {
        layout.align = parse_align(value);
    }
    if let Some(value) = value.get("alignSelf").and_then(Value::as_str) {
        layout.align_self = Some(parse_align(value));
    }
    if let Some(value) = value.get("justify").and_then(Value::as_str) {
        layout.justify = match value {
            "center" => LayoutJustify::Center,
            "end" => LayoutJustify::End,
            "space-between" => LayoutJustify::SpaceBetween,
            "space-around" => LayoutJustify::SpaceAround,
            _ => LayoutJustify::Start,
        };
    }
    if let Some(gap) = value.get("gap").and_then(Value::as_f64) {
        layout.gap = gap as f32;
    }
    if let Some(wrap) = value.get("wrap").and_then(Value::as_bool) {
        layout.wrap = wrap;
    }
    if let Some(columns) = value.get("columns").and_then(Value::as_u64) {
        layout.columns = columns as u32;
    }
    if let Some(grow) = value.get("grow").and_then(Value::as_f64) {
        layout.grow = grow as f32;
    }
    if let Some(shrink) = value.get("shrink") {
        layout.shrink = shrink.as_f64().map(|number| number as f32);
    }
    if let Some(padding) = value.get("padding") {
        layout.padding = Insets {
            top: number_or(padding, "top", 0.0) as f32,
            right: number_or(padding, "right", 0.0) as f32,
            bottom: number_or(padding, "bottom", 0.0) as f32,
            left: number_or(padding, "left", 0.0) as f32,
        };
    }
    apply_optional_number(&value, "minWidth", &mut layout.min_width);
    apply_optional_number(&value, "maxWidth", &mut layout.max_width);
    apply_optional_number(&value, "minHeight", &mut layout.min_height);
    apply_optional_number(&value, "maxHeight", &mut layout.max_height);
    apply_optional_number(&value, "aspectRatio", &mut layout.aspect_ratio);
    Ok(())
}

fn apply_optional_number(value: &Value, key: &str, target: &mut Option<f64>) {
    if let Some(value) = value.get(key) {
        *target = value.as_f64();
    }
}

fn apply_length(value: &Value, width: bool, layout: &mut Layout) -> Result<(), String> {
    let object = value.as_object().ok_or("Canvas length must be an object")?;
    let unit = object
        .get("unit")
        .and_then(Value::as_str)
        .ok_or("Canvas length needs unit")?;
    let (mode, concrete, percent) = match unit {
        "px" => (
            SizeMode::Fixed,
            object.get("value").and_then(Value::as_f64),
            None,
        ),
        "percent" => (
            SizeMode::Percent,
            None,
            object.get("value").and_then(Value::as_f64),
        ),
        "fill" => (SizeMode::Fill, None, None),
        "hug" => (SizeMode::Hug, None, None),
        other => return Err(format!("Unsupported canvas length unit {other}")),
    };
    if width {
        layout.width_mode = mode;
        layout.width_percent = percent;
        if let Some(value) = concrete {
            layout.width = value.max(1.0);
        }
    } else {
        layout.height_mode = mode;
        layout.height_percent = percent;
        if let Some(value) = concrete {
            layout.height = value.max(1.0);
        }
    }
    Ok(())
}

fn apply_style_and_typography(
    node: &mut Node,
    value: &Value,
    document: &Document,
) -> Result<(), String> {
    apply_style_patch(
        &mut node.style,
        value,
        &document.tokens,
        &document.active_theme_id,
    )?;
    let parsed = parse_json_value(value)?;
    if let Some(typography) = parsed.get("typography") {
        node.typography = Some(parse_typography(
            typography,
            node.typography.clone().unwrap_or_default(),
            &document.tokens,
            &document.active_theme_id,
        )?);
        node.font_size = node.typography.as_ref().unwrap().size;
    }
    Ok(())
}

fn apply_style_patch(
    style: &mut Style,
    value: &Value,
    tokens: &[DesignToken],
    theme_id: &str,
) -> Result<(), String> {
    let value = parse_json_value(value)?;
    if let Some(fills) = value.get("fills").and_then(Value::as_array) {
        style.fills = fills
            .iter()
            .map(|paint| parse_paint(paint, tokens, theme_id))
            .collect::<Result<Vec<_>, _>>()?;
    }
    if let Some(stroke) = value.get("stroke") {
        style.stroke = if stroke.is_null() {
            None
        } else {
            let (color, token_id) =
                parse_color_or_token(required(stroke, "color")?, tokens, theme_id)?;
            Some(Stroke {
                color,
                token_id,
                width: number_or(stroke, "width", 1.0) as f32,
                style: match stroke.get("style").and_then(Value::as_str) {
                    Some("dashed") => StrokeStyle::Dashed,
                    Some("dotted") => StrokeStyle::Dotted,
                    _ => StrokeStyle::Solid,
                },
            })
        };
    }
    if let Some(radius) = value.get("radius") {
        style.corners = if let Some(radius) = radius.as_f64() {
            Corners::uniform(radius as f32)
        } else if let Some(values) = radius.as_array() {
            if values.len() != 4 {
                return Err("radius tuple must contain four numbers".into());
            }
            Corners {
                tl: values[0].as_f64().unwrap_or(0.0) as f32,
                tr: values[1].as_f64().unwrap_or(0.0) as f32,
                br: values[2].as_f64().unwrap_or(0.0) as f32,
                bl: values[3].as_f64().unwrap_or(0.0) as f32,
            }
        } else {
            return Err("radius must be a number or four-number tuple".into());
        };
    }
    if let Some(opacity) = value.get("opacity").and_then(Value::as_f64) {
        style.opacity = opacity.clamp(0.0, 1.0) as f32;
    }
    if let Some(overflow) = value.get("overflow").and_then(Value::as_str) {
        style.overflow = match overflow {
            "hidden" => Overflow::Hidden,
            "auto" => Overflow::Auto,
            _ => Overflow::Visible,
        };
    }
    if let Some(blend_mode) = value.get("blendMode") {
        style.blend_mode = blend_mode.as_str().map(str::to_owned);
    }
    if let Some(shadows) = value.get("shadows").and_then(Value::as_array) {
        style.shadows = shadows
            .iter()
            .map(|shadow| {
                let (color, token_id) =
                    parse_color_or_token(required(shadow, "color")?, tokens, theme_id)?;
                Ok(Shadow {
                    color,
                    token_id,
                    x: number_or(shadow, "x", 0.0) as f32,
                    y: number_or(shadow, "y", 0.0) as f32,
                    blur: number_or(shadow, "blur", 0.0) as f32,
                    spread: number_or(shadow, "spread", 0.0) as f32,
                    inset: shadow
                        .get("inset")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
    }
    Ok(())
}

fn parse_paint(value: &Value, tokens: &[DesignToken], theme_id: &str) -> Result<Paint, String> {
    match value.get("type").and_then(Value::as_str).unwrap_or("solid") {
        "solid" => {
            let (color, token_id) =
                parse_color_or_token(required(value, "color")?, tokens, theme_id)?;
            Ok(Paint::Solid { color, token_id })
        }
        "linear-gradient" => {
            let stops = required(value, "stops")?
                .as_array()
                .ok_or("gradient stops must be an array")?
                .iter()
                .map(|stop| {
                    let (color, token_id) =
                        parse_color_or_token(required(stop, "color")?, tokens, theme_id)?;
                    Ok(GradientStop {
                        offset: number_or(stop, "offset", 0.0) as f32,
                        color,
                        token_id,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok(Paint::LinearGradient {
                angle: number_or(value, "angle", 0.0) as f32,
                stops,
            })
        }
        other => Err(format!("Unsupported paint type {other}")),
    }
}

fn parse_typography(
    value: &Value,
    mut typography: Typography,
    tokens: &[DesignToken],
    theme_id: &str,
) -> Result<Typography, String> {
    if let Some(value) = value.get("family").and_then(Value::as_str) {
        typography.family = value.into();
    }
    if let Some(value) = value.get("size").and_then(Value::as_f64) {
        typography.size = value as f32;
    }
    if let Some(value) = value.get("weight").and_then(Value::as_u64) {
        typography.weight = value as u16;
    }
    if let Some(value) = value.get("lineHeight") {
        typography.line_height = value.as_f64().map(|value| value as f32);
    }
    if let Some(value) = value.get("letterSpacing").and_then(Value::as_f64) {
        typography.letter_spacing = value as f32;
    }
    if let Some(value) = value.get("align").and_then(Value::as_str) {
        typography.align = match value {
            "center" => TextAlign::Center,
            "right" => TextAlign::Right,
            "justify" => TextAlign::Justify,
            _ => TextAlign::Left,
        };
    }
    if let Some(value) = value.get("wrap").and_then(Value::as_bool) {
        typography.wrap = value;
    }
    if let Some(value) = value.get("decoration").and_then(Value::as_str) {
        typography.decoration = match value {
            "underline" => TextDecoration::Underline,
            "line-through" => TextDecoration::LineThrough,
            _ => TextDecoration::None,
        };
    }
    if let Some(value) = value.get("transform").and_then(Value::as_str) {
        typography.transform = match value {
            "uppercase" => TextTransform::Uppercase,
            "lowercase" => TextTransform::Lowercase,
            "capitalize" => TextTransform::Capitalize,
            _ => TextTransform::None,
        };
    }
    if let Some(value) = value.get("color") {
        let (color, token) = parse_color_or_token(value, tokens, theme_id)?;
        typography.color = color;
        typography.color_token = token;
    }
    Ok(typography)
}

fn parse_token(value: &Value) -> Result<DesignToken, String> {
    let token_type = string(value, "type")?.to_owned();
    let raw = required(value, "value")?.clone();
    let color = if token_type == "color" {
        parse_color(
            raw.as_str()
                .ok_or("color token value must be a color string")?,
        )?
    } else {
        Color::rgb(0x80, 0x80, 0x80)
    };
    let modes = value
        .get("modes")
        .and_then(Value::as_object)
        .map(|modes| {
            modes
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default();
    Ok(DesignToken {
        id: string(value, "id")?.into(),
        name: string(value, "name")?.into(),
        token_type,
        color,
        value: raw,
        modes,
    })
}

fn parse_color_or_token(
    value: &Value,
    tokens: &[DesignToken],
    theme_id: &str,
) -> Result<(Color, Option<String>), String> {
    if let Some(color) = value.as_str() {
        return Ok((parse_color(color)?, None));
    }
    let token = value
        .get("token")
        .and_then(Value::as_str)
        .ok_or("color must be a CSS color or token reference")?;
    let color = tokens
        .iter()
        .find(|candidate| candidate.id == token || candidate.name == token)
        .map(|candidate| candidate.color_for_theme(theme_id))
        .ok_or_else(|| format!("Color token {token} was not found"))?;
    Ok((color, Some(token.into())))
}

fn parse_color(value: &str) -> Result<Color, String> {
    let lower = value.trim().to_ascii_lowercase();
    let named = match lower.as_str() {
        "transparent" => Some(Color::rgba(0.0, 0.0, 0.0, 0.0)),
        "black" => Some(Color::rgb(0, 0, 0)),
        "white" => Some(Color::rgb(255, 255, 255)),
        "red" => Some(Color::rgb(255, 0, 0)),
        "green" => Some(Color::rgb(0, 128, 0)),
        "blue" => Some(Color::rgb(0, 0, 255)),
        _ => None,
    };
    if let Some(color) = named {
        return Ok(color);
    }
    let Some(hex) = lower.strip_prefix('#') else {
        return Err(format!(
            "Local canvas currently accepts hex colors, got {value:?}"
        ));
    };
    let expanded;
    let hex = if hex.len() == 3 || hex.len() == 4 {
        expanded = hex
            .chars()
            .flat_map(|character| [character, character])
            .collect::<String>();
        expanded.as_str()
    } else {
        hex
    };
    if hex.len() != 6 && hex.len() != 8 {
        return Err(format!("Invalid hex color {value:?}"));
    }
    let byte = |range: std::ops::Range<usize>| {
        u8::from_str_radix(&hex[range], 16).map_err(|_| format!("Invalid hex color {value:?}"))
    };
    let r = byte(0..2)?;
    let g = byte(2..4)?;
    let b = byte(4..6)?;
    let a = if hex.len() == 8 { byte(6..8)? } else { 255 };
    Ok(Color::rgba(
        r as f32 / 255.0,
        g as f32 / 255.0,
        b as f32 / 255.0,
        a as f32 / 255.0,
    ))
}

fn parse_paths(
    value: &Value,
    tokens: &[DesignToken],
    theme_id: &str,
) -> Result<Vec<loora_engine::VectorPath>, String> {
    value
        .as_array()
        .ok_or("paths must be an array")?
        .iter()
        .map(|path| {
            let (fill, fill_token) = path
                .get("fill")
                .map(|value| parse_color_or_token(value, tokens, theme_id))
                .transpose()?
                .map(|value| (Some(value.0), value.1))
                .unwrap_or((None, None));
            let (stroke, stroke_token) = path
                .get("stroke")
                .map(|value| parse_color_or_token(value, tokens, theme_id))
                .transpose()?
                .map(|value| (Some(value.0), value.1))
                .unwrap_or((None, None));
            Ok(loora_engine::VectorPath {
                d: string(path, "d")?.into(),
                fill,
                fill_token,
                stroke,
                stroke_token,
                stroke_width: path
                    .get("strokeWidth")
                    .and_then(Value::as_f64)
                    .map(|v| v as f32),
            })
        })
        .collect()
}

fn rebind_document_token_colors(document: &mut Document) {
    let theme_id = document.active_theme_id.clone();
    let resolved: HashMap<String, Color> = document
        .tokens
        .iter()
        .map(|token| (token.id.clone(), token.color_for_theme(&theme_id)))
        .collect();
    for node in document.nodes.values_mut() {
        rebind_style_token_colors(&mut node.style, &resolved);
        if let Some(typography) = node.typography.as_mut() {
            if let Some(token) = typography.color_token.as_deref() {
                if let Some(color) = resolved.get(token) {
                    typography.color = *color;
                }
            }
        }
        for path in &mut node.paths {
            if let Some(token) = path.fill_token.as_deref() {
                if let Some(color) = resolved.get(token) {
                    path.fill = Some(*color);
                }
            }
            if let Some(token) = path.stroke_token.as_deref() {
                if let Some(color) = resolved.get(token) {
                    path.stroke = Some(*color);
                }
            }
        }
    }
}

fn rebind_style_token_colors(style: &mut Style, resolved: &HashMap<String, Color>) {
    for paint in &mut style.fills {
        match paint {
            Paint::Solid { color, token_id } => {
                if let Some(token) = token_id.as_deref() {
                    if let Some(resolved) = resolved.get(token) {
                        *color = *resolved;
                    }
                }
            }
            Paint::LinearGradient { stops, .. } | Paint::RadialGradient { stops, .. } => {
                for stop in stops {
                    if let Some(token) = stop.token_id.as_deref() {
                        if let Some(resolved) = resolved.get(token) {
                            stop.color = *resolved;
                        }
                    }
                }
            }
        }
    }
    if let Some(stroke) = style.stroke.as_mut() {
        if let Some(token) = stroke.token_id.as_deref() {
            if let Some(resolved) = resolved.get(token) {
                stroke.color = *resolved;
            }
        }
    }
    for shadow in &mut style.shadows {
        if let Some(token) = shadow.token_id.as_deref() {
            if let Some(resolved) = resolved.get(token) {
                shadow.color = *resolved;
            }
        }
    }
}

fn parse_states(
    value: Option<&Value>,
) -> Result<HashMap<String, loora_engine::extras::StateDefinition>, String> {
    let Some(value) = value else {
        return Ok(HashMap::new());
    };
    let value = parse_json_value(value)?;
    value
        .as_object()
        .ok_or_else(|| "states must be an object".to_string())?
        .iter()
        .map(|(key, state)| {
            let initial = match required(state, "initial")? {
                Value::String(value) => StateValue::String(value.clone()),
                Value::Number(value) => StateValue::Number(
                    value
                        .as_f64()
                        .ok_or("number state initial value must be finite")?,
                ),
                Value::Bool(value) => StateValue::Boolean(*value),
                _ => return Err("state initial must be a string, number, or boolean".into()),
            };
            Ok((
                key.clone(),
                loora_engine::extras::StateDefinition {
                    id: state
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or(key)
                        .into(),
                    name: state
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(key)
                        .into(),
                    state_type: string(state, "type")?.into(),
                    initial,
                },
            ))
        })
        .collect()
}

fn parse_animation(value: &Value) -> Result<DocumentAnimation, String> {
    let easing = value
        .get("easing")
        .and_then(Value::as_str)
        .unwrap_or("ease-out");
    let keyframes = required(value, "keyframes")?
        .as_array()
        .ok_or("animation keyframes must be an array")?
        .iter()
        .map(|keyframe| {
            Ok(AnimationKeyframe {
                offset: number_or(keyframe, "offset", 0.0) as f32,
                opacity: keyframe
                    .get("opacity")
                    .and_then(Value::as_f64)
                    .map(|v| v as f32),
                transform: keyframe.get("transform").map(parse_transform).transpose()?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(DocumentAnimation {
        id: string(value, "id")?.into(),
        name: string(value, "name")?.into(),
        duration_ms: duration_ms(number_or(value, "duration", 0.3)),
        easing: easing.into(),
        cubic_bezier: parse_cubic_bezier(easing),
        delay_ms: duration_ms(number_or(value, "delay", 0.0)),
        keyframes,
        iterations: number_or(value, "iterations", 1.0) as f32,
        infinite: value.get("iterations").and_then(Value::as_str) == Some("infinite"),
        direction: value
            .get("direction")
            .and_then(Value::as_str)
            .unwrap_or("normal")
            .into(),
        fill: value
            .get("fill")
            .and_then(Value::as_str)
            .unwrap_or("none")
            .into(),
    })
}

fn animation_preset(name: &str) -> Result<DocumentAnimation, String> {
    let (from, to) = match name {
        "fade-in" => (
            AnimationKeyframe {
                offset: 0.0,
                opacity: Some(0.0),
                transform: None,
            },
            AnimationKeyframe {
                offset: 1.0,
                opacity: Some(1.0),
                transform: None,
            },
        ),
        "fade-in-up" => (
            AnimationKeyframe {
                offset: 0.0,
                opacity: Some(0.0),
                transform: Some(MotionTransform {
                    y: Some(24.0),
                    ..Default::default()
                }),
            },
            AnimationKeyframe {
                offset: 1.0,
                opacity: Some(1.0),
                transform: Some(MotionTransform {
                    y: Some(0.0),
                    ..Default::default()
                }),
            },
        ),
        "scale-in" => (
            AnimationKeyframe {
                offset: 0.0,
                opacity: Some(0.0),
                transform: Some(MotionTransform {
                    scale: Some(0.96),
                    ..Default::default()
                }),
            },
            AnimationKeyframe {
                offset: 1.0,
                opacity: Some(1.0),
                transform: Some(MotionTransform {
                    scale: Some(1.0),
                    ..Default::default()
                }),
            },
        ),
        other => return Err(format!("Unsupported local animation preset {other}")),
    };
    Ok(DocumentAnimation {
        id: name.into(),
        name: name.into(),
        duration_ms: 400.0,
        easing: "ease-out".into(),
        cubic_bezier: None,
        delay_ms: 0.0,
        keyframes: vec![from, to],
        iterations: 1.0,
        infinite: false,
        direction: "normal".into(),
        fill: "both".into(),
    })
}

fn upsert_animation(animations: &mut Vec<DocumentAnimation>, animation: DocumentAnimation) {
    if let Some(current) = animations
        .iter_mut()
        .find(|current| current.id == animation.id)
    {
        *current = animation;
    } else {
        animations.push(animation);
    }
}

fn parse_transform(value: &Value) -> Result<MotionTransform, String> {
    Ok(MotionTransform {
        x: value.get("x").and_then(Value::as_f64).map(|v| v as f32),
        y: value.get("y").and_then(Value::as_f64).map(|v| v as f32),
        scale: value.get("scale").and_then(Value::as_f64).map(|v| v as f32),
        scale_x: value
            .get("scaleX")
            .and_then(Value::as_f64)
            .map(|v| v as f32),
        scale_y: value
            .get("scaleY")
            .and_then(Value::as_f64)
            .map(|v| v as f32),
        rotate: value
            .get("rotate")
            .and_then(Value::as_f64)
            .map(|v| v as f32),
        skew_x: value.get("skewX").and_then(Value::as_f64).map(|v| v as f32),
        skew_y: value.get("skewY").and_then(Value::as_f64).map(|v| v as f32),
    })
}

fn parse_visual_state(value: &Value) -> Result<VisualState, String> {
    if let Some(preset) = value.as_str() {
        return match preset {
            "lift" => Ok(VisualState {
                opacity: None,
                scale: None,
                fill: None,
                transform: Some(MotionTransform {
                    y: Some(-4.0),
                    ..Default::default()
                }),
                style: None,
            }),
            "grow" => Ok(VisualState {
                scale: Some(1.03),
                ..empty_visual_state()
            }),
            "shrink" => Ok(VisualState {
                scale: Some(0.97),
                ..empty_visual_state()
            }),
            "fade" => Ok(VisualState {
                opacity: Some(0.8),
                ..empty_visual_state()
            }),
            "nudge-right" => Ok(VisualState {
                transform: Some(MotionTransform {
                    x: Some(4.0),
                    ..Default::default()
                }),
                ..empty_visual_state()
            }),
            other => Err(format!("Unsupported visual-state preset {other}")),
        };
    }
    Ok(VisualState {
        opacity: value
            .get("opacity")
            .and_then(Value::as_f64)
            .map(|v| v as f32),
        scale: value.get("scale").and_then(Value::as_f64).map(|v| v as f32),
        fill: None,
        transform: value.get("transform").map(parse_transform).transpose()?,
        style: None,
    })
}

fn empty_visual_state() -> VisualState {
    VisualState {
        opacity: None,
        scale: None,
        fill: None,
        transform: None,
        style: None,
    }
}

fn parse_visual_states(value: &Value) -> Result<VisualStates, String> {
    Ok(VisualStates {
        hover: value.get("hover").map(parse_visual_state).transpose()?,
        press: value.get("press").map(parse_visual_state).transpose()?,
        focus: value.get("focus").map(parse_visual_state).transpose()?,
    })
}

fn parse_transition(value: &Value) -> Result<Transition, String> {
    let easing = value
        .get("easing")
        .and_then(Value::as_str)
        .unwrap_or("ease-out");
    Ok(Transition {
        duration_ms: duration_ms(number_or(value, "duration", 0.3)),
        easing: easing.into(),
        delay_ms: duration_ms(number_or(value, "delay", 0.0)),
        cubic_bezier: parse_cubic_bezier(easing),
        properties: value
            .get("properties")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_else(|| vec!["all".into()]),
    })
}

fn parse_cubic_bezier(value: &str) -> Option<[f32; 4]> {
    let inner = value.strip_prefix("cubic-bezier(")?.strip_suffix(')')?;
    let values = inner
        .split(',')
        .map(|value| value.trim().parse::<f32>().ok())
        .collect::<Option<Vec<_>>>()?;
    (values.len() == 4).then(|| [values[0], values[1], values[2], values[3]])
}

fn parse_node_animation(value: &Value) -> Result<NodeAnimation, String> {
    if let Some(id) = value.as_str() {
        return Ok(NodeAnimation {
            animation_id: id.into(),
            trigger: AnimationTrigger::Load,
            delay_ms: 0.0,
            once: false,
        });
    }
    Ok(NodeAnimation {
        animation_id: string(value, "animationId")?.into(),
        trigger: match value
            .get("trigger")
            .and_then(Value::as_str)
            .unwrap_or("load")
        {
            "in-view" => AnimationTrigger::InView,
            "always" => AnimationTrigger::Always,
            "hover" => AnimationTrigger::Hover,
            "press" => AnimationTrigger::Press,
            _ => AnimationTrigger::Load,
        },
        delay_ms: duration_ms(number_or(value, "delay", 0.0)),
        once: value.get("once").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn duration_ms(value: f64) -> f32 {
    if value <= 20.0 {
        (value * 1000.0) as f32
    } else {
        value as f32
    }
}

fn page_ids(document: &Document) -> Vec<NodeId> {
    let mut pages = document
        .nodes
        .values()
        .filter(|node| node.parent_id.is_none() && node.kind == NodeKind::Frame)
        .map(|node| node.id.clone())
        .collect::<Vec<_>>();
    pages.sort_by(|left, right| {
        document.nodes[left]
            .order
            .total_cmp(&document.nodes[right].order)
            .then_with(|| left.as_str().cmp(right.as_str()))
    });
    pages
}

fn sorted_nodes(document: &Document) -> Vec<&Node> {
    let mut nodes = document.nodes.values().collect::<Vec<_>>();
    nodes.sort_by(|left, right| {
        left.order
            .total_cmp(&right.order)
            .then_with(|| left.id.as_str().cmp(right.id.as_str()))
    });
    nodes
}

fn build_forest(
    document: &Document,
    parent: Option<&NodeId>,
    depth: usize,
    skip: Option<&NodeId>,
) -> Vec<Value> {
    let mut nodes = document
        .nodes
        .values()
        .filter(|node| node.parent_id.as_ref() == parent && skip != Some(&node.id))
        .collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.order.total_cmp(&right.order));
    nodes
        .into_iter()
        .filter_map(|node| tree_node(document, &node.id, depth, skip).ok())
        .collect()
}

fn tree_node(
    document: &Document,
    id: &NodeId,
    depth: usize,
    skip: Option<&NodeId>,
) -> Result<Value, String> {
    let node = document
        .nodes
        .get(id)
        .ok_or_else(|| format!("Node {id} was not found"))?;
    let children = if depth > 1 {
        build_forest(document, Some(id), depth - 1, skip)
    } else {
        Vec::new()
    };
    Ok(json!({
        "ref": node_ref(id),
        "type": tool_node_type(node),
        "name": node.name,
        "text": node.text,
        "hidden": node.hidden,
        "locked": node.locked,
        "children": children,
        "childCount": document.nodes.values().filter(|candidate| candidate.parent_id.as_ref() == Some(id)).count(),
    }))
}

fn node_summary(node: &Node) -> Value {
    json!({
        "ref": node_ref(&node.id),
        "id": node.id,
        "name": node.name,
        "type": tool_node_type(node),
        "parentId": node.parent_id,
    })
}

fn node_ref(id: &NodeId) -> Value {
    json!({"nodeId": id, "instancePath": []})
}

fn node_id_from_ref(value: &Value) -> Result<NodeId, String> {
    if let Some(id) = value.as_str() {
        return Ok(NodeId::from(id));
    }
    if value
        .get("instancePath")
        .and_then(Value::as_array)
        .is_some_and(|path| !path.is_empty())
    {
        return Err(
            "Instance-path overrides are not yet addressable in the native local canvas".into(),
        );
    }
    value
        .get("nodeId")
        .and_then(Value::as_str)
        .map(NodeId::from)
        .ok_or_else(|| "NodeRef must be a node id string or { nodeId }".into())
}

fn tool_node_type(node: &Node) -> &'static str {
    match node.kind {
        NodeKind::Frame => {
            if node.parent_id.is_none() {
                "page"
            } else {
                "frame"
            }
        }
        NodeKind::Rectangle => "shape",
        NodeKind::Text => "text",
        NodeKind::Image => "image",
        NodeKind::Component => "component",
        NodeKind::Instance => "instance",
        NodeKind::Vector => "vector",
    }
}

fn absolute_bounds(document: &Document, id: &NodeId) -> Value {
    let Some(node) = document.nodes.get(id) else {
        return Value::Null;
    };
    let mut x = node.layout.x;
    let mut y = node.layout.y;
    let mut parent = node.parent_id.as_ref();
    let mut seen = HashSet::new();
    while let Some(id) = parent {
        if !seen.insert(id.clone()) {
            break;
        }
        let Some(node) = document.nodes.get(id) else {
            break;
        };
        x += node.layout.x;
        y += node.layout.y;
        parent = node.parent_id.as_ref();
    }
    json!({"x": x, "y": y, "width": node.layout.width, "height": node.layout.height})
}

fn next_order(document: &Document, parent: Option<&NodeId>) -> f64 {
    document
        .nodes
        .values()
        .filter(|node| node.parent_id.as_ref() == parent)
        .map(|node| node.order)
        .max_by(f64::total_cmp)
        .unwrap_or(0.0)
        + DEFAULT_ORDER_STEP
}

fn next_order_with_operations(
    document: &Document,
    parent: &NodeId,
    operations: &[Operation],
) -> f64 {
    let existing = next_order(document, Some(parent));
    let pending = operations
        .iter()
        .filter_map(|operation| match operation {
            Operation::Insert { node } if node.parent_id.as_ref() == Some(parent) => {
                Some(node.order)
            }
            _ => None,
        })
        .max_by(f64::total_cmp)
        .map(|order| order + DEFAULT_ORDER_STEP)
        .unwrap_or(0.0);
    existing.max(pending)
}

fn is_descendant(document: &Document, candidate: &NodeId, ancestor: &NodeId) -> bool {
    let mut current = Some(candidate);
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if id == ancestor {
            return true;
        }
        if !seen.insert(id.clone()) {
            return false;
        }
        current = document
            .nodes
            .get(id)
            .and_then(|node| node.parent_id.as_ref());
    }
    false
}

fn parse_align(value: &str) -> LayoutAlign {
    match value {
        "start" => LayoutAlign::Start,
        "center" => LayoutAlign::Center,
        "end" => LayoutAlign::End,
        _ => LayoutAlign::Stretch,
    }
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a Value, String> {
    value
        .get(key)
        .ok_or_else(|| format!("Missing required property {key}"))
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    required(value, key)?
        .as_str()
        .ok_or_else(|| format!("{key} must be a string"))
}

fn number_or(value: &Value, key: &str, fallback: f64) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(fallback)
}

fn parse_json_value(value: &Value) -> Result<Value, String> {
    if let Some(text) = value.as_str() {
        serde_json::from_str(text).map_err(|error| format!("invalid structured JSON: {error}"))
    } else {
        Ok(value.clone())
    }
}

fn parse_json_with_camel_case<T>(value: Option<&Value>) -> Result<Option<T>, String>
where
    T: for<'de> Deserialize<'de>,
{
    let Some(value) = value else {
        return Ok(None);
    };
    let value = camel_to_snake_value(parse_json_value(value)?);
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("invalid structured canvas value: {error}"))
}

fn camel_to_snake_value(value: Value) -> Value {
    match value {
        Value::Array(values) => {
            Value::Array(values.into_iter().map(camel_to_snake_value).collect())
        }
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| (camel_to_snake(&key), camel_to_snake_value(value)))
                .collect(),
        ),
        value => value,
    }
}

fn camel_to_snake(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_ascii_uppercase() {
            result.push('_');
            result.push(character.to_ascii_lowercase());
        } else if character == '-' {
            result.push('_');
        } else {
            result.push(character);
        }
    }
    result
}

fn document_revision(document: &Document) -> u64 {
    document
        .metadata
        .get("mcpRevision")
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn bump_document_revision(document: &mut Document) {
    let revision = document_revision(document).saturating_add(1);
    if !document.metadata.is_object() {
        document.metadata = Value::Object(Map::new());
    }
    document
        .metadata
        .as_object_mut()
        .unwrap()
        .insert("mcpRevision".into(), json!(revision));
}

fn branches_dir(store: &DesignStore, design_id: &str) -> PathBuf {
    store.designs_dir().join(".mcp-branches").join(design_id)
}

fn branch_path(store: &DesignStore, design_id: &str, draft_id: &str) -> PathBuf {
    branches_dir(store, design_id).join(format!("{draft_id}.json"))
}

fn write_branch(store: &DesignStore, design_id: &str, branch: &BranchRecord) -> Result<(), String> {
    let dir = branches_dir(store, design_id);
    fs::create_dir_all(&dir).map_err(|error| format!("create local branch directory: {error}"))?;
    let path = branch_path(store, design_id, &branch.id);
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(branch)
        .map_err(|error| format!("serialize local branch: {error}"))?;
    fs::write(&temp, bytes).map_err(|error| format!("write local branch: {error}"))?;
    fs::rename(&temp, &path).map_err(|error| format!("publish local branch: {error}"))
}

fn read_branch(
    store: &DesignStore,
    design_id: &str,
    draft_id: &str,
) -> Result<BranchRecord, String> {
    let path = branch_path(store, design_id, draft_id);
    let bytes = fs::read(&path).map_err(|error| format!("load branch {draft_id}: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("parse branch {draft_id}: {error}"))
}

fn read_branches(store: &DesignStore, design_id: &str) -> Result<Vec<BranchRecord>, String> {
    let dir = branches_dir(store, design_id);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut branches = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|error| format!("list local branches: {error}"))? {
        let path = entry
            .map_err(|error| format!("read local branch entry: {error}"))?
            .path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let bytes = fs::read(&path).map_err(|error| format!("read local branch: {error}"))?;
        if let Ok(branch) = serde_json::from_slice(&bytes) {
            branches.push(branch);
        }
    }
    branches.sort_by(|left: &BranchRecord, right: &BranchRecord| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(branches)
}

fn branch_summary(branch: &BranchRecord) -> Value {
    json!({
        "id": branch.id,
        "draftId": branch.id,
        "name": branch.name,
        "status": branch.status,
        "description": branch.description,
        "baseRevision": branch.base_revision,
        "revision": branch.revision,
        "createdAt": branch.created_at,
    })
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (PathBuf, DesignStore, CanvasEngine) {
        let root = std::env::temp_dir().join(NodeId::new("loora-mcp-test").to_string());
        let store = DesignStore::open_at(root.clone()).unwrap();
        let document = store.create("MCP Test").unwrap();
        let engine = CanvasEngine::new(document);
        (root, store, engine)
    }

    #[test]
    fn parses_hex_colors() {
        assert_eq!(parse_color("#fff").unwrap(), Color::rgb(255, 255, 255));
        assert_eq!(
            parse_color("#7aa2f7").unwrap(),
            Color::rgb(0x7a, 0xa2, 0xf7)
        );
        assert!(parse_color("url(javascript:bad)").is_err());
    }

    #[test]
    fn layout_patch_maps_fill_and_flex() {
        let mut layout = Layout::new(0.0, 0.0, 10.0, 10.0);
        apply_layout_patch(
            &mut layout,
            &json!({
                "position": "flow",
                "width": {"unit": "fill"},
                "height": {"unit": "hug"},
                "mode": "flex",
                "direction": "column",
                "gap": 12,
            }),
        )
        .unwrap();
        assert_eq!(layout.position, LayoutPosition::Flow);
        assert_eq!(layout.width_mode, SizeMode::Fill);
        assert_eq!(layout.height_mode, SizeMode::Hug);
        assert_eq!(layout.mode, LayoutMode::Flex);
        assert_eq!(layout.direction, FlexDirection::Column);
        assert_eq!(layout.gap, 12.0);
    }

    #[test]
    fn descriptors_create_nested_native_nodes() {
        let document = Document::empty("Test");
        let parent = document.root_page_id.clone();
        let mut operations = Vec::new();
        let mut refs = HashMap::new();
        append_descriptors(
            &document,
            &parent,
            &[json!({
                "ref": "card",
                "type": "frame",
                "children": [{"ref": "title", "type": "text", "text": "Hello"}]
            })],
            &mut operations,
            &mut refs,
        )
        .unwrap();
        assert_eq!(operations.len(), 2);
        assert!(refs.contains_key("card"));
        assert!(refs.contains_key("title"));
    }

    #[test]
    fn descriptors_default_to_flow_without_opaque_frame_fill() {
        let document = Document::empty("Test");
        let parent = document.root_page_id.clone();
        let mut operations = Vec::new();
        let mut refs = HashMap::new();
        append_descriptors(
            &document,
            &parent,
            &[json!({
                "ref": "hero",
                "type": "frame",
                "layout": {
                    "mode": "flex",
                    "direction": "column",
                    "width": {"unit": "fill"},
                    "height": {"unit": "hug"}
                },
                "children": [{
                    "ref": "title",
                    "type": "text",
                    "text": "Loora",
                    "layout": {
                        "width": {"unit": "hug"},
                        "height": {"unit": "hug"}
                    }
                }]
            })],
            &mut operations,
            &mut refs,
        )
        .unwrap();

        let hero_id = refs.get("hero").unwrap();
        let hero = operations
            .iter()
            .find_map(|operation| match operation {
                Operation::Insert { node } if node.id.to_string() == *hero_id => Some(node),
                _ => None,
            })
            .unwrap();
        assert_eq!(hero.layout.position, LayoutPosition::Flow);
        assert_eq!(hero.layout.width_mode, SizeMode::Fill);
        assert!(hero.style.fills.is_empty());
        assert_eq!(hero.style.corners.tl, 0.0);

        let title_id = refs.get("title").unwrap();
        let title = operations
            .iter()
            .find_map(|operation| match operation {
                Operation::Insert { node } if node.id.to_string() == *title_id => Some(node),
                _ => None,
            })
            .unwrap();
        assert_eq!(title.layout.position, LayoutPosition::Flow);
    }

    #[test]
    fn insert_nodes_reflows_flex_fill_children() {
        let (root, store, mut engine) = temp_store();
        let design_id = engine.document().id.clone();
        let page = execute_tool(
            &mut engine,
            &store,
            "createPage",
            &json!({
                "designId": design_id,
                "name": "Home",
                "width": 1280,
                "minHeight": 900,
                "layout": {
                    "mode": "flex",
                    "direction": "column",
                    "align": "stretch"
                },
                "style": {
                    "fills": [{"type": "solid", "color": "#0e0f0e"}]
                },
                "children": [{
                    "ref": "nav",
                    "type": "frame",
                    "name": "Nav",
                    "layout": {
                        "mode": "flex",
                        "direction": "row",
                        "width": {"unit": "fill"},
                        "height": {"unit": "hug"},
                        "padding": {"top": 20, "right": 20, "bottom": 20, "left": 20}
                    },
                    "children": [{
                        "type": "text",
                        "text": "Loora",
                        "layout": {
                            "width": {"unit": "hug"},
                            "height": {"unit": "hug"}
                        },
                        "style": {
                            "typography": {"family": "Geist", "size": 22, "weight": 500},
                            "fills": [{"type": "solid", "color": "#ffffff"}]
                        }
                    }]
                }]
            }),
        )
        .unwrap();

        let page_id = page.value["page"]["nodeId"].as_str().unwrap().to_string();
        let nav_id = page.value["refs"]["nav"].as_str().unwrap().to_string();
        let nav = engine
            .document()
            .nodes
            .get(&NodeId::from(nav_id.as_str()))
            .unwrap();
        assert_eq!(nav.layout.position, LayoutPosition::Flow);
        assert!(nav.style.fills.is_empty());
        // Fill width should resolve against the page content box.
        assert!(
            (nav.layout.width - 1280.0).abs() < 1.0,
            "nav width {}",
            nav.layout.width
        );
        assert!(nav.layout.height > 20.0, "nav height {}", nav.layout.height);
        assert!(nav.layout.y.abs() < f64::EPSILON);

        let page_node = engine
            .document()
            .nodes
            .get(&NodeId::from(page_id.as_str()))
            .unwrap();
        assert_eq!(page_node.layout.mode, LayoutMode::Flex);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn token_colors_resolve_active_theme_mode() {
        let (root, store, mut engine) = temp_store();
        let design_id = engine.document().id.clone();
        execute_tool(
            &mut engine,
            &store,
            "setTokens",
            &json!({
                "designId": design_id,
                "themes": [
                    {"id": "light", "name": "Light"},
                    {"id": "dark", "name": "Dark"}
                ],
                "activeThemeId": "dark",
                "tokens": [{
                    "id": "text",
                    "name": "Text",
                    "type": "color",
                    "value": "#111111",
                    "modes": {"dark": "#f2f1ec"}
                }]
            }),
        )
        .unwrap();

        let page = execute_tool(
            &mut engine,
            &store,
            "createPage",
            &json!({
                "designId": design_id,
                "name": "Themed",
                "children": [{
                    "ref": "label",
                    "type": "text",
                    "text": "Hi",
                    "style": {
                        "fills": [{"type": "solid", "color": {"token": "text"}}]
                    }
                }]
            }),
        )
        .unwrap();
        let label_id = page.value["refs"]["label"].as_str().unwrap().to_string();
        let label = engine
            .document()
            .nodes
            .get(&NodeId::from(label_id.as_str()))
            .unwrap();
        let Paint::Solid { color, token_id } = &label.style.fills[0] else {
            panic!("expected solid fill");
        };
        assert_eq!(token_id.as_deref(), Some("text"));
        assert!((color.r - 0xF2 as f32 / 255.0).abs() < 0.01);
        assert!((color.g - 0xF1 as f32 / 255.0).abs() < 0.01);
        assert!((color.b - 0xEC as f32 / 255.0).abs() < 0.01);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mcp_mutations_update_and_persist_the_live_document() {
        let (root, store, mut engine) = temp_store();
        let design_id = engine.document().id.clone();
        let created = execute_tool(
            &mut engine,
            &store,
            "createPage",
            &json!({
                "designId": design_id,
                "name": "Dashboard",
                "width": 1200,
                "minHeight": 800,
                "children": [{
                    "ref": "headline",
                    "type": "text",
                    "text": "Live from MCP",
                    "layout": {"position": "flow", "width": {"unit": "hug"}, "height": {"unit": "hug"}}
                }]
            }),
        )
        .unwrap();

        assert!(matches!(created.effect, UiEffect::FocusNodes(_)));
        assert!(engine
            .document()
            .nodes
            .values()
            .any(|node| node.text.as_deref() == Some("Live from MCP")));
        let persisted = store.load(&design_id).unwrap();
        assert_eq!(persisted.nodes.len(), engine.document().nodes.len());
        assert_eq!(document_revision(&persisted), 1);

        fs::remove_dir_all(root).unwrap();
    }
}
