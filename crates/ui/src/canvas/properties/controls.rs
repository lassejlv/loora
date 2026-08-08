use gpui::{
    div, prelude::FluentBuilder, px, rgba, CursorStyle, InteractiveElement, IntoElement,
    MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement, SharedString, Styled,
};
use loora_engine::Color;

use crate::text_field::field_content;
use crate::theme::Theme;

/// Compact inspector select. `None` is rendered as the multi-selection "Mixed" value.
pub fn select_field(
    theme: Theme,
    id: SharedString,
    label: &'static str,
    value: Option<SharedString>,
    disabled: bool,
    on_click: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_between()
        .h(px(28.))
        .px_2()
        .rounded(px(6.))
        .border_1()
        .border_color(theme.hairline())
        .bg(theme.field_bg())
        .opacity(if disabled { 0.5 } else { 1.0 })
        .when(!disabled, |this| {
            this.cursor_pointer()
                .on_mouse_down(MouseButton::Left, on_click)
        })
        .child(
            div()
                .text_size(px(11.))
                .text_color(theme.muted)
                .child(label),
        )
        .child(
            div()
                .text_size(px(11.))
                .text_color(theme.foreground)
                .child(value.unwrap_or_else(|| "Mixed".into())),
        )
}

/// Clickable inspector choice used for binary and segmented settings.
pub fn choice_field(
    theme: Theme,
    id: SharedString,
    label: &'static str,
    selected: Option<bool>,
    disabled: bool,
    on_click: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    select_field(
        theme,
        id,
        label,
        selected.map(|selected| SharedString::from(if selected { "On" } else { "Off" })),
        disabled,
        on_click,
    )
}

pub fn section(
    theme: Theme,
    title: &'static str,
    open: bool,
    on_toggle: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    children: impl IntoElement,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .border_b_1()
        .border_color(theme.border)
        .px_2()
        .py_1p5()
        .child(
            div()
                .id(SharedString::from(format!("props-section-{title}")))
                .flex()
                .items_center()
                .h(px(24.))
                .px_1()
                .rounded(px(4.))
                .cursor_pointer()
                .hover(|s| s.bg(theme.hover))
                .on_mouse_down(MouseButton::Left, on_toggle)
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(theme.muted_strong)
                        .child(if open { "▾ " } else { "▸ " }),
                )
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(theme.muted_strong)
                        .child(title),
                ),
        )
        .when(open, |this| {
            this.child(div().mt_1().flex().flex_col().gap_1().child(children))
        })
}

pub fn pair(left: impl IntoElement, right: impl IntoElement) -> impl IntoElement {
    div()
        .flex()
        .gap_1()
        .child(div().flex_1().min_w_0().child(left))
        .child(div().flex_1().min_w_0().child(right))
}

