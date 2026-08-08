use gpui::{div, Entity, IntoElement, ParentElement, SharedString, Styled};
use loora_engine::Bounds;

use crate::canvas::properties::controls::{format_number, number_field, pair};
use crate::canvas::properties::{PropsField, PropsView};
use crate::canvas::workspace::CanvasWorkspace;
use crate::theme::Theme;

fn display_opt(view: &PropsView, field: PropsField, value: Option<f64>, digits: i32) -> SharedString {
    if view.focus == Some(field) {
        SharedString::from(view.draft.clone())
    } else {
        match value {
            Some(v) => SharedString::from(format_number(v, digits)),
            None => SharedString::from("Mixed"),
        }
    }
}

pub fn layout_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    bounds: Option<Bounds>,
    rotation: Option<f32>,
) -> impl IntoElement {
    let disabled = view.readonly;
    let cell = |field: PropsField, label: &'static str, value: Option<f64>| {
        let start = value.unwrap_or(0.0);
        let ws = workspace.clone();
        let ws2 = workspace.clone();
        let ws3 = workspace.clone();
        let ws4 = workspace.clone();
        let ws5 = workspace.clone();
        number_field(
            theme,
            SharedString::from(format!("props-{label}")),
            label,
            display_opt(view, field, value, 2),
            view.focus == Some(field),
            view.selection_for(field),
            disabled,
            None,
            move |event, window, cx| {
                ws.update(cx, |this, cx| {
                    this.focus_props_field(field, event.click_count, window, cx)
                });
            },
            move |_, _, cx| {
                ws5.update(cx, |this, cx| this.blur_props_if_needed(cx));
            },
            move |event, _, cx| {
                ws2.update(cx, |this, cx| {
                    this.begin_props_scrub(field, start, f32::from(event.position.x), cx);
                });
            },
            move |event, _, cx| {
                ws3.update(cx, |this, cx| {
                    this.update_props_scrub(f32::from(event.position.x), 1.0, cx);
                });
            },
            move |_, _, cx| {
                ws4.update(cx, |this, cx| this.end_props_scrub(cx));
            },
        )
    };

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(pair(
            cell(PropsField::X, "X", bounds.map(|b| b.x)),
            cell(PropsField::Y, "Y", bounds.map(|b| b.y)),
        ))
        .child(pair(
            cell(PropsField::W, "W", bounds.map(|b| b.width)),
            cell(PropsField::H, "H", bounds.map(|b| b.height)),
        ))
        .child(pair(
            cell(
                PropsField::Rotation,
                "Rot",
                rotation.map(|r| r as f64),
            ),
            div(),
        ))
}
