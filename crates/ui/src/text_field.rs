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

/// Editable field contents with a UTF-8 byte selection and caret.
pub fn editable_field_content(
    value: impl Into<SharedString>,
    placeholder: impl Into<SharedString>,
    selection: Option<(usize, usize)>,
    value_color: Hsla,
    placeholder_color: Hsla,
    caret_color: Hsla,
    selection_color: Hsla,
    font_size: Pixels,
    caret_height: Pixels,
) -> impl IntoElement {
    let value = value.into().to_string();
    let placeholder = placeholder.into();
    let empty = value.is_empty();
    let clamp = |mut index: usize| {
        index = index.min(value.len());
        while index > 0 && !value.is_char_boundary(index) {
            index -= 1;
        }
        index
    };
    let selection = selection.map(|(anchor, caret)| (clamp(anchor), clamp(caret)));
    let (anchor, caret) = selection.unwrap_or((value.len(), value.len()));
    let (start, end) = if anchor <= caret {
        (anchor, caret)
    } else {
        (caret, anchor)
    };
    let before = SharedString::from(value[..start].to_string());
    let selected = SharedString::from(value[start..end].to_string());
    let after = SharedString::from(value[end..].to_string());
    let caret_at_start = selection.is_some() && caret == start;
    let caret_at_end = selection.is_some() && caret == end && caret != start;

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
                .text_size(font_size)
                .text_color(value_color)
                .whitespace_nowrap()
                .overflow_hidden()
                .child(before)
                .when(caret_at_start, |this| {
                    this.child(blinking_caret(caret_color, caret_height))
                })
                .when(start < end, |this| {
                    this.child(
                        div()
                            .bg(selection_color)
                            .text_color(value_color)
                            .child(selected),
                    )
                })
                .when(caret_at_end, |this| {
                    this.child(blinking_caret(caret_color, caret_height))
                })
                .child(after),
        )
}
