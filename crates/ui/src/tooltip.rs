use gpui::{
    div, prelude::FluentBuilder, px, AnyElement, AnyView, App, AppContext, Context, FontWeight,
    InteractiveElement, IntoElement, ParentElement, Render, SharedString, Styled, Window,
};

use crate::theme::Theme;

const TOOLTIP_GAP: f32 = 8.0;
/// Button height (30) + gap — places the chip just above the host.
/// Must fit inside the bottom toolbar strip (webview covers anything above it).
const TOOLTIP_ABOVE: f32 = 30.0 + TOOLTIP_GAP;

/// Compact dark tooltip for Loora chrome (toolbar, icons, etc.).
pub struct Tooltip {
    title: SharedString,
    shortcut: Option<SharedString>,
}

impl Tooltip {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            shortcut: None,
        }
    }

    pub fn shortcut(mut self, shortcut: impl Into<SharedString>) -> Self {
        self.shortcut = Some(shortcut.into());
        self
    }

    /// Builder for [`StatefulInteractiveElement::tooltip`] (cursor-anchored).
    ///
    /// Prefer [`Tooltip::attach`] when the tip should sit above the target.
    pub fn text(title: impl Into<SharedString>) -> impl Fn(&mut Window, &mut App) -> AnyView {
        let title = title.into();
        move |_, cx| cx.new(|_| Self::new(title.clone())).into()
    }

    /// Tooltip with a keyboard shortcut hint on the right (cursor-anchored).
    pub fn with_key(
        title: impl Into<SharedString>,
        shortcut: impl Into<SharedString>,
    ) -> impl Fn(&mut Window, &mut App) -> AnyView {
        let title = title.into();
        let shortcut = shortcut.into();
        move |_, cx| {
            cx.new(|_| Self::new(title.clone()).shortcut(shortcut.clone()))
                .into()
        }
    }

    /// Wrap `child` so a tooltip appears centered above it on hover.
    pub fn attach(
        child: impl IntoElement,
        title: impl Into<SharedString>,
        shortcut: Option<&str>,
    ) -> impl IntoElement {
        let tip = match shortcut {
            Some(key) => Self::new(title).shortcut(key),
            None => Self::new(title),
        };

        div().relative().group("loora-tooltip").child(child).child(
            div()
                .absolute()
                .bottom(px(TOOLTIP_ABOVE))
                .left_0()
                .right_0()
                .flex()
                .justify_center()
                .invisible()
                .group_hover("loora-tooltip", |style| style.visible())
                .child(tip.into_chip()),
        )
    }

    fn into_chip(self) -> AnyElement {
        let theme = Theme::default();
        div()
            .flex()
            .items_center()
            .gap_2()
            .px_2p5()
            .h(px(28.))
            .rounded(px(8.))
            .border_1()
            .border_color(theme.hairline())
            .bg(theme.panel_bg())
            .shadow_sm()
            .child(
                div()
                    .text_size(px(12.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(theme.bright_white)
                    .whitespace_nowrap()
                    .child(self.title.clone()),
            )
            .when_some(self.shortcut.clone(), |this, shortcut| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_center()
                        .min_w(px(18.))
                        .h(px(18.))
                        .px_1()
                        .rounded(px(5.))
                        .bg(theme.highlight_fill())
                        .text_size(px(11.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.muted_strong)
                        .child(shortcut),
                )
            })
            .into_any_element()
    }
}

impl Render for Tooltip {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        Self {
            title: self.title.clone(),
            shortcut: self.shortcut.clone(),
        }
        .into_chip()
    }
}
