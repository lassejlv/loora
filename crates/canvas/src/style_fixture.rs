//! Permanent visual regression document for native-canvas style parity.

use loora_engine::{
    Color, Corners, Document, GradientStop, Layout, Node, NodeId, Overflow, Paint, Shadow,
    TextDecoration, TextRun, TypographyPatch,
};

/// A stable artboard covering transforms, clips, gradients, rich type, opacity and blend modes.
pub fn style_fixture_document() -> Document {
    let mut document = Document::empty("Native Canvas Style Parity");
    let old_page = document.root_page_id.clone();
    let mut page = document.nodes.remove(&old_page).expect("fixture page");
    page.id = NodeId::from("style_fixture_page");
    page.name = "Style Parity".into();
    page.layout.width = 1200.0;
    page.layout.height = 760.0;
    page.style.fills = vec![Paint::solid(Color::rgb(0xf0, 0xed, 0xe6))];
    page.style.stroke = None;
    page.style.overflow = Overflow::Hidden;
    page.viewport = Some(loora_engine::PageViewport {
        width: 1200.0,
        min_height: 760.0,
    });
    let page_id = page.id.clone();
    document.root_page_id = page_id.clone();
    document.id = "native-canvas-style-parity".into();
    document.nodes.insert(page_id.clone(), page);

    let mut eyebrow = Node::text(
        "Eyebrow",
        page_id.clone(),
        Layout::new(72.0, 54.0, 620.0, 24.0),
        "NATIVE GPUI · STYLE REGRESSION",
    );
    eyebrow.id = NodeId::from("fixture_eyebrow");
    eyebrow.typography.as_mut().unwrap().size = 13.0;
    eyebrow.typography.as_mut().unwrap().weight = 700;
    eyebrow.typography.as_mut().unwrap().letter_spacing = 2.4;
    eyebrow
        .style
        .set_solid_fill(Some(Color::rgb(0x57, 0x58, 0x5c)));
    document.nodes.insert(eyebrow.id.clone(), eyebrow);

    let mut title = Node::text(
        "Gradient title",
        page_id.clone(),
        Layout::new(68.0, 82.0, 930.0, 72.0),
        "Canvas, without the browser.",
    );
    title.id = NodeId::from("fixture_title");
    title.typography.as_mut().unwrap().size = 54.0;
    title.typography.as_mut().unwrap().weight = 720;
    title.typography.as_mut().unwrap().letter_spacing = -1.8;
    title.style.fills = vec![linear(
        90.0,
        Color::rgb(0x24, 0x35, 0x64),
        Color::rgb(0xd0, 0x68, 0x54),
    )];
    document.nodes.insert(title.id.clone(), title);

    let mut transform_card = Node::frame(
        "Inherited transform",
        page_id.clone(),
        Layout::new(80.0, 196.0, 300.0, 218.0),
    );
    transform_card.id = NodeId::from("fixture_transform_card");
    transform_card.rotation = -6.0;
    transform_card.style.fills = vec![Paint::solid(Color::rgb(0x23, 0x2b, 0x3b))];
    transform_card.style.corners = Corners::uniform(26.0);
    transform_card.style.shadows = vec![Shadow {
        color: Color::rgba(0.08, 0.1, 0.16, 0.28),
        x: 0.0,
        y: 18.0,
        blur: 38.0,
        spread: -12.0,
        inset: false,
        token_id: None,
    }];
    let transform_id = transform_card.id.clone();
    document.nodes.insert(transform_id.clone(), transform_card);

    let mut transform_accent = Node::rectangle(
        "Transformed child",
        transform_id.clone(),
        Layout::new(28.0, 28.0, 244.0, 82.0),
    );
    transform_accent.id = NodeId::from("fixture_transform_accent");
    transform_accent.style.fills = vec![linear(
        125.0,
        Color::rgb(0x69, 0x83, 0xc1),
        Color::rgb(0xb9, 0xc5, 0xe8),
    )];
    transform_accent.style.corners = Corners::uniform(18.0);
    document
        .nodes
        .insert(transform_accent.id.clone(), transform_accent);

    let mut transform_label = Node::text(
        "Transform label",
        transform_id,
        Layout::new(30.0, 132.0, 240.0, 52.0),
        "Parent rotation\nmoves every child",
    );
    transform_label.id = NodeId::from("fixture_transform_label");
    transform_label.typography.as_mut().unwrap().size = 20.0;
    transform_label.typography.as_mut().unwrap().weight = 620;
    transform_label
        .style
        .set_solid_fill(Some(Color::rgb(0xf5, 0xf6, 0xfa)));
    document
        .nodes
        .insert(transform_label.id.clone(), transform_label);

    let mut clip = Node::frame(
        "Rounded rotated clip",
        page_id.clone(),
        Layout::new(450.0, 184.0, 300.0, 230.0),
    );
    clip.id = NodeId::from("fixture_clip");
    clip.rotation = 5.0;
    clip.style.overflow = Overflow::Hidden;
    clip.style.corners = Corners {
        tl: 56.0,
        tr: 18.0,
        br: 56.0,
        bl: 18.0,
    };
    clip.style.fills = vec![Paint::solid(Color::rgb(0xd8, 0xdf, 0xd4))];
    let clip_id = clip.id.clone();
    document.nodes.insert(clip_id.clone(), clip);

    for (id, x, y, width, height, color, rotation) in [
        (
            "fixture_clip_a",
            -42.0,
            18.0,
            180.0,
            92.0,
            Color::rgb(0x47, 0x65, 0x6f),
            -12.0,
        ),
        (
            "fixture_clip_b",
            128.0,
            54.0,
            220.0,
            124.0,
            Color::rgb(0xd7, 0x89, 0x64),
            18.0,
        ),
        (
            "fixture_clip_c",
            46.0,
            148.0,
            214.0,
            96.0,
            Color::rgb(0xee, 0xc9, 0x82),
            -4.0,
        ),
    ] {
        let mut child = Node::rectangle(
            "Clipped child",
            clip_id.clone(),
            Layout::new(x, y, width, height),
        );
        child.id = NodeId::from(id);
        child.rotation = rotation;
        child.style.set_solid_fill(Some(color));
        child.style.corners = Corners::uniform(24.0);
        document.nodes.insert(child.id.clone(), child);
    }

    let mut blend_base = Node::frame(
        "Blend modes",
        page_id.clone(),
        Layout::new(820.0, 184.0, 300.0, 230.0),
    );
    blend_base.id = NodeId::from("fixture_blend_base");
    blend_base.style.fills = vec![linear(
        20.0,
        Color::rgb(0x3a, 0x70, 0x85),
        Color::rgb(0x7b, 0x9d, 0x92),
    )];
    blend_base.style.corners = Corners::uniform(28.0);
    blend_base.style.overflow = Overflow::Hidden;
    let blend_id = blend_base.id.clone();
    document.nodes.insert(blend_id.clone(), blend_base);

    let mut multiply = Node::rectangle(
        "Multiply",
        blend_id.clone(),
        Layout::new(34.0, 30.0, 154.0, 154.0),
    );
    multiply.id = NodeId::from("fixture_multiply");
    multiply
        .style
        .set_solid_fill(Some(Color::rgba(0.94, 0.28, 0.24, 0.92)));
    multiply.style.corners = Corners::uniform(77.0);
    multiply.style.blend_mode = Some("multiply".into());
    document.nodes.insert(multiply.id.clone(), multiply);

    let mut screen = Node::rectangle("Screen", blend_id, Layout::new(116.0, 70.0, 150.0, 130.0));
    screen.id = NodeId::from("fixture_screen");
    screen
        .style
        .set_solid_fill(Some(Color::rgba(0.95, 0.77, 0.25, 0.88)));
    screen.style.corners = Corners::uniform(34.0);
    screen.style.blend_mode = Some("screen".into());
    document.nodes.insert(screen.id.clone(), screen);

    let mut opacity = Node::frame(
        "Nested opacity",
        page_id.clone(),
        Layout::new(80.0, 490.0, 300.0, 170.0),
    );
    opacity.id = NodeId::from("fixture_opacity");
    opacity.style.opacity = 0.68;
    opacity.style.fills = vec![Paint::solid(Color::rgb(0x20, 0x2c, 0x32))];
    opacity.style.corners = Corners::uniform(24.0);
    let opacity_id = opacity.id.clone();
    document.nodes.insert(opacity_id.clone(), opacity);
    let mut opacity_child = Node::rectangle(
        "Opacity child",
        opacity_id,
        Layout::new(26.0, 28.0, 248.0, 114.0),
    );
    opacity_child.id = NodeId::from("fixture_opacity_child");
    opacity_child.style.opacity = 0.56;
    opacity_child.style.fills = vec![radial(
        Color::rgb(0xfa, 0xd1, 0x9a),
        Color::rgb(0xb2, 0x76, 0x69),
    )];
    opacity_child.style.corners = Corners::uniform(18.0);
    document
        .nodes
        .insert(opacity_child.id.clone(), opacity_child);

    let mut typography = Node::text(
        "Rich typography",
        page_id.clone(),
        Layout::new(450.0, 492.0, 670.0, 150.0),
        "Rich type, gradients, and spacing\nshould survive the native canvas.",
    );
    typography.id = NodeId::from("fixture_typography");
    typography.typography.as_mut().unwrap().size = 29.0;
    typography.typography.as_mut().unwrap().weight = 470;
    typography.typography.as_mut().unwrap().line_height = Some(1.35);
    typography.typography.as_mut().unwrap().letter_spacing = 0.4;
    typography.style.fills = vec![linear(
        90.0,
        Color::rgb(0x2d, 0x3d, 0x54),
        Color::rgb(0xa5, 0x4f, 0x49),
    )];
    typography.text_runs = vec![
        TextRun {
            start: 0,
            end: 9,
            typography: Some(TypographyPatch {
                weight: Some(760),
                letter_spacing: Some(-0.8),
                ..TypographyPatch::default()
            }),
            color: None,
            color_token: None,
        },
        TextRun {
            start: 10,
            end: 20,
            typography: Some(TypographyPatch {
                decoration: Some("underline".into()),
                ..TypographyPatch::default()
            }),
            color: Some(Color::rgb(0x6a, 0x54, 0x91)),
            color_token: None,
        },
    ];
    typography.typography.as_mut().unwrap().decoration = TextDecoration::None;
    document.nodes.insert(typography.id.clone(), typography);

    document
}

fn linear(angle: f32, start: Color, end: Color) -> Paint {
    Paint::LinearGradient {
        angle,
        stops: vec![
            GradientStop {
                offset: 0.0,
                color: start,
                token_id: None,
            },
            GradientStop {
                offset: 1.0,
                color: end,
                token_id: None,
            },
        ],
    }
}

fn radial(center: Color, edge: Color) -> Paint {
    Paint::RadialGradient {
        cx: 0.35,
        cy: 0.3,
        size: Some("farthest-corner".into()),
        stops: vec![
            GradientStop {
                offset: 0.0,
                color: center,
                token_id: None,
            },
            GradientStop {
                offset: 1.0,
                color: edge,
                token_id: None,
            },
        ],
    }
}
