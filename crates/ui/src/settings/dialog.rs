//! Cursor-inspired settings overlay: sidebar nav + section content.

use std::collections::HashMap;

use gpui::{
    div, prelude::FluentBuilder, px, Entity, FontWeight, InteractiveElement, IntoElement,
    MouseButton, ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled,
};

use crate::CanvasWorkspace;
use crate::icon::{Icon, IconName};
use crate::motion::{Ease, Motion, MotionStyle, Transition};
use crate::settings::shortcuts::{
    display_keystroke, resolve_keystrokes, shortcut_catalog, ShortcutCategory, ShortcutDef,
};
use crate::settings::SettingsSection;
use crate::sidebar::{Sidebar, SidebarEntry};
use crate::theme::{Theme, ThemeKind};
use std::time::Duration;

#[derive(IntoElement)]
pub struct SettingsDialog {
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    section: SettingsSection,
    shortcut_overrides: HashMap<String, String>,
    recording: Option<String>,
    query: String,
}

impl SettingsDialog {
    pub fn new(
        workspace: Entity<CanvasWorkspace>,
        theme: Theme,
        section: SettingsSection,
        shortcut_overrides: HashMap<String, String>,
        recording: Option<String>,
        query: String,
    ) -> Self {
        Self {
            workspace,
            theme,
            section,
            shortcut_overrides,
            recording,
            query,
        }
    }
}

impl RenderOnce for SettingsDialog {
    fn render(self, _window: &mut gpui::Window, _cx: &mut gpui::App) -> impl IntoElement {
        let theme = self.theme;
        let workspace = self.workspace;
        let section = self.section;
        let overrides = self.shortcut_overrides;
        let recording = self.recording;
        let query = self.query;

        div()
            .absolute()
            .inset_0()
            .occlude()
            .flex()
            .items_center()
            .justify_center()
            .bg(theme.overlay_scrim())
            .on_mouse_down(MouseButton::Left, {
                let workspace = workspace.clone();
                move |_, _, cx| {
                    workspace.update(cx, |this, cx| this.close_settings(cx));
                }
            })
            .child(
                Motion::new()
                    .id("settings-dialog")
                    .initial(MotionStyle::new().opacity(0.).y(px(14.)).scale(0.98))
                    .animate(MotionStyle::new().opacity(1.).y(px(0.)).scale(1.))
                    .transition(Transition::tween(Duration::from_millis(240)).ease(Ease::EaseOut))
                    .child(
                        div()
                            .w(px(920.))
                            .h(px(620.))
                            .flex()
                            .flex_row()
                            .rounded(px(16.))
                            .border_1()
                            .border_color(theme.hairline())
                            .bg(theme.main_bg)
                            .shadow_lg()
                            .overflow_hidden()
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .child(settings_sidebar(theme, section, workspace.clone()))
                            .child(
                                div()
                                    .flex_1()
                                    .h_full()
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .bg(theme.main_bg)
                                    .child(settings_header(theme, section, workspace.clone()))
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_h_0()
                                            .overflow_hidden()
                                            .px(px(28.))
                                            .pb(px(28.))
                                            .child(match section {
                                                SettingsSection::General => {
                                                    general_page(theme, workspace.clone()).into_any_element()
                                                }
                                                SettingsSection::Appearance => {
                                                    appearance_page(theme, workspace.clone())
                                                        .into_any_element()
                                                }
                                                SettingsSection::Shortcuts => shortcuts_page(
                                                    theme,
                                                    workspace,
                                                    overrides,
                                                    recording,
                                                    query,
                                                )
                                                .into_any_element(),
                                            }),
                                    ),
                            ),
                    ),
            )
    }
}

fn settings_sidebar(
    theme: Theme,
    section: SettingsSection,
    workspace: Entity<CanvasWorkspace>,
) -> impl IntoElement {
    Sidebar::new(theme)
        .title("Settings")
        .subtitle("Preferences")
        .width(220.0_f32)
        .selected(section.id())
        .items([
            SidebarEntry::new("general", "General", IconName::Settings),
            SidebarEntry::new("appearance", "Appearance", IconName::View),
            SidebarEntry::new("shortcuts", "Shortcuts", IconName::Keyboard),
        ])
        .pt(px(20.))
        .on_select(move |id, _, cx| {
            if let Some(next) = SettingsSection::parse(id) {
                workspace.update(cx, |this, cx| this.select_settings_section(next, cx));
            }
        })
}

