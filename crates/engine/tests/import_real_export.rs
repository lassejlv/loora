use std::{fs, time::Instant};

use loora_engine::{
    canvas_import::parse_design_bytes, compile_canvas, HtmlCanvasOptions, NodeKind,
};

fn hug_page_fixture() -> String {
    let mut nodes = serde_json::Map::new();
    nodes.insert(
        "page".into(),
        serde_json::json!({
            "id": "page", "type": "page", "name": "Page", "parentId": null,
            "order": 1024, "layout": {
                "position": "absolute", "x": 0, "y": 0,
                "width": {"unit": "px", "value": 1000}, "height": {"unit": "hug"},
                "mode": "flex", "direction": "column"
            },
            "viewport": {"width": 1000, "minHeight": 900}
        }),
    );
    for index in 0..3 {
        let frame = format!("frame_{index}");
        let child = format!("child_{index}");
        nodes.insert(
            frame.clone(),
            serde_json::json!({
                "id": frame, "type": "frame", "name": format!("Section {index}"),
                "parentId": "page", "order": (index + 1) * 1024,
                "layout": {
                    "position": "flow", "x": 0, "y": 0,
                    "width": {"unit": "fill"}, "height": {"unit": "hug"},
                    "mode": "flex", "direction": "column"
                }
            }),
        );
        nodes.insert(
            child.clone(),
            serde_json::json!({
                "id": child, "type": "shape", "shape": "rectangle",
                "name": format!("Content {index}"), "parentId": frame,
                "order": 1024,
                "layout": {
                    "position": "flow", "x": 0, "y": 0,
                    "width": {"unit": "fill"}, "height": {"unit": "px", "value": 500},
                    "mode": "absolute"
                }
            }),
        );
    }
    serde_json::json!({
        "schema": "loora.canvas", "version": 2,
        "document": {"id": "hug-page", "name": "Hug page", "nodes": nodes}
    })
    .to_string()
}

#[test]
fn hug_page_stacks_sections_without_shrinking_or_overlap() {
    let fixture = hug_page_fixture();
    let document = parse_design_bytes(fixture.as_bytes()).unwrap();
    let page = document.nodes.get(&"page".into()).unwrap();
    let mut sections: Vec<_> = document
        .nodes
        .values()
        .filter(|node| node.parent_id.as_ref() == Some(&page.id))
        .collect();
    sections.sort_by(|a, b| a.order.total_cmp(&b.order));

    assert_eq!(page.layout.height, 1500.0);
    for (index, section) in sections.iter().enumerate() {
        assert_eq!(section.layout.y, index as f64 * 500.0);
        assert_eq!(section.layout.height, 500.0);
    }
}

#[test]
fn real_loora_export_preserves_page_flow() {
    let Ok(fixture) = std::env::var("LOORA_IMPORT_FIXTURE") else {
        eprintln!("skipping real export check; LOORA_IMPORT_FIXTURE is not set");
        return;
    };
    let bytes = fs::read(fixture).unwrap();
    let started = Instant::now();
    let document = parse_design_bytes(&bytes).unwrap();
    let elapsed = started.elapsed();

    let mut pages: Vec<_> = document
        .nodes
        .values()
        .filter(|node| node.kind == NodeKind::Page)
        .collect();
    pages.sort_by(|a, b| a.order.total_cmp(&b.order));
    assert_eq!(pages.len(), 2);

    for page in pages {
        let mut flow_children: Vec<_> = document
            .nodes
            .values()
            .filter(|node| node.parent_id.as_ref() == Some(&page.id))
            .filter(|node| !node.hidden)
            .filter(|node| node.layout.position == loora_engine::LayoutPosition::Flow)
            .collect();
        flow_children.sort_by(|a, b| a.order.total_cmp(&b.order));
        let distinct_y: std::collections::HashSet<_> = flow_children
            .iter()
            .map(|node| (node.layout.y * 100.0).round() as i64)
            .collect();

        assert!(
            distinct_y.len() >= 4,
            "{} collapsed {} flow children into {} y positions",
            page.name,
            flow_children.len(),
            distinct_y.len()
        );
        assert!(
            page.layout.height > 900.0,
            "{} did not hug its content: {}px",
            page.name,
            page.layout.height
        );

        let mut previous_bottom = 0.0_f64;
        let mut previous_name = "page start";
        for child in &flow_children {
            assert!(
                child.layout.y + 0.01 >= previous_bottom,
                "{} overlaps {} on {}: y={} previous_bottom={}",
                child.name,
                previous_name,
                page.name,
                child.layout.y,
                previous_bottom
            );
            previous_bottom = child.layout.y + child.layout.height;
            previous_name = &child.name;
        }
        assert!(
            page.layout.height + 0.01 >= previous_bottom,
            "{} clips flow content at {}px (content bottom {})",
            page.name,
            page.layout.height,
            previous_bottom
        );
    }

    assert!(
        elapsed.as_millis() < 500,
        "import took {}ms",
        elapsed.as_millis()
    );
}

#[test]
#[ignore = "manual performance probe; requires LOORA_IMPORT_FIXTURE"]
fn measure_real_export_page_drag_updates() {
    let fixture = std::env::var("LOORA_IMPORT_FIXTURE").unwrap();
    let bytes = fs::read(fixture).unwrap();
    let document = parse_design_bytes(&bytes).unwrap();
    let mut engine = loora_engine::CanvasEngine::new(document);
    let page = engine.root_page_id().clone();
    let start = engine.absolute_bounds(&page).unwrap();
    let began = Instant::now();
    for step in 0..120 {
        let mut bounds = start;
        bounds.x += step as f64;
        engine
            .set_world_bounds(&page, bounds, Some(format!("drag:{page}")))
            .unwrap();
    }
    eprintln!("120 page updates: {:?}", began.elapsed());
}

#[test]
#[ignore = "manual performance probe; requires LOORA_IMPORT_FIXTURE"]
fn measure_real_export_html_compile() {
    let fixture = std::env::var("LOORA_IMPORT_FIXTURE").unwrap();
    let bytes = fs::read(fixture).unwrap();
    let document = parse_design_bytes(&bytes).unwrap();
    let began = Instant::now();
    let mut output_bytes = 0;
    for _ in 0..20 {
        let compiled = compile_canvas(&document, &HtmlCanvasOptions::default());
        output_bytes = compiled.markup.len() + compiled.css.len();
    }
    eprintln!(
        "20 HTML/CSS compiles: {:?} ({} bytes each)",
        began.elapsed(),
        output_bytes
    );
}
