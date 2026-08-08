use gpui::{
    div, prelude::FluentBuilder, px, Entity, InteractiveElement, IntoElement, MouseButton,
    ParentElement, SharedString, Styled,
};
use loora_engine::{Overflow, Paint, Stroke, Style, Typography};

use crate::canvas::properties::controls::{
    choice_field, format_hex, format_number, hex_color_field, number_field, pair, select_field,
    text_field,
};
use crate::canvas::properties::{PropsField, PropsView};
use crate::canvas::workspace::CanvasWorkspace;
use crate::theme::Theme;

pub fn appearance_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    style: &Style,
) -> impl IntoElement {
    let disabled = view.readonly;
    let fill = style.solid_fill();
    let radius_value = style.radius() as f64;
    let fill_display = if view.focus == Some(PropsField::Fill) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(fill.map(format_hex).unwrap_or_else(|| "None".to_string()))
    };

    let opacity_pct = (style.opacity * 100.0) as f64;
    let opacity_display = if view.focus == Some(PropsField::Opacity) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(format_number(opacity_pct, 0))
    };

    let radius_display = if view.focus == Some(PropsField::Radius) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(format_number(radius_value, 1))
    };

    let ws_fill = workspace.clone();
    let ws_op = workspace.clone();
    let ws_op2 = workspace.clone();
    let ws_op3 = workspace.clone();
    let ws_op4 = workspace.clone();
    let ws_rad = workspace.clone();
    let ws_rad2 = workspace.clone();
    let ws_rad3 = workspace.clone();
    let ws_rad4 = workspace.clone();

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(hex_color_field(
            theme,
            "props-fill".into(),
            fill,
            fill_display,
            view.focus == Some(PropsField::Fill),
            disabled,
            {
                let ws = workspace.clone();
                move |_, window, cx| {
                    ws.update(cx, |this, cx| {
                        this.open_color_picker(PropsField::Fill, window, cx)
                    })
                }
            },
            move |_, window, cx| {
                ws_fill.update(cx, |this, cx| this.focus_props_field(PropsField::Fill, window, cx));
            },
        ))
        .child(pair(
            number_field(
                theme,
                "props-opacity".into(),
                "Op",
                opacity_display,
                view.focus == Some(PropsField::Opacity),
                disabled,
                Some("%"),
                move |_, window, cx| {
                    ws_op.update(cx, |this, cx| {
                        this.focus_props_field(PropsField::Opacity, window, cx)
                    });
                },
                move |event, _, cx| {
                    ws_op2.update(cx, |this, cx| {
                        this.begin_props_scrub(
                            PropsField::Opacity,
                            opacity_pct,
                            f32::from(event.position.x),
                            cx,
                        );
                    });
                },
                move |event, _, cx| {
                    ws_op3.update(cx, |this, cx| {
                        this.update_props_scrub(f32::from(event.position.x), 1.0, cx);
                    });
                },
                move |_, _, cx| {
                    ws_op4.update(cx, |this, cx| this.end_props_scrub(cx));
                },
            ),
            number_field(
                theme,
                "props-radius".into(),
                "R",
                radius_display,
                view.focus == Some(PropsField::Radius),
                disabled,
                None,
                move |_, window, cx| {
                    ws_rad.update(cx, |this, cx| {
                        this.focus_props_field(PropsField::Radius, window, cx)
                    });
                },
                move |event, _, cx| {
                    ws_rad2.update(cx, |this, cx| {
                        this.begin_props_scrub(
                            PropsField::Radius,
                            radius_value,
                            f32::from(event.position.x),
                            cx,
                        );
                    });
                },
                move |event, _, cx| {
                    ws_rad3.update(cx, |this, cx| {
                        this.update_props_scrub(f32::from(event.position.x), 0.5, cx);
                    });
                },
                move |_, _, cx| {
                    ws_rad4.update(cx, |this, cx| this.end_props_scrub(cx));
                },
            ),
        ))
        .child(pair(
            corner_field(
                workspace.clone(),
                theme,
                view,
                PropsField::CornerTl,
                "TL",
                style.corners.tl as f64,
            ),
            corner_field(
                workspace.clone(),
                theme,
                view,
                PropsField::CornerTr,
                "TR",
                style.corners.tr as f64,
            ),
        ))
        .child(pair(
            corner_field(
                workspace.clone(),
                theme,
                view,
                PropsField::CornerBr,
                "BR",
                style.corners.br as f64,
            ),
            corner_field(
                workspace.clone(),
                theme,
                view,
                PropsField::CornerBl,
                "BL",
                style.corners.bl as f64,
            ),
        ))
        .child(choice_field(
            theme,
            "props-overflow-hidden".into(),
            "Clip",
            Some(style.overflow == Overflow::Hidden),
            disabled,
            {
                let workspace = workspace.clone();
                move |_, _, cx| {
                    workspace.update(cx, |this, cx| this.toggle_selection_overflow(cx));
                }
            },
        ))
        .child(select_field(
            theme,
            "props-fill-type".into(),
            "Fill",
            Some(
                if style.fills.is_empty() {
                    "None"
                } else if matches!(
                    style.fills.first(),
                    Some(loora_engine::Paint::LinearGradient { .. })
                ) {
                    "Linear"
                } else {
                    "Solid"
                }
                .into(),
            ),
            disabled,
            {
                let workspace = workspace.clone();
                move |_, window, cx| {
                    workspace.update(cx, |this, cx| this.focus_props_field(PropsField::Fill, window, cx));
                }
            },
        ))
        .when_some(style.fills.first(), |this, paint| match paint {
            Paint::LinearGradient { angle, .. } => this.child(corner_field(
                workspace.clone(),
                theme,
                view,
                PropsField::GradientAngle,
                "Angle",
                *angle as f64,
            )),
            _ => this,
        })
}

