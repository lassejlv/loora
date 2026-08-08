//! Reusable color picker: compact field + popover with hue / SV / alpha / presets.

use std::rc::Rc;

use gpui::{
    div, prelude::FluentBuilder, px, relative, rgba, CursorStyle, InteractiveElement, IntoElement,
    MouseButton, MouseDownEvent, MouseMoveEvent, ParentElement, RenderOnce, SharedString,
    StatefulInteractiveElement, Styled, Window,
};
use loora_engine::Color;

use crate::text_field::field_content;
use crate::theme::Theme;

type ColorChangeFn = Rc<dyn Fn(Color, &mut Window, &mut gpui::App)>;
type DismissFn = Rc<dyn Fn(&MouseDownEvent, &mut Window, &mut gpui::App)>;

/// HSV in ranges H∈[0,360), S∈[0,1], V∈[0,1], A∈[0,1].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hsv {
    pub h: f32,
    pub s: f32,
    pub v: f32,
    pub a: f32,
}

impl Hsv {
    pub fn from_color(color: Color) -> Self {
        let r = color.r.clamp(0.0, 1.0);
        let g = color.g.clamp(0.0, 1.0);
        let b = color.b.clamp(0.0, 1.0);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let d = max - min;
        let h = if d < 1e-6 {
            0.0
        } else if (max - r).abs() < 1e-6 {
            60.0 * (((g - b) / d) % 6.0)
        } else if (max - g).abs() < 1e-6 {
            60.0 * (((b - r) / d) + 2.0)
        } else {
            60.0 * (((r - g) / d) + 4.0)
        };
        let h = if h < 0.0 { h + 360.0 } else { h };
        let s = if max < 1e-6 { 0.0 } else { d / max };
        Self {
            h,
            s,
            v: max,
            a: color.a.clamp(0.0, 1.0),
        }
    }

