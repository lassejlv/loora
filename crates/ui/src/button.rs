use gpui::{
    div, prelude::*, px, rgba, App, ClickEvent, FontWeight, IntoElement, RenderOnce, SharedString,
    StyleRefinement, Styled, Window,
};

use crate::component::StyledSlot;
use crate::icon::{Icon, IconName};
use crate::theme::Theme;

type ButtonClickHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// Visual treatment for [`Button`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    /// Frosted / translucent — lets the window blur show through.
    Blurry,
    /// Standard surface button.
    #[default]
    Default,
    /// Near-black fill.
    Dark,
    /// Light fill on dark chrome.
    Light,
    /// No fill; borderless until hover.
    Ghost,
    /// Destructive action.
    Danger,
    /// Caution / attention.
    Warning,
    /// Informational / accent.
    Info,
}

struct ButtonColors {
    bg: gpui::Hsla,
    hover_bg: gpui::Hsla,
    active_bg: gpui::Hsla,
    border: gpui::Hsla,
    hover_border: gpui::Hsla,
    fg: gpui::Hsla,
}

impl ButtonVariant {
    fn colors(self, theme: Theme) -> ButtonColors {
        match self {
            Self::Blurry => ButtonColors {
                bg: theme.hairline(),
                hover_bg: theme.highlight_fill(),
                active_bg: theme.selected,
                border: theme.hairline(),
                hover_border: theme.muted_strong,
                fg: theme.foreground,
            },
            Self::Default => ButtonColors {
                bg: theme.surface,
                hover_bg: theme.hover,
                active_bg: theme.selected,
                border: theme.border,
                hover_border: theme.accent,
                fg: theme.foreground,
            },
            Self::Dark => ButtonColors {
                bg: rgba(0x0a0a0acc).into(),
                hover_bg: rgba(0x141414e6).into(),
                active_bg: rgba(0x000000f2).into(),
                border: rgba(0x2a2a2acc).into(),
                hover_border: theme.muted_strong,
                fg: theme.bright_white,
            },
            Self::Light => ButtonColors {
                bg: rgba(0xf3f3f3e6).into(),
                hover_bg: rgba(0xffffff).into(),
                active_bg: rgba(0xe8e8e8f2).into(),
                border: rgba(0xffffffaa).into(),
                hover_border: rgba(0xffffff).into(),
                fg: theme.black,
            },
            Self::Ghost => ButtonColors {
                bg: gpui::transparent_black(),
                hover_bg: theme.wash(),
                active_bg: theme.highlight_fill(),
                border: gpui::transparent_black(),
                hover_border: theme.hairline(),
                fg: theme.foreground,
            },
            Self::Danger => ButtonColors {
                bg: rgba(0xf7768e33).into(),
                hover_bg: rgba(0xf7768e55).into(),
                active_bg: rgba(0xf7768e77).into(),
                border: rgba(0xf7768e88).into(),
                hover_border: theme.bright_red,
                fg: theme.bright_red,
            },
            Self::Warning => ButtonColors {
                bg: rgba(0xe0af6833).into(),
                hover_bg: rgba(0xe0af6855).into(),
                active_bg: rgba(0xe0af6877).into(),
                border: rgba(0xe0af6888).into(),
                hover_border: theme.bright_yellow,
                fg: theme.bright_yellow,
            },
            Self::Info => ButtonColors {
                bg: rgba(0x7aa2f733).into(),
                hover_bg: rgba(0x7aa2f755).into(),
                active_bg: rgba(0x7aa2f777).into(),
                border: rgba(0x7aa2f788).into(),
                hover_border: theme.bright_blue,
                fg: theme.bright_blue,
            },
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blurry => "Blurry",
            Self::Default => "Default",
            Self::Dark => "Dark",
            Self::Light => "Light",
            Self::Ghost => "Ghost",
            Self::Danger => "Danger",
            Self::Warning => "Warning",
            Self::Info => "Info",
        }
    }
}

/// Clickable button with a [`ButtonVariant`].
///
/// Implements [`Styled`] for the root. Nest styles into the optional icon via `.icon(|i| …)`.
#[derive(IntoElement)]
pub struct Button {
    id: SharedString,
    label: SharedString,
    variant: ButtonVariant,
    theme: Theme,
    style: StyleRefinement,
    icon: Option<Icon>,
    on_click: Option<ButtonClickHandler>,
}

impl Button {
    pub fn new(id: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            variant: ButtonVariant::Default,
            theme: Theme::dark(),
            style: StyleRefinement::default()
                .flex()
                .items_center()
                .justify_center()
                .gap_2()
                .px(px(18.))
                .py(px(10.))
                .rounded(px(8.))
                .border_1()
                .text_size(px(14.))
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer(),
            icon: None,
            on_click: None,
        }
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn theme(mut self, theme: Theme) -> Self {
        self.theme = theme;
        self
    }

    /// Attach a Hugeicons glyph; style it with [`Self::icon`].
    pub fn with_icon(mut self, name: IconName) -> Self {
        self.icon = Some(Icon::hugeicon(name).size(px(16.)));
        self
    }

    /// Style the nested [`Icon`] slot (no-op when no icon is set).
    pub fn icon(mut self, f: impl FnOnce(Icon) -> Icon) -> Self {
        if let Some(icon) = self.icon.take() {
            self.icon = Some(f(icon));
        }
        self
    }

    pub fn on_click(
        mut self,
        listener: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(listener));
        self
    }
}

impl Styled for Button {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Button {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let colors = self.variant.colors(self.theme);
        let hover_bg = colors.hover_bg;
        let hover_border = colors.hover_border;
        let active_bg = colors.active_bg;

        div()
            .id(self.id)
            .refine_style(&self.style)
            .border_color(colors.border)
            .bg(colors.bg)
            .text_color(colors.fg)
            .hover(move |s| s.bg(hover_bg).border_color(hover_border))
            .active(move |s| s.bg(active_bg))
            .when_some(self.icon, |this, icon| this.child(icon))
            .child(self.label)
            .when_some(self.on_click, |this, on_click| this.on_click(on_click))
    }
}

/// All variants in display order (for galleries / demos).
pub const BUTTON_VARIANTS: &[ButtonVariant] = &[
    ButtonVariant::Blurry,
    ButtonVariant::Default,
    ButtonVariant::Dark,
    ButtonVariant::Light,
    ButtonVariant::Ghost,
    ButtonVariant::Danger,
    ButtonVariant::Warning,
    ButtonVariant::Info,
];
