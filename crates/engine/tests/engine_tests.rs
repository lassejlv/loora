use loora_engine::{
    ApplyOptions, Bounds, Camera, CanvasEngine, Document, Layout, Node, NodeId, NodeKind,
    NodePatch, Operation, PageViewport, SizeMode, Transaction, Vec2, DEFAULT_ORDER_STEP,
};

#[test]
fn demo_document_has_page_and_shapes() {
    let engine = CanvasEngine::demo();
    assert!(engine.node(engine.root_page_id()).is_some());
    let kids = engine.children(Some(engine.root_page_id()));
    assert!(kids.len() >= 2);
}

#[test]
fn insert_patch_delete_inverses() {
    let mut engine = CanvasEngine::demo();
    let page = engine.root_page_id().clone();
    let mut rect = Node::rectangle("Temp", page.clone(), Layout::new(10.0, 10.0, 40.0, 40.0));
    rect.order = engine.next_order(Some(&page));
    let id = rect.id.clone();

    engine
        .apply(
            Transaction::new("insert", vec![Operation::Insert { node: rect }]),
            ApplyOptions::with_history(),
        )
        .unwrap();
    assert!(engine.node(&id).is_some());

    engine
        .apply(
            Transaction::new(
                "rename",
                vec![Operation::Patch {
                    id: id.clone(),
                    patch: NodePatch {
                        name: Some("Renamed".into()),
                        ..Default::default()
                    },
                }],
            ),
            ApplyOptions::with_history(),
        )
        .unwrap();
    assert_eq!(engine.node(&id).unwrap().name, "Renamed");

    engine.undo().unwrap();
    assert_eq!(engine.node(&id).unwrap().name, "Temp");

    engine.undo().unwrap();
    assert!(engine.node(&id).is_none());

    engine.redo().unwrap();
    assert!(engine.node(&id).is_some());
}

#[test]
fn sibling_order_sorted() {
    let mut engine = CanvasEngine::new(loora_engine::Document::empty("t"));
    let page = engine.root_page_id().clone();
    let mut a = Node::rectangle("A", page.clone(), Layout::new(0.0, 0.0, 10.0, 10.0));
    a.order = DEFAULT_ORDER_STEP * 2.0;
    let mut b = Node::rectangle("B", page.clone(), Layout::new(0.0, 0.0, 10.0, 10.0));
    b.order = DEFAULT_ORDER_STEP;
    engine
        .apply(
            Transaction::new(
                "insert",
                vec![Operation::Insert { node: a }, Operation::Insert { node: b }],
            ),
            ApplyOptions::with_history(),
        )
        .unwrap();
    let names: Vec<_> = engine
        .children(Some(&page))
        .into_iter()
        .map(|n| n.name.as_str())
        .collect();
    assert_eq!(names, vec!["B", "A"]);
}

#[test]
fn hit_test_frontmost() {
    let mut engine = CanvasEngine::new(loora_engine::Document::empty("t"));
    let page = engine.root_page_id().clone();
    let mut back = Node::rectangle("Back", page.clone(), Layout::new(0.0, 0.0, 100.0, 100.0));
    back.order = DEFAULT_ORDER_STEP;
    let back_id = back.id.clone();
    let mut front = Node::rectangle("Front", page.clone(), Layout::new(20.0, 20.0, 40.0, 40.0));
    front.order = DEFAULT_ORDER_STEP * 2.0;
    let front_id = front.id.clone();
    engine
        .apply(
            Transaction::new(
                "insert",
                vec![
                    Operation::Insert { node: back },
                    Operation::Insert { node: front },
                ],
            ),
            ApplyOptions {
                record_history: false,
            },
        )
        .unwrap();

    assert_eq!(
        engine.hit_test(Vec2::new(30.0, 30.0)).as_ref(),
        Some(&front_id)
    );
    assert_eq!(
        engine.hit_test(Vec2::new(90.0, 90.0)).as_ref(),
        Some(&back_id)
    );
    // Empty space on the page selects the page; outside all pages is a miss.
    assert_eq!(engine.hit_test(Vec2::new(200.0, 200.0)).as_ref(), Some(&page));
    assert_eq!(engine.hit_test(Vec2::new(2000.0, 2000.0)), None);
}

