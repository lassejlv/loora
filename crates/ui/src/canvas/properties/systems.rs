//! Deferred Loora systems: responsive, motion, components, actions, vector, tokens.

use gpui::{
    div, prelude::FluentBuilder, px, Entity, InteractiveElement, IntoElement, MouseButton,
    MouseDownEvent, ParentElement, SharedString, Styled,
};
use loora_engine::{Breakpoint, DesignToken, Node, Transition, VectorPath, VisualStates};

use crate::canvas::properties::controls::{
    format_hex, format_number, number_field, pair, select_field, text_field,
};
use crate::canvas::properties::{PropsField, PropsView};
use crate::canvas::workspace::CanvasWorkspace;
use crate::context_menu::{ContextMenuAction, ContextMenuEntry};
use crate::theme::Theme;

pub fn responsive_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    breakpoints: &[Breakpoint],
    active_breakpoint: Option<&str>,
    has_override: bool,
) -> impl IntoElement {
    let disabled = view.readonly;
    let label = active_breakpoint
        .and_then(|id| breakpoints.iter().find(|b| b.id == id))
        .map(|b| SharedString::from(b.name.clone()))
        .unwrap_or_else(|| "Base".into());

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(select_field(
            theme,
            "props-breakpoint".into(),
            "Breakpoint",
            Some(label),
            disabled,
            {
                let ws = workspace.clone();
                move |_, _, cx| ws.update(cx, |this, cx| this.cycle_active_breakpoint(cx))
            },
        ))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .h(px(28.))
                .px_2()
                .rounded(px(6.))
                .bg(theme.field_bg())
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(theme.muted)
                        .child(if has_override {
                            "Overrides"
                        } else {
                            "No overrides"
                        }),
                )
                .when(has_override && !disabled, |this| {
                    let ws = workspace;
                    this.cursor_pointer()
                        .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                            ws.update(cx, |this, cx| this.clear_responsive_overrides(cx))
                        })
                        .child(
                            div()
                                .text_size(px(11.))
                                .text_color(theme.accent)
                                .child("Clear"),
                        )
                }),
        )
}

pub fn motion_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    visual_states: Option<&VisualStates>,
    transition: Option<&Transition>,
) -> impl IntoElement {
    let disabled = view.readonly;
    let hover_on = visual_states.and_then(|v| v.hover.as_ref()).is_some();
    let duration = transition.map(|t| t.duration_ms as f64).unwrap_or(300.0);
    let easing = transition
        .map(|t| SharedString::from(t.easing.clone()))
        .unwrap_or_else(|| "ease-out".into());

    let duration_display = if view.focus == Some(PropsField::MotionDuration) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(format_number(duration, 0))
    };

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(select_field(
            theme,
            "props-motion-hover".into(),
            "Hover",
            Some(SharedString::from(if hover_on {
                "Opacity"
            } else {
                "None"
            })),
            disabled,
            {
                let ws = workspace.clone();
                move |_, _, cx| ws.update(cx, |this, cx| this.toggle_hover_preset(cx))
            },
        ))
        .child(pair(
            {
                let a = workspace.clone();
                let b = workspace.clone();
                let c = workspace.clone();
                let d = workspace.clone();
                let e = workspace.clone();
                number_field(
                    theme,
                    "props-motion-duration".into(),
                    "Ms",
                    duration_display,
                    view.focus == Some(PropsField::MotionDuration),
                    view.selection_for(PropsField::MotionDuration),
                    disabled,
                    None,
                    move |event, window, cx| {
                        a.update(cx, |this, cx| {
                            this.focus_props_field(
                                PropsField::MotionDuration,
                                event.click_count,
                                window,
                                cx,
                            )
                        })
                    },
                    move |_, _, cx| e.update(cx, |this, cx| this.blur_props_if_needed(cx)),
                    move |event, _, cx| {
                        b.update(cx, |this, cx| {
                            this.begin_props_scrub(
                                PropsField::MotionDuration,
                                duration,
                                f32::from(event.position.x),
                                cx,
                            )
                        })
                    },
                    move |event, _, cx| {
                        c.update(cx, |this, cx| {
                            this.update_props_scrub(f32::from(event.position.x), 1.0, cx)
                        })
                    },
                    move |_, _, cx| d.update(cx, |this, cx| this.end_props_scrub(cx)),
                )
            },
            select_field(
                theme,
                "props-motion-easing".into(),
                "Ease",
                Some(easing),
                disabled,
                {
                    let ws = workspace;
                    move |_, _, cx| ws.update(cx, |this, cx| this.cycle_transition_easing(cx))
                },
            ),
        ))
}

