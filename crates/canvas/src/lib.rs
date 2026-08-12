//! Native GPUI canvas surface for Loora.
//!
//! This crate deliberately depends on the document engine, not on `loora-ui`.
//! The desktop shell remains responsible for history, persistence and panels;
//! this surface owns drawing and pointer interactions.

mod assets;
mod geometry;
mod motion;
mod native_canvas;
mod raster;
mod scene;
mod scene_raster;
pub mod style_fixture;
mod text;
mod types;

pub use native_canvas::NativeCanvas;
pub use types::{
    CanvasEvent, CanvasPalette, CanvasTool, NativeTextEdit, PreviewTrigger, ResizeHandle,
};

pub(crate) use assets::*;
pub(crate) use geometry::*;
pub(crate) use motion::*;
pub(crate) use raster::*;
pub(crate) use scene::*;
pub(crate) use text::*;
pub(crate) use types::*;

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        point, px, size, AppContext, Bounds as GpBounds, Entity, EntityInputHandler, FontWeight,
        PathBuilder, RenderImage, TestAppContext, VisualTestContext,
    };
    use loora_engine::{
        Bounds, Camera, Color, Document, FlexDirection, Insets, Layout, LayoutMode, Node, NodeId,
        Overflow, Paint, TextAlign as EngineTextAlign, Vec2,
    };
    use std::cell::Cell;
    use std::collections::HashMap;
    use std::path::Path;
    use std::rc::Rc;
    use std::sync::Arc;
    use std::time::Instant;
    use svgtypes::PathParser;

    #[test]
    fn gradient_sampling_preserves_middle_stops() {
        let stops = vec![
            loora_engine::GradientStop {
                offset: 0.0,
                color: Color::rgb(255, 0, 0),
                token_id: None,
            },
            loora_engine::GradientStop {
                offset: 0.5,
                color: Color::rgb(0, 255, 0),
                token_id: None,
            },
            loora_engine::GradientStop {
                offset: 1.0,
                color: Color::rgb(0, 0, 255),
                token_id: None,
            },
        ];
        let middle = sample_gradient(&stops, 0.5).unwrap();
        assert!(middle.g > 0.99);
        assert!(middle.r < 0.01);
        assert!(middle.b < 0.01);
    }

    #[test]
    fn image_rotation_expands_the_raster_without_losing_pixels() {
        let mut source = image::RgbaImage::new(4, 2);
        for pixel in source.pixels_mut() {
            *pixel = image::Rgba([255, 255, 255, 255]);
        }
        let rotated = rotate_rgba(&source, 90.0);
        assert_eq!((rotated.width(), rotated.height()), (3, 4));
        assert!(rotated.pixels().any(|pixel| pixel.0[3] == 255));
    }

    #[test]
    fn rich_text_runs_use_character_ranges_and_utf8_byte_lengths() {
        let page = NodeId::from("page");
        let mut node = Node::text("Rich", page, Layout::new(0.0, 0.0, 200.0, 40.0), "AéB");
        node.text_runs.push(loora_engine::TextRun {
            start: 1,
            end: 2,
            typography: Some(loora_engine::TypographyPatch {
                family: Some("Courier".into()),
                weight: Some(700),
                ..loora_engine::TypographyPatch::default()
            }),
            color: Some(Color::rgb(255, 0, 0)),
            color_token: None,
        });
        let runs = text_runs_for_line(&node, &node.effective_typography(), "AéB", 0, None, 1.0);
        assert_eq!(runs.iter().map(|run| run.len).sum::<usize>(), "AéB".len());
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[1].len, "é".len());
        assert_eq!(runs[1].font.family.as_ref(), "Courier");
        assert_eq!(runs[1].font.weight, FontWeight(700.0));
    }

    #[test]
    fn text_nodes_use_style_fill_before_typography_fallback() {
        let page = NodeId::from("page");
        let mut node = Node::text("Label", page, Layout::new(0.0, 0.0, 200.0, 40.0), "Label");
        let fill = Color::rgb(0x20, 0x21, 0x24);
        node.style.set_solid_fill(Some(fill));
        node.typography.as_mut().unwrap().color = Color::rgb(0xf0, 0xf0, 0xf0);

        assert_eq!(text_paint_color(&node, None), Some(fill));
    }

    #[test]
    fn native_line_height_uses_the_css_style_multiplier() {
        let typography = loora_engine::Typography {
            size: 20.0,
            line_height: Some(1.5),
            ..loora_engine::Typography::default()
        };

        assert!((resolved_line_height(&typography) - 30.0).abs() < f32::EPSILON);
    }

    #[test]
    fn double_click_word_selection_uses_utf8_boundaries() {
        assert_eq!(word_range_at("hello world", 7), 6..11);
        assert_eq!(word_range_at("hej verden", 1), 0..3);
        assert_eq!(word_range_at("blå himmel", 3), 0..4);
    }

    #[gpui::test]
    fn native_input_replaces_active_ime_composition(cx: &mut TestAppContext) {
        let mut document = Document::empty("IME");
        let page = document.root_page_id.clone();
        let mut text = Node::text("Text", page, Layout::new(0.0, 0.0, 200.0, 40.0), "Cafe");
        text.id = NodeId::from("ime_text");
        let id = text.id.clone();
        document.nodes.insert(id.clone(), text);
        let (canvas, cx): (Entity<NativeCanvas>, &mut VisualTestContext) =
            cx.add_window_view(|_, cx| {
                let mut canvas = NativeCanvas::new(document, Camera::default(), cx);
                canvas.text_edit = Some(NativeTextEdit {
                    id: id.clone(),
                    anchor: 4,
                    caret: 4,
                    caret_visible: true,
                    marked_range: None,
                });
                canvas
            });

        canvas.update_in(cx, |canvas, window, cx| {
            canvas.replace_and_mark_text_in_range(None, "e\u{301}", Some(2..2), window, cx);
            canvas.replace_and_mark_text_in_range(None, "é", Some(1..1), window, cx);
        });

        canvas.read_with(cx, |canvas, _| {
            assert_eq!(canvas.document.nodes[&id].text.as_deref(), Some("Cafeé"));
            assert_eq!(canvas.text_edit.as_ref().unwrap().marked_range, Some(4..6));
        });
    }

    #[test]
    fn svg_text_preserves_letter_spacing() {
        let svg = styled_text_svg(
            "Apps",
            100.0,
            24.0,
            16.0,
            "System",
            400,
            EngineTextAlign::Left,
            2.0,
        );

        assert!(svg.contains("letter-spacing=\"2\""));
        assert!(should_use_text_svg(0.0, 2.0, None));
    }

    #[test]
    fn child_opacity_is_compounded_with_its_ancestors() {
        let mut document = Document::empty("Opacity");
        let page = document.root_page_id.clone();
        let mut parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        parent.style.opacity = 0.5;
        let mut child = Node::rectangle(
            "Child",
            parent.id.clone(),
            Layout::new(0.0, 0.0, 50.0, 50.0),
        );
        child.style.opacity = 0.4;
        let child_id = child.id.clone();
        document.nodes.insert(parent.id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);

        let opacity = node_opacity(
            &document,
            document.nodes.get(&child_id).unwrap(),
            &HashMap::new(),
        );

        assert!((opacity - 0.2).abs() < f32::EPSILON);
    }

    #[test]
    fn animated_parent_opacity_compounds_into_static_children() {
        let mut document = Document::empty("Animated opacity");
        let page = document.root_page_id.clone();
        let parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        let parent_id = parent.id.clone();
        let mut child = Node::rectangle(
            "Child",
            parent_id.clone(),
            Layout::new(0.0, 0.0, 50.0, 50.0),
        );
        child.style.opacity = 0.4;
        let child_id = child.id.clone();
        document.nodes.insert(parent_id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);
        let frames = HashMap::from([(
            parent_id,
            MotionFrame {
                opacity: 0.25,
                x: 0.0,
                y: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotate: 0.0,
                fill: None,
                corners: loora_engine::Corners::default(),
                stroke: None,
            },
        )]);

        let opacity = node_opacity(&document, document.nodes.get(&child_id).unwrap(), &frames);

        assert!((opacity - 0.1).abs() < f32::EPSILON);
    }

    #[test]
    fn nested_overflow_clips_intersect_in_world_space() {
        let mut document = Document::empty("Nested clips");
        let page = document.root_page_id.clone();
        let mut outer = Node::frame("Outer", page, Layout::new(10.0, 20.0, 100.0, 100.0));
        outer.style.overflow = Overflow::Hidden;
        let mut inner = Node::frame(
            "Inner",
            outer.id.clone(),
            Layout::new(80.0, 80.0, 50.0, 50.0),
        );
        inner.style.overflow = Overflow::Hidden;
        let child = Node::rectangle("Child", inner.id.clone(), Layout::new(0.0, 0.0, 50.0, 50.0));
        let child_id = child.id.clone();
        document.nodes.insert(outer.id.clone(), outer);
        document.nodes.insert(inner.id.clone(), inner);
        document.nodes.insert(child_id.clone(), child);
        let bounds = absolute_bounds(&document);

        let clip =
            inherited_clip(&document, &bounds, document.nodes.get(&child_id).unwrap()).unwrap();

        assert_eq!(clip, Bounds::new(90.0, 100.0, 20.0, 20.0));
    }

    #[test]
    fn gradient_raster_uses_compounded_node_opacity() {
        let mut document = Document::empty("Gradient opacity");
        let page = document.root_page_id.clone();
        let mut parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        parent.style.opacity = 0.5;
        let mut child = Node::rectangle(
            "Gradient",
            parent.id.clone(),
            Layout::new(0.0, 0.0, 50.0, 50.0),
        );
        child.style.opacity = 0.4;
        child.style.fills = vec![Paint::LinearGradient {
            angle: 0.0,
            stops: vec![
                loora_engine::GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 255, 255),
                    token_id: None,
                },
                loora_engine::GradientStop {
                    offset: 1.0,
                    color: Color::rgb(255, 255, 255),
                    token_id: None,
                },
            ],
        }];
        let child_id = child.id.clone();
        document.nodes.insert(parent.id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );

        canvas.sync_gradient_fills(&document, &HashMap::new());

        let raster = canvas.gradient_fills.get(&(child_id, 0)).unwrap();
        assert_eq!(raster.image.as_bytes(0).unwrap()[3], 51);
    }

    #[test]
    fn image_pixels_respect_effective_opacity() {
        let frame = image::Frame::new(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([10, 20, 30, 200]),
        ));
        let source = Arc::new(RenderImage::new(smallvec::smallvec![frame]));

        let faded = render_image_with_opacity(&source, 0.5);

        assert_eq!(faded.as_bytes(0).unwrap(), &[10, 20, 30, 100]);
    }

    #[test]
    fn image_cache_uses_compounded_node_opacity() {
        let mut document = Document::empty("Image opacity");
        let page = document.root_page_id.clone();
        let mut parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        parent.style.opacity = 0.5;
        let mut child = Node::image(
            "Image",
            parent.id.clone(),
            Layout::new(0.0, 0.0, 50.0, 50.0),
        );
        child.style.opacity = 0.4;
        child.image_path = Some("fixture".into());
        let child_id = child.id.clone();
        document.nodes.insert(parent.id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);
        let frame = image::Frame::new(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([10, 20, 30, 200]),
        ));
        let source = Arc::new(RenderImage::new(smallvec::smallvec![frame]));
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.images.insert("fixture".into(), source);

        canvas.sync_image_opacity_variants(&document, &HashMap::new());

        let variant = canvas.image_opacity_variants.get(&child_id).unwrap();
        assert_eq!(variant.image.as_bytes(0).unwrap()[3], 40);
    }

    #[test]
    fn initial_scene_loads_local_image_assets() {
        let mut document = Document::empty("Initial images");
        let page = document.root_page_id.clone();
        let mut image = Node::image("Logo", page, Layout::new(0.0, 0.0, 64.0, 64.0));
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../desktop/assets/logo.png")
            .to_string_lossy()
            .into_owned();
        image.image_path = Some(path.clone());
        document.nodes.insert(image.id.clone(), image);

        let canvas = NativeCanvas::new_with_viewport(
            document,
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );

        assert!(canvas.images.contains_key(&path));
    }

    #[test]
    fn overlapping_artboards_only_paint_the_frontmost_page_label() {
        let mut document = Document::empty("Pages");
        let desktop = document.root_page_id.clone();
        let mut homepage = Node::root_frame("Homepage");
        homepage.layout.x = 0.25;
        homepage.order = 2048.0;
        let homepage_id = homepage.id.clone();
        document.nodes.insert(homepage_id.clone(), homepage);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);

        assert!(!root_page_label_is_frontmost(
            &desktop, &document, &bounds, &order, 1.0,
        ));
        assert!(root_page_label_is_frontmost(
            &homepage_id,
            &document,
            &bounds,
            &order,
            1.0,
        ));
    }

    #[test]
    fn resize_group_scales_every_member_from_shared_origin() {
        let first = NodeId::from("first");
        let second = NodeId::from("second");
        let originals = HashMap::from([
            (first.clone(), Bounds::new(0.0, 0.0, 50.0, 100.0)),
            (second.clone(), Bounds::new(50.0, 0.0, 50.0, 100.0)),
        ]);
        let scaled = scale_group(
            &originals,
            Bounds::new(0.0, 0.0, 100.0, 100.0),
            Bounds::new(10.0, 20.0, 200.0, 50.0),
        );
        assert_eq!(scaled[&first], Bounds::new(10.0, 20.0, 100.0, 50.0));
        assert_eq!(scaled[&second], Bounds::new(110.0, 20.0, 100.0, 50.0));
    }

    #[test]
    fn top_level_selection_drops_descendants_of_selected_nodes() {
        let mut document = Document::empty("Test");
        let page = document.root_page_id.clone();
        let parent = Node::frame("Parent", page.clone(), Layout::new(0.0, 0.0, 100.0, 100.0));
        let child = Node::rectangle(
            "Child",
            parent.id.clone(),
            Layout::new(10.0, 10.0, 20.0, 20.0),
        );
        document.nodes.insert(parent.id.clone(), parent.clone());
        document.nodes.insert(child.id.clone(), child.clone());
        assert_eq!(
            top_level_selection(&[parent.id.clone(), child.id], &document),
            vec![parent.id]
        );
    }

    #[test]
    fn snap_move_aligns_centers_in_world_space() {
        let moving = NodeId::from("moving");
        let target = NodeId::from("target");
        let originals = HashMap::from([(moving.clone(), Bounds::new(0.0, 0.0, 100.0, 100.0))]);
        let all = HashMap::from([
            (moving.clone(), originals[&moving]),
            (target, Bounds::new(202.0, 0.0, 100.0, 100.0)),
        ]);
        let (delta, guides) = snap_move(Vec2::new(100.0, 0.0), &[moving], &originals, &all, 1.0);
        assert_eq!(delta.x, 102.0);
        assert!(guides.iter().any(|guide| guide.axis == GuideAxis::Vertical));
    }

    #[test]
    fn smart_guides_report_non_overlapping_distance() {
        let moving = NodeId::from("moving");
        let target = NodeId::from("target");
        let originals = HashMap::from([(moving.clone(), Bounds::new(0.0, 0.0, 100.0, 50.0))]);
        let all = HashMap::from([
            (moving.clone(), originals[&moving]),
            (target, Bounds::new(202.0, 150.0, 100.0, 50.0)),
        ]);
        let (_, guides) = snap_move(Vec2::new(102.0, 0.0), &[moving], &originals, &all, 1.0);
        assert_eq!(guides[0].label, Some(100.0));
    }

    #[test]
    fn rotation_handle_hit_and_wrapped_angle_are_stable() {
        let id = NodeId::from("selected");
        let bounds = HashMap::from([(id.clone(), Bounds::new(100.0, 100.0, 80.0, 40.0))]);
        let geometries = HashMap::from([(
            id.clone(),
            VisualGeometry::from_matrix(bounds[&id], Affine2::IDENTITY),
        )]);
        let group = hit_rotation_handle(Vec2::new(140.0, 76.0), &[id], &geometries, 8.0, 24.0);
        assert!(group.is_some());
        assert!((angle_delta(170.0, -170.0) - 20.0).abs() < f64::EPSILON);
        assert_eq!(normalize_degrees(375.0), 15.0);
    }

    #[test]
    fn click_creation_uses_useful_defaults() {
        assert_eq!(
            defaulted_create_bounds(CanvasTool::Text, Vec2::new(4.0, 5.0), Vec2::new(4.0, 5.0)),
            Bounds::new(4.0, 5.0, 160.0, 40.0)
        );
    }

    #[test]
    fn shift_corner_resize_preserves_aspect_ratio() {
        let resized = resize_bounds_with_aspect(
            Bounds::new(10.0, 20.0, 200.0, 100.0),
            ResizeHandle::SouthEast,
            Vec2::new(20.0, 80.0),
        );
        assert!((resized.width / resized.height - 2.0).abs() < f64::EPSILON);
        assert_eq!(resized.x, 10.0);
        assert_eq!(resized.y, 20.0);
    }

    #[test]
    fn svg_path_supports_the_full_editor_command_set() {
        let data = "M 0 0 L 100 0 H 90 V 10 C 80 10 80 20 70 20 S 60 30 50 30 Q 40 30 40 40 T 30 50 A 10 10 0 0 1 20 60 Z";
        let segments = PathParser::from(data)
            .collect::<Result<Vec<_>, _>>()
            .expect("valid SVG path");
        let path = build_svg_path(
            &segments,
            GpBounds::new(point(px(10.0), px(20.0)), size(px(200.0), px(100.0))),
            (0.0, 0.0, 100.0, 100.0),
            25.0,
            PathBuilder::fill(),
        );
        assert!(path.is_some());
    }

    #[test]
    fn overlay_subtree_is_always_painted_last() {
        let mut document = Document::empty("Test");
        let current = document.root_page_id.clone();
        let overlay = Node::root_frame("Overlay");
        let child = Node::rectangle(
            "Dialog",
            overlay.id.clone(),
            Layout::new(20.0, 20.0, 80.0, 60.0),
        );
        document.nodes.insert(overlay.id.clone(), overlay.clone());
        document.nodes.insert(child.id.clone(), child.clone());
        let base_order = paint_order(&document);
        let order = paint_order_with_overlay(&document, &base_order, Some(&overlay.id));
        assert!(order.iter().position(|id| id == &current).unwrap() < order.len() - 2);
        assert_eq!(order[order.len() - 2..], [overlay.id, child.id]);
    }

    #[test]
    fn overlay_preview_maps_hover_and_click_to_the_centered_artboard() {
        let mut document = Document::empty("Test");
        let mut overlay = Node::root_frame("Overlay");
        overlay.layout.x = 1_000.0;
        overlay.layout.y = 800.0;
        overlay.layout.width = 400.0;
        overlay.layout.height = 200.0;
        let overlay_id = overlay.id.clone();
        document.nodes.insert(overlay_id.clone(), overlay);
        let viewport = Rc::new(Cell::new(GpBounds::new(
            point(px(0.0), px(0.0)),
            size(px(1_000.0), px(800.0)),
        )));
        let mut canvas = NativeCanvas::new_with_viewport(document, Camera::default(), viewport);
        canvas.preview = true;
        canvas.preview_overlay = Some(overlay_id);
        let bounds = absolute_bounds(&canvas.document);

        let world = canvas
            .preview_world_at(Vec2::new(500.0, 400.0), &bounds)
            .unwrap();
        assert!((world.x - 1_200.0).abs() < 0.01);
        assert!((world.y - 900.0).abs() < 0.01);
    }

    #[test]
    fn in_view_nodes_excludes_offscreen_layers() {
        let mut document = Document::empty("Test");
        let page = document.root_page_id.clone();
        let visible = Node::rectangle("Visible", page.clone(), Layout::new(20.0, 20.0, 80.0, 40.0));
        let outside = Node::rectangle("Outside", page, Layout::new(900.0, 20.0, 80.0, 40.0));
        document.nodes.insert(visible.id.clone(), visible.clone());
        document.nodes.insert(outside.id.clone(), outside.clone());
        let bounds = absolute_bounds(&document);
        let viewport = GpBounds::new(point(px(0.0), px(0.0)), size(px(500.0), px(400.0)));

        let nodes = in_view_nodes(&document, &bounds, Camera::default(), viewport, None);
        assert!(nodes.contains(&visible.id));
        assert!(!nodes.contains(&outside.id));
    }

    #[test]
    fn view_box_parser_accepts_svg_spacing_and_rejects_zero_size() {
        assert_eq!(parse_view_box("-10, 5 200 100"), (-10.0, 5.0, 200.0, 100.0));
        assert_eq!(parse_view_box("0 0 0 100"), (0.0, 0.0, 100.0, 100.0));
    }

    #[test]
    fn gpui_scroll_delta_moves_canvas_with_the_content() {
        let mut camera = Camera::default();
        apply_scroll_delta(
            &mut camera,
            Vec2::new(100.0, 80.0),
            Vec2::new(24.0, -16.0),
            false,
        );
        assert_eq!(camera.pan, Vec2::new(24.0, -16.0));
    }

    #[test]
    fn positive_gpui_zoom_delta_zooms_in_around_pointer() {
        let mut camera = Camera::default();
        let pointer = Vec2::new(240.0, 160.0);
        let world_before = camera.screen_to_world(pointer);
        apply_scroll_delta(&mut camera, pointer, Vec2::new(0.0, 40.0), true);
        let world_after = camera.screen_to_world(pointer);
        assert!(camera.zoom > 1.0);
        assert!((world_before.x - world_after.x).abs() < 1e-9);
        assert!((world_before.y - world_after.y).abs() < 1e-9);
    }

    #[test]
    fn pinch_zooms_around_the_gesture_center() {
        let mut camera = Camera::default();
        let center = Vec2::new(320.0, 180.0);
        let world_before = camera.screen_to_world(center);
        apply_pinch_delta(&mut camera, center, 0.2);
        let world_after = camera.screen_to_world(center);
        assert!((camera.zoom - 1.2).abs() < 1e-9);
        assert!((world_before.x - world_after.x).abs() < 1e-9);
        assert!((world_before.y - world_after.y).abs() < 1e-9);
    }

    #[test]
    fn selection_and_transform_handles_stay_screen_sized_across_zoom_levels() {
        let mut document = Document::empty("Zoom interaction");
        let page = document.root_page_id.clone();
        let node = Node::rectangle("Card", page, Layout::new(120.0, 90.0, 160.0, 80.0));
        let id = node.id.clone();
        document.nodes.insert(id.clone(), node);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);
        let geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);

        for zoom in [0.1, 0.25, 0.5, 1.0, 2.0, 4.0] {
            let camera = Camera::new(Vec2::new(37.0, -19.0), zoom);
            let world = Vec2::new(180.0, 120.0);
            let screen = camera.world_to_screen(world);
            let mapped = camera.screen_to_world(screen);
            assert!((mapped.x - world.x).abs() < 1e-8);
            assert!((mapped.y - world.y).abs() < 1e-8);
            assert_eq!(
                hit_test(&document, &bounds, &order, mapped),
                Some(id.clone())
            );

            let east = Vec2::new(280.0 + HANDLE_SCREEN_PX * 0.4 / zoom, 130.0);
            assert!(hit_resize_handle(
                east,
                std::slice::from_ref(&id),
                &bounds,
                &geometries,
                HANDLE_SCREEN_PX / zoom,
            )
            .is_some());
        }
    }

    #[test]
    fn parent_rotation_moves_child_hit_geometry() {
        let mut document = Document::empty("Parent transform");
        let page = document.root_page_id.clone();
        let mut parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        parent.rotation = 90.0;
        let parent_id = parent.id.clone();
        let child = Node::rectangle(
            "Child",
            parent_id.clone(),
            Layout::new(0.0, 0.0, 20.0, 20.0),
        );
        let child_id = child.id.clone();
        document.nodes.insert(parent_id, parent);
        document.nodes.insert(child_id.clone(), child);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);

        assert_eq!(
            hit_test(&document, &bounds, &order, Vec2::new(90.0, 10.0)),
            Some(child_id)
        );
    }

    #[test]
    fn rotated_hit_testing_rejects_empty_aabb_corners() {
        let mut document = Document::empty("Rotated hit");
        let page = document.root_page_id.clone();
        let mut node = Node::rectangle("Diamond", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        node.rotation = 45.0;
        let node_id = node.id.clone();
        document.nodes.insert(node_id.clone(), node);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);

        assert_ne!(
            hit_test(&document, &bounds, &order, Vec2::new(0.0, 0.0)),
            Some(node_id)
        );
    }

    #[test]
    fn parent_motion_translation_and_scale_propagate_to_children() {
        let mut document = Document::empty("Parent motion");
        let page = document.root_page_id.clone();
        let parent = Node::frame("Parent", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        let parent_id = parent.id.clone();
        let child = Node::rectangle(
            "Child",
            parent_id.clone(),
            Layout::new(0.0, 0.0, 20.0, 20.0),
        );
        let child_id = child.id.clone();
        document.nodes.insert(parent_id.clone(), parent);
        document.nodes.insert(child_id.clone(), child);
        let bounds = absolute_bounds(&document);
        let frames = HashMap::from([(
            parent_id,
            MotionFrame {
                opacity: 1.0,
                x: 10.0,
                y: 20.0,
                scale_x: 2.0,
                scale_y: 2.0,
                rotate: 0.0,
                fill: None,
                corners: loora_engine::Corners::default(),
                stroke: None,
            },
        )]);

        let geometry = visual_geometries(&document, &bounds, &frames, None)[&child_id];

        assert_eq!(geometry.bounds, Bounds::new(-40.0, -30.0, 40.0, 40.0));
    }

    #[test]
    fn hit_testing_respects_rounded_overflow_corners() {
        let mut document = Document::empty("Rounded hit clip");
        let page = document.root_page_id.clone();
        let mut clip = Node::frame("Clip", page, Layout::new(0.0, 0.0, 100.0, 100.0));
        clip.style.overflow = Overflow::Hidden;
        clip.style.corners = loora_engine::Corners::uniform(40.0);
        let clip_id = clip.id.clone();
        let child = Node::rectangle(
            "Child",
            clip_id.clone(),
            Layout::new(0.0, 0.0, 100.0, 100.0),
        );
        let child_id = child.id.clone();
        document.nodes.insert(clip_id, clip);
        document.nodes.insert(child_id.clone(), child);
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);

        assert_ne!(
            hit_test(&document, &bounds, &order, Vec2::new(5.0, 5.0)),
            Some(child_id)
        );
    }

    #[test]
    fn style_fixture_transformed_child_is_hittable_at_its_painted_center() {
        let document = crate::style_fixture::style_fixture_document();
        let child_id = NodeId::from("fixture_transform_accent");
        let bounds = absolute_bounds(&document);
        let order = paint_order(&document);
        let geometry = visual_geometries(&document, &bounds, &HashMap::new(), None)[&child_id];
        let center = Vec2::new(
            geometry.bounds.x + geometry.bounds.width * 0.5,
            geometry.bounds.y + geometry.bounds.height * 0.5,
        );

        assert_eq!(hit_test(&document, &bounds, &order, center), Some(child_id));
    }

    #[test]
    fn rotated_selection_handles_follow_the_painted_geometry() {
        let mut document = Document::empty("Rotated selection");
        let page = document.root_page_id.clone();
        let mut node = Node::rectangle("Rotated", page, Layout::new(0.0, 0.0, 100.0, 50.0));
        node.rotation = 90.0;
        let id = node.id.clone();
        document.nodes.insert(id.clone(), node);
        let bounds = absolute_bounds(&document);
        let geometry = visual_geometries(&document, &bounds, &HashMap::new(), None)[&id];
        let east = Vec2::new(
            (geometry.corners[1].x + geometry.corners[2].x) * 0.5,
            (geometry.corners[1].y + geometry.corners[2].y) * 0.5,
        );
        let top = Vec2::new(
            (geometry.corners[0].x + geometry.corners[1].x) * 0.5,
            (geometry.corners[0].y + geometry.corners[1].y) * 0.5,
        );
        let center = Vec2::new(
            geometry.corners.iter().map(|point| point.x).sum::<f64>() / 4.0,
            geometry.corners.iter().map(|point| point.y).sum::<f64>() / 4.0,
        );
        let outward = Vec2::new(top.x - center.x, top.y - center.y);
        let length = (outward.x.powi(2) + outward.y.powi(2)).sqrt();
        let outward = Vec2::new(outward.x / length, outward.y / length);
        let rotation_handle = Vec2::new(top.x + outward.x * 24.0, top.y + outward.y * 24.0);

        let (handle, _, basis) = hit_resize_handle(
            east,
            std::slice::from_ref(&id),
            &bounds,
            &visual_geometries(&document, &bounds, &HashMap::new(), None),
            1.0,
        )
        .expect("painted east handle should be interactive");
        assert_eq!(handle, ResizeHandle::East);
        let local_delta = basis.project(Vec2::new(0.0, 10.0));
        assert!((local_delta.x - 10.0).abs() < 0.001);
        assert!(local_delta.y.abs() < 0.001);
        assert!(hit_rotation_handle(
            rotation_handle,
            std::slice::from_ref(&id),
            &visual_geometries(&document, &bounds, &HashMap::new(), None),
            1.0,
            24.0,
        )
        .is_some());
    }

    #[test]
    fn marquee_uses_transformed_shape_instead_of_empty_aabb_corners() {
        let geometry = VisualGeometry::from_matrix(
            Bounds::new(0.0, 0.0, 100.0, 100.0),
            Affine2::around(
                Vec2::new(50.0, 50.0),
                Vec2::default(),
                Vec2::new(1.0, 1.0),
                45.0,
            ),
        );

        assert!(!quad_intersects_bounds(
            geometry.corners,
            Bounds::new(-20.0, -20.0, 5.0, 5.0),
        ));
        assert!(quad_intersects_bounds(
            geometry.corners,
            Bounds::new(45.0, 45.0, 10.0, 10.0),
        ));
    }

    #[test]
    fn complex_page_raster_survives_drag_start() {
        let document = crate::style_fixture::style_fixture_document();
        let page = document.root_page_id.clone();
        let bounds = absolute_bounds(&document);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
        assert!(canvas.page_rasters.contains_key(&page));
        let original_image = canvas.page_rasters[&page].image.clone();

        let dragged = NodeId::from("fixture_transform_card");
        let original = bounds[&dragged];
        canvas.drag = Some(DragState::Move {
            start_world: Vec2::new(original.x, original.y),
            ids: vec![dragged.clone()],
            originals: HashMap::from([(dragged, original)]),
            delta: Vec2::new(10.0, 5.0),
            duplicate: false,
        });
        let preview_bounds = canvas.preview_bounds();
        canvas.sync_page_rasters(&document, &HashMap::new(), &preview_bounds);

        assert!(canvas.page_rasters.contains_key(&page));
        assert!(!Arc::ptr_eq(
            &original_image,
            &canvas.page_rasters[&page].image
        ));
    }

    fn next_batch_complex_document() -> (Document, NodeId, NodeId, NodeId) {
        let mut document = Document::empty("Interaction raster");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 320.0;
            page_node.layout.height = 140.0;
            page_node
                .style
                .set_solid_fill(Some(Color::rgb(255, 255, 255)));
        }
        let mut gradient = Node::rectangle(
            "Gradient",
            page.clone(),
            Layout::new(20.0, 20.0, 80.0, 80.0),
        );
        gradient.id = NodeId::from("interaction_gradient");
        gradient.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                loora_engine::GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 0, 0),
                    token_id: None,
                },
                loora_engine::GradientStop {
                    offset: 1.0,
                    color: Color::rgb(0, 0, 255),
                    token_id: None,
                },
            ],
        }];
        let gradient_id = gradient.id.clone();
        let mut text = Node::text(
            "Editable",
            page.clone(),
            Layout::new(140.0, 35.0, 140.0, 48.0),
            "Edit me",
        );
        text.id = NodeId::from("interaction_text");
        text.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                loora_engine::GradientStop {
                    offset: 0.0,
                    color: Color::rgb(20, 20, 20),
                    token_id: None,
                },
                loora_engine::GradientStop {
                    offset: 1.0,
                    color: Color::rgb(90, 90, 90),
                    token_id: None,
                },
            ],
        }];
        let text_id = text.id.clone();
        document.nodes.insert(gradient_id.clone(), gradient);
        document.nodes.insert(text_id.clone(), text);
        (document, page, gradient_id, text_id)
    }

    #[test]
    fn next_batch_move_drag_reuses_raster_between_pointer_updates() {
        let (document, page, id, _) = next_batch_complex_document();
        let bounds = absolute_bounds(&document);
        let original = bounds[&id];
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.drag = Some(DragState::Move {
            start_world: Vec2::new(original.x, original.y),
            ids: vec![id.clone()],
            originals: HashMap::from([(id, original)]),
            delta: Vec2::new(10.0, 0.0),
            duplicate: false,
        });
        let preview_bounds = canvas.preview_bounds();
        canvas.sync_page_rasters(&document, &HashMap::new(), &preview_bounds);
        let first = canvas.page_rasters[&page].image.clone();
        let first_overlay = canvas.page_rasters[&page].overlay.clone().unwrap();
        if let Some(DragState::Move { delta, .. }) = canvas.drag.as_mut() {
            *delta = Vec2::new(20.0, 0.0);
        }
        let started = Instant::now();
        let preview_bounds = canvas.preview_bounds();
        canvas.sync_page_rasters(&document, &HashMap::new(), &preview_bounds);
        eprintln!("cached move raster update took {:?}", started.elapsed());

        assert!(Arc::ptr_eq(&first, &canvas.page_rasters[&page].image));
        assert!(Arc::ptr_eq(
            &first_overlay,
            canvas.page_rasters[&page].overlay.as_ref().unwrap()
        ));
    }

    #[test]
    fn next_batch_text_edit_keeps_complex_page_rasterized() {
        let (document, page, _, text_id) = next_batch_complex_document();
        let bounds = absolute_bounds(&document);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
        assert!(canvas.page_rasters.contains_key(&page));
        canvas.text_edit = Some(NativeTextEdit {
            id: text_id,
            anchor: 0,
            caret: 0,
            caret_visible: true,
            marked_range: None,
        });
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);

        assert!(canvas.page_rasters.contains_key(&page));
    }

    #[test]
    fn next_editor_small_zoom_delta_reuses_page_raster() {
        let (document, page, _, _) = next_batch_complex_document();
        let bounds = absolute_bounds(&document);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(GpBounds::default())),
        );
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
        let first = canvas.page_rasters[&page].image.clone();

        canvas.camera.zoom = 1.01;
        let started = Instant::now();
        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
        eprintln!("small zoom raster update took {:?}", started.elapsed());

        assert!(Arc::ptr_eq(&first, &canvas.page_rasters[&page].image));
    }

    #[test]
    fn zoom_raster_covers_retina_device_pixels() {
        let zoom = 0.7;
        let display_scale = 2.0;
        let raster_scale = raster_scale_for_zoom(zoom, display_scale);

        assert!(
            raster_scale >= zoom as f32 * display_scale,
            "raster scale {raster_scale} undersamples {zoom}x zoom on a {display_scale}x display"
        );
    }

    #[test]
    fn zoom_raster_covers_retina_beyond_two_hundred_percent() {
        let zoom = 4.0;
        let display_scale = 2.0;
        let raster_scale = raster_scale_for_zoom(zoom, display_scale);

        assert!(
            raster_scale >= zoom as f32 * display_scale,
            "raster scale {raster_scale} undersamples {zoom}x zoom on a {display_scale}x display"
        );
    }

    #[test]
    fn large_page_raster_work_is_bounded_by_the_visible_viewport() {
        let (mut document, page, _, _) = next_batch_complex_document();
        document.nodes.get_mut(&page).unwrap().layout = Layout::new(0.0, 0.0, 3_000.0, 2_000.0);
        let viewport = GpBounds::new(point(px(0.0), px(0.0)), size(px(800.0), px(600.0)));
        let bounds = absolute_bounds(&document);
        let mut canvas = NativeCanvas::new_with_viewport(
            document.clone(),
            Camera::default(),
            Rc::new(Cell::new(viewport)),
        );

        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);

        let raster_pixels = canvas.page_rasters[&page]
            .tiles
            .iter()
            .map(|tile| {
                let size = tile.image.size(0);
                size.width.0 as u64 * size.height.0 as u64
            })
            .sum::<u64>();
        let viewport_pixels = 800_u64 * 600_u64;
        assert!(
            raster_pixels <= viewport_pixels * 4,
            "visible 800x600 viewport rasterized {raster_pixels} pixels"
        );
    }

    #[gpui::test]
    fn panning_renders_only_missing_edge_tiles_and_reuses_overlap(cx: &mut TestAppContext) {
        let (mut document, page, _, _) = next_batch_complex_document();
        document.nodes.get_mut(&page).unwrap().layout = Layout::new(0.0, 0.0, 3_000.0, 2_000.0);
        let viewport = Rc::new(Cell::new(GpBounds::new(
            point(px(0.0), px(0.0)),
            size(px(800.0), px(600.0)),
        )));
        let canvas = cx.new(|_| {
            NativeCanvas::new_with_viewport(document.clone(), Camera::default(), viewport.clone())
        });
        let before = canvas.update(cx, |canvas, _| {
            let bounds = absolute_bounds(&document);
            canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
            canvas.page_rasters[&page]
                .tiles
                .iter()
                .map(|tile| ((tile.region.column, tile.region.row), tile.image.clone()))
                .collect::<HashMap<_, _>>()
        });

        canvas.update(cx, |canvas, cx| {
            canvas.camera.pan.x = -260.0;
            let bounds = absolute_bounds(&document);
            canvas.sync_page_rasters_with_context(&document, &HashMap::new(), &bounds, Some(cx));
            assert!(canvas.page_raster_jobs.contains_key(&page));
        });
        cx.run_until_parked();

        canvas.update(cx, |canvas, _| {
            let after = &canvas.page_rasters[&page];
            let reused = after
                .tiles
                .iter()
                .filter(|tile| {
                    before
                        .get(&(tile.region.column, tile.region.row))
                        .is_some_and(|image| Arc::ptr_eq(image, &tile.image))
                })
                .count();
            assert!(reused >= 12, "only {reused} overlapping tiles were reused");
            let started = Instant::now();
            let bounds = absolute_bounds(&document);
            canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
            assert!(
                started.elapsed() < std::time::Duration::from_millis(16),
                "cached pan sync exceeded one frame: {:?}",
                started.elapsed()
            );
        });
    }

    #[test]
    fn centered_preview_overlay_rasterizes_even_when_its_world_page_is_offscreen() {
        let mut document = Document::empty("Overlay raster");
        let mut overlay = Node::root_frame("Overlay");
        overlay.layout = Layout::new(5_000.0, 5_000.0, 320.0, 240.0);
        let overlay_id = overlay.id.clone();
        let mut card = Node::rectangle(
            "Rotated card",
            overlay_id.clone(),
            Layout::new(40.0, 40.0, 120.0, 80.0),
        );
        card.rotation = 12.0;
        document.nodes.insert(overlay_id.clone(), overlay);
        document.nodes.insert(card.id.clone(), card);
        let viewport = Rc::new(Cell::new(GpBounds::new(
            point(px(0.0), px(0.0)),
            size(px(800.0), px(600.0)),
        )));
        let bounds = absolute_bounds(&document);
        let mut canvas =
            NativeCanvas::new_with_viewport(document.clone(), Camera::default(), viewport);
        canvas.preview_overlay = Some(overlay_id.clone());

        canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);

        assert!(canvas.page_rasters.contains_key(&overlay_id));
    }

    #[test]
    fn continuous_zoom_does_not_cross_many_raster_buckets() {
        let scales = (35..=200)
            .map(|percent| raster_scale_for_zoom(percent as f64 / 100.0, 2.0))
            .collect::<Vec<_>>();
        let changes = scales
            .windows(2)
            .filter(|pair| pair[0].to_bits() != pair[1].to_bits())
            .count();

        assert!(
            changes <= 2,
            "continuous zoom crossed {changes} raster buckets: {scales:?}"
        );
    }

    #[gpui::test]
    fn zoom_upgrade_keeps_current_raster_while_sharper_pixels_render(cx: &mut TestAppContext) {
        let (document, page, _, _) = next_batch_complex_document();
        let bounds = absolute_bounds(&document);
        let canvas = cx.new(|cx| NativeCanvas::new(document.clone(), Camera::default(), cx));
        let first = canvas.update(cx, |canvas, _| {
            canvas.display_scale = 2.0;
            canvas.camera.zoom = 0.35;
            canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
            canvas.page_rasters[&page].image.clone()
        });

        canvas.update(cx, |canvas, cx| {
            canvas.camera.zoom = 0.7;
            canvas.sync_page_rasters_with_context(&document, &HashMap::new(), &bounds, Some(cx));
            assert!(Arc::ptr_eq(&first, &canvas.page_rasters[&page].image));
            assert!(canvas.page_raster_jobs.contains_key(&page));
        });
        cx.run_until_parked();

        let (upgraded, scale) = canvas.update(cx, |canvas, _| {
            (
                canvas.page_rasters[&page].image.clone(),
                canvas.page_rasters[&page].scale,
            )
        });
        assert!(!Arc::ptr_eq(&first, &upgraded));
        assert_eq!(scale, 2.0);
    }

    #[gpui::test]
    fn next_editor_unrelated_page_edit_reuses_unchanged_raster(cx: &mut TestAppContext) {
        let mut document = Document::empty("Page-local raster cache");
        let first_page = document.root_page_id.clone();
        document.nodes.get_mut(&first_page).unwrap().layout = Layout::new(0.0, 0.0, 120.0, 120.0);
        let mut second_page_node = Node::root_frame("Second");
        second_page_node.layout = Layout::new(200.0, 0.0, 120.0, 120.0);
        let second_page = second_page_node.id.clone();
        document.nodes.insert(second_page.clone(), second_page_node);
        let mut first_card = Node::rectangle(
            "First card",
            first_page.clone(),
            Layout::new(20.0, 20.0, 80.0, 80.0),
        );
        first_card.rotation = 12.0;
        document.nodes.insert(first_card.id.clone(), first_card);
        let mut second_card = Node::rectangle(
            "Second card",
            second_page.clone(),
            Layout::new(20.0, 20.0, 80.0, 80.0),
        );
        second_card.rotation = -12.0;
        let second_card_id = second_card.id.clone();
        document.nodes.insert(second_card_id.clone(), second_card);

        let canvas = cx.new(|cx| NativeCanvas::new(document.clone(), Camera::default(), cx));
        let (first_image, second_image) = canvas.update(cx, |canvas, _| {
            let bounds = absolute_bounds(&document);
            canvas.sync_page_rasters(&document, &HashMap::new(), &bounds);
            (
                canvas.page_rasters[&first_page].image.clone(),
                canvas.page_rasters[&second_page].image.clone(),
            )
        });

        let mut updated = document.clone();
        updated
            .nodes
            .get_mut(&second_card_id)
            .unwrap()
            .style
            .set_solid_fill(Some(Color::rgb(255, 80, 80)));
        canvas.update(cx, |canvas, cx| {
            canvas.set_scene(
                Arc::new(updated.clone()),
                1,
                Camera::default(),
                Vec::new(),
                Vec::new(),
                CanvasTool::Select,
                false,
                None,
                None,
                CanvasPalette::default(),
                cx,
            );
            let bounds = absolute_bounds(&updated);
            canvas.sync_page_rasters(&updated, &HashMap::new(), &bounds);

            assert!(Arc::ptr_eq(
                &first_image,
                &canvas.page_rasters[&first_page].image
            ));
            assert!(!Arc::ptr_eq(
                &second_image,
                &canvas.page_rasters[&second_page].image
            ));
        });
    }

    #[test]
    fn next_batch_rotated_layout_badges_follow_the_container() {
        let mut document = Document::empty("Rotated layout controls");
        let page = document.root_page_id.clone();
        let mut stack = Node::frame("Stack", page, Layout::new(100.0, 80.0, 240.0, 160.0));
        stack.layout.mode = LayoutMode::Flex;
        stack.rotation = 90.0;
        stack.layout.gap = 20.0;
        let stack_id = stack.id.clone();
        document.nodes.insert(stack_id.clone(), stack);
        for (index, x) in [12.0, 92.0].into_iter().enumerate() {
            let mut child = Node::rectangle(
                format!("Child {index}"),
                stack_id.clone(),
                Layout::new(x, 12.0, 60.0, 48.0),
            );
            child.layout.position = loora_engine::LayoutPosition::Flow;
            child.order = index as f64 * 1024.0;
            document.nodes.insert(child.id.clone(), child);
        }
        let bounds = absolute_bounds(&document);
        let geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);
        let (_, badges) = layout_badges(
            std::slice::from_ref(&stack_id),
            &document,
            &bounds,
            &geometries,
            1.0,
        )
        .unwrap();
        let badge_center = Vec2::new(
            badges[0].bounds.x + badges[0].bounds.width * 0.5,
            badges[0].bounds.y + badges[0].bounds.height * 0.5,
        );
        let raw_center = gap_badge_position(&document.nodes[&stack_id], &document, &bounds)
            .unwrap()
            .0;
        let expected = geometries[&stack_id].matrix.apply(raw_center);

        assert!(point_distance(badge_center, expected) < 0.001);
    }

    #[test]
    fn next_batch_multi_resize_uses_the_painted_group_bounds() {
        let mut document = Document::empty("Transformed multi selection");
        let page = document.root_page_id.clone();
        let mut rotated =
            Node::rectangle("Rotated", page.clone(), Layout::new(0.0, 0.0, 100.0, 100.0));
        rotated.rotation = 45.0;
        let rotated_id = rotated.id.clone();
        let plain = Node::rectangle("Plain", page, Layout::new(200.0, 0.0, 100.0, 100.0));
        let plain_id = plain.id.clone();
        document.nodes.insert(rotated_id.clone(), rotated);
        document.nodes.insert(plain_id.clone(), plain);
        let selection = vec![rotated_id, plain_id];
        let bounds = absolute_bounds(&document);
        let geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);
        let visual = selection_visual_geometry(&selection, &geometries).unwrap();
        let handles = visual.handles();
        let (_, group, _) =
            hit_resize_handle(handles[3], &selection, &bounds, &geometries, 1.0).unwrap();

        assert!((group.x - visual.corners[0].x).abs() < 0.001);
        assert!((group.right() - visual.corners[2].x).abs() < 0.001);
    }

    #[test]
    fn next_batch_multi_rotation_moves_members_around_the_group_center() {
        let mut document = Document::empty("Multi rotation");
        let page = document.root_page_id.clone();
        let left = Node::rectangle("Left", page.clone(), Layout::new(0.0, 0.0, 100.0, 100.0));
        let left_id = left.id.clone();
        let right = Node::rectangle("Right", page, Layout::new(200.0, 0.0, 100.0, 100.0));
        let right_id = right.id.clone();
        document.nodes.insert(left_id.clone(), left);
        document.nodes.insert(right_id.clone(), right);
        let bounds = absolute_bounds(&document);
        let selection = vec![left_id.clone(), right_id.clone()];
        let original_geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);
        let transform =
            multi_transform(&selection, &document, &bounds, &original_geometries).unwrap();
        let rotated_bounds = rotate_multi_transform(&transform, Vec2::new(150.0, 50.0), 90.0);
        let mut preview_bounds = bounds.clone();
        preview_bounds.extend(
            rotated_bounds
                .iter()
                .map(|(id, bounds)| (id.clone(), *bounds)),
        );
        let drag = DragState::Rotate {
            center: Vec2::new(150.0, 50.0),
            start_angle: 0.0,
            originals: HashMap::from([(left_id.clone(), 0.0), (right_id.clone(), 0.0)]),
            current: HashMap::from([(left_id.clone(), 90.0), (right_id, 90.0)]),
            bounds: Some(MultiRotateBounds {
                current: rotated_bounds,
                members: transform,
            }),
        };
        let geometries =
            visual_geometries(&document, &preview_bounds, &HashMap::new(), Some(&drag));
        let center = geometries[&left_id].bounds;

        assert!((center.x + center.width * 0.5 - 150.0).abs() < 0.001);
        assert!((center.y + center.height * 0.5 + 50.0).abs() < 0.001);
    }

    #[test]
    fn drag_preview_raster_moves_gradient_pixels_without_dropping_style() {
        let mut document = Document::empty("Gradient drag");
        let page = document.root_page_id.clone();
        if let Some(page_node) = document.nodes.get_mut(&page) {
            page_node.layout.width = 240.0;
            page_node.layout.height = 100.0;
            page_node
                .style
                .set_solid_fill(Some(Color::rgb(255, 255, 255)));
        }
        let mut gradient = Node::rectangle(
            "Gradient",
            page.clone(),
            Layout::new(20.0, 20.0, 40.0, 40.0),
        );
        gradient.id = NodeId::from("drag_gradient");
        gradient.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                loora_engine::GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 0, 0),
                    token_id: None,
                },
                loora_engine::GradientStop {
                    offset: 1.0,
                    color: Color::rgb(0, 0, 255),
                    token_id: None,
                },
            ],
        }];
        let id = gradient.id.clone();
        document.nodes.insert(id.clone(), gradient);
        let bounds = absolute_bounds(&document);
        let original = bounds[&id];
        let drag = DragState::Move {
            start_world: Vec2::new(original.x, original.y),
            ids: vec![id.clone()],
            originals: HashMap::from([(id.clone(), original)]),
            delta: Vec2::new(120.0, 0.0),
            duplicate: false,
        };
        let mut preview_bounds = bounds.clone();
        translate_subtree(&document, &id, 120.0, 0.0, &mut preview_bounds);
        let preview = raster_preview_document(&document, &preview_bounds, Some(&drag)).unwrap();
        let image = scene_raster::render_page(&preview, &page, &HashMap::new(), 1.0).unwrap();
        let old_center = image.get_pixel(40, 40).0;
        let moved_center = image.get_pixel(160, 40).0;

        assert!(old_center[0] > 245 && old_center[1] > 245 && old_center[2] > 245);
        assert!(moved_center[0] > 40 && moved_center[2] > 40);
        assert!(moved_center[1] < 40);
        assert_eq!(moved_center[3], 255);
    }

    #[test]
    fn layout_metric_badges_stay_screen_sized_and_draggable() {
        let mut document = Document::empty("Layout controls");
        let page = document.root_page_id.clone();
        let mut stack = Node::frame("Stack", page, Layout::new(100.0, 80.0, 320.0, 180.0));
        stack.layout.mode = LayoutMode::Flex;
        stack.layout.gap = 16.0;
        stack.layout.padding = Insets::uniform(12.0);
        let stack_id = stack.id.clone();
        document.nodes.insert(stack_id.clone(), stack);
        for (index, x) in [12.0, 88.0].into_iter().enumerate() {
            let mut child = Node::rectangle(
                format!("Child {index}"),
                stack_id.clone(),
                Layout::new(x, 12.0, 60.0, 48.0),
            );
            child.layout.position = loora_engine::LayoutPosition::Flow;
            child.order = index as f64 * 1024.0;
            document.nodes.insert(child.id.clone(), child);
        }
        let bounds = absolute_bounds(&document);
        let geometries = visual_geometries(&document, &bounds, &HashMap::new(), None);
        let (_, at_half) = layout_badges(
            std::slice::from_ref(&stack_id),
            &document,
            &bounds,
            &geometries,
            0.5,
        )
        .unwrap();
        let (_, at_double) = layout_badges(
            std::slice::from_ref(&stack_id),
            &document,
            &bounds,
            &geometries,
            2.0,
        )
        .unwrap();

        assert_eq!(at_half.len(), 5);
        assert_eq!(at_double.len(), 5);
        assert!((at_half[0].bounds.width * 0.5 - at_double[0].bounds.width * 2.0).abs() < 0.01);
        assert!(at_half
            .iter()
            .any(|badge| matches!(badge.kind, LayoutBadgeKind::Gap(FlexDirection::Row))));
        assert_eq!(
            resized_padding(
                Insets::uniform(12.0),
                PaddingEdge::Left,
                Vec2::new(18.0, 50.0),
                320.0,
                180.0,
            ),
            Insets {
                left: 30.0,
                ..Insets::uniform(12.0)
            }
        );
    }

    #[test]
    fn large_scene_index_covers_every_node_without_quadratic_tree_scans() {
        let mut document = Document::empty("Large scene");
        let page = document.root_page_id.clone();
        for index in 0..5_000 {
            let mut node = Node::rectangle(
                format!("Node {index}"),
                page.clone(),
                Layout::new(
                    (index % 100) as f64 * 12.0,
                    (index / 100) as f64 * 12.0,
                    10.0,
                    10.0,
                ),
            );
            node.order = index as f64;
            document.nodes.insert(node.id.clone(), node);
        }
        let started = Instant::now();
        let order = paint_order(&document);
        let bounds = absolute_bounds(&document);
        eprintln!(
            "indexed {} nodes in {:?}",
            document.nodes.len(),
            started.elapsed()
        );
        assert_eq!(order.len(), document.nodes.len());
        assert_eq!(bounds.len(), document.nodes.len());
    }

    #[test]
    fn flex_drag_shows_an_insertion_guide_before_the_target_child() {
        let mut document = Document::empty("Guide");
        let page = document.root_page_id.clone();
        let mut stack = Node::frame("Stack", page, Layout::new(100.0, 80.0, 240.0, 100.0));
        stack.layout.mode = loora_engine::LayoutMode::Flex;
        let stack_id = stack.id.clone();
        document.nodes.insert(stack_id.clone(), stack);
        let mut dragged =
            Node::rectangle("A", stack_id.clone(), Layout::new(10.0, 10.0, 50.0, 40.0));
        dragged.layout.position = loora_engine::LayoutPosition::Flow;
        let dragged_id = dragged.id.clone();
        document.nodes.insert(dragged_id.clone(), dragged);
        let mut target = Node::rectangle("B", stack_id, Layout::new(80.0, 10.0, 50.0, 40.0));
        target.layout.position = loora_engine::LayoutPosition::Flow;
        target.order = 2048.0;
        document.nodes.insert(target.id.clone(), target);
        let bounds = absolute_bounds(&document);

        let order = paint_order(&document);
        let guide = flow_drop_guide(
            &document,
            &order,
            &dragged_id,
            Vec2::new(170.0, 110.0),
            &bounds,
        )
        .unwrap();
        assert_eq!(guide.axis, GuideAxis::Vertical);
        assert!((guide.position - 180.0).abs() < f64::EPSILON);
    }
}
