use std::time::Duration;

use gpui::{
    div, prelude::FluentBuilder, px, Animation, AnimationExt, Hsla, InteractiveElement,
    IntoElement, ParentElement, Pixels, SharedString, Styled,
};

/// Blinking text caret for faux input fields.
pub fn blinking_caret(color: Hsla, height: Pixels) -> impl IntoElement {
    div()
        .id("text-caret")
        .w(px(1.5))
        .h(height)
        .flex_shrink_0()
        .rounded(px(1.))
        .bg(color)
        .with_animation(
            "caret-blink",
            Animation::new(Duration::from_millis(1060)).repeat(),
            |this, delta| {
                // Visible for ~530ms, hidden for ~530ms.
                let on = delta < 0.5;
                this.opacity(if on { 1. } else { 0. })
            },
        )
}

/// Search/query field contents: value or placeholder, plus optional caret.
pub fn field_content(
    value: impl Into<SharedString>,
    placeholder: impl Into<SharedString>,
    focused: bool,
    value_color: Hsla,
    placeholder_color: Hsla,
    caret_color: Hsla,
    font_size: Pixels,
    caret_height: Pixels,
) -> impl IntoElement {
    let value = value.into();
    let placeholder = placeholder.into();
    let empty = value.is_empty();

    div()
        .relative()
        .flex_1()
        .h_full()
        .flex()
        .items_center()
        .min_w_0()
        .when(empty, |this| {
            this.child(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .text_size(font_size)
                    .text_color(placeholder_color)
                    .whitespace_nowrap()
                    .overflow_hidden()
                    .child(placeholder),
            )
        })
        .child(
            div()
                .flex()
                .items_center()
                .min_w_0()
                .child(
                    div()
                        .text_size(font_size)
                        .text_color(value_color)
                        .whitespace_nowrap()
                        .overflow_hidden()
                        .child(value),
                )
                .when(focused, |this| {
                    this.child(blinking_caret(caret_color, caret_height))
                }),
        )
}