pub fn component_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    node: &Node,
    variant_names: &[String],
) -> impl IntoElement {
    let disabled = view.readonly;
    let variant = node
        .variant
        .clone()
        .unwrap_or_else(|| "Default".into());
    let has_overrides = !node.overrides.is_empty();
    let can_delete_variant = variant_names.len() > 1;
    let variants_label = if variant_names.len() > 1 {
        format!("{} · {} variants", variant, variant_names.len())
    } else {
        variant
    };

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(
            div()
                .text_size(px(11.))
                .text_color(theme.muted)
                .child(if node.kind == loora_engine::NodeKind::Component {
                    "Master component"
                } else {
                    "Instance"
                }),
        )
        .child(select_field(
            theme,
            "props-variant".into(),
            "Variant",
            Some(SharedString::from(variants_label)),
            disabled,
            {
                let ws = workspace.clone();
                let names = variant_names.to_vec();
                move |event, window, cx| {
                    let entries: Vec<_> = names
                        .iter()
                        .map(|name| {
                            ContextMenuEntry::Action(ContextMenuAction::new(
                                format!("enum:variant:{name}"),
                                name.clone(),
                            ))
                        })
                        .collect();
                    ws.update(cx, |this, cx| {
                        this.open_enum_menu(event.position, entries, window, cx)
                    });
                }
            },
        ))
        .child(
            div()
                .text_size(px(10.))
                .text_color(theme.muted)
                .child("Click to choose variant"),
        )
        .when(!disabled, |this| {
            this.child(variant_action_row(
                theme,
                "props-capture-variant",
                "Capture as variant",
                {
                    let ws = workspace.clone();
                    move |_, _, cx| ws.update(cx, |this, cx| this.capture_selected_variant(cx))
                },
            ))
            .child(variant_action_row(
                theme,
                "props-add-variant",
                "Add variant",
                {
                    let ws = workspace.clone();
                    move |_, _, cx| ws.update(cx, |this, cx| this.add_selected_variant(cx))
                },
            ))
            .when(can_delete_variant, |this| {
                this.child(variant_action_row(
                    theme,
                    "props-delete-variant",
                    "Delete variant",
                    {
                        let ws = workspace.clone();
                        move |_, _, cx| ws.update(cx, |this, cx| this.delete_selected_variant(cx))
                    },
                ))
            })
        })
        .when(has_overrides, |this| {
            let ws = workspace;
            this.child(
                div()
                    .id("props-reset-overrides")
                    .flex()
                    .items_center()
                    .h(px(28.))
                    .px_2()
                    .rounded(px(6.))
                    .bg(theme.field_bg())
                    .cursor_pointer()
                    .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                        ws.update(cx, |this, cx| this.reset_instance_overrides(cx))
                    })
                    .child(
                        div()
                            .text_size(px(11.))
                            .text_color(theme.accent)
                            .child("Reset overrides"),
                    ),
            )
        })
}

fn variant_action_row(
    theme: Theme,
    id: &'static str,
    label: &'static str,
    on_click: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .h(px(28.))
        .px_2()
        .rounded(px(6.))
        .bg(theme.field_bg())
        .cursor_pointer()
        .on_mouse_down(MouseButton::Left, on_click)
        .child(
            div()
                .text_size(px(11.))
                .text_color(theme.bright_white)
                .child(label),
        )
}

