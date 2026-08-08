use gpui::{
    div, prelude::FluentBuilder, px, rgba, CursorStyle, Entity, FontWeight, InteractiveElement,
    IntoElement, ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled,
};

use crate::canvas::workspace::CanvasWorkspace;
use crate::icon::{Icon, IconName};
use crate::motion::{Ease, Motion, MotionStyle, Transition};
use crate::text_field::editable_field_content;
use crate::theme::Theme;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImagePickerMode {
    Choose,
    Url,
}

#[derive(IntoElement)]
pub struct ImagePickerDialog {
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    mode: ImagePickerMode,
    url: String,
    selection: Option<(usize, usize)>,
    library: Vec<PathBuf>,
}

impl ImagePickerDialog {
    pub fn new(
        workspace: Entity<CanvasWorkspace>,
        theme: Theme,
        mode: ImagePickerMode,
        url: String,
        selection: Option<(usize, usize)>,
        library: Vec<PathBuf>,
    ) -> Self {
        Self {
            workspace,
            theme,
            mode,
            url,
            selection,
            library,
        }
    }
}

impl RenderOnce for ImagePickerDialog {
    fn render(self, _window: &mut gpui::Window, _cx: &mut gpui::App) -> impl IntoElement {
        let theme = self.theme;
        let workspace = self.workspace;
        let mode = self.mode;
        let url = self.url;
        let selection = self.selection;
        let library = self.library;

        div()
            .absolute()
            .inset_0()
            .occlude()
            .flex()
            .items_start()
            .justify_center()
            .pt(px(140.))
            .bg(theme.overlay_scrim())
            .on_mouse_down(gpui::MouseButton::Left, {
                let workspace = workspace.clone();
                move |_, _, cx| {
                    workspace.update(cx, |this, cx| this.close_image_picker(cx));
                }
            })
            .child(
                Motion::new()
                    .id("image-picker-dialog")
                    .initial(MotionStyle::new().opacity(0.).y(px(16.)))
                    .animate(MotionStyle::new().opacity(1.).y(px(0.)))
                    .transition(Transition::tween(Duration::from_millis(240)).ease(Ease::EaseOut))
                    .child(
                        div()
                            .w(px(420.))
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
                                    .justify_between()
                                    .h(px(52.))
                                    .px_4()
                                    .border_b_1()
                                    .border_color(theme.hairline_soft())
                                    .child(
                                        div()
                                            .text_size(px(15.))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.bright_white)
                                            .child(match mode {
                                                ImagePickerMode::Choose => "Add image",
                                                ImagePickerMode::Url => "Image URL",
                                            }),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.))
                                            .text_color(theme.muted)
                                            .child("esc"),
                                    ),
                            )
                            .when(mode == ImagePickerMode::Choose, |this| {
                                this.child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .p_2()
                                        .gap_1()
                                        .child(source_row(
                                            workspace.clone(),
                                            theme,
                                            "img-from-folder",
                                            IconName::Folder,
                                            "Choose from folder",
                                            "Browse local files",
                                            |this, cx| this.pick_image_from_folder(cx),
                                        ))
                                        .child(source_row(
                                            workspace.clone(),
                                            theme,
                                            "img-from-url",
                                            IconName::Search,
                                            "From URL",
                                            "Paste a link to an image",
                                            |this, cx| this.begin_image_url_input(cx),
                                        ))
                                        .when(!library.is_empty(), |this| {
                                            this.child(
                                                div()
                                                    .mt_2()
                                                    .px_2()
                                                    .text_size(px(11.))
                                                    .text_color(theme.muted)
                                                    .child("Library"),
                                            )
                                            .children(library.into_iter().take(12).enumerate().map(
                                                |(index, path)| {
                                                    let label = path
                                                        .file_name()
                                                        .and_then(|n| n.to_str())
                                                        .unwrap_or("asset")
                                                        .to_string();
                                                    let path_for_click = path;
                                                    library_row(
                                                        workspace.clone(),
                                                        theme,
                                                        SharedString::from(format!(
                                                            "img-lib-{index}"
                                                        )),
                                                        SharedString::from(label),
                                                        path_for_click,
                                                    )
                                                },
                                            ))
                                        }),
                                )
                                .child(
                                    div().px_4().pb_3().child(
                                        div()
                                            .text_size(px(11.))
                                            .text_color(theme.muted)
                                            .child("Drop images onto the canvas, or double-click to replace"),
                                    ),
                                )
                            })
                            .when(mode == ImagePickerMode::Url, |this| {
                                this.child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .p_3()
                                        .gap_3()
                                        .child(
                                            div()
                                                .id("image-url-input")
                                                .flex()
                                                .items_center()
                                                .gap_2()
                                                .h(px(40.))
                                                .px_3()
                                                .rounded(px(10.))
                                                .bg(theme.field_bg())
                                                .border_1()
                                                .border_color(rgba(0x7aa2f788))
                                                .cursor(CursorStyle::IBeam)
                                                .on_mouse_down(gpui::MouseButton::Left, {
                                                    let workspace = workspace.clone();
                                                    move |event, window, cx| {
                                                        cx.stop_propagation();
                                                        workspace.update(cx, |this, cx| {
                                                            this.focus_image_url_input(
                                                                event.click_count,
                                                                window,
                                                                cx,
                                                            );
                                                        });
                                                    }
                                                })
                                                .when(selection.is_some(), |this| {
                                                    let workspace = workspace.clone();
                                                    this.on_mouse_down_out(move |_, _, cx| {
                                                        workspace.update(cx, |this, cx| {
                                                            this.blur_image_url_input(cx)
                                                        });
                                                    })
                                                })
                                                .child(editable_field_content(
                                                    url,
                                                    "https://…",
                                                    selection,
                                                    theme.bright_white,
                                                    theme.muted,
                                                    theme.bright_white,
                                                    theme.highlight_fill(),
                                                    px(14.),
                                                    px(16.),
                                                )),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .justify_between()
                                                .child(
                                                    div()
                                                        .id("img-url-back")
                                                        .px_3()
                                                        .h(px(32.))
                                                        .flex()
                                                        .items_center()
                                                        .rounded(px(8.))
                                                        .cursor_pointer()
                                                        .hover(|s| s.bg(theme.wash()))
                                                        .on_click({
                                                            let workspace = workspace.clone();
                                                            move |_, _, cx| {
                                                                workspace.update(cx, |this, cx| {
                                                                    this.image_picker_back(cx);
                                                                });
                                                            }
                                                        })
                                                        .child(
                                                            div()
                                                                .text_size(px(12.))
                                                                .text_color(theme.muted_strong)
                                                                .child("Back"),
                                                        ),
                                                )
                                                .child(
                                                    div()
                                                        .id("img-url-apply")
                                                        .px_3()
                                                        .h(px(32.))
                                                        .flex()
                                                        .items_center()
                                                        .rounded(px(8.))
                                                        .bg(rgba(0x7aa2f7ee))
                                                        .cursor_pointer()
                                                        .hover(|s| s.bg(rgba(0x8bb0ffff)))
                                                        .on_click({
                                                            let workspace = workspace.clone();
                                                            move |_, _, cx| {
                                                                workspace.update(cx, |this, cx| {
                                                                    this.apply_image_url(cx);
                                                                });
                                                            }
                                                        })
                                                        .child(
                                                            div()
                                                                .text_size(px(12.))
                                                                .font_weight(FontWeight::MEDIUM)
                                                                .text_color(rgba(0x0f0f10ff))
                                                                .child("Add image"),
                                                        ),
                                                ),
                                        ),
                                )
                            }),
                    ),
            )
    }
}

