use gpui::{
    div, prelude::FluentBuilder, px, rgba, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled,
};
use loora_engine::DesignFileInfo;

use crate::canvas::workspace::CanvasWorkspace;
use crate::icon::{Icon, IconName};
use crate::motion::{Ease, Motion, MotionStyle, Transition};
use crate::text_field::field_content;
use crate::theme::Theme;
use std::time::Duration;

#[derive(IntoElement)]
pub struct FilesCommandDialog {
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    active_id: String,
    files: Vec<DesignFileInfo>,
    query: String,
    selected_index: usize,
    dirty: bool,
}

impl FilesCommandDialog {
    pub fn new(
        workspace: Entity<CanvasWorkspace>,
        theme: Theme,
        active_id: String,
        files: Vec<DesignFileInfo>,
        query: String,
        selected_index: usize,
        dirty: bool,
    ) -> Self {
        Self {
            workspace,
            theme,
            active_id,
            files,
            query,
            selected_index,
            dirty,
        }
    }
}

impl RenderOnce for FilesCommandDialog {
    fn render(self, _window: &mut gpui::Window, _cx: &mut gpui::App) -> impl IntoElement {
        let theme = self.theme;
        let workspace = self.workspace;
        let active_id = self.active_id;
        let query = self.query;
        let selected_index = self.selected_index;
        let dirty = self.dirty;

        let filtered: Vec<DesignFileInfo> = self
            .files
            .into_iter()
            .filter(|file| {
                query.is_empty() || file.name.to_lowercase().contains(&query.to_lowercase())
            })
            .collect();

        div()
            .absolute()
            .inset_0()
            .occlude()
            .flex()
            .items_start()
            .justify_center()
            .pt(px(120.))
            .bg(theme.overlay_scrim())
            .on_mouse_down(gpui::MouseButton::Left, {
                let workspace = workspace.clone();
                move |_, _, cx| {
                    workspace.update(cx, |this, cx| this.close_command_dialog(cx));
                }
            })
            .child(
                Motion::new()
                    .id("files-command-dialog")
                    .initial(MotionStyle::new().opacity(0.).y(px(18.)))
                    .animate(MotionStyle::new().opacity(1.).y(px(0.)))
                    .transition(Transition::tween(Duration::from_millis(280)).ease(Ease::EaseOut))
                    .child(
                        div()
                            .w(px(480.))
                            .max_h(px(420.))
                            .flex()
                            .flex_col()
                            .rounded(px(16.))
                            .border_1()
                            .border_color(theme.hairline())
                            .bg(theme.panel_bg())
                            .shadow_lg()
                            .overflow_hidden()
                            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| {
                                cx.stop_propagation()
                            })
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_3()
                                    .h(px(52.))
                                    .px_4()
                                    .border_b_1()
                                    .border_color(theme.hairline_soft())
                                    .child(
                                        Icon::hugeicon(IconName::Search)
                                            .size(px(16.))
                                            .text_color(theme.muted),
                                    )
                                    .child(field_content(
                                        query.clone(),
                                        "Search designs…",
                                        true,
                                        theme.bright_white,
                                        theme.muted,
                                        theme.bright_white,
                                        px(15.),
                                        px(18.),
                                    ))
                                    .child(
                                        div()
                                            .text_size(px(11.))
                                            .text_color(theme.muted)
                                            .child("esc"),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .py_1p5()
                                    .px_1p5()
                                    .gap_0p5()
                                    .overflow_hidden()
                                    .child(action_row(
                                        workspace.clone(),
                                        theme,
                                        "new-design-cmd",
                                        IconName::Add,
                                        "New design",
                                        Some("⌘N"),
                                        false,
                                        selected_index == 0,
                                        |this, cx| {
                                            this.create_design(cx);
                                            this.close_command_dialog(cx);
                                        },
                                    ))
                                    .child(action_row(
                                        workspace.clone(),
                                        theme,
                                        "import-designs-cmd",
                                        IconName::Layers,
                                        "Import designs…",
                                        None,
                                        false,
                                        selected_index == 1,
                                        |this, cx| {
                                            this.close_command_dialog(cx);
                                            this.prompt_import_designs(cx);
                                        },
                                    ))
                                    .child(action_row(
                                        workspace.clone(),
                                        theme,
                                        "import-luuma-cmd",
                                        IconName::Folder,
                                        "Import from Luuma folder",
                                        None,
                                        false,
                                        selected_index == 2,
                                        |this, cx| {
                                            this.import_from_luuma_folder(cx);
                                            this.close_command_dialog(cx);
                                        },
                                    ))
                                    .child(action_row(
                                        workspace.clone(),
                                        theme,
                                        "export-design-cmd",
                                        IconName::Layers,
                                        "Export design…",
                                        None,
                                        false,
                                        selected_index == 3,
                                        |this, cx| {
                                            this.close_command_dialog(cx);
                                            this.prompt_export_design(cx);
                                        },
                                    ))
                                    .child(action_row(
                                        workspace.clone(),
                                        theme,
                                        "toggle-theme-cmd",
                                        IconName::View,
                                        if theme.is_dark() {
                                            "Switch to light theme"
                                        } else {
                                            "Switch to dark theme"
                                        },
                                        None,
                                        false,
                                        selected_index == 4,
                                        |this, cx| {
                                            this.toggle_ui_theme(cx);
                                            this.close_command_dialog(cx);
                                        },
                                    ))
                                    .when(filtered.is_empty(), |this| {
                                        this.child(
                                            div()
                                                .px_3()
                                                .py_4()
                                                .text_size(px(12.))
                                                .text_color(theme.muted)
                                                .child(if query.is_empty() {
                                                    "No designs yet. Create one or import from Luuma."
                                                } else {
                                                    "No designs match your search."
                                                }),
                                        )
                                    })
                                    .children(filtered.into_iter().enumerate().map(|(i, file)| {
                                        let selected = file.id == active_id;
                                        let highlighted = selected_index == i + 5;
                                        file_row(
                                            workspace.clone(),
                                            theme,
                                            file,
                                            selected,
                                            highlighted,
                                            dirty && selected,
                                        )
                                    })),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .h(px(36.))
                                    .px_4()
                                    .border_t_1()
                                    .border_color(theme.hairline_soft())
                                    .child(div().text_size(px(11.)).text_color(theme.muted).child(
                                        if dirty {
                                            "Autosaving current file…"
                                        } else {
                                            "Saved locally"
                                        },
                                    ))
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_3()
                                            .text_size(px(11.))
                                            .text_color(theme.muted)
                                            .child("↑↓ navigate")
                                            .child("↵ open"),
                                    ),
                            ),
                    ),
            )
    }
}