pub fn actions_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    url: Option<String>,
) -> impl IntoElement {
    let disabled = view.readonly;
    let display = if view.focus == Some(PropsField::ActionUrl) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(url.unwrap_or_default())
    };
    let ws = workspace.clone();
    let ws_blur = workspace;
    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(text_field(
            theme,
            "props-action-url".into(),
            display,
            "https://… or page:page_id".into(),
            view.focus == Some(PropsField::ActionUrl),
            view.selection_for(PropsField::ActionUrl),
            disabled,
            move |event, window, cx| {
                ws.update(cx, |this, cx| {
                    this.focus_props_field(PropsField::ActionUrl, event.click_count, window, cx)
                });
            },
            move |_, _, cx| ws_blur.update(cx, |this, cx| this.blur_props_if_needed(cx)),
        ))
        .child(
            div()
                .text_size(px(10.))
                .text_color(theme.muted)
                .child("Preview: URL opens browser, page:… navigates"),
        )
}

pub fn vector_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    path: Option<&VectorPath>,
) -> impl IntoElement {
    let disabled = view.readonly;
    let fill = path.and_then(|p| p.fill);
    let weight = path.and_then(|p| p.stroke_width).unwrap_or(1.0) as f64;
    let fill_display = if view.focus == Some(PropsField::VectorFill) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(fill.map(format_hex).unwrap_or_else(|| "None".into()))
    };
    let weight_display = if view.focus == Some(PropsField::VectorWeight) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(format_number(weight, 1))
    };

    let ws_fill = workspace.clone();
    let a = workspace.clone();
    let b = workspace.clone();
    let c = workspace.clone();
    let d = workspace.clone();
    let e = workspace.clone();

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(crate::canvas::properties::controls::hex_color_field(
            theme,
            "props-vector-fill".into(),
            fill,
            fill_display,
            view.focus == Some(PropsField::VectorFill),
            view.selection_for(PropsField::VectorFill),
            disabled,
            {
                let ws = workspace.clone();
                move |_, window, cx| {
                    ws.update(cx, |this, cx| {
                        this.open_color_picker(PropsField::VectorFill, window, cx)
                    })
                }
            },
            move |event, window, cx| {
                ws_fill.update(cx, |this, cx| {
                    this.focus_props_field(
                        PropsField::VectorFill,
                        event.click_count,
                        window,
                        cx,
                    )
                })
            },
            {
                let ws = workspace.clone();
                move |_, _, cx| ws.update(cx, |this, cx| this.blur_props_if_needed(cx))
            },
        ))
        .child(number_field(
            theme,
            "props-vector-weight".into(),
            "Weight",
            weight_display,
            view.focus == Some(PropsField::VectorWeight),
            view.selection_for(PropsField::VectorWeight),
            disabled,
            None,
            move |event, window, cx| {
                a.update(cx, |this, cx| {
                    this.focus_props_field(
                        PropsField::VectorWeight,
                        event.click_count,
                        window,
                        cx,
                    )
                })
            },
            move |_, _, cx| e.update(cx, |this, cx| this.blur_props_if_needed(cx)),
            move |event, _, cx| {
                b.update(cx, |this, cx| {
                    this.begin_props_scrub(
                        PropsField::VectorWeight,
                        weight,
                        f32::from(event.position.x),
                        cx,
                    )
                })
            },
            move |event, _, cx| {
                c.update(cx, |this, cx| {
                    this.update_props_scrub(f32::from(event.position.x), 1.0, cx)
                })
            },
            move |_, _, cx| d.update(cx, |this, cx| this.end_props_scrub(cx)),
        ))
}

pub fn tokens_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    tokens: &[DesignToken],
    disabled: bool,
) -> impl IntoElement {
    let label = tokens
        .first()
        .map(|t| SharedString::from(t.name.clone()))
        .unwrap_or_else(|| "No tokens".into());
    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(select_field(
            theme,
            "props-token".into(),
            "Apply",
            Some(label),
            disabled || tokens.is_empty(),
            {
                let ws = workspace;
                move |_, _, cx| ws.update(cx, |this, cx| this.apply_next_token_fill(cx))
            },
        ))
        .child(
            div()
                .text_size(px(10.))
                .text_color(theme.muted)
                .child(format!("{} document tokens", tokens.len())),
        )
}
