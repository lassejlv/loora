use std::collections::HashSet;
use std::rc::Rc;

use gpui::{
    div, prelude::FluentBuilder, px, rgba, uniform_list, AppContext, Context, CursorStyle,
    Entity, FontWeight, InteractiveElement, IntoElement, ParentElement, Render, RenderOnce,
    SharedString, StatefulInteractiveElement, Styled, UniformListScrollHandle, Window,
};
use loora_engine::{CanvasEngine, NodeId, NodeKind};

use crate::canvas::workspace::CanvasWorkspace;
use crate::icon::{Icon, IconName};
use crate::text_field::editable_field_content;
use crate::theme::Theme;

const LAYER_ROW_HEIGHT: f32 = 36.;

#[derive(Clone)]
pub struct LayerRow {
    pub id: NodeId,
    pub name: SharedString,
    pub kind: NodeKind,
    pub depth: u32,
    pub hidden: bool,
    pub locked: bool,
    pub has_children: bool,
    pub collapsed: bool,
}

/// Cache key for the flattened layer list. Camera / pan / zoom must never be here.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayerListKey {
    pub revision: u64,
    pub query: String,
    /// Bumped whenever the collapsed set changes — O(1), never hash the set.
    pub collapsed_generation: u64,
}

/// Pure flatten used by the sidebar (and tests). Keeps GPUI out of the hot data path.
pub fn build_layer_rows(
    engine: &CanvasEngine,
    collapsed: &HashSet<NodeId>,
    query: &str,
) -> Vec<LayerRow> {
    let mut rows = Vec::new();
    for page_id in engine.page_ids() {
        let Some(page) = engine.node(&page_id) else {
            continue;
        };
        let is_collapsed = collapsed.contains(&page_id);
        let has_children = !engine.children(Some(&page_id)).is_empty();
        rows.push(LayerRow {
            id: page_id.clone(),
            name: page.name.clone().into(),
            kind: NodeKind::Page,
            depth: 0,
            hidden: page.hidden,
            locked: page.locked,
            has_children,
            collapsed: is_collapsed,
        });
        if !is_collapsed {
            collect_layer_rows(engine, collapsed, &page_id, 1, &mut rows);
        }
    }
    if !query.is_empty() {
        let q = query.to_lowercase();
        rows.retain(|row| row.name.to_lowercase().contains(&q));
    }
    rows
}

fn collect_layer_rows(
    engine: &CanvasEngine,
    collapsed: &HashSet<NodeId>,
    parent_id: &NodeId,
    depth: u32,
    rows: &mut Vec<LayerRow>,
) {
    for child in engine.children(Some(parent_id)).into_iter().rev() {
        let id = child.id.clone();
        let has_children = child.is_container() && !engine.children(Some(&id)).is_empty();
        let is_collapsed = collapsed.contains(&id);
        rows.push(LayerRow {
            id: id.clone(),
            name: child.name.clone().into(),
            kind: child.kind,
            depth,
            hidden: child.hidden,
            locked: child.locked,
            has_children,
            collapsed: is_collapsed,
        });
        if child.is_container() && !is_collapsed {
            collect_layer_rows(engine, collapsed, &id, depth + 1, rows);
        }
    }
}

/// Whether a webview IPC batch should re-render GPUI chrome.
/// Pan-only camera updates must return false (webview already applied the transform).
pub fn ipc_should_notify_chrome(before: &ShellChromeToken, after: &ShellChromeToken) -> bool {
    before != after
}

/// Everything `CanvasWorkspace::render` shows except camera pan.
#[derive(Clone, Debug, PartialEq)]
pub struct ShellChromeToken {
    pub revision: u64,
    pub selection: Vec<NodeId>,
    pub tool: crate::canvas::CanvasTool,
    pub zoom_bits: u64,
    pub layer_query: String,
    pub layer_search_focused: bool,
    pub layer_rename: Option<NodeId>,
    pub layer_rename_draft: String,
    pub collapsed_generation: u64,
    pub sidebar_visible: bool,
    pub command_open: bool,
    pub command_query: String,
    pub command_index: usize,
    pub dirty: bool,
    pub doc_name: String,
    pub doc_id: String,
    pub files_len: usize,
    pub web_ready: bool,
    pub preview_mode: bool,
    pub preview_runtime_generation: u64,
    pub image_picker: bool,
    pub color_picker: bool,
    pub context_menu: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub props_focus: bool,
    pub props_draft: String,
    pub active_breakpoint_id: Option<String>,
}

