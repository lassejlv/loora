use gpui::{div, Entity, IntoElement, ParentElement, Styled};
use loora_engine::Layout;

use crate::canvas::properties::controls::{format_number, number_field, pair};
use crate::canvas::properties::{PropsField, PropsView};
use crate::canvas::workspace::CanvasWorkspace;
use crate::theme::Theme;

pub fn constraints_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    layout: &Layout,
) -> impl IntoElement {
    let disabled = view.readonly;
    let cell = |field: PropsField, label: &'static str, value: Option<f64>| {
        let value = value.unwrap_or(0.0);
        let a = workspace.clone();
        let b = workspace.clone();
        let c = workspace.clone();
        let d = workspace.clone();
        let e = workspace.clone();
        number_field(
            theme,
            format!("props-constraint-{label}").into(),
            label,
            if view.focus == Some(field) {
                view.draft.clone().into()
            } else {
                format_number(value, 2).into()
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
    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(pair(
            cell(PropsField::MinWidth, "Min W", layout.min_width),
            cell(PropsField::MaxWidth, "Max W", layout.max_width),
        ))
        .child(pair(
            cell(PropsField::MinHeight, "Min H", layout.min_height),
            cell(PropsField::MaxHeight, "Max H", layout.max_height),
        ))
        .child(cell(PropsField::AspectRatio, "Aspect", layout.aspect_ratio))
}