fn source_row(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    id: &'static str,
    icon: IconName,
    title: &'static str,
    subtitle: &'static str,
    on_click: impl Fn(&mut CanvasWorkspace, &mut gpui::Context<CanvasWorkspace>) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .gap_3()
        .h(px(56.))
        .px_3()
        .rounded(px(12.))
        .cursor_pointer()
        .hover(|s| s.bg(theme.wash()))
        .on_click(move |_, _, cx| {
            workspace.update(cx, |this, cx| on_click(this, cx));
        })
        .child(
            div()
                .flex()
                .items_center()
                .justify_center()
                .size(px(36.))
                .rounded(px(10.))
                .bg(theme.wash())
                .child(
                    Icon::hugeicon(icon)
                        .size(px(16.))
                        .text_color(theme.bright_white),
                ),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_0p5()
                .min_w_0()
                .flex_1()
                .child(
                    div()
                        .text_size(px(13.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.bright_white)
                        .child(title),
                )
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(theme.muted)
                        .child(SharedString::from(subtitle)),
                ),
        )
}

fn library_row(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    id: SharedString,
    title: SharedString,
    path: PathBuf,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .gap_3()
        .h(px(48.))
        .px_3()
        .rounded(px(12.))
        .cursor_pointer()
        .hover(|s| s.bg(theme.wash()))
        .on_click(move |_, _, cx| {
            let path = path.clone();
            workspace.update(cx, |this, cx| this.apply_library_asset(path, cx));
        })
        .child(
            div()
                .flex()
                .items_center()
                .justify_center()
                .size(px(32.))
                .rounded(px(10.))
                .bg(theme.wash())
                .child(
                    Icon::hugeicon(IconName::Image)
                        .size(px(15.))
                        .text_color(theme.bright_white),
                ),
        )
        .child(
            div()
                .min_w_0()
                .flex_1()
                .text_size(px(12.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme.bright_white)
                .overflow_hidden()
                .text_ellipsis()
                .whitespace_nowrap()
                .child(title),
        )
}