pub fn number_field(
    theme: Theme,
    id: SharedString,
    label: &'static str,
    display: SharedString,
    focused: bool,
    disabled: bool,
    suffix: Option<&'static str>,
    on_focus: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    on_scrub_down: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    on_scrub_move: impl Fn(&MouseMoveEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    on_scrub_up: impl Fn(&MouseUpEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .gap_1()
        .h(px(28.))
        .px_2()
        .rounded(px(6.))
        .border_1()
        .border_color(if focused {
            rgba(0x7aa2f788).into()
        } else {
            theme.hairline()
        })
        .bg(theme.field_bg())
        .opacity(if disabled { 0.5 } else { 1.0 })
        .cursor(if disabled {
            CursorStyle::Arrow
        } else {
            CursorStyle::IBeam
        })
        .when(!disabled, |this| {
            this.on_mouse_down(MouseButton::Left, on_focus)
        })
        .child(
            div()
                .id(SharedString::from(format!("{label}-scrub")))
                .flex_shrink_0()
                .text_size(px(11.))
                .text_color(theme.muted)
                .cursor(if disabled {
                    CursorStyle::Arrow
                } else {
                    CursorStyle::ResizeLeftRight
                })
                .when(!disabled, |this| {
                    this.on_mouse_down(MouseButton::Left, on_scrub_down)
                        .on_mouse_move(on_scrub_move)
                        .on_mouse_up(MouseButton::Left, on_scrub_up)
                })
                .child(label),
        )
        .child(field_content(
            display,
            "—",
            focused && !disabled,
            theme.foreground,
            theme.muted,
            theme.bright_white,
            px(11.),
            px(12.),
        ))
        .when_some(suffix, |this, s| {
            this.child(
                div()
                    .flex_shrink_0()
                    .text_size(px(10.))
                    .text_color(theme.muted)
                    .child(s),
            )
        })
}

pub fn text_field(
    theme: Theme,
    id: SharedString,
    display: SharedString,
    placeholder: SharedString,
    focused: bool,
    disabled: bool,
    on_focus: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .h(px(28.))
        .px_2()
        .rounded(px(6.))
        .border_1()
        .border_color(if focused {
            rgba(0x7aa2f788).into()
        } else {
            theme.hairline()
        })
        .bg(theme.field_bg())
        .opacity(if disabled { 0.5 } else { 1.0 })
        .cursor(if disabled {
            CursorStyle::Arrow
        } else {
            CursorStyle::IBeam
        })
        .when(!disabled, |this| {
            this.on_mouse_down(MouseButton::Left, on_focus)
        })
        .child(field_content(
            display,
            placeholder,
            focused && !disabled,
            theme.foreground,
            theme.muted,
            theme.bright_white,
            px(11.),
            px(12.),
        ))
}

pub fn hex_color_field(
    theme: Theme,
    id: SharedString,
    color: Option<Color>,
    display: SharedString,
    focused: bool,
    disabled: bool,
    on_swatch: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    on_hex_focus: impl Fn(&MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    crate::color_picker::ColorPickerField::new(
        theme,
        id,
        color,
        display,
        focused,
        disabled,
        on_swatch,
        on_hex_focus,
    )
}

pub fn format_number(value: f64, places: i32) -> String {
    let factor = 10f64.powi(places);
    let rounded = (value * factor).round() / factor;
    if (rounded - rounded.round()).abs() < 1e-9 {
        format!("{}", rounded.round() as i64)
    } else {
        format!("{rounded}")
    }
}

pub fn format_hex(color: Color) -> String {
    let r = (color.r.clamp(0.0, 1.0) * 255.0).round() as u8;
    let g = (color.g.clamp(0.0, 1.0) * 255.0).round() as u8;
    let b = (color.b.clamp(0.0, 1.0) * 255.0).round() as u8;
    if color.a < 0.999 {
        let a = (color.a.clamp(0.0, 1.0) * 255.0).round() as u8;
        format!("#{r:02X}{g:02X}{b:02X}{a:02X}")
    } else {
        format!("#{r:02X}{g:02X}{b:02X}")
    }
}

pub fn parse_hex(input: &str) -> Option<Color> {
    let s = input.trim().trim_start_matches('#');
    match s.len() {
        6 => {
            let n = u32::from_str_radix(s, 16).ok()?;
            Some(Color::rgb(
                ((n >> 16) & 0xff) as u8,
                ((n >> 8) & 0xff) as u8,
                (n & 0xff) as u8,
            ))
        }
        8 => {
            let n = u32::from_str_radix(s, 16).ok()?;
            Some(Color::rgba(
                ((n >> 24) & 0xff) as f32 / 255.0,
                ((n >> 16) & 0xff) as f32 / 255.0,
                ((n >> 8) & 0xff) as f32 / 255.0,
                (n & 0xff) as f32 / 255.0,
            ))
        }
        3 => {
            let n = u32::from_str_radix(s, 16).ok()?;
            let r = ((n >> 8) & 0xf) as u8;
            let g = ((n >> 4) & 0xf) as u8;
            let b = (n & 0xf) as u8;
            Some(Color::rgb(r * 17, g * 17, b * 17))
        }
        _ => None,
    }
}
