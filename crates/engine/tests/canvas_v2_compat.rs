use loora_engine::{
    canvas_import::parse_design_bytes, AnimationTrigger, CanvasAction, InteractionTrigger,
    NodeId, NodeKind, Paint, ShapeKind, SizeMode, TextAlign, TextDecoration, TextTransform,
};

fn base_layout(width: serde_json::Value, height: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "position": "flow", "x": 0, "y": 0,
        "width": width, "height": height, "mode": "absolute"
    })
}

fn base_style() -> serde_json::Value {
    serde_json::json!({
        "fills": [], "radius": 0, "shadows": [], "opacity": 1,
        "overflow": "visible"
    })
}

#[test]
fn imports_and_resolves_canvas_v2_feature_contract() {
    let px = |value| serde_json::json!({"unit":"px", "value":value});
    let mut nodes = serde_json::Map::new();
    nodes.insert(
        "page".into(),
        serde_json::json!({
            "id":"page", "type":"page", "name":"Page", "parentId":null,
            "order":1024, "layout": {
                "position":"absolute", "x":0, "y":0,
                "width":px(1440), "height":{"unit":"hug"},
                "mode":"flex", "direction":"column"
            },
            "style":base_style(), "viewport":{"width":1440,"minHeight":900},
            "states": {
                "count":{"id":"count","name":"Count","type":"number","initial":0},
                "open":{"id":"open","name":"Open","type":"boolean","initial":false}
            },
            "responsive":{}, "interactions":[]
        }),
    );
    nodes.insert(
        "group".into(),
        serde_json::json!({
            "id":"group", "type":"group", "name":"Group", "parentId":"page",
            "order":1024, "layout":{
                "position":"flow", "x":0, "y":0,
                "width":{"unit":"percent","value":75}, "height":px(300),
                "mode":"flex", "direction":"row", "gap":20
            },
            "style":{
                "fills":[{"type":"solid","color":{"token":"accent"}}],
                "radius":[4,8,12,16], "shadows":[], "opacity":1,
                "overflow":"hidden", "blendMode":"multiply"
            },
            "responsive":{
                "mobile":{"layout":{"width":{"unit":"percent","value":50},"direction":"column","gap":8},"style":{"opacity":0.8}},
                "desktop":{"layout":{"gap":24}}
            },
            "visualStates":{
                "hover":{"style":{"opacity":0.7},"transform":{"x":2,"y":-1,"scale":1.02}},
                "press":{"transform":{"scale":0.98}},
                "focus":{"style":{"fills":[{"type":"solid","color":"#ffffff"}]}}
            },
            "transition":{"duration":160,"delay":10,"easing":{"cubicBezier":[0.2,0,0,1]},"properties":["colors","transform"]},
            "animations":[{"animationId":"fade","trigger":"in-view","delay":25,"once":true}],
            "interactions":[{
                "trigger":"state-change", "stateId":"open",
                "when":[{"stateId":"open","operator":"equals","value":true}],
                "actions":[
                    {"type":"navigate","pageId":"page"},
                    {"type":"open-url","url":"https://example.com","target":"_self"},
                    {"type":"visibility","nodeId":"image","value":"toggle"},
                    {"type":"open-overlay","pageId":"page"},
                    {"type":"close-overlay"},
                    {"type":"set-variant","instanceId":"instance","variant":"Hover"},
                    {"type":"set-state","stateId":"open","value":true},
                    {"type":"toggle-state","stateId":"open"},
                    {"type":"increment-state","stateId":"count","amount":2},
                    {"type":"set-theme","themeId":"dark"}
                ]
            }],
            "metadata":{"source":"test"}
        }),
    );
    nodes.insert(
        "text".into(),
        serde_json::json!({
            "id":"text", "type":"text", "name":"Text", "parentId":"group",
            "order":1024, "text":"Hello world", "runs":[{
                "start":0,"end":5,"typography":{"weight":700,"decoration":"underline"},"color":{"token":"accent"}
            }],
            "layout":base_layout(serde_json::json!({"unit":"hug"}), serde_json::json!({"unit":"hug"})),
            "style":{
                "fills":[{"type":"solid","color":"#112233"}],"radius":0,"shadows":[],"opacity":1,
                "typography":{"family":"Inter, sans-serif","size":24,"weight":600,"lineHeight":1.3,"letterSpacing":0.5,"align":"justify","wrap":false,"decoration":"line-through","transform":"uppercase"}
            },
            "responsive":{},"interactions":[]
        }),
    );
    nodes.insert(
        "ellipse".into(),
        serde_json::json!({
            "id":"ellipse","type":"shape","shape":"ellipse","name":"Ellipse","parentId":"group","order":2048,
            "layout":base_layout(px(100),px(100)),
            "style":{"fills":[{"type":"radial-gradient","cx":0.25,"cy":0.75,"size":"circle","stops":[{"offset":0,"color":"#ffffff"},{"offset":1,"color":"#000000"}]}],"radius":0,"shadows":[],"opacity":1},
            "responsive":{},"interactions":[]
        }),
    );
    nodes.insert(
        "line".into(),
        serde_json::json!({
            "id":"line","type":"shape","shape":"line","name":"Line","parentId":"group","order":3072,
            "layout":base_layout(px(100),px(2)),"style":base_style(),"responsive":{},"interactions":[]
        }),
    );
    nodes.insert(
        "vector".into(),
        serde_json::json!({
            "id":"vector","type":"vector","name":"Vector","parentId":"group","order":4096,
            "layout":base_layout(px(24),px(24)),"style":base_style(),"viewBox":"0 0 24 24",
            "paths":[{"d":"M0 0 L24 0 L24 24 Z","fill":{"token":"accent"},"stroke":"#fff","strokeWidth":2}],
            "responsive":{},"interactions":[]
        }),
    );
    nodes.insert(
        "image".into(),
        serde_json::json!({
            "id":"image","type":"image","name":"Image","parentId":"group","order":5120,
            "layout":base_layout(px(120),px(80)),"style":base_style(),
            "src":"https://example.com/image.png","alt":"Example","fit":"contain",
            "responsive":{},"interactions":[]
        }),
    );
    nodes.insert(
        "component".into(),
        serde_json::json!({
            "id":"component","type":"component","name":"Button","parentId":null,"order":1024,
            "layout":base_layout(px(100),px(40)),"style":base_style(),
            "variants":["Default","Hover"],"defaultVariant":"Default",
            "variantOverrides":{"Hover":{"component":{"style":{"opacity":0.5}}}},
            "responsive":{},"interactions":[]
        }),
    );
    nodes.insert(
        "instance".into(),
        serde_json::json!({
            "id":"instance","type":"instance","name":"Button instance","parentId":"page","order":2048,
            "layout":base_layout(px(100),px(40)),"style":base_style(),
            "componentId":"component","variant":"Hover","overrides":{"component":{"name":"Override"}},
            "responsive":{},"interactions":[]
        }),
    );

    let export = serde_json::json!({
        "schema":"loora.canvas","version":2,
        "document":{
            "schemaVersion":2,"id":"feature-contract","name":"Feature contract",
            "nodes":nodes,
            "breakpoints":[
                {"id":"mobile","name":"Mobile","minWidth":0,"previewWidth":390},
                {"id":"desktop","name":"Desktop","minWidth":1200,"previewWidth":1440}
            ],
            "tokens":{
                "accent":{"id":"accent","name":"Accent","type":"color","value":"#3366ff","modes":{"dark":"#99aaff"}},
                "spacing":{"id":"spacing","name":"Spacing","type":"number","value":8},
                "ui":{"id":"ui","name":"UI","type":"font","value":"Inter"}
            },
            "themes":{"default":{"id":"default","name":"Default"},"dark":{"id":"dark","name":"Dark"}},
            "activeThemeId":"default",
            "animations":{"fade":{"id":"fade","name":"Fade","duration":400,"delay":20,"easing":"ease-out","iterations":"infinite","direction":"alternate","fill":"both","keyframes":[{"offset":0,"opacity":0,"transform":{"y":10}},{"offset":1,"opacity":1,"transform":{"y":0}}]}},
            "metadata":{"createdAt":1,"updatedAt":2}
        }
    });
    let document = parse_design_bytes(export.to_string().as_bytes()).unwrap();

    assert_eq!(document.schema_version, 2);
    assert_eq!(document.breakpoints[0].preview_width, 390.0);
    assert_eq!(document.tokens.len(), 3);
    assert_eq!(document.themes.len(), 2);
    assert_eq!(document.animations.len(), 1);
    assert!(document.animations[0].infinite);
    assert_eq!(document.animations[0].keyframes.len(), 2);

    let group = &document.nodes[&NodeId::from_static("group")];
    assert_eq!(group.kind, NodeKind::Frame);
    assert_eq!(group.layout.width_mode, SizeMode::Percent);
    assert_eq!(group.layout.width_percent, Some(75.0));
    assert_eq!(group.style.corners.tl, 4.0);
    assert_eq!(group.style.corners.bl, 16.0);
    assert_eq!(group.style.blend_mode.as_deref(), Some("multiply"));
    assert!(group.visual_states.as_ref().unwrap().focus.is_some());
    assert_eq!(group.transition.as_ref().unwrap().cubic_bezier, Some([0.2, 0.0, 0.0, 1.0]));
    assert_eq!(group.animations[0].trigger, AnimationTrigger::InView);
    assert_eq!(group.interactions[0].trigger, InteractionTrigger::StateChange);
    assert_eq!(group.interactions[0].when.len(), 1);
    assert_eq!(group.interactions[0].actions.len(), 10);
    assert!(matches!(group.interactions[0].actions[2], CanvasAction::Visibility { .. }));

    let text = &document.nodes[&NodeId::from_static("text")];
    let typography = text.typography.as_ref().unwrap();
    assert_eq!(typography.family, "Inter, sans-serif");
    assert_eq!(typography.align, TextAlign::Justify);
    assert_eq!(typography.decoration, TextDecoration::LineThrough);
    assert_eq!(typography.transform, TextTransform::Uppercase);
    assert!(!typography.wrap);
    assert_eq!(text.text_runs.len(), 1);
    assert_eq!(text.text_runs[0].typography.as_ref().unwrap().weight, Some(700));

    let ellipse = &document.nodes[&NodeId::from_static("ellipse")];
    assert_eq!(ellipse.shape_kind, ShapeKind::Ellipse);
    assert!(matches!(ellipse.style.fills[0], Paint::RadialGradient { .. }));
    assert_eq!(document.nodes[&NodeId::from_static("line")].shape_kind, ShapeKind::Line);
    assert_eq!(document.nodes[&NodeId::from_static("vector")].paths.len(), 1);
    assert_eq!(document.nodes[&NodeId::from_static("image")].image_alt, "Example");
    assert_eq!(document.nodes[&NodeId::from_static("component")].component_variants.len(), 2);

    let engine = loora_engine::CanvasEngine::new(document);
    let mobile = engine.resolved_document_at_width(390.0);
    let mobile_group = &mobile.nodes[&NodeId::from_static("group")];
    assert_eq!(mobile_group.layout.gap, 8.0);
    assert_eq!(mobile_group.layout.width_mode, SizeMode::Percent);
    assert!(
        (mobile_group.layout.width - 195.0).abs() < 0.01,
        "mobile percent width resolved to {}",
        mobile_group.layout.width
    );
    assert_eq!(mobile_group.style.opacity, 0.8);
    assert!(!mobile_group.style.fills.is_empty(), "partial style patch erased base fill");

    let desktop = engine.resolved_document_at_width(1440.0);
    assert_eq!(desktop.nodes[&NodeId::from_static("group")].layout.gap, 24.0);
}
