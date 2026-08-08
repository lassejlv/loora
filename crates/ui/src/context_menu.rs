//! Reusable context menu: floating panel, keyboard nav, no dim overlay.

use std::rc::Rc;

use gpui::{
    div, prelude::FluentBuilder, px, rgba, App, FontWeight, InteractiveElement, IntoElement,
    MouseButton, MouseDownEvent, ParentElement, Pixels, Point, RenderOnce, SharedString, Styled,
    Window,
};

use crate::icon::{Icon, IconName};
use crate::theme::Theme;

type DismissFn = Rc<dyn Fn(&MouseDownEvent, &mut Window, &mut App)>;
type ActionFn = Rc<dyn Fn(&str, &mut Window, &mut App)>;

/// One row or a divider in a [`ContextMenu`].
#[derive(Clone, Debug)]
pub enum ContextMenuEntry {
    Action(ContextMenuAction),
    Separator,
}

/// A selectable menu row.
#[derive(Clone, Debug)]
pub struct ContextMenuAction {
    pub id: SharedString,
    pub label: SharedString,
    pub shortcut: Option<SharedString>,
    pub icon: Option<IconName>,
    pub enabled: bool,
    pub destructive: bool,
}

impl ContextMenuAction {
    pub fn new(id: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            shortcut: None,
            icon: None,
            enabled: true,
            destructive: false,
        }
    }

    pub fn shortcut(mut self, shortcut: impl Into<SharedString>) -> Self {
        self.shortcut = Some(shortcut.into());
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub fn destructive(mut self) -> Self {
        self.destructive = true;
        self
    }
}

/// Floating context menu anchored at a screen point.
///
/// Uses a transparent full-screen catcher (no mute/dim) so outside clicks
/// dismiss cleanly without greying out the canvas.
#[derive(IntoElement)]
pub struct ContextMenu {
    theme: Theme,
    entries: Vec<ContextMenuEntry>,
    position: Point<Pixels>,
    /// Entry index used for keyboard highlight (separators are skipped on move).
    highlight: usize,
    on_dismiss: DismissFn,
    on_action: ActionFn,
}

impl ContextMenu {
    pub fn new(
        theme: Theme,
        entries: Vec<ContextMenuEntry>,
        position: Point<Pixels>,
        highlight: usize,
        on_dismiss: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
        on_action: impl Fn(&str, &mut Window, &mut App) + 'static,
    ) -> Self {
        let highlight = clamp_highlight(&entries, highlight);
        Self {
            theme,
            entries,
            position,
            highlight,
            on_dismiss: Rc::new(on_dismiss),
            on_action: Rc::new(on_action),
        }
    }
}

impl RenderOnce for ContextMenu {
    fn render(self, window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let entries = self.entries;
        let highlight = self.highlight;
        let on_dismiss = self.on_dismiss;
        let on_action = self.on_action;

        let menu_w = px(220.);
        let row_h = 32.0_f32;
        let sep_h = 9.0_f32;
        let pad_y = 6.0_f32;
        let mut content_h = pad_y * 2.0;
        for entry in &entries {
            content_h += match entry {
                ContextMenuEntry::Separator => sep_h,
                ContextMenuEntry::Action(_) => row_h,
            };
        }
        let menu_h = px(content_h);

        let win = window.bounds();
        let margin = px(8.);
        let max_x = (win.size.width - menu_w - margin).max(margin);
        let max_y = (win.size.height - menu_h - margin).max(margin);
        let x = self.position.x.clamp(margin, max_x);
        let y = self.position.y.clamp(margin, max_y);

        div()
            .id("context-menu-root")
            .absolute()
            .inset_0()
            .occlude()
            // Transparent catcher — dismiss without muting the UI.
            .on_mouse_down(MouseButton::Left, {
                let on_dismiss = on_dismiss.clone();
                move |e, w, cx| on_dismiss(e, w, cx)
            })
            .on_mouse_down(MouseButton::Right, {
                let on_dismiss = on_dismiss.clone();
                move |e, w, cx| on_dismiss(e, w, cx)
            })
            .on_mouse_down(MouseButton::Middle, {
                let on_dismiss = on_dismiss;
                move |e, w, cx| on_dismiss(e, w, cx)
            })
            .child(
                div()
                    .id("context-menu-panel")
                    .absolute()
                    .left(x)
                    .top(y)
                    .w(menu_w)
                    .flex()
                    .flex_col()
                    .py(px(pad_y))
                    .px_1p5()
                    .rounded(px(10.))
                    .border_1()
                    .border_color(theme.hairline())
                    .bg(theme.panel_bg())
                    .shadow_lg()
                    .overflow_hidden()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_mouse_down(MouseButton::Right, |_, _, cx| cx.stop_propagation())
                    .children(entries.into_iter().enumerate().map({
                        let on_action = on_action.clone();
                        move |(index, entry)| match entry {
                            ContextMenuEntry::Separator => {
                                separator_row(theme).into_any_element()
                            }
                            ContextMenuEntry::Action(action) => menu_row(
                                theme,
                                action,
                                index == highlight,
                                on_action.clone(),
                            )
                            .into_any_element(),
                        }
                    })),
            )
    }
}

