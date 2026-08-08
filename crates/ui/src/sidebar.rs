use std::rc::Rc;

use gpui::{
    div, prelude::*, px, App, ClickEvent, FontWeight, IntoElement, RenderOnce, SharedString,
    StyleRefinement, Styled, Window,
};

use crate::component::StyledSlot;
use crate::icon::{Icon, IconName};
use crate::theme::Theme;

type SidebarSelectHandler = Rc<dyn Fn(&str, &mut Window, &mut App)>;

/// One navigable row in a [`Sidebar`].
#[derive(Clone, Debug)]
pub struct SidebarEntry {
    pub id: SharedString,
    pub label: SharedString,
    pub icon: IconName,
}

impl SidebarEntry {
    pub fn new(
        id: impl Into<SharedString>,
        label: impl Into<SharedString>,
        icon: IconName,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon,
        }
    }
}

/// Styleable sidebar row with Hugeicons + label slots.
///
/// Style the root via [`Styled`], or nest styles into child slots:
///
/// ```ignore
/// SidebarItem::new(SidebarEntry::new("home", "Home", IconName::Home))
///     .h(px(36.))
///     .rounded(px(8.))
///     .icon(|i| i.size(px(18.)).text_color(theme.accent))
///     .label(|s| s.text_size(px(13.)).font_weight(FontWeight::MEDIUM))
/// ```
#[derive(IntoElement)]
pub struct SidebarItem {
    entry: SidebarEntry,
    icon: Icon,
    style: StyleRefinement,
    label_style: StyleRefinement,
    active: bool,
    theme: Theme,
    on_click: Option<SidebarSelectHandler>,
}

impl SidebarItem {
    pub fn new(entry: SidebarEntry) -> Self {
        let icon = Icon::hugeicon(entry.icon).size(px(18.));
        Self {
            entry,
            icon,
            style: StyleRefinement::default()
                .flex()
                .flex_row()
                .items_center()
                .gap_2p5()
                .h(px(36.))
                .px(px(10.))
                .rounded(px(8.))
                .cursor_pointer(),
            label_style: StyleRefinement::default().text_size(px(13.)),
            active: false,
            theme: Theme::dark(),
            on_click: None,
        }
    }

    pub fn theme(mut self, theme: Theme) -> Self {
        self.theme = theme;
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    /// Style the nested Hugeicons [`Icon`] slot.
    pub fn icon(mut self, f: impl FnOnce(Icon) -> Icon) -> Self {
        self.icon = f(self.icon);
        self
    }

    /// Style the nested label slot (`StyleRefinement` implements [`Styled`]).
    pub fn label(mut self, f: impl FnOnce(StyleRefinement) -> StyleRefinement) -> Self {
        self.label_style = f(self.label_style);
        self
    }

    pub fn on_click(mut self, listener: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(listener));
        self
    }

    pub fn on_select_rc(mut self, listener: SidebarSelectHandler) -> Self {
        self.on_click = Some(listener);
        self
    }
}

impl Styled for SidebarItem {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for SidebarItem {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let fg = if self.active {
            theme.foreground
        } else {
            theme.muted_strong
        };
        let bg = if self.active {
            theme.selected
        } else {
            gpui::transparent_black()
        };
        let hover_bg = theme.hover;
        let hover_fg = theme.foreground;
        let entry_id = self.entry.id.clone();
        let element_id: SharedString = format!("sidebar-{}", entry_id).into();
        let label_weight = if self.active {
            FontWeight::MEDIUM
        } else {
            FontWeight::NORMAL
        };

        div()
            .id(element_id)
            .refine_style(&self.style)
            .bg(bg)
            .text_color(fg)
            .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
            .child(self.icon)
            .child(
                div()
                    .refine_style(&self.label_style)
                    .font_weight(label_weight)
                    .child(self.entry.label),
            )
            .when_some(self.on_click, |this, on_click| {
                this.on_click(move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
                    on_click(entry_id.as_ref(), window, cx);
                })
            })
    }
}

/// Clean navigation sidebar with Hugeicons glyphs.
///
/// Supply your own [`SidebarEntry`] lists — the library does not own app routes.
#[derive(IntoElement)]
pub struct Sidebar {
    theme: Theme,
    title: SharedString,
    subtitle: SharedString,
    selected: SharedString,
    items: Vec<SidebarEntry>,
    footer: Vec<SidebarEntry>,
    width: f32,
    style: StyleRefinement,
    item_style: Option<Box<dyn Fn(SidebarItem) -> SidebarItem>>,
    on_select: Option<SidebarSelectHandler>,
}

impl Sidebar {
    pub fn new(theme: Theme) -> Self {
        Self {
            theme,
            title: "App".into(),
            subtitle: SharedString::default(),
            selected: SharedString::default(),
            items: Vec::new(),
            footer: Vec::new(),
            width: 220.,
            style: StyleRefinement::default()
                .flex()
                .flex_col()
                .h_full()
                .flex_shrink_0()
                .pt(px(52.))
                .pb(px(16.))
                .px(px(12.)),
            item_style: None,
            on_select: None,
        }
    }

    pub fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = title.into();
        self
    }

    pub fn subtitle(mut self, subtitle: impl Into<SharedString>) -> Self {
        self.subtitle = subtitle.into();
        self
    }

    pub fn selected(mut self, id: impl Into<SharedString>) -> Self {
        self.selected = id.into();
        self
    }

    pub fn items(mut self, items: impl IntoIterator<Item = SidebarEntry>) -> Self {
        self.items = items.into_iter().collect();
        self
    }

    pub fn footer(mut self, items: impl IntoIterator<Item = SidebarEntry>) -> Self {
        self.footer = items.into_iter().collect();
        self
    }

    pub fn width(mut self, width: impl Into<f32>) -> Self {
        self.width = width.into();
        self
    }

    /// Style every [`SidebarItem`] while the sidebar builds them.
    pub fn item(mut self, f: impl Fn(SidebarItem) -> SidebarItem + 'static) -> Self {
        self.item_style = Some(Box::new(f));
        self
    }

    pub fn on_select(mut self, listener: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(listener));
        self
    }
}

impl Styled for Sidebar {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Sidebar {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let selected = self.selected;
        let on_select = self.on_select;
        let item_style = self.item_style;
        let title = self.title;
        let subtitle = self.subtitle;

        let build = |entry: SidebarEntry| {
            let active = entry.id.as_ref() == selected.as_ref();
            let mut item = SidebarItem::new(entry).theme(theme).active(active);
            if let Some(on_select) = on_select.clone() {
                item = item.on_select_rc(on_select);
            }
            if let Some(style_item) = item_style.as_ref() {
                item = style_item(item);
            }
            item
        };

        let primary: Vec<_> = self.items.into_iter().map(build).collect();
        let footer: Vec<_> = self.footer.into_iter().map(build).collect();

        div()
            .w(px(self.width))
            .bg(theme.sidebar_bg)
            .border_r_1()
            .border_color(theme.border)
            .refine_style(&self.style)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .px(px(8.))
                    .pb(px(16.))
                    .child(
                        div()
                            .text_size(px(13.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.foreground)
                            .child(title),
                    )
                    .when(!subtitle.is_empty(), |this| {
                        this.child(
                            div()
                                .text_size(px(11.))
                                .text_color(theme.muted)
                                .child(subtitle),
                        )
                    }),
            )
            .child(div().flex().flex_col().gap_0p5().flex_1().children(primary))
            .when(!footer.is_empty(), |this| {
                this.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_0p5()
                        .pt(px(8.))
                        .border_t_1()
                        .border_color(theme.border)
                        .children(footer),
                )
            })
    }
}