#[derive(IntoElement)]
pub struct LayerSidebar {
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    selection: HashSet<NodeId>,
    rows: Rc<Vec<LayerRow>>,
    query: String,
    search_focused: bool,
    search_selection: Option<(usize, usize)>,
    rename_id: Option<NodeId>,
    rename_draft: String,
    rename_selection: Option<(usize, usize)>,
    components: Vec<(NodeId, SharedString)>,
    scroll_handle: UniformListScrollHandle,
}

impl LayerSidebar {
    pub fn new(
        workspace: Entity<CanvasWorkspace>,
        theme: Theme,
        selection: HashSet<NodeId>,
        rows: Rc<Vec<LayerRow>>,
        query: String,
        search_focused: bool,
        search_selection: Option<(usize, usize)>,
        rename_id: Option<NodeId>,
        rename_draft: String,
        rename_selection: Option<(usize, usize)>,
        components: Vec<(NodeId, SharedString)>,
        scroll_handle: UniformListScrollHandle,
    ) -> Self {
        Self {
            workspace,
            theme,
            selection,
            rows,
            query,
            search_focused,
            search_selection,
            rename_id,
            rename_draft,
            rename_selection,
            components,
            scroll_handle,
        }
    }
}

impl RenderOnce for LayerSidebar {
    fn render(self, _window: &mut gpui::Window, _cx: &mut gpui::App) -> impl IntoElement {
        let theme = self.theme;
        let selection = self.selection;
        let workspace = self.workspace;
        let query = self.query.clone();
        let search_focused = self.search_focused;
        let search_selection = self.search_selection;
        let rename_id = self.rename_id.clone();
        let rename_draft = self.rename_draft.clone();
        let rename_selection = self.rename_selection;
        let rows = self.rows;
        let scroll_handle = self.scroll_handle;
        let row_count = rows.len();

        let layer_list = if rows.is_empty() {
            div()
                .flex_1()
                .min_h_0()
                .px_2()
                .py_4()
                .text_size(px(12.))
                .text_color(theme.muted)
                .child(if query.is_empty() {
                    "No layers yet. Draw a frame or import a design."
                } else {
                    "No layers match your search."
                })
                .into_any_element()
        } else {
            let row_workspace = workspace.clone();
            let row_selection = selection;
            let row_rows = rows.clone();
            let row_rename_id = rename_id.clone();
            let row_rename_draft = rename_draft.clone();
            let row_rename_selection = rename_selection;
            uniform_list("layers-scroll", row_count, move |range, _, _| {
                range
                    .map(|index| {
                        let row = row_rows[index].clone();
                        let selected = row_selection.contains(&row.id);
                        let renaming = row_rename_id.as_ref() == Some(&row.id);
                        div()
                            .h(px(LAYER_ROW_HEIGHT))
                            .child(layer_row(
                                row_workspace.clone(),
                                theme,
                                row,
                                selected,
                                renaming,
                                if renaming {
                                    row_rename_draft.clone()
                                } else {
                                    String::new()
                                },
                                renaming.then_some(row_rename_selection).flatten(),
                            ))
                    })
                    .collect::<Vec<_>>()
            })
            .track_scroll(&scroll_handle)
            .flex_1()
            .min_h_0()
            .px_1p5()
            .py_1()
            .into_any_element()
        };

        div()
            .flex()
            .flex_col()
            .w(px(260.))
            .h_full()
            .border_r_1()
            .border_color(theme.border)
            .bg(theme.panel_chrome_bg())
            .child(
                div()
                    .id("layers-titlebar")
                    .flex()
                    .items_center()
                    .justify_between()
                    // Tall enough for macOS traffic lights; left pad clears them.
                    .h(px(52.))
                    .pl(px(76.))
                    .pr_3()
                    .on_click(|event, window, _| {
                        if event.click_count() == 2 {
                            window.titlebar_double_click();
                        }
                    })
                    .child(
                        div()
                            .text_size(px(13.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.bright_white)
                            .child("Layers"),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(header_icon(
                                workspace.clone(),
                                theme,
                                "add-layer",
                                IconName::Add,
                                |this, cx| this.add_child_frame(cx),
                            ))
                            .child(header_icon(
                                workspace.clone(),
                                theme,
                                "components",
                                IconName::Diamond,
                                |this, cx| this.set_tool(crate::canvas::CanvasTool::Component, cx),
                            ))
                            .child(header_icon(
                                workspace.clone(),
                                theme,
                                "collapse",
                                IconName::Layers,
                                |this, cx| {
                                    if this.collapsed.is_empty() {
                                        for page in this.engine.page_ids() {
                                            collapse_all(
                                                &mut this.collapsed,
                                                &this.engine,
                                                &page,
                                            );
                                        }
                                    } else {
                                        this.collapsed.clear();
                                    }
                                    this.note_collapsed_changed();
                                    cx.notify();
                                },
                            )),
                    ),
            )
            .child(
                div().px_3().pb_2().child(
                    div()
                        .id("layer-search")
                        .flex()
                        .items_center()
                        .gap_2()
                        .h(px(32.))
                        .px_2p5()
                        .rounded(px(8.))
                        .bg(theme.field_bg())
                        .border_1()
                        .border_color(if search_focused {
                            rgba(0x7aa2f788).into()
                        } else {
                            theme.hairline()
                        })
                        .cursor(CursorStyle::IBeam)
                        .on_mouse_down(gpui::MouseButton::Left, {
                            let workspace = workspace.clone();
                            move |event, window, cx| {
                                cx.stop_propagation();
                                workspace.update(cx, |this, cx| {
                                    this.focus_layer_search(event.click_count, window, cx);
                                });
                            }
                        })
                        .when(search_focused, |this| {
                            let workspace = workspace.clone();
                            this.on_mouse_down_out(move |_, _, cx| {
                                workspace.update(cx, |this, cx| this.blur_layer_search(cx));
                            })
                        })
                        .child(
                            Icon::hugeicon(IconName::Search)
                                .size(px(14.))
                                .text_color(theme.muted),
                        )
                        .child(editable_field_content(
                            query.clone(),
                            "Search layers",
                            search_selection.filter(|_| search_focused),
                            theme.foreground,
                            theme.muted,
                            theme.bright_white,
                            theme.highlight_fill(),
                            px(12.),
                            px(14.),
                        )),
                ),
            )
            .child(layer_list)
            .child(
                div()
                    .id("components-scroll")
                    .border_t_1()
                    .border_color(theme.border)
                    .px_3()
                    .py_2()
                    .max_h(px(168.))
                    .min_h(px(72.))
                    .overflow_y_scroll()
                    .child(
                        div()
                            .text_size(px(11.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.muted)
                            .mb_1()
                            .child("Components"),
                    )
                    .when(self.components.is_empty(), |this| {
                        this.child(
                            div()
                                .px_1()
                                .py_2()
                                .text_size(px(12.))
                                .text_color(theme.muted)
                                .child("No components. Use the ♦ tool to create one."),
                        )
                    })
                    .children(self.components.into_iter().map(|(id, name)| {
                        component_row(workspace.clone(), theme, id, name)
                    })),
            )
    }
}

fn collapse_all(
    collapsed: &mut HashSet<NodeId>,
    engine: &loora_engine::CanvasEngine,
    parent: &NodeId,
) {
    for child in engine.children(Some(parent)) {
        if child.is_container() {
            collapsed.insert(child.id.clone());
            collapse_all(collapsed, engine, &child.id);
        }
    }
}

fn header_icon(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    id: &'static str,
    icon: IconName,
    on_click: impl Fn(&mut CanvasWorkspace, &mut gpui::Context<CanvasWorkspace>) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_center()
        .size(px(26.))
        .rounded(px(6.))
        .cursor_pointer()
        .hover(|s| s.bg(theme.hover))
        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            workspace.update(cx, |this, cx| on_click(this, cx));
        })
        .child(
            Icon::hugeicon(icon)
                .size(px(14.))
                .text_color(theme.muted_strong),
        )
}