fn settings_header(
    theme: Theme,
    section: SettingsSection,
    workspace: Entity<CanvasWorkspace>,
) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .justify_between()
        .h(px(64.))
        .px(px(28.))
        .border_b_1()
        .border_color(theme.hairline_soft())
        .child(
            div()
                .text_size(px(20.))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.foreground)
                .child(section.label()),
        )
        .child(
            div()
                .id("settings-close")
                .flex()
                .items_center()
                .justify_center()
                .size(px(32.))
                .rounded(px(8.))
                .cursor_pointer()
                .text_color(theme.muted)
                .hover(|s| s.bg(theme.hover).text_color(theme.foreground))
                .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                    workspace.update(cx, |this, cx| this.close_settings(cx));
                })
                .child(Icon::hugeicon(IconName::CancelSquare).size(px(16.))),
        )
}

fn general_page(theme: Theme, workspace: Entity<CanvasWorkspace>) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap_4()
        .child(section_label(theme, "Loora"))
        .child(
            settings_card(theme).child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(row_title(theme, "Native design canvas"))
                    .child(row_description(
                        theme,
                        "Built with GPUI. Designs and preferences save locally on this machine.",
                    )),
            ),
        )
        .child(section_label(theme, "Quick actions"))
        .child(
            settings_card(theme)
                .child(action_row(
                    theme,
                    "Open Shortcuts",
                    "Remap keyboard shortcuts used across the canvas",
                    "Open",
                    {
                        let workspace = workspace.clone();
                        move |_, _, cx| {
                            workspace.update(cx, |this, cx| {
                                this.select_settings_section(SettingsSection::Shortcuts, cx);
                            });
                        }
                    },
                ))
                .child(divider(theme))
                .child(action_row(
                    theme,
                    "Appearance",
                    "Switch between dark and light chrome",
                    "Open",
                    move |_, _, cx| {
                        workspace.update(cx, |this, cx| {
                            this.select_settings_section(SettingsSection::Appearance, cx);
                        });
                    },
                )),
        )
}

fn appearance_page(theme: Theme, workspace: Entity<CanvasWorkspace>) -> impl IntoElement {
    let kind = theme.kind;
    div()
        .flex()
        .flex_col()
        .gap_4()
        .child(section_label(theme, "Theme"))
        .child(
            settings_card(theme).child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(row_title(theme, "Color mode"))
                    .child(row_description(
                        theme,
                        "Applies to chrome, panels, and overlays. Canvas artboards keep their own fills.",
                    ))
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(theme_choice(
                                theme,
                                workspace.clone(),
                                ThemeKind::Dark,
                                kind == ThemeKind::Dark,
                            ))
                            .child(theme_choice(
                                theme,
                                workspace,
                                ThemeKind::Light,
                                kind == ThemeKind::Light,
                            )),
                    ),
            ),
        )
}