#[test]
fn move_coalesce_single_undo() {
    let mut engine = CanvasEngine::demo();
    let page = engine.root_page_id().clone();
    let id = engine.children(Some(&page))[0].id.clone();
    let start_x = engine.node(&id).unwrap().layout.x;

    engine
        .move_nodes(&[id.clone()], 10.0, 0.0, Some("drag".into()))
        .unwrap();
    engine
        .move_nodes(&[id.clone()], 10.0, 0.0, Some("drag".into()))
        .unwrap();
    assert!((engine.node(&id).unwrap().layout.x - (start_x + 20.0)).abs() < f64::EPSILON);

    engine.undo().unwrap();
    assert!((engine.node(&id).unwrap().layout.x - start_x).abs() < f64::EPSILON);
}

#[test]
fn page_world_bounds_can_move_resize_and_undo() {
    let mut engine = CanvasEngine::demo();
    let page = engine.root_page_id().clone();
    let child = engine.children(Some(&page))[0].id.clone();
    let original_page = engine.absolute_bounds(&page).unwrap();
    let original_child = engine.absolute_bounds(&child).unwrap();
    let coalesce_key = format!("resize:{page}");
    let updated_page = Bounds::new(120.0, 80.0, 1024.0, 768.0);

    engine
        .set_world_bounds(
            &page,
            Bounds::new(100.0, 60.0, 1100.0, 800.0),
            Some(coalesce_key.clone()),
        )
        .unwrap();
    engine
        .set_world_bounds(&page, updated_page, Some(coalesce_key))
        .unwrap();

    assert_eq!(engine.absolute_bounds(&page), Some(updated_page));
    let moved_child = engine.absolute_bounds(&child).unwrap();
    assert_eq!(moved_child.x, original_child.x + 120.0);
    assert_eq!(moved_child.y, original_child.y + 80.0);

    engine.undo().unwrap();
    assert_eq!(engine.absolute_bounds(&page), Some(original_page));
    assert_eq!(engine.absolute_bounds(&child), Some(original_child));
}

#[test]
fn page_resize_overrides_imported_viewport_minimum() {
    let mut document = Document::empty("responsive page");
    let page = document.root_page_id.clone();
    let page_node = document.nodes.get_mut(&page).unwrap();
    page_node.layout.width = 1440.0;
    page_node.layout.height = 900.0;
    page_node.layout.height_mode = SizeMode::Hug;
    page_node.layout.min_height = Some(900.0);
    page_node.viewport = Some(PageViewport {
        width: 1440.0,
        min_height: 900.0,
    });
    let mut engine = CanvasEngine::new(document);

    let resized = Bounds::new(50.0, 60.0, 640.0, 360.0);
    engine.set_world_bounds(&page, resized, None).unwrap();

    assert_eq!(engine.absolute_bounds(&page), Some(resized));
    let layout = &engine.node(&page).unwrap().layout;
    assert_eq!(layout.width_mode, SizeMode::Fixed);
    assert_eq!(layout.height_mode, SizeMode::Fixed);
    assert_eq!(layout.min_height, None);
}

#[test]
fn direct_page_child_drag_uses_world_coordinates() {
    let mut engine = CanvasEngine::new(loora_engine::Document::empty("page child drag"));
    let page = engine.root_page_id().clone();
    let child = Node::rectangle(
        "Child",
        page.clone(),
        Layout::new(20.0, 30.0, 40.0, 50.0),
    );
    let child_id = child.id.clone();
    engine
        .apply(
            Transaction::new("insert", vec![Operation::Insert { node: child }]),
            ApplyOptions::with_history(),
        )
        .unwrap();
    engine
        .set_world_bounds(&page, Bounds::new(500.0, 200.0, 800.0, 600.0), None)
        .unwrap();

    engine
        .set_world_position(&child_id, Vec2::new(620.0, 260.0), None)
        .unwrap();
    assert_eq!(
        engine.absolute_bounds(&child_id),
        Some(Bounds::new(620.0, 260.0, 40.0, 50.0))
    );
    assert_eq!(engine.node(&child_id).unwrap().layout.x, 120.0);
    assert_eq!(engine.node(&child_id).unwrap().layout.y, 60.0);

    engine
        .set_world_bounds(
            &child_id,
            Bounds::new(700.0, 300.0, 80.0, 90.0),
            None,
        )
        .unwrap();
    assert_eq!(
        engine.absolute_bounds(&child_id),
        Some(Bounds::new(700.0, 300.0, 80.0, 90.0))
    );
}