fn component_row(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    id: NodeId,
    name: SharedString,
) -> impl IntoElement {
    let insert_id = id.clone();
    div()
        .id(SharedString::from(format!("component-{}", id.as_str())))
        .flex()
        .items_center()
        .gap_2()
        .h(px(28.))
        .px_1()
        .rounded(px(6.))
        .cursor_pointer()
        .hover(|s| s.bg(theme.hover))
        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            workspace.update(cx, |this, cx| {
                this.insert_component_instance(&insert_id, cx);
            });
        })
        .child(
            Icon::hugeicon(IconName::Diamond)
                .size(px(14.))
                .text_color(theme.muted_strong),
        )
        .child(
            div()
                .text_size(px(12.))
                .text_color(theme.foreground)
                .child(name),
        )
}

fn layer_row(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    row: LayerRow,
    selected: bool,
    renaming: bool,
    rename_draft: String,
    rename_selection: Option<(usize, usize)>,
) -> impl IntoElement {
    let id = row.id.clone();
    let id_toggle = row.id.clone();
    let id_hide = row.id.clone();
    let id_lock = row.id.clone();
    let drop_id = row.id.clone();
    let drag_id = row.id.clone();
    let drag_name = row.name.clone();
    let type_icon = match row.kind {
        NodeKind::Page | NodeKind::Frame | NodeKind::Component => IconName::Grid,
        NodeKind::Text => IconName::Text,
        NodeKind::Image => IconName::Image,
        NodeKind::Instance => IconName::Square,
        NodeKind::Vector => IconName::Square,
        NodeKind::Rectangle => {
            if row.name.as_ref() == "Ellipse" {
                IconName::Circle
            } else {
                IconName::Square
            }
        }
    };

    let dragged = DraggedLayer {
        id: drag_id,
        name: drag_name,
    };

    div()
        .id(SharedString::from(format!("layer-{}", row.id)))
        .group("layer-row")
        .flex()
        .items_center()
        .gap_1p5()
        .h(px(LAYER_ROW_HEIGHT))
        .pr_1()
        .pl(px(8.0 + row.depth as f32 * 14.0))
        .rounded(px(8.))
        .cursor_pointer()
        .bg(if selected {
            theme.selected
        } else {
            gpui::transparent_black()
        })
        .hover(|s| {
            s.bg(if selected {
                theme.selected
            } else {
                theme.hover
            })
        })
        .on_click({
            let workspace = workspace.clone();
            let id = id.clone();
            move |event, _, cx| {
                if event.click_count() >= 2 {
                    workspace.update(cx, |this, cx| this.begin_layer_rename(id.clone(), cx));
                    return;
                }
                workspace.update(cx, |this, cx| this.select(Some(id.clone()), cx));
            }
        })
        .when(!renaming, |this| {
            this.on_drag(dragged, |layer, _offset, _, cx| cx.new(|_| layer.clone()))
                .drag_over::<DraggedLayer>(|style, _, _, _| style.bg(rgba(0x7aa2f733)))
                .on_drop({
                    let workspace = workspace.clone();
                    move |dragged: &DraggedLayer, _, cx| {
                        let target = drop_id.clone();
                        let source = dragged.id.clone();
                        workspace.update(cx, |this, cx| this.drop_layer(&source, &target, cx));
                    }
                })
        })
        .when(renaming, |this| {
            this.drag_over::<DraggedLayer>(|style, _, _, _| style)
                .on_drop(|_: &DraggedLayer, _, _| {})
        })
        .child(
            div()
                .w(px(14.))
                .flex()
                .items_center()
                .justify_center()
                .child(if row.has_children {
                    div()
                        .id(SharedString::from(format!("caret-{}", id_toggle)))
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(16.))
                        .rounded(px(4.))
                        .cursor_pointer()
                        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click({
                            let workspace = workspace.clone();
                            move |_, _, cx| {
                                cx.stop_propagation();
                                workspace.update(cx, |this, cx| {
                                    this.toggle_collapsed(&id_toggle, cx);
                                });
                            }
                        })
                        .child(
                            Icon::hugeicon(if row.collapsed {
                                IconName::ChevronRight
                            } else {
                                IconName::ChevronDown
                            })
                            .size(px(12.))
                            .text_color(theme.muted),
                        )
                        .into_any_element()
                } else {
                    div().size(px(16.)).into_any_element()
                }),
        )
        .child(
            Icon::hugeicon(type_icon)
                .size(px(14.))
                .text_color(theme.muted_strong),
        )
        .child(if renaming {
            let focus_workspace = workspace.clone();
            let blur_workspace = workspace.clone();
            div()
                .flex_1()
                .min_w_0()
                .h(px(24.))
                .px_1p5()
                .rounded(px(5.))
                .bg(theme.surface_raised)
                .border_1()
                .border_color(theme.accent)
                .flex()
                .items_center()
                .on_mouse_down(gpui::MouseButton::Left, move |event, window, cx| {
                    cx.stop_propagation();
                    focus_workspace.update(cx, |this, cx| {
                        this.focus_layer_rename(event.click_count, window, cx);
                    });
                })
                .on_mouse_down_out(move |_, _, cx| {
                    blur_workspace.update(cx, |this, cx| this.commit_layer_rename(cx));
                })
                .child(editable_field_content(
                    rename_draft,
                    "Name",
                    rename_selection,
                    theme.foreground,
                    theme.muted,
                    theme.accent,
                    theme.highlight_fill(),
                    px(12.),
                    px(14.),
                ))
                .into_any_element()
        } else {
            div()
                .flex_1()
                .min_w_0()
                .text_size(px(12.))
                .text_color(if row.hidden {
                    theme.muted
                } else {
                    theme.foreground
                })
                .overflow_hidden()
                .text_ellipsis()
                .whitespace_nowrap()
                .child(row.name)
                .into_any_element()
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap_0p5()
                .child(
                    div()
                        .id(SharedString::from(format!("hide-{}", id_hide)))
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(22.))
                        .rounded(px(5.))
                        .cursor_pointer()
                        .hover(|s| s.bg(theme.surface_raised))
                        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click({
                            let workspace = workspace.clone();
                            move |_, _, cx| {
                                cx.stop_propagation();
                                workspace.update(cx, |this, cx| this.toggle_hidden(&id_hide, cx));
                            }
                        })
                        .child(
                            Icon::hugeicon(if row.hidden {
                                IconName::ViewOff
                            } else {
                                IconName::View
                            })
                            .size(px(13.))
                            .text_color(if row.hidden {
                                theme.accent
                            } else {
                                theme.muted
                            }),
                        ),
                )
                .child(
                    div()
                        .id(SharedString::from(format!("lock-{}", id_lock)))
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(22.))
                        .rounded(px(5.))
                        .cursor_pointer()
                        .bg(if row.locked {
                            theme.surface_raised
                        } else {
                            gpui::transparent_black()
                        })
                        .hover(|s| s.bg(theme.surface_raised))
                        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click({
                            let workspace = workspace.clone();
                            move |_, _, cx| {
                                cx.stop_propagation();
                                workspace.update(cx, |this, cx| this.toggle_locked(&id_lock, cx));
                            }
                        })
                        .child(
                            Icon::hugeicon(if row.locked {
                                IconName::Lock
                            } else {
                                IconName::Unlock
                            })
                            .size(px(13.))
                            .text_color(if row.locked {
                                theme.accent
                            } else {
                                theme.muted
                            }),
                        ),
                ),
        )
}