fn theme_choice(
    theme: Theme,
    workspace: Entity<CanvasWorkspace>,
    kind: ThemeKind,
    selected: bool,
) -> impl IntoElement {
    let label = match kind {
        ThemeKind::Dark => "Dark",
        ThemeKind::Light => "Light",
    };
    let id: SharedString = format!("theme-choice-{}", kind.as_str()).into();
    div()
        .id(id)
        .flex_1()
        .flex()
        .flex_col()
        .gap_2()
        .p_3()
        .rounded(px(10.))
        .border_1()
        .border_color(if selected {
            theme.accent
        } else {
            theme.hairline()
        })
        .bg(if selected {
            theme.highlight_fill()
        } else {
            theme.field_bg()
        })
        .cursor_pointer()
        .hover(|s| s.bg(theme.hover))
        .on_mouse_down(MouseButton::Left, move |_, _, cx| {
            workspace.update(cx, |this, cx| this.set_ui_theme_kind(kind, cx));
        })
        .child(
            div()
                .h(px(48.))
                .rounded(px(6.))
                .bg(match kind {
                    ThemeKind::Dark => theme.black,
                    ThemeKind::Light => theme.bright_white,
                })
                .border_1()
                .border_color(theme.hairline()),
        )
        .child(
            div()
                .text_size(px(13.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme.foreground)
                .child(label),
        )
}

fn shortcuts_page(
    theme: Theme,
    workspace: Entity<CanvasWorkspace>,
    overrides: HashMap<String, String>,
    recording: Option<String>,
    query: String,
) -> impl IntoElement {
    let q = query.to_lowercase();
    let catalog: Vec<&ShortcutDef> = shortcut_catalog()
        .iter()
        .filter(|def| {
            q.is_empty()
                || def.label.to_lowercase().contains(&q)
                || def.description.to_lowercase().contains(&q)
                || def.category.label().to_lowercase().contains(&q)
        })
        .collect();

    let categories = [
        ShortcutCategory::App,
        ShortcutCategory::File,
        ShortcutCategory::Edit,
        ShortcutCategory::View,
        ShortcutCategory::Arrange,
        ShortcutCategory::Tools,
    ];

    div()
        .flex()
        .flex_col()
        .gap_4()
        .size_full()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .items_center()
                        .gap_2()
                        .h(px(36.))
                        .px_3()
                        .rounded(px(8.))
                        .border_1()
                        .border_color(theme.hairline())
                        .bg(theme.field_bg())
                        .child(
                            Icon::hugeicon(IconName::Search)
                                .size(px(14.))
                                .text_color(theme.muted),
                        )
                        .child(
                            div()
                                .id("settings-shortcut-search")
                                .flex_1()
                                .text_size(px(13.))
                                .text_color(if query.is_empty() {
                                    theme.muted
                                } else {
                                    theme.foreground
                                })
                                .child(if query.is_empty() {
                                    SharedString::from("Search shortcuts…")
                                } else {
                                    SharedString::from(query.clone())
                                })
                                .on_mouse_down(MouseButton::Left, {
                                    let workspace = workspace.clone();
                                    move |_, _, cx| {
                                        workspace.update(cx, |this, cx| {
                                            this.focus_shortcut_search(cx);
                                        });
                                    }
                                }),
                        ),
                )
                .child(
                    div()
                        .id("settings-reset-shortcuts")
                        .h(px(36.))
                        .px_3()
                        .rounded(px(8.))
                        .border_1()
                        .border_color(theme.hairline())
                        .bg(theme.field_bg())
                        .cursor_pointer()
                        .hover(|s| s.bg(theme.hover))
                        .flex()
                        .items_center()
                        .text_size(px(12.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.foreground)
                        .child("Reset all")
                        .on_mouse_down(MouseButton::Left, {
                            let workspace = workspace.clone();
                            move |_, _, cx| {
                                workspace.update(cx, |this, cx| this.reset_all_shortcuts(cx));
                            }
                        }),
                ),
        )
        .child(row_description(
            theme,
            "Click a shortcut to record a new keystroke. Esc cancels. Delete restores the default.",
        ))
        .child(
            div()
                .id("settings-shortcuts-scroll")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap_4()
                .children(categories.into_iter().filter_map(|category| {
                    let rows: Vec<&ShortcutDef> = catalog
                        .iter()
                        .copied()
                        .filter(|def| def.category == category)
                        .collect();
                    if rows.is_empty() {
                        return None;
                    }
                    Some(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(section_label(theme, category.label()))
                            .child(
                                settings_card(theme).children(rows.into_iter().enumerate().flat_map(
                                    |(index, def)| {
                                        let mut items = Vec::new();
                                        if index > 0 {
                                            items.push(divider(theme).into_any_element());
                                        }
                                        items.push(
                                            shortcut_row(
                                                theme,
                                                workspace.clone(),
                                                def,
                                                &overrides,
                                                recording.as_deref(),
                                            )
                                            .into_any_element(),
                                        );
                                        items
                                    },
                                )),
                            )
                            .into_any_element(),
                    )
                })),
        )
}