fn corner_field(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    field: PropsField,
    label: &'static str,
    value: f64,
) -> impl IntoElement {
    let a = workspace.clone();
    let b = workspace.clone();
    let c = workspace.clone();
    let d = workspace;
    number_field(
        theme,
        format!("props-{label}").into(),
        label,
        if view.focus == Some(field) {
            view.draft.clone().into()
        } else {
            format_number(value, 1).into()
        },
        view.focus == Some(field),
        view.readonly,
        None,
        move |_, window, cx| a.update(cx, |this, cx| this.focus_props_field(field, window, cx)),
        move |event, _, cx| {
            b.update(cx, |this, cx| {
                this.begin_props_scrub(field, value, f32::from(event.position.x), cx)
            })
        },
        move |event, _, cx| {
            c.update(cx, |this, cx| {
                this.update_props_scrub(f32::from(event.position.x), 0.5, cx)
            })
        },
        move |_, _, cx| d.update(cx, |this, cx| this.end_props_scrub(cx)),
    )
}

pub fn stroke_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    stroke: Option<&Stroke>,
) -> impl IntoElement {
    let disabled = view.readonly;
    let enabled = stroke.is_some();
    let color = stroke.map(|s| s.color);
    let width = stroke.map(|s| s.width as f64).unwrap_or(1.0);

    let color_display = if view.focus == Some(PropsField::StrokeColor) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(
            color
                .map(format_hex)
                .unwrap_or_else(|| "#FFFFFF".to_string()),
        )
    };
    let width_display = if view.focus == Some(PropsField::StrokeWidth) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(format_number(width, 1))
    };

    let ws_toggle = workspace.clone();
    let ws_color = workspace.clone();
    let ws_w = workspace.clone();
    let ws_w2 = workspace.clone();
    let ws_w3 = workspace.clone();
    let ws_w4 = workspace.clone();

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(
            div()
                .id("props-stroke-toggle")
                .flex()
                .items_center()
                .justify_between()
                .h(px(28.))
                .px_2()
                .rounded(px(6.))
                .bg(theme.field_bg())
                .border_1()
                .border_color(theme.hairline())
                .opacity(if disabled { 0.5 } else { 1.0 })
                .when(!disabled, |this| {
                    this.cursor_pointer().on_mouse_down(MouseButton::Left, {
                        move |_, _, cx| {
                            ws_toggle.update(cx, |this, cx| this.toggle_selection_stroke(cx));
                        }
                    })
                })
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(theme.muted_strong)
                        .child("Stroke"),
                )
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(if enabled { theme.accent } else { theme.muted })
                        .child(if enabled { "On" } else { "Off" }),
                ),
        )
        .when(enabled, |this| {
            this.child(hex_color_field(
                theme,
                "props-stroke-color".into(),
                color,
                color_display,
                view.focus == Some(PropsField::StrokeColor),
                disabled,
                {
                    let ws = workspace.clone();
                    move |_, window, cx| {
                        ws.update(cx, |this, cx| {
                            this.open_color_picker(PropsField::StrokeColor, window, cx)
                        })
                    }
                },
                move |_, window, cx| {
                    ws_color.update(cx, |this, cx| {
                        this.focus_props_field(PropsField::StrokeColor, window, cx)
                    });
                },
            ))
            .child(number_field(
                theme,
                "props-stroke-width".into(),
                "W",
                width_display,
                view.focus == Some(PropsField::StrokeWidth),
                disabled,
                None,
                move |_, window, cx| {
                    ws_w.update(cx, |this, cx| {
                        this.focus_props_field(PropsField::StrokeWidth, window, cx)
                    });
                },
                move |event, _, cx| {
                    ws_w2.update(cx, |this, cx| {
                        this.begin_props_scrub(
                            PropsField::StrokeWidth,
                            width,
                            f32::from(event.position.x),
                            cx,
                        );
                    });
                },
                move |event, _, cx| {
                    ws_w3.update(cx, |this, cx| {
                        this.update_props_scrub(f32::from(event.position.x), 0.25, cx);
                    });
                },
                move |_, _, cx| {
                    ws_w4.update(cx, |this, cx| this.end_props_scrub(cx));
                },
            ))
            .child(select_field(
                theme,
                "props-stroke-style".into(),
                "Style",
                Some(
                    stroke
                        .map(|stroke| match stroke.style {
                            loora_engine::StrokeStyle::Solid => "Solid",
                            loora_engine::StrokeStyle::Dashed => "Dashed",
                            loora_engine::StrokeStyle::Dotted => "Dotted",
                        })
                        .unwrap_or("Solid")
                        .into(),
                ),
                disabled,
                {
                    let ws = workspace.clone();
                    move |event, window, cx| {
                        let entries = vec![
                            crate::context_menu::ContextMenuEntry::Action(
                                crate::context_menu::ContextMenuAction::new(
                                    "enum:stroke:solid",
                                    "Solid",
                                ),
                            ),
                            crate::context_menu::ContextMenuEntry::Action(
                                crate::context_menu::ContextMenuAction::new(
                                    "enum:stroke:dashed",
                                    "Dashed",
                                ),
                            ),
                            crate::context_menu::ContextMenuEntry::Action(
                                crate::context_menu::ContextMenuAction::new(
                                    "enum:stroke:dotted",
                                    "Dotted",
                                ),
                            ),
                        ];
                        ws.update(cx, |this, cx| {
                            this.open_enum_menu(event.position, entries, window, cx)
                        });
                    }
                },
            ))
        })
}