    pub fn to_color(self) -> Color {
        let c = self.v * self.s;
        let x = c * (1.0 - ((self.h / 60.0) % 2.0 - 1.0).abs());
        let m = self.v - c;
        let (r1, g1, b1) = match (self.h as i32).rem_euclid(360) {
            0..=59 => (c, x, 0.0),
            60..=119 => (x, c, 0.0),
            120..=179 => (0.0, c, x),
            180..=239 => (0.0, x, c),
            240..=299 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        Color::rgba(r1 + m, g1 + m, b1 + m, self.a)
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

pub fn color_to_rgba(color: Color) -> gpui::Rgba {
    gpui::Rgba {
        r: color.r,
        g: color.g,
        b: color.b,
        a: color.a,
    }
}

/// Built-in swatches for quick picks.
pub fn preset_colors() -> [Color; 12] {
    [
        Color::rgb(0xff, 0xff, 0xff),
        Color::rgb(0xe1, 0xe1, 0xe1),
        Color::rgb(0x78, 0x78, 0x78),
        Color::rgb(0x1a, 0x1a, 0x1a),
        Color::rgb(0xf7, 0x76, 0x8e),
        Color::rgb(0xe0, 0xaf, 0x68),
        Color::rgb(0x9e, 0xce, 0x6a),
        Color::rgb(0x7d, 0xcf, 0xff),
        Color::rgb(0x7a, 0xa2, 0xf7),
        Color::rgb(0xbb, 0x9a, 0xf7),
        Color::rgb(0xff, 0x9e, 0x64),
        Color::rgb(0x73, 0xda, 0xc5),
    ]
}

/// Compact inspector field: swatch (opens popover) + hex text.
#[derive(IntoElement)]
pub struct ColorPickerField {
    id: SharedString,
    theme: Theme,
    color: Option<Color>,
    display: SharedString,
    focused: bool,
    disabled: bool,
    on_swatch: Box<dyn Fn(&MouseDownEvent, &mut Window, &mut gpui::App) + 'static>,
    on_hex_focus: Box<dyn Fn(&MouseDownEvent, &mut Window, &mut gpui::App) + 'static>,
}

impl ColorPickerField {
    pub fn new(
        theme: Theme,
        id: impl Into<SharedString>,
        color: Option<Color>,
        display: impl Into<SharedString>,
        focused: bool,
        disabled: bool,
        on_swatch: impl Fn(&MouseDownEvent, &mut Window, &mut gpui::App) + 'static,
        on_hex_focus: impl Fn(&MouseDownEvent, &mut Window, &mut gpui::App) + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            theme,
            color,
            display: display.into(),
            focused,
            disabled,
            on_swatch: Box::new(on_swatch),
            on_hex_focus: Box::new(on_hex_focus),
        }
    }
}

impl RenderOnce for ColorPickerField {
    fn render(self, _window: &mut Window, _cx: &mut gpui::App) -> impl IntoElement {
        let theme = self.theme;
        let swatch = self.color.unwrap_or(Color::rgba(0.0, 0.0, 0.0, 0.0));
        let on_swatch = self.on_swatch;
        let on_hex = self.on_hex_focus;

        div()
            .id(self.id)
            .flex()
            .items_center()
            .gap_1p5()
            .h(px(28.))
            .px_1p5()
            .rounded(px(6.))
            .border_1()
            .border_color(if self.focused {
                rgba(0x7aa2f788).into()
            } else {
                theme.hairline()
            })
            .bg(theme.surface_raised)
            .opacity(if self.disabled { 0.5 } else { 1.0 })
            .child(
                div()
                    .id("color-swatch")
                    .w(px(16.))
                    .h(px(16.))
                    .rounded(px(4.))
                    .border_1()
                    .border_color(rgba(0xffffff33))
                    .bg(color_to_rgba(swatch))
                    .cursor(if self.disabled {
                        CursorStyle::Arrow
                    } else {
                        CursorStyle::PointingHand
                    })
                    .when(!self.disabled, |this| {
                        this.on_mouse_down(MouseButton::Left, move |e, w, cx| on_swatch(e, w, cx))
                    }),
            )
            .child(
                div()
                    .id("color-hex")
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .cursor(if self.disabled {
                        CursorStyle::Arrow
                    } else {
                        CursorStyle::IBeam
                    })
                    .when(!self.disabled, |this| {
                        this.on_mouse_down(MouseButton::Left, move |e, w, cx| on_hex(e, w, cx))
                    })
                    .child(field_content(
                        self.display,
                        "#000000",
                        self.focused && !self.disabled,
                        theme.foreground,
                        theme.muted,
                        theme.bright_white,
                        px(11.),
                        px(12.),
                    )),
            )
    }
}

/// Floating popover for interactive color editing.
#[derive(IntoElement)]
pub struct ColorPickerPopover {
    theme: Theme,
    hsv: Hsv,
    on_change: ColorChangeFn,
    on_dismiss: DismissFn,
}

impl ColorPickerPopover {
    pub fn new(
        theme: Theme,
        color: Color,
        on_change: impl Fn(Color, &mut Window, &mut gpui::App) + 'static,
        on_dismiss: impl Fn(&MouseDownEvent, &mut Window, &mut gpui::App) + 'static,
    ) -> Self {
        Self {
            theme,
            hsv: Hsv::from_color(color),
            on_change: Rc::new(on_change),
            on_dismiss: Rc::new(on_dismiss),
        }
    }
}

impl RenderOnce for ColorPickerPopover {
    fn render(self, _window: &mut Window, _cx: &mut gpui::App) -> impl IntoElement {
        let theme = self.theme;
        let hsv = self.hsv;
        let color = hsv.to_color();
        let on_change = self.on_change;
        let on_dismiss = self.on_dismiss;

        // Keep the popover inside the properties column so we never have to
        // resize/inset the webview (that was thrashing move/resize hit-testing).
        div()
            .id("color-picker-root")
            .absolute()
            .inset_0()
            .occlude()
            .on_mouse_down(MouseButton::Left, move |event, window, cx| {
                on_dismiss(event, window, cx)
            })
            .child(
                div()
                    .id("color-picker-popover")
                    .debug_selector(|| "color-picker-popover".into())
                    .absolute()
                    .top(px(72.))
                    .right(px(16.))
                    .w(px(240.))
                    .max_h(px(420.))
                    .flex()
                    .flex_col()
                    .gap_2()
                    .p_3()
                    .rounded(px(12.))
                    .border_1()
                    .border_color(theme.hairline())
                    .bg(theme.panel_bg())
                    .shadow_lg()
                    .overflow_y_scroll()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .flex_shrink_0()
                            .child(
                                div()
                                    .text_size(px(12.))
                                    .text_color(theme.bright_white)
                                    .child("Color"),
                            )
                            .child(
                                div()
                                    .text_size(px(11.))
                                    .text_color(theme.muted)
                                    .child(format_hex(color)),
                            ),
                    )
                    .child(sv_plane(theme, hsv, on_change.clone()))
                    .child(hue_strip(hsv, on_change.clone()))
                    .child(alpha_strip(theme, hsv, on_change.clone()))
                    .child(presets_row(hsv.a, on_change)),
            )
    }
}

#[cfg(test)]
mod interaction_tests {
    use gpui::{point, Context, Entity, Modifiers, Render, TestAppContext, VisualTestContext};