#[test]
fn browser_parent_origin_drift_does_not_shift_committed_drag() {
    let mut document = Document::empty("browser layout drag");
    let page = document.root_page_id.clone();
    document.nodes.get_mut(&page).unwrap().layout.x = 500.0;
    document.nodes.get_mut(&page).unwrap().layout.y = 200.0;

    let parent = Node::frame(
        "Browser-positioned parent",
        page,
        Layout::new(100.0, 40.0, 400.0, 300.0),
    );
    let parent_id = parent.id.clone();
    let mut child = Node::rectangle(
        "Dragged child",
        parent_id.clone(),
        Layout::new(20.0, 30.0, 80.0, 60.0),
    );
    child.layout.position = loora_engine::LayoutPosition::Flow;
    let child_id = child.id.clone();
    document.nodes.insert(parent_id, parent);
    document.nodes.insert(child_id.clone(), child);
    let mut engine = CanvasEngine::new(document);

    // Browser layout is the rendering source of truth and may place a flow
    // parent somewhere different from the engine's stored approximation.
    let browser_parent_origin = Vec2::new(640.0, 260.0);
    let requested_browser_world = Vec2::new(720.0, 330.0);
    engine
        .set_world_position_from_parent_origin(
            &child_id,
            requested_browser_world,
            browser_parent_origin,
            None,
        )
        .unwrap();

    let committed = engine.node(&child_id).unwrap();
    let browser_world_after_recompile = Vec2::new(
        browser_parent_origin.x + committed.layout.x,
        browser_parent_origin.y + committed.layout.y,
    );
    assert_eq!(browser_world_after_recompile, requested_browser_world);
}

#[test]
fn browser_drop_target_origin_does_not_shift_reparented_drag() {
    let mut document = Document::empty("browser reparent drag");
    let page = document.root_page_id.clone();
    document.nodes.get_mut(&page).unwrap().layout.x = 500.0;
    document.nodes.get_mut(&page).unwrap().layout.y = 200.0;

    let source = Node::frame(
        "Source",
        page.clone(),
        Layout::new(100.0, 40.0, 240.0, 240.0),
    );
    let source_id = source.id.clone();
    let target = Node::frame(
        "Target",
        page,
        Layout::new(400.0, 40.0, 240.0, 240.0),
    );
    let target_id = target.id.clone();
    let child = Node::rectangle(
        "Dragged child",
        source_id.clone(),
        Layout::new(20.0, 30.0, 80.0, 60.0),
    );
    let child_id = child.id.clone();
    document.nodes.insert(source_id, source);
    document.nodes.insert(target_id.clone(), target);
    document.nodes.insert(child_id.clone(), child);
    let mut engine = CanvasEngine::new(document);

    let requested_browser_world = Vec2::new(960.0, 330.0);
    engine
        .set_world_position_from_parent_origin(
            &child_id,
            requested_browser_world,
            Vec2::new(640.0, 260.0),
            None,
        )
        .unwrap();
    let browser_target_origin = Vec2::new(950.0, 260.0);
    engine
        .reparent_from_rendered_position(
            &child_id,
            &target_id,
            requested_browser_world,
            browser_target_origin,
        )
        .unwrap();

    let committed = engine.node(&child_id).unwrap();
    let browser_world_after_recompile = Vec2::new(
        browser_target_origin.x + committed.layout.x,
        browser_target_origin.y + committed.layout.y,
    );
    assert_eq!(browser_world_after_recompile, requested_browser_world);
}