fn action_row(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    id: &'static str,
    icon: IconName,
    label: &'static str,
    shortcut: Option<&'static str>,
    current: bool,
    highlighted: bool,
    on_click: impl Fn(&mut CanvasWorkspace, &mut gpui::Context<CanvasWorkspace>) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_between()
        .h(px(40.))
        .px_3()
        .rounded(px(10.))
        .cursor_pointer()
        .bg(if highlighted {
            theme.highlight_fill()
        } else {
            gpui::transparent_black()
        })
        .hover(|s| s.bg(theme.wash()))
        .on_click(move |_, _, cx| {
            workspace.update(cx, |this, cx| on_click(this, cx));
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap_3()
                .child(
                    Icon::hugeicon(icon)
                        .size(px(15.))
                        .text_color(if highlighted {
                            theme.bright_white
                        } else {
                            theme.muted_strong
                        }),
                )
                .child(
                    div()
                        .text_size(px(13.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if highlighted {
                            theme.bright_white
                        } else {
                            theme.foreground
                        })
                        .child(label),
                )
                .when(current, |this| {
                    this.child(
                        div()
                            .text_size(px(10.))
                            .px_1p5()
                            .py_0p5()
                            .rounded(px(4.))
                            .bg(rgba(0x7aa2f733))
                            .text_color(theme.accent)
                            .child("Current"),
                    )
                }),
        )
        .when_some(shortcut, |this, key| {
            this.child(div().text_size(px(11.)).text_color(theme.muted).child(key))
        })
}

fn file_row(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    file: DesignFileInfo,
    current: bool,
    highlighted: bool,
    dirty: bool,
) -> impl IntoElement {
    let open_id = file.id.clone();
    let status = if current && dirty {
        Some("Current · editing")
    } else if current {
        Some("Current")
    } else {
        None
    };
    div()
        .id(SharedString::from(format!("cmd-file-{}", file.id)))
        .flex()
        .items_center()
        .justify_between()
        .h(px(40.))
        .px_3()
        .rounded(px(10.))
        .cursor_pointer()
        .bg(if highlighted {
            theme.highlight_fill()
        } else {
            gpui::transparent_black()
        })
        .hover(|s| s.bg(theme.wash()))
        .on_click(move |_, _, cx| {
            let open_id = open_id.clone();
            workspace.update(cx, |this, cx| {
                this.open_design(&open_id, cx);
                this.close_command_dialog(cx);
            });
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap_3()
                .min_w_0()
                .flex_1()
                .child(
                    Icon::hugeicon(IconName::BoundingBox)
                        .size(px(15.))
                        .text_color(if highlighted || current {
                            theme.bright_white
                        } else {
                            theme.muted_strong
                        }),
                )
                .child(
                    div()
                        .min_w_0()
                        .flex_1()
                        .text_size(px(13.))
                        .font_weight(if current || highlighted {
                            FontWeight::MEDIUM
                        } else {
                            FontWeight::NORMAL
                        })
                        .text_color(if highlighted || current {
                            theme.bright_white
                        } else {
                            theme.foreground
                        })
                        .child(SharedString::from(file.name)),
                )
                .when_some(status, |this, label| {
                    this.child(
                        div()
                            .text_size(px(10.))
                            .px_1p5()
                            .py_0p5()
                            .rounded(px(4.))
                            .bg(rgba(0x7aa2f733))
                            .text_color(theme.accent)
                            .child(label),
                    )
                }),
        )
}