    use super::*;

    struct PickerTestView {
        dismissed: bool,
    }

    impl Render for PickerTestView {
        fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let view: Entity<Self> = cx.entity();

            div().relative().size_full().when(!self.dismissed, |this| {
                this.child(ColorPickerPopover::new(
                    Theme::default(),
                    Color::rgb(0x7a, 0xa2, 0xf7),
                    |_, _, _| {},
                    move |_, _, cx| {
                        view.update(cx, |this, cx| {
                            this.dismissed = true;
                            cx.notify();
                        });
                    },
                ))
            })
        }
    }

    #[gpui::test]
    fn clicking_outside_dismisses_the_popover(cx: &mut TestAppContext) {
        let (view, cx): (Entity<PickerTestView>, &mut VisualTestContext) =
            cx.add_window_view(|_, _| PickerTestView { dismissed: false });

        cx.simulate_click(point(px(8.), px(8.)), Modifiers::default());

        assert!(
            view.read_with(cx, |this, _| this.dismissed),
            "the color picker stayed open"
        );
    }

    #[gpui::test]
    fn clicking_inside_keeps_the_popover_open(cx: &mut TestAppContext) {
        let (view, cx): (Entity<PickerTestView>, &mut VisualTestContext) =
            cx.add_window_view(|_, _| PickerTestView { dismissed: false });
        let panel = cx
            .debug_bounds("color-picker-popover")
            .expect("the color picker should be rendered");

        cx.simulate_click(panel.center(), Modifiers::default());

        assert!(
            !view.read_with(cx, |this, _| this.dismissed),
            "a click inside the color picker dismissed it"
        );
    }
}

fn sv_plane(theme: Theme, hsv: Hsv, on_change: ColorChangeFn) -> impl IntoElement {
    let rows = 12u32;
    let cols = 16u32;
    div()
        .id("color-sv")
        .w_full()
        .h(px(140.))
        .rounded(px(8.))
        .overflow_hidden()
        .border_1()
        .border_color(theme.highlight_fill())
        .relative()
        .child(
            div()
                .absolute()
                .inset_0()
                .flex()
                .flex_col()
                .children((0..rows).map({
                    let on_change = on_change.clone();
                    move |row| {
                        let v = 1.0 - row as f32 / (rows - 1) as f32;
                        let hsv = hsv;
                        let on_change = on_change.clone();
                        div()
                            .flex()
                            .flex_1()
                            .w_full()
                            .children((0..cols).map({
                                let on_change = on_change.clone();
                                move |col| {
                                    let s = col as f32 / (cols - 1) as f32;
                                    let cell = Hsv {
                                        h: hsv.h,
                                        s,
                                        v,
                                        a: hsv.a,
                                    }
                                    .to_color();
                                    let on_change = on_change.clone();
                                    div()
                                        .id(SharedString::from(format!("sv-{row}-{col}")))
                                        .flex_1()
                                        .h_full()
                                        .bg(color_to_rgba(cell))
                                        .cursor_pointer()
                                        .on_mouse_down(MouseButton::Left, {
                                            let on_change = on_change.clone();
                                            move |_, w, cx| on_change(cell, w, cx)
                                        })
                                        .on_mouse_move({
                                            let on_change = on_change.clone();
                                            move |event: &MouseMoveEvent, w, cx| {
                                                if event.pressed_button == Some(MouseButton::Left) {
                                                    on_change(cell, w, cx);
                                                }
                                            }
                                        })
                                }
                            }))
                    }
                })),
        )
        .child(
            div()
                .absolute()
                .left(relative(hsv.s))
                .top(relative(1.0 - hsv.v))
                .ml(px(-5.))
                .mt(px(-5.))
                .w(px(10.))
                .h(px(10.))
                .rounded_full()
                .border_2()
                .border_color(rgba(0xffffffff))
                .bg(color_to_rgba(hsv.to_color())),
        )
}