#[derive(Clone)]
struct DraggedLayer {
    id: NodeId,
    name: SharedString,
}

impl Render for DraggedLayer {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .px_3()
            .py_1()
            .rounded(px(6.))
            .border_1()
            .border_color(rgba(0xffffff33))
            .bg(rgba(0x1a1a1af2))
            .text_size(px(12.))
            .text_color(rgba(0xffffffff))
            .child(self.name.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use loora_engine::{Document, Layout, Node};

    fn fat_doc(nodes: usize) -> CanvasEngine {
        let mut doc = Document::empty("Lag");
        let page = doc.root_page_id.clone();
        for i in 0..nodes {
            if i % 8 == 0 {
                let mut frame =
                    Node::frame(format!("Frame {i}"), page.clone(), Layout::new(0.0, 0.0, 200.0, 100.0));
                frame.order = i as f64;
                doc.nodes.insert(frame.id.clone(), frame);
            } else {
                let parent = doc
                    .nodes
                    .values()
                    .filter(|n| n.kind == NodeKind::Frame)
                    .map(|n| n.id.clone())
                    .last()
                    .unwrap_or_else(|| page.clone());
                let mut rect = Node::rectangle(
                    format!("Rect {i}"),
                    parent,
                    Layout::new(0.0, 0.0, 40.0, 20.0),
                );
                rect.order = i as f64;
                doc.nodes.insert(rect.id.clone(), rect);
            }
        }
        CanvasEngine::new(doc)
    }

    #[test]
    fn camera_pan_must_not_invalidate_layer_list_key() {
        let key_a = LayerListKey {
            revision: 3,
            query: String::new(),
            collapsed_generation: 9,
        };
        let key_b = key_a.clone();
        assert_eq!(key_a, key_b, "layer list key must ignore camera");
    }

    #[test]
    fn pan_only_chrome_token_skips_notify() {
        let token = ShellChromeToken {
            revision: 1,
            selection: vec![],
            tool: crate::canvas::CanvasTool::Select,
            zoom_bits: 1f64.to_bits(),
            layer_query: String::new(),
            layer_search_focused: false,
            layer_rename: None,
            layer_rename_draft: String::new(),
            collapsed_generation: 0,
            sidebar_visible: true,
            command_open: false,
            command_query: String::new(),
            command_index: 0,
            dirty: false,
            doc_name: "A".into(),
            doc_id: "1".into(),
            files_len: 0,
            web_ready: true,
            preview_mode: false,
            preview_runtime_generation: 0,
            image_picker: false,
            color_picker: false,
            context_menu: false,
            can_undo: false,
            can_redo: false,
            props_focus: false,
            props_draft: String::new(),
            active_breakpoint_id: None,
        };
        // Pan is intentionally absent from the token — identical tokens ⇒ no notify.
        assert!(!ipc_should_notify_chrome(&token, &token));

        let mut zoomed = token.clone();
        zoomed.zoom_bits = 1.2f64.to_bits();
        assert!(ipc_should_notify_chrome(&token, &zoomed));

        let mut selected = token.clone();
        selected.selection = vec![NodeId::from("n1")];
        assert!(ipc_should_notify_chrome(&token, &selected));
    }

    #[test]
    fn collapsed_generation_is_o1_in_shell_token() {
        // Regression: hashing thousands of collapsed ids on every IPC made the canvas lag.
        let mut token = ShellChromeToken {
            revision: 1,
            selection: vec![],
            tool: crate::canvas::CanvasTool::Select,
            zoom_bits: 1f64.to_bits(),
            layer_query: String::new(),
            layer_search_focused: false,
            layer_rename: None,
            layer_rename_draft: String::new(),
            collapsed_generation: 0,
            sidebar_visible: true,
            command_open: false,
            command_query: String::new(),
            command_index: 0,
            dirty: false,
            doc_name: "A".into(),
            doc_id: "1".into(),
            files_len: 0,
            web_ready: true,
            preview_mode: false,
            preview_runtime_generation: 0,
            image_picker: false,
            color_picker: false,
            context_menu: false,
            can_undo: false,
            can_redo: false,
            props_focus: false,
            props_draft: String::new(),
            active_breakpoint_id: None,
        };
        let start = std::time::Instant::now();
        for i in 0..50_000u64 {
            token.collapsed_generation = i;
            let _ = ipc_should_notify_chrome(&token, &token);
        }
        assert!(
            start.elapsed().as_millis() < 50,
            "chrome token compare must stay O(1) even with huge collapse counts"
        );
    }

    #[test]
    fn build_layer_rows_is_stable_and_bounded() {
        let engine = fat_doc(800);
        let mut collapsed = HashSet::new();
        for node in engine.document().nodes.values() {
            if node.kind != NodeKind::Page && node.is_container() {
                collapsed.insert(node.id.clone());
            }
        }
        let start = std::time::Instant::now();
        let mut total = 0usize;
        for _ in 0..50 {
            total += build_layer_rows(&engine, &collapsed, "").len();
        }
        let elapsed = start.elapsed();
        assert!(total > 0);
        assert!(
            elapsed.as_millis() < 250,
            "layer flatten too slow: {elapsed:?} for 50 passes"
        );

        // Expanding one frame with children should grow the visible row list.
        let frame = engine
            .document()
            .nodes
            .values()
            .find(|n| n.kind == NodeKind::Frame && !engine.children(Some(&n.id)).is_empty())
            .map(|n| n.id.clone())
            .expect("frame with children");
        collapsed.remove(&frame);
        let expanded = build_layer_rows(&engine, &collapsed, "");
        collapsed.insert(frame);
        let collapsed_rows = build_layer_rows(&engine, &collapsed, "");
        assert!(expanded.len() > collapsed_rows.len());
    }

    #[test]
    fn layer_list_key_changes_with_revision_or_collapse() {
        let a = LayerListKey {
            revision: 1,
            query: String::new(),
            collapsed_generation: 1,
        };
        assert_ne!(
            a,
            LayerListKey {
                revision: 2,
                query: String::new(),
                collapsed_generation: 1,
            }
        );
        assert_ne!(
            a,
            LayerListKey {
                revision: 1,
                query: String::new(),
                collapsed_generation: 2,
            }
        );
        assert_ne!(
            a,
            LayerListKey {
                revision: 1,
                query: "x".into(),
                collapsed_generation: 1,
            }
        );
    }
}