#[test]
fn browser_flow_leading_edge_resize_preserves_rendered_bounds() {
    let mut document = Document::empty("browser flow resize");
    let page = document.root_page_id.clone();
    let parent = Node::frame(
        "Flow parent",
        page,
        Layout::new(100.0, 40.0, 400.0, 300.0),
    );
    let parent_id = parent.id.clone();
    let mut child = Node::rectangle(
        "Flow child",
        parent_id.clone(),
        Layout::new(20.0, 30.0, 80.0, 60.0),
    );
    child.layout.position = loora_engine::LayoutPosition::Flow;
    let child_id = child.id.clone();
    document.nodes.insert(parent_id, parent);
    document.nodes.insert(child_id.clone(), child);
    let mut engine = CanvasEngine::new(document);

    let browser_parent_origin = Vec2::new(140.0, 70.0);
    let requested = Bounds::new(170.0, 85.0, 110.0, 75.0);
    engine
        .set_rendered_world_bounds(
            &child_id,
            requested,
            browser_parent_origin,
            true,
            None,
        )
        .unwrap();

    let committed = engine.node(&child_id).unwrap();
    assert_eq!(
        committed.layout.position,
        loora_engine::LayoutPosition::Absolute
    );
    assert_eq!(
        Bounds::new(
            browser_parent_origin.x + committed.layout.x,
            browser_parent_origin.y + committed.layout.y,
            committed.layout.width,
            committed.layout.height,
        ),
        requested
    );
}

#[test]
fn camera_roundtrip() {
    let mut cam = Camera::new(Vec2::new(100.0, 50.0), 2.0);
    let world = Vec2::new(10.0, 20.0);
    let screen = cam.world_to_screen(world);
    let back = cam.screen_to_world(screen);
    assert!((back.x - world.x).abs() < 1e-9);
    assert!((back.y - world.y).abs() < 1e-9);

    cam.zoom_at(Vec2::new(200.0, 200.0), 2.0);
    assert!((cam.zoom - 4.0).abs() < 1e-9);
}

#[test]
fn absolute_bounds_nested() {
    let engine = CanvasEngine::demo();
    let page = engine.root_page_id().clone();
    let frame = engine
        .children(Some(&page))
        .into_iter()
        .find(|n| n.kind == NodeKind::Frame)
        .unwrap();
    let child = engine.children(Some(&frame.id))[0];
    let bounds = engine.absolute_bounds(&child.id).unwrap();
    assert_eq!(
        bounds,
        Bounds::new(
            frame.layout.x + child.layout.x,
            frame.layout.y + child.layout.y,
            child.layout.width,
            child.layout.height,
        )
    );
}

#[test]
fn hidden_skipped_in_hit_test() {
    let mut engine = CanvasEngine::new(loora_engine::Document::empty("t"));
    let page = engine.root_page_id().clone();
    let rect = Node::rectangle("H", page.clone(), Layout::new(0.0, 0.0, 50.0, 50.0));
    let id = rect.id.clone();
    engine
        .apply(
            Transaction::new("i", vec![Operation::Insert { node: rect }]),
            ApplyOptions::with_history(),
        )
        .unwrap();
    engine.set_hidden(&id, true).unwrap();
    // Hidden child is skipped; empty page area selects the page.
    assert_eq!(
        engine.hit_test(Vec2::new(10.0, 10.0)).as_ref(),
        Some(&page)
    );
}

#[test]
fn delete_removes_descendants() {
    let mut engine = CanvasEngine::demo();
    let page = engine.root_page_id().clone();
    let frame_id = engine
        .children(Some(&page))
        .into_iter()
        .find(|n| n.kind == NodeKind::Frame)
        .unwrap()
        .id
        .clone();
    let child_ids: Vec<NodeId> = engine
        .children(Some(&frame_id))
        .into_iter()
        .map(|n| n.id.clone())
        .collect();
    assert!(!child_ids.is_empty());

    engine
        .apply(
            Transaction::new(
                "delete",
                vec![Operation::Delete {
                    id: frame_id.clone(),
                }],
            ),
            ApplyOptions::with_history(),
        )
        .unwrap();
    assert!(engine.node(&frame_id).is_none());
    for id in child_ids {
        assert!(engine.node(&id).is_none());
    }
}