fn hue_strip(hsv: Hsv, on_change: ColorChangeFn) -> impl IntoElement {
    let steps = 24u32;
    div()
        .id("color-hue")
        .w_full()
        .h(px(14.))
        .rounded(px(7.))
        .overflow_hidden()
        .flex()
        .relative()
        .children((0..steps).map({
            let on_change = on_change.clone();
            move |i| {
                let h = i as f32 / steps as f32 * 360.0;
                let cell = Hsv {
                    h,
                    s: 1.0,
                    v: 1.0,
                    a: 1.0,
                }
                .to_color();
                let hsv = hsv;
                let on_change = on_change.clone();
                div()
                    .id(SharedString::from(format!("hue-{i}")))
                    .flex_1()
                    .h_full()
                    .bg(color_to_rgba(cell))
                    .cursor_pointer()
                    .on_mouse_down(MouseButton::Left, {
                        let on_change = on_change.clone();
                        move |_, w, cx| {
                            on_change(
                                Hsv {
                                    h,
                                    s: hsv.s,
                                    v: hsv.v,
                                    a: hsv.a,
                                }
                                .to_color(),
                                w,
                                cx,
                            )
                        }
                    })
            }
        }))
        .child(
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left(relative(hsv.h / 360.0))
                .ml(px(-1.5))
                .w(px(3.))
                .bg(rgba(0xffffffff))
                .rounded(px(1.)),
        )
}

fn alpha_strip(theme: Theme, hsv: Hsv, on_change: ColorChangeFn) -> impl IntoElement {
    let steps = 16u32;
    let opaque = Hsv { a: 1.0, ..hsv }.to_color();
    div()
        .id("color-alpha")
        .w_full()
        .h(px(14.))
        .rounded(px(7.))
        .overflow_hidden()
        .flex()
        .relative()
        .border_1()
        .border_color(theme.highlight_fill())
        .children((0..steps).map({
            let on_change = on_change.clone();
            move |i| {
                let a = i as f32 / (steps - 1) as f32;
                let cell = Color::rgba(opaque.r, opaque.g, opaque.b, a);
                let hsv = hsv;
                let on_change = on_change.clone();
                div()
                    .id(SharedString::from(format!("alpha-{i}")))
                    .flex_1()
                    .h_full()
                    .bg(color_to_rgba(cell))
                    .cursor_pointer()
                    .on_mouse_down(MouseButton::Left, {
                        let on_change = on_change.clone();
                        move |_, w, cx| {
                            on_change(
                                Hsv {
                                    h: hsv.h,
                                    s: hsv.s,
                                    v: hsv.v,
                                    a,
                                }
                                .to_color(),
                                w,
                                cx,
                            )
                        }
                    })
            }
        }))
        .child(
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left(relative(hsv.a))
                .ml(px(-1.5))
                .w(px(3.))
                .bg(rgba(0xffffffff))
                .rounded(px(1.)),
        )
}

fn presets_row(alpha: f32, on_change: ColorChangeFn) -> impl IntoElement {
    div()
        .flex()
        .flex_wrap()
        .gap_1()
        .children(preset_colors().into_iter().enumerate().map(move |(i, c)| {
            let color = Color::rgba(c.r, c.g, c.b, alpha);
            let on_change = on_change.clone();
            div()
                .id(SharedString::from(format!("preset-{i}")))
                .w(px(18.))
                .h(px(18.))
                .rounded(px(4.))
                .border_1()
                .border_color(rgba(0xffffff22))
                .bg(color_to_rgba(color))
                .cursor_pointer()
                .on_mouse_down(MouseButton::Left, move |_, w, cx| on_change(color, w, cx))
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hsv_roundtrip_primary() {
        let c = Color::rgb(0x7a, 0xa2, 0xf7);
        let back = Hsv::from_color(c).to_color();
        assert!((back.r - c.r).abs() < 0.02);
        assert!((back.g - c.g).abs() < 0.02);
        assert!((back.b - c.b).abs() < 0.02);
    }

    #[test]
    fn parse_hex_accepts_hash() {
        let c = parse_hex("#7AA2F7").unwrap();
        assert!((c.r - 122.0 / 255.0).abs() < 0.01);
    }
}