pub fn type_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    font_size: f32,
    text: &str,
    typography: &Typography,
) -> impl IntoElement {
    let disabled = view.readonly;
    let size_display = if view.focus == Some(PropsField::FontSize) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(format_number(font_size as f64, 0))
    };
    let text_display = if view.focus == Some(PropsField::Text) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(text.to_string())
    };

    let ws_fs = workspace.clone();
    let ws_fs2 = workspace.clone();
    let ws_fs3 = workspace.clone();
    let ws_fs4 = workspace.clone();
    let ws_text = workspace.clone();
    let family_display = if view.focus == Some(PropsField::FontFamily) {
        view.draft.clone().into()
    } else {
        typography.family.clone().into()
    };
    let color_display = if view.focus == Some(PropsField::TextColor) {
        view.draft.clone().into()
    } else {
        format_hex(typography.color).into()
    };

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(number_field(
            theme,
            "props-font-size".into(),
            "Size",
            size_display,
            view.focus == Some(PropsField::FontSize),
            disabled,
            None,
            move |_, window, cx| {
                ws_fs.update(cx, |this, cx| {
                    this.focus_props_field(PropsField::FontSize, window, cx)
                });
            },
            move |event, _, cx| {
                ws_fs2.update(cx, |this, cx| {
                    this.begin_props_scrub(
                        PropsField::FontSize,
                        font_size as f64,
                        f32::from(event.position.x),
                        cx,
                    );
                });
            },
            move |event, _, cx| {
                ws_fs3.update(cx, |this, cx| {
                    this.update_props_scrub(f32::from(event.position.x), 1.0, cx);
                });
            },
            move |_, _, cx| {
                ws_fs4.update(cx, |this, cx| this.end_props_scrub(cx));
            },
        ))
        .child(text_field(
            theme,
            "props-text".into(),
            text_display,
            "Text content".into(),
            view.focus == Some(PropsField::Text),
            disabled,
            move |_, window, cx| {
                ws_text.update(cx, |this, cx| this.focus_props_field(PropsField::Text, window, cx));
            },
        ))
        .child(text_field(
            theme,
            "props-font-family".into(),
            family_display,
            "Font family".into(),
            view.focus == Some(PropsField::FontFamily),
            disabled,
            {
                let ws = workspace.clone();
                move |_, window, cx| {
                    ws.update(cx, |this, cx| {
                        this.focus_props_field(PropsField::FontFamily, window, cx)
                    })
                }
            },
        ))
        .child(hex_color_field(
            theme,
            "props-text-color".into(),
            Some(typography.color),
            color_display,
            view.focus == Some(PropsField::TextColor),
            disabled,
            {
                let ws = workspace.clone();
                move |_, window, cx| {
                    ws.update(cx, |this, cx| {
                        this.open_color_picker(PropsField::TextColor, window, cx)
                    })
                }
            },
            {
                let ws = workspace.clone();
                move |_, window, cx| {
                    ws.update(cx, |this, cx| {
                        this.focus_props_field(PropsField::TextColor, window, cx)
                    })
                }
            },
        ))
        .child(pair(
            type_value_field(
                workspace.clone(),
                theme,
                view,
                PropsField::FontWeight,
                "Weight",
                format_number(typography.weight as f64, 0),
            ),
            type_value_field(
                workspace.clone(),
                theme,
                view,
                PropsField::LineHeight,
                "Line height",
                typography
                    .line_height
                    .map(|value| format_number(value as f64, 1))
                    .unwrap_or_default(),
            ),
        ))
        .child(type_value_field(
            workspace.clone(),
            theme,
            view,
            PropsField::LetterSpacing,
            "Letter spacing",
            format_number(typography.letter_spacing as f64, 1),
        ))
}

fn type_value_field(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    field: PropsField,
    placeholder: &'static str,
    value: String,
) -> impl IntoElement {
    text_field(
        theme,
        format!("props-type-{placeholder}").into(),
        if view.focus == Some(field) {
            view.draft.clone().into()
        } else {
            value.into()
        },
        placeholder.into(),
        view.focus == Some(field),
        view.readonly,
        move |_, window, cx| workspace.update(cx, |this, cx| this.focus_props_field(field, window, cx)),
    )
}

pub fn image_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
) -> impl IntoElement {
    let disabled = view.readonly;
    let ws = workspace;
    div()
        .id("props-image-replace")
        .flex()
        .items_center()
        .justify_center()
        .h(px(32.))
        .rounded(px(6.))
        .border_1()
        .border_color(theme.hairline())
        .bg(theme.field_bg())
        .opacity(if disabled { 0.5 } else { 1.0 })
        .when(!disabled, |this| {
            this.cursor_pointer()
                .hover(|s| s.bg(theme.hover))
                .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                    ws.update(cx, |this, cx| this.replace_selection_image(cx));
                })
        })
        .child(
            div()
                .text_size(px(12.))
                .text_color(theme.foreground)
                .child("Replace…"),
        )
}