#[test]
fn rename_node_updates_name() {
    let mut engine = CanvasEngine::demo();
    let page = engine.root_page_id().clone();
    let id = engine.children(Some(&page))[0].id.clone();
    engine.rename_node(&id, "Renamed Layer").unwrap();
    assert_eq!(engine.node(&id).unwrap().name, "Renamed Layer");
    engine.undo().unwrap();
    assert_ne!(engine.node(&id).unwrap().name, "Renamed Layer");
}

#[test]
fn style_opacity_coalesce_single_undo() {
    let mut engine = CanvasEngine::demo();
    let page = engine.root_page_id().clone();
    let id = engine.children(Some(&page))[0].id.clone();
    let start = engine.node(&id).unwrap().style.opacity;

    engine
        .set_opacity(&id, 0.8, Some(format!("property:opacity:{id}")))
        .unwrap();
    engine
        .set_opacity(&id, 0.4, Some(format!("property:opacity:{id}")))
        .unwrap();
    assert!((engine.node(&id).unwrap().style.opacity - 0.4).abs() < f32::EPSILON);

    engine.undo().unwrap();
    assert!((engine.node(&id).unwrap().style.opacity - start).abs() < f32::EPSILON);
}

#[test]
fn set_fill_and_stroke() {
    let mut engine = CanvasEngine::demo();
    let page = engine.root_page_id().clone();
    let id = engine.children(Some(&page))[0].id.clone();

    engine
        .set_fill(&id, Some(loora_engine::Color::rgb(0xff, 0x00, 0x00)), None)
        .unwrap();
    let fill = engine.node(&id).unwrap().style.solid_fill().unwrap();
    assert!((fill.r - 1.0).abs() < f32::EPSILON);
    assert!((fill.g - 0.0).abs() < f32::EPSILON);
    assert!((fill.b - 0.0).abs() < f32::EPSILON);

    engine
        .set_stroke(
            &id,
            Some(loora_engine::Stroke::solid(
                loora_engine::Color::rgb(0x00, 0xff, 0x00),
                2.0,
            )),
            None,
        )
        .unwrap();
    let stroke = engine.node(&id).unwrap().style.stroke.clone().unwrap();
    assert!((stroke.width - 2.0).abs() < f32::EPSILON);
}

#[test]
fn flex_stack_resolves_row_gap() {
    let mut engine = CanvasEngine::new(loora_engine::Document::empty("stack"));
    let page = engine.root_page_id().clone();
    let mut frame = Node::frame("Stack", page.clone(), Layout::new(0.0, 0.0, 400.0, 100.0));
    frame.layout.mode = loora_engine::LayoutMode::Flex;
    frame.layout.direction = loora_engine::FlexDirection::Row;
    frame.layout.gap = 10.0;
    frame.layout.padding = loora_engine::Insets::uniform(0.0);
    let frame_id = frame.id.clone();

    let mut a = Node::rectangle("A", frame_id.clone(), Layout::new(0.0, 0.0, 40.0, 40.0));
    a.layout.position = loora_engine::LayoutPosition::Flow;
    let a_id = a.id.clone();
    let mut b = Node::rectangle("B", frame_id.clone(), Layout::new(0.0, 0.0, 40.0, 40.0));
    b.layout.position = loora_engine::LayoutPosition::Flow;
    let b_id = b.id.clone();

    engine
        .apply(
            Transaction::new(
                "insert",
                vec![
                    Operation::Insert { node: frame },
                    Operation::Insert { node: a },
                    Operation::Insert { node: b },
                ],
            ),
            ApplyOptions::with_history(),
        )
        .unwrap();
    engine.resolve_stack(&frame_id).unwrap();
    assert!((engine.node(&a_id).unwrap().layout.x - 0.0).abs() < f64::EPSILON);
    assert!((engine.node(&b_id).unwrap().layout.x - 50.0).abs() < f64::EPSILON);
}