fn separator_row(theme: Theme) -> impl IntoElement {
    div()
        .w_full()
        .h(px(9.))
        .flex()
        .items_center()
        .px_2()
        .child(
            div()
                .w_full()
                .h(px(1.))
                .bg(theme.hairline_soft()),
        )
}

fn menu_row(
    theme: Theme,
    action: ContextMenuAction,
    highlighted: bool,
    on_action: ActionFn,
) -> impl IntoElement {
    let id = action.id.clone();
    let enabled = action.enabled;
    let destructive = action.destructive;
    let label_color = if !enabled {
        theme.muted
    } else if destructive {
        rgba(0xf7768eff).into()
    } else if highlighted {
        theme.bright_white
    } else {
        theme.foreground
    };
    let shortcut_color = if !enabled {
        theme.muted
    } else {
        theme.muted_strong
    };

    div()
        .id(SharedString::from(format!("ctx-item-{}", action.id)))
        .flex()
        .items_center()
        .justify_between()
        .h(px(32.))
        .px_2()
        .rounded(px(7.))
        .cursor(if enabled {
            gpui::CursorStyle::PointingHand
        } else {
            gpui::CursorStyle::Arrow
        })
        .bg(if highlighted && enabled {
            theme.highlight_fill()
        } else {
            gpui::transparent_black()
        })
        .when(enabled, |this| {
            this.hover(|s| s.bg(theme.wash()))
                .on_mouse_down(MouseButton::Left, {
                    let on_action = on_action.clone();
                    let id = id.clone();
                    move |_, w, cx| {
                        cx.stop_propagation();
                        on_action(id.as_ref(), w, cx);
                    }
                })
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .min_w_0()
                .flex_1()
                .when_some(action.icon, |this, icon| {
                    this.child(
                        Icon::hugeicon(icon)
                            .size(px(14.))
                            .text_color(label_color),
                    )
                })
                .child(
                    div()
                        .text_size(px(13.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(label_color)
                        .child(action.label),
                ),
        )
        .when_some(action.shortcut, |this, shortcut| {
            this.child(
                div()
                    .text_size(px(11.))
                    .text_color(shortcut_color)
                    .child(shortcut),
            )
        })
}

/// First actionable (enabled) entry index, or 0.
pub fn first_action_index(entries: &[ContextMenuEntry]) -> usize {
    entries
        .iter()
        .position(|e| matches!(e, ContextMenuEntry::Action(a) if a.enabled))
        .unwrap_or(0)
}

pub fn clamp_highlight(entries: &[ContextMenuEntry], highlight: usize) -> usize {
    if entries.is_empty() {
        return 0;
    }
    highlight.min(entries.len() - 1)
}

/// Move highlight to the next enabled action in `dir` (+1 / -1).
pub fn move_highlight(entries: &[ContextMenuEntry], highlight: usize, dir: isize) -> usize {
    if entries.is_empty() {
        return 0;
    }
    let len = entries.len() as isize;
    let mut idx = highlight as isize;
    for _ in 0..entries.len() {
        idx = (idx + dir).rem_euclid(len);
        if let ContextMenuEntry::Action(action) = &entries[idx as usize] {
            if action.enabled {
                return idx as usize;
            }
        }
    }
    highlight
}

/// Action id at highlight, if that row is an enabled action.
pub fn action_id_at(entries: &[ContextMenuEntry], highlight: usize) -> Option<&str> {
    match entries.get(highlight) {
        Some(ContextMenuEntry::Action(action)) if action.enabled => Some(action.id.as_ref()),
        _ => None,
    }
}