fn shortcut_row(
    theme: Theme,
    workspace: Entity<CanvasWorkspace>,
    def: &ShortcutDef,
    overrides: &HashMap<String, String>,
    recording: Option<&str>,
) -> impl IntoElement {
    let id = def.id.to_string();
    let is_recording = recording == Some(def.id);
    let is_custom = overrides.contains_key(def.id);
    let keystrokes = resolve_keystrokes(def, overrides);
    let chip_label = if is_recording {
        "Press keys…".to_string()
    } else {
        display_keystroke(&keystrokes)
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .py_1()
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap_0p5()
                .child(row_title(theme, def.label))
                .child(row_description(theme, def.description)),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .when(is_custom && !is_recording, |this| {
                    let workspace = workspace.clone();
                    let action_id = id.clone();
                    this.child(
                        div()
                            .id(SharedString::from(format!("reset-shortcut-{action_id}")))
                            .px_2()
                            .h(px(28.))
                            .rounded(px(6.))
                            .cursor_pointer()
                            .text_size(px(11.))
                            .text_color(theme.muted)
                            .hover(|s| s.text_color(theme.foreground).bg(theme.hover))
                            .flex()
                            .items_center()
                            .child("Reset")
                            .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                                workspace.update(cx, |this, cx| {
                                    this.reset_shortcut(&action_id, cx);
                                });
                            }),
                    )
                })
                .child(
                    div()
                        .id(SharedString::from(format!("shortcut-chip-{id}")))
                        .h(px(30.))
                        .px_3()
                        .rounded(px(8.))
                        .border_1()
                        .border_color(if is_recording {
                            theme.accent
                        } else {
                            theme.hairline()
                        })
                        .bg(if is_recording {
                            theme.highlight_fill()
                        } else {
                            theme.field_bg()
                        })
                        .cursor_pointer()
                        .hover(|s| s.bg(theme.hover))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(12.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if is_recording {
                            theme.accent
                        } else {
                            theme.foreground
                        })
                        .child(chip_label)
                        .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                            workspace.update(cx, |this, cx| {
                                this.begin_shortcut_recording(&id, cx);
                            });
                        }),
                ),
        )
}

fn settings_card(theme: Theme) -> gpui::Div {
    div()
        .flex()
        .flex_col()
        .rounded(px(12.))
        .border_1()
        .border_color(theme.hairline())
        .bg(theme.surface)
        .px_4()
        .py_3()
}

fn section_label(theme: Theme, title: &'static str) -> impl IntoElement {
    div()
        .text_size(px(12.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(theme.muted_strong)
        .child(title)
}

fn row_title(theme: Theme, title: impl Into<SharedString>) -> impl IntoElement {
    div()
        .text_size(px(13.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(theme.foreground)
        .child(title.into())
}

fn row_description(theme: Theme, text: impl Into<SharedString>) -> impl IntoElement {
    div()
        .text_size(px(12.))
        .text_color(theme.muted)
        .child(text.into())
}

fn divider(theme: Theme) -> impl IntoElement {
    div().h(px(1.)).my_2().bg(theme.hairline_soft())
}

fn action_row(
    theme: Theme,
    title: &'static str,
    description: &'static str,
    action_label: &'static str,
    on_click: impl Fn(&gpui::MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap_0p5()
                .child(row_title(theme, title))
                .child(row_description(theme, description)),
        )
        .child(
            div()
                .id(SharedString::from(format!("settings-action-{title}")))
                .h(px(30.))
                .px_3()
                .rounded(px(8.))
                .border_1()
                .border_color(theme.hairline())
                .bg(theme.field_bg())
                .cursor_pointer()
                .hover(|s| s.bg(theme.hover))
                .flex()
                .items_center()
                .text_size(px(12.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme.foreground)
                .child(action_label)
                .on_mouse_down(MouseButton::Left, on_click),
        )
}