#[test]
fn flex_wrap_starts_new_line() {
    let mut engine = CanvasEngine::new(loora_engine::Document::empty("wrap"));
    let page = engine.root_page_id().clone();
    let mut frame = Node::frame("Wrap", page, Layout::new(0.0, 0.0, 100.0, 200.0));
    frame.layout.mode = loora_engine::LayoutMode::Flex;
    frame.layout.direction = loora_engine::FlexDirection::Row;
    frame.layout.wrap = true;
    frame.layout.gap = 0.0;
    let frame_id = frame.id.clone();
    let mut a = Node::rectangle("A", frame_id.clone(), Layout::new(0.0, 0.0, 60.0, 20.0));
    a.layout.position = loora_engine::LayoutPosition::Flow;
    let a_id = a.id.clone();
    let mut b = Node::rectangle("B", frame_id.clone(), Layout::new(0.0, 0.0, 60.0, 20.0));
    b.layout.position = loora_engine::LayoutPosition::Flow;
    let b_id = b.id.clone();
    engine
        .apply(
            Transaction::new(
                "insert",
                vec![
                    Operation::Insert { node: frame },
                    Operation::Insert { node: a },
                    Operation::Insert { node: b },
                ],
            ),
            ApplyOptions::with_history(),
        )
        .unwrap();
    engine.resolve_stack(&frame_id).unwrap();
    assert!((engine.node(&a_id).unwrap().layout.y - 0.0).abs() < f64::EPSILON);
    assert!((engine.node(&b_id).unwrap().layout.y - 20.0).abs() < f64::EPSILON);
}

#[test]
fn grid_resolves_columns() {
    let mut engine = CanvasEngine::new(loora_engine::Document::empty("grid"));
    let page = engine.root_page_id().clone();
    let mut frame = Node::frame("Grid", page, Layout::new(0.0, 0.0, 210.0, 200.0));
    frame.layout.mode = loora_engine::LayoutMode::Grid;
    frame.layout.columns = 2;
    frame.layout.gap = 10.0;
    let frame_id = frame.id.clone();
    let mut a = Node::rectangle("A", frame_id.clone(), Layout::new(0.0, 0.0, 40.0, 40.0));
    a.layout.position = loora_engine::LayoutPosition::Flow;
    let a_id = a.id.clone();
    let mut b = Node::rectangle("B", frame_id.clone(), Layout::new(0.0, 0.0, 40.0, 40.0));
    b.layout.position = loora_engine::LayoutPosition::Flow;
    let b_id = b.id.clone();
    engine
        .apply(
            Transaction::new(
                "insert",
                vec![
                    Operation::Insert { node: frame },
                    Operation::Insert { node: a },
                    Operation::Insert { node: b },
                ],
            ),
            ApplyOptions::with_history(),
        )
        .unwrap();
    engine.resolve_stack(&frame_id).unwrap();
    assert!((engine.node(&a_id).unwrap().layout.x - 0.0).abs() < f64::EPSILON);
    assert!((engine.node(&b_id).unwrap().layout.x - 110.0).abs() < f64::EPSILON);
}

#[test]
fn legacy_style_json_migrates() {
    let json = r#"{
        "id":"doc_1","name":"Old",
        "root_page_id":"page_1",
        "nodes":{
            "page_1":{
                "id":"page_1","kind":"page","name":"Page","parent_id":null,
                "order":1024.0,"hidden":false,"locked":false,
                "layout":{"x":0,"y":0,"width":100,"height":100},
                "style":{"fill":{"r":0.1,"g":0.2,"b":0.3,"a":1.0},"stroke":null,"radius":4.0,"opacity":1.0}
            }
        }
    }"#;
    let doc: loora_engine::Document = serde_json::from_str(json).unwrap();
    let page = doc.nodes.get(&doc.root_page_id).unwrap();
    assert_eq!(page.style.fills.len(), 1);
    assert!((page.style.corners.tl - 4.0).abs() < f32::EPSILON);
}
