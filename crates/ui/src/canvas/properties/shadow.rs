use gpui::{
    div, prelude::FluentBuilder, px, Entity, InteractiveElement, IntoElement, MouseButton,
    ParentElement, Styled,
};
use loora_engine::Shadow;

use crate::canvas::properties::controls::{choice_field, hex_color_field, number_field, pair};
use crate::canvas::properties::{format_hex, format_number, PropsField, PropsView};
use crate::canvas::workspace::CanvasWorkspace;
use crate::theme::Theme;

pub fn shadow_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    shadow: Option<&Shadow>,
) -> impl IntoElement {
    let disabled = view.readonly;
    let enabled = shadow.is_some();
    let shadow = shadow.cloned().unwrap_or_default();

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(
            div()
                .id("props-shadow-toggle")
                .flex()
                .items_center()
                .justify_between()
                .h(px(28.))
                .px_2()
                .rounded(px(6.))
                .bg(theme.field_bg())
                .opacity(if disabled { 0.5 } else { 1.0 })
                .when(!disabled, |this| {
                    let ws = workspace.clone();
                    this.cursor_pointer()
                        .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                            ws.update(cx, |this, cx| this.toggle_selection_shadow(cx))
                        })
                })
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(theme.muted_strong)
                        .child("Shadow"),
                )
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(if enabled { theme.accent } else { theme.muted })
                        .child(if enabled { "On" } else { "Off" }),
                ),
        )
        .when(enabled, |this| {
            let number = |field: PropsField, label: &'static str, value: f64| {
                let a = workspace.clone();
                let b = workspace.clone();
                let c = workspace.clone();
                let d = workspace.clone();
                let e = workspace.clone();
                number_field(
                    theme,
                    format!("props-shadow-{label}").into(),
                    label,
                    if view.focus == Some(field) {
                        view.draft.clone().into()
                    } else {
                        format_number(value, 1).into()
                    },
                    view.focus == Some(field),
                    view.selection_for(field),
                    disabled,
                    None,
                    move |event, window, cx| {
                        a.update(cx, |this, cx| {
                            this.focus_props_field(field, event.click_count, window, cx)
                        })
                    },
                    move |_, _, cx| e.update(cx, |this, cx| this.blur_props_if_needed(cx)),
                    move |event, _, cx| {
                        b.update(cx, |this, cx| {
                            this.begin_props_scrub(field, value, f32::from(event.position.x), cx)
                        })
                    },
                    move |event, _, cx| {
                        c.update(cx, |this, cx| {
                            this.update_props_scrub(f32::from(event.position.x), 1.0, cx)
                        })
                    },
                    move |_, _, cx| d.update(cx, |this, cx| this.end_props_scrub(cx)),
                )
            };
            this.child(hex_color_field(
                theme,
                "props-shadow-color".into(),
                Some(shadow.color),
                if view.focus == Some(PropsField::ShadowColor) {
                    view.draft.clone().into()
                } else {
                    format_hex(shadow.color).into()
                },
                view.focus == Some(PropsField::ShadowColor),
                view.selection_for(PropsField::ShadowColor),
                disabled,
                {
                    let ws = workspace.clone();
                    move |_, window, cx| {
                        ws.update(cx, |this, cx| {
                            this.open_color_picker(PropsField::ShadowColor, window, cx)
                        })
                    }
                },
                {
                    let ws = workspace.clone();
                    move |event, window, cx| {
                        ws.update(cx, |this, cx| {
                            this.focus_props_field(
                                PropsField::ShadowColor,
                                event.click_count,
                                window,
                                cx,
                            )
                        })
                    }
                },
                {
                    let ws = workspace.clone();
                    move |_, _, cx| {
                        ws.update(cx, |this, cx| this.blur_props_if_needed(cx));
                    }
                },
            ))
            .child(pair(
                number(PropsField::ShadowX, "X", shadow.x as f64),
                number(PropsField::ShadowY, "Y", shadow.y as f64),
            ))
            .child(pair(
                number(PropsField::ShadowBlur, "Blur", shadow.blur as f64),
                number(PropsField::ShadowSpread, "Spread", shadow.spread as f64),
            ))
            .child(choice_field(
                theme,
                "props-shadow-inset".into(),
                "Inset",
                Some(shadow.inset),
                disabled,
                {
                    let ws = workspace.clone();
                    move |_, _, cx| {
                        ws.update(cx, |this, cx| this.toggle_selection_shadow_inset(cx))
                    }
                },
            ))
        })
}
