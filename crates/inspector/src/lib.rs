//! Chrome DevTools-inspired inspector for Loora's native GPUI element tree.
//!
//! GPUI owns the runtime instrumentation and hit-testing. This crate supplies
//! the developer action, shortcut, docked UI, element tree, style declarations,
//! and box-model layout view.

use std::{cell::Cell, rc::Rc};

use gpui::prelude::FluentBuilder as _;
use gpui::{
    actions, div, point, px, rgba, AnyElement, App, ClipboardItem, Context, CursorStyle, Div,
    DivInspectorState, Global, Hsla, Inspector, InspectorElementId, InteractiveElement as _,
    IntoElement, KeyBinding, MouseButton, MouseDownEvent, MouseMoveEvent, ParentElement as _,
    ScrollHandle, SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use loora_ui::Theme;
use serde_json::Value;

actions!(developer_inspector, [ToggleInspector]);

// DevTools syntax colors intentionally remain stable across Loora themes.
const SYNTAX_TAG: u32 = 0x5dade2ff;
const SYNTAX_ATTRIBUTE: u32 = 0x9cdcfeff;
const SYNTAX_VALUE: u32 = 0xce9178ff;
const SYNTAX_PROPERTY: u32 = 0x9cdcfeff;
const DEFAULT_DOCK_WIDTH: f32 = 480.;
const MIN_DOCK_WIDTH: f32 = 300.;
const MAX_DOCK_WIDTH: f32 = 760.;
const MIN_APP_WIDTH: f32 = 320.;
const GPUI_INSPECTOR_REMS: f32 = 30.;
const DEFAULT_DETAILS_HEIGHT: f32 = 180.;
const MIN_DETAILS_HEIGHT: f32 = 72.;
const MIN_TREE_HEIGHT: f32 = 96.;
const TOOLBAR_HEIGHT: f32 = 38.;
const STATUS_BAR_HEIGHT: f32 = 22.;

#[derive(Clone, Copy)]
struct ActiveInspectorTheme(Theme);

impl Global for ActiveInspectorTheme {}

type VisibilityListener = Rc<dyn Fn(bool, &mut App)>;

#[derive(Default)]
struct InspectorVisibility {
    open: bool,
    listeners: Vec<VisibilityListener>,
}

impl Global for InspectorVisibility {}

struct InspectorUiState {
    active_tab: Cell<InspectorTab>,
    tree_scroll_handle: ScrollHandle,
    details_scroll_handle: ScrollHandle,
    collapsed_tree_depth: Cell<Option<usize>>,
    styles_collapsed: Cell<bool>,
    box_model_collapsed: Cell<bool>,
    geometry_collapsed: Cell<bool>,
    details_height: Cell<f32>,
    details_collapsed: Cell<bool>,
    details_resizing: Cell<bool>,
    dock_width: Cell<f32>,
    base_rem_size: Cell<Option<f32>>,
    resizing: Cell<bool>,
}

impl Default for InspectorUiState {
    fn default() -> Self {
        Self {
            active_tab: Cell::new(InspectorTab::Elements),
            tree_scroll_handle: ScrollHandle::new(),
            details_scroll_handle: ScrollHandle::new(),
            collapsed_tree_depth: Cell::new(None),
            styles_collapsed: Cell::new(false),
            box_model_collapsed: Cell::new(false),
            geometry_collapsed: Cell::new(false),
            details_height: Cell::new(DEFAULT_DETAILS_HEIGHT),
            details_collapsed: Cell::new(false),
            details_resizing: Cell::new(false),
            dock_width: Cell::new(DEFAULT_DOCK_WIDTH),
            base_rem_size: Cell::new(None),
            resizing: Cell::new(false),
        }
    }
}

struct InspectorUiGlobal(Rc<InspectorUiState>);

impl Global for InspectorUiGlobal {}

#[derive(Clone, Copy)]
struct InspectorPalette {
    panel: Hsla,
    raised: Hsla,
    field: Hsla,
    border: Hsla,
    text: Hsla,
    muted: Hsla,
    accent: Hsla,
    picking: Hsla,
    selection: Hsla,
    hover: Hsla,
    transparent: Hsla,
    margin: Hsla,
    border_model: Hsla,
    padding: Hsla,
    content: Hsla,
}

impl From<Theme> for InspectorPalette {
    fn from(theme: Theme) -> Self {
        Self {
            // Loora's normal chrome is translucent over the window blur. DevTools
            // sits on top of the app itself, so those same colors need an opaque
            // base or the inspected UI bleeds through the panel.
            panel: theme.panel_bg().alpha(1.),
            raised: theme.surface_raised.alpha(1.),
            field: theme.field_bg().alpha(1.),
            border: theme.hairline(),
            text: theme.foreground,
            muted: theme.muted,
            accent: theme.accent,
            picking: theme.bright_green,
            selection: theme.selected,
            hover: theme.hover,
            transparent: gpui::transparent_black(),
            margin: theme.bright_yellow,
            border_model: theme.yellow,
            padding: theme.bright_green,
            content: theme.bright_blue,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum InspectorTab {
    #[default]
    Elements,
    Styles,
    Layout,
}

/// Install the inspector action, platform shortcut, and GPUI renderer.
///
/// The inspector is available in release builds too because the workspace
/// explicitly enables GPUI's `inspector` feature.
pub fn init(cx: &mut App) {
    if !cx.has_global::<ActiveInspectorTheme>() {
        cx.set_global(ActiveInspectorTheme(Theme::dark()));
    }
    if !cx.has_global::<InspectorVisibility>() {
        cx.set_global(InspectorVisibility::default());
    }
    let ui_state = Rc::new(InspectorUiState::default());
    cx.set_global(InspectorUiGlobal(ui_state.clone()));
    cx.bind_keys([
        KeyBinding::new("cmd-alt-i", ToggleInspector, None),
        KeyBinding::new("ctrl-shift-i", ToggleInspector, None),
    ]);

    let action_state = ui_state.clone();
    cx.on_action(move |_: &ToggleInspector, cx| {
        let Some(active_window) = cx.active_window() else {
            return;
        };
        let ui_state = action_state.clone();

        // Actions can fire while the active window is already leased.
        cx.defer(move |cx| {
            let _ = active_window.update(cx, |_, window, cx| {
                toggle(window, ui_state, cx);
            });
        });
    });

    let div_state = ui_state.clone();
    cx.register_inspector_element(move |id, state: &DivInspectorState, window, cx| {
        render_div_inspector(id, state, div_state.clone(), window, cx)
    });

    cx.set_inspector_renderer(Box::new(move |inspector, window, cx| {
        render_inspector(inspector, ui_state.clone(), window, cx)
    }));
}

/// Keep inspector chrome synchronized with Loora's active UI theme.
pub fn set_theme(theme: Theme, cx: &mut App) {
    if cx.has_global::<ActiveInspectorTheme>() {
        cx.global_mut::<ActiveInspectorTheme>().0 = theme;
    } else {
        cx.set_global(ActiveInspectorTheme(theme));
    }
}

/// Whether the developer inspector is currently docked in the app window.
pub fn is_open(cx: &App) -> bool {
    cx.try_global::<InspectorVisibility>()
        .is_some_and(|visibility| visibility.open)
}

/// Observe dock visibility changes. The listener is immediately called with
/// the current state so native surfaces can synchronize before the next frame.
pub fn on_visibility_change(cx: &mut App, listener: impl Fn(bool, &mut App) + 'static) {
    let open = is_open(cx);
    let listener: VisibilityListener = Rc::new(listener);
    cx.global_mut::<InspectorVisibility>()
        .listeners
        .push(listener.clone());
    listener(open, cx);
}

fn set_open(open: bool, cx: &mut App) {
    let listeners = {
        let visibility = cx.global_mut::<InspectorVisibility>();
        if visibility.open == open {
            return;
        }
        visibility.open = open;
        visibility.listeners.clone()
    };
    for listener in listeners {
        listener(open, cx);
    }
    cx.refresh_windows();
}

fn toggle(window: &mut Window, ui_state: Rc<InspectorUiState>, cx: &mut App) {
    let open = !is_open(cx);
    if open {
        ui_state
            .base_rem_size
            .set(Some(f32::from(window.rem_size())));
        apply_dock_width(ui_state.as_ref(), ui_state.dock_width.get(), window);
    } else if let Some(base_rem_size) = ui_state.base_rem_size.take() {
        ui_state.resizing.set(false);
        ui_state.details_resizing.set(false);
        window.set_rem_size(px(base_rem_size));
    }
    window.toggle_inspector(cx);
    set_open(open, cx);
}

fn inspector_ui(cx: &App) -> Rc<InspectorUiState> {
    cx.global::<InspectorUiGlobal>().0.clone()
}

fn clamped_dock_width(viewport_width: f32, width: f32) -> f32 {
    let maximum = MAX_DOCK_WIDTH.min((viewport_width - MIN_APP_WIDTH).max(MIN_DOCK_WIDTH));
    width.clamp(MIN_DOCK_WIDTH, maximum)
}

fn apply_dock_width(ui_state: &InspectorUiState, width: f32, window: &mut Window) {
    let width = clamped_dock_width(f32::from(window.viewport_size().width), width);
    ui_state.dock_width.set(width);
    window.set_rem_size(px(width / GPUI_INSPECTOR_REMS));
    window.refresh();
}

fn palette(cx: &App) -> InspectorPalette {
    cx.try_global::<ActiveInspectorTheme>()
        .map(|theme| theme.0)
        .unwrap_or_default()
        .into()
}

/// Open the inspector during app startup when `LOORA_INSPECTOR=1` is set.
/// This is useful for repeatable developer runs and visual regression checks.
pub fn open_on_startup(window: &mut Window, cx: &mut App) {
    let enabled = std::env::var("LOORA_INSPECTOR")
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "yes"));
    if enabled && !is_open(cx) {
        toggle(window, inspector_ui(cx), cx);
    }
}

fn render_inspector(
    inspector: &mut Inspector,
    ui_state: Rc<InspectorUiState>,
    window: &mut Window,
    cx: &mut Context<Inspector>,
) -> AnyElement {
    let palette = palette(cx);
    let selected = inspector.active_element_id().cloned();
    let is_picking = inspector.is_picking();
    let tab = ui_state.active_tab.get();
    let inspector_states = inspector.render_inspector_states(window, cx);

    div()
        .id("developer-inspector")
        .relative()
        .size_full()
        .flex()
        .flex_col()
        .bg(palette.panel)
        .text_color(palette.text)
        .border_l_1()
        .border_color(palette.border)
        .child(render_toolbar(
            is_picking,
            tab,
            ui_state.clone(),
            palette,
            cx,
        ))
        .child(render_inspector_body(
            selected.as_ref(),
            tab,
            inspector_states,
            ui_state.clone(),
            palette,
        ))
        .child(render_status_bar(
            is_picking,
            ui_state.dock_width.get(),
            palette,
        ))
        .child(render_resize_handle(ui_state.clone(), palette))
        .when(ui_state.resizing.get(), |this| {
            this.child(render_resize_overlay(ui_state.clone(), palette))
        })
        .when(ui_state.details_resizing.get(), |this| {
            this.child(render_details_resize_overlay(ui_state, palette))
        })
        .into_any_element()
}

fn render_inspector_body(
    selected: Option<&InspectorElementId>,
    tab: InspectorTab,
    inspector_states: Vec<AnyElement>,
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> Div {
    match tab {
        InspectorTab::Elements => div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .child(
                        div()
                            .id("developer-inspector-tree-scroll")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .track_scroll(&ui_state.tree_scroll_handle)
                            .when_some(selected, {
                                let ui_state = ui_state.clone();
                                move |this, selected| {
                                    this.child(render_element_tree(selected, ui_state, palette))
                                }
                            })
                            .when(selected.is_none(), |this| {
                                this.child(render_empty_state(palette))
                            }),
                    )
                    .child(render_scrollbar(
                        ui_state.tree_scroll_handle.clone(),
                        palette,
                    )),
            )
            .when(selected.is_some(), |this| {
                this.child(render_details_pane(inspector_states, ui_state, palette))
            }),
        InspectorTab::Styles | InspectorTab::Layout => div()
            .relative()
            .flex_1()
            .min_h_0()
            .flex()
            .child(
                div()
                    .id("developer-inspector-details-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&ui_state.details_scroll_handle)
                    .flex()
                    .flex_col()
                    .when_some(selected, move |this, selected| {
                        this.child(render_selected_bar(selected, palette))
                    })
                    .when(selected.is_none(), |this| {
                        this.child(render_empty_state(palette))
                    })
                    .children(inspector_states),
            )
            .child(render_scrollbar(
                ui_state.details_scroll_handle.clone(),
                palette,
            )),
    }
}

fn render_details_pane(
    inspector_states: Vec<AnyElement>,
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> Div {
    let collapsed = ui_state.details_collapsed.get();
    let height = ui_state.details_height.get();

    div()
        .relative()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .when(!collapsed, |this| this.h(px(height)))
        .child(render_details_splitter(ui_state.clone(), palette))
        .child(render_details_header(ui_state.clone(), collapsed, palette))
        .when(!collapsed, |this| {
            this.child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .child(
                        div()
                            .id("developer-inspector-element-details-scroll")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .track_scroll(&ui_state.details_scroll_handle)
                            .flex()
                            .flex_col()
                            .children(inspector_states),
                    )
                    .child(render_scrollbar(
                        ui_state.details_scroll_handle.clone(),
                        palette,
                    )),
            )
        })
}

fn render_toolbar(
    is_picking: bool,
    active: InspectorTab,
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
    cx: &mut Context<Inspector>,
) -> Div {
    div()
        .h(px(38.))
        .flex_shrink_0()
        .flex()
        .items_center()
        .border_b_1()
        .border_color(palette.border)
        .bg(palette.raised)
        .child(
            div()
                .id("inspector-pick")
                .w(px(38.))
                .h_full()
                .flex()
                .items_center()
                .justify_center()
                .border_r_1()
                .border_color(palette.border)
                .text_size(px(17.))
                .text_color(if is_picking {
                    palette.accent
                } else {
                    palette.muted
                })
                .cursor_pointer()
                .hover(move |style| style.bg(palette.hover).text_color(palette.accent))
                .on_click(cx.listener(|inspector, _, window, _| {
                    inspector.start_picking();
                    window.refresh();
                }))
                .child("⌖"),
        )
        .child(render_tab(
            "inspector-elements-tab",
            "Elements",
            InspectorTab::Elements,
            active,
            ui_state.clone(),
            palette,
        ))
        .child(render_tab(
            "inspector-styles-tab",
            "Styles",
            InspectorTab::Styles,
            active,
            ui_state.clone(),
            palette,
        ))
        .child(render_tab(
            "inspector-layout-tab",
            "Layout",
            InspectorTab::Layout,
            active,
            ui_state.clone(),
            palette,
        ))
        .child(div().flex_1())
        .child(
            div()
                .id("inspector-close")
                .w(px(34.))
                .h_full()
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(15.))
                .text_color(palette.muted)
                .cursor_pointer()
                .hover(move |style| style.bg(palette.hover).text_color(palette.text))
                .on_click(move |_, window, cx| toggle(window, ui_state.clone(), cx))
                .child("×"),
        )
}

fn render_tab(
    id: &'static str,
    label: &'static str,
    tab: InspectorTab,
    active: InspectorTab,
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    let selected = tab == active;
    div()
        .id(id)
        .relative()
        .h_full()
        .px(px(10.))
        .flex()
        .items_center()
        .text_size(px(11.))
        .text_color(if selected {
            palette.text
        } else {
            palette.muted
        })
        .cursor_pointer()
        .hover(move |style| style.bg(palette.hover).text_color(palette.text))
        .when(selected, |this| {
            this.child(
                div()
                    .absolute()
                    .left(px(6.))
                    .right(px(6.))
                    .bottom_0()
                    .h(px(2.))
                    .bg(palette.accent),
            )
        })
        .on_click(move |_, window, _| {
            ui_state.active_tab.set(tab);
            ui_state
                .tree_scroll_handle
                .set_offset(point(px(0.), px(0.)));
            ui_state
                .details_scroll_handle
                .set_offset(point(px(0.), px(0.)));
            window.refresh();
        })
        .child(label)
}

fn render_status_bar(is_picking: bool, dock_width: f32, palette: InspectorPalette) -> Div {
    div()
        .h(px(22.))
        .flex_shrink_0()
        .px(px(7.))
        .flex()
        .items_center()
        .justify_between()
        .border_t_1()
        .border_color(palette.border)
        .bg(palette.raised)
        .text_size(px(9.))
        .text_color(palette.muted)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(5.))
                .child(div().size(px(6.)).rounded_full().bg(if is_picking {
                    palette.picking
                } else {
                    palette.accent
                }))
                .child(if is_picking {
                    "Pick mode · click an element to unlock panel scrolling"
                } else {
                    "Selection locked"
                }),
        )
        .child(format!("{}px  ·  ⌥⌘I", dock_width.round()))
}

fn render_resize_handle(
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    div()
        .id("inspector-resize-handle")
        .absolute()
        .left_0()
        .top_0()
        .bottom_0()
        .w(px(6.))
        .cursor(CursorStyle::ResizeLeftRight)
        .hover(move |style| style.bg(palette.accent.opacity(0.45)))
        .on_mouse_down(
            MouseButton::Left,
            move |event: &MouseDownEvent, window, cx| {
                cx.stop_propagation();
                ui_state.resizing.set(true);
                resize_from_pointer(ui_state.as_ref(), f32::from(event.position.x), window);
            },
        )
}

fn render_resize_overlay(
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    let move_state = ui_state.clone();
    div()
        .id("inspector-resize-overlay")
        .absolute()
        .inset_0()
        .cursor(CursorStyle::ResizeLeftRight)
        .border_l_1()
        .border_color(palette.accent)
        .on_mouse_move(move |event: &MouseMoveEvent, window, cx| {
            cx.stop_propagation();
            resize_from_pointer(move_state.as_ref(), f32::from(event.position.x), window);
        })
        .capture_any_mouse_up(move |_, window, cx| {
            cx.stop_propagation();
            ui_state.resizing.set(false);
            window.refresh();
        })
}

fn render_details_splitter(
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    div()
        .id("inspector-details-resize-handle")
        .h(px(6.))
        .flex_shrink_0()
        .border_t_1()
        .border_color(palette.border)
        .cursor(CursorStyle::ResizeUpDown)
        .hover(move |style| style.bg(palette.accent.opacity(0.45)))
        .on_mouse_down(
            MouseButton::Left,
            move |event: &MouseDownEvent, window, cx| {
                cx.stop_propagation();
                ui_state.details_collapsed.set(false);
                ui_state.details_resizing.set(true);
                resize_details_from_pointer(ui_state.as_ref(), f32::from(event.position.y), window);
            },
        )
}

fn render_details_header(
    ui_state: Rc<InspectorUiState>,
    collapsed: bool,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    div()
        .id("inspector-details-header")
        .h(px(28.))
        .flex_shrink_0()
        .px(px(9.))
        .flex()
        .items_center()
        .justify_between()
        .bg(palette.raised)
        .text_size(px(10.))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |style| style.bg(palette.hover))
        .on_click(move |_, window, cx| {
            cx.stop_propagation();
            ui_state.details_collapsed.set(!collapsed);
            window.refresh();
        })
        .child("Element details")
        .child(
            div()
                .text_color(palette.muted)
                .child(if collapsed { "▴" } else { "▾" }),
        )
}

fn render_details_resize_overlay(
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    let move_state = ui_state.clone();
    div()
        .id("inspector-details-resize-overlay")
        .absolute()
        .inset_0()
        .cursor(CursorStyle::ResizeUpDown)
        .border_t_1()
        .border_color(palette.accent)
        .on_mouse_move(move |event: &MouseMoveEvent, window, cx| {
            cx.stop_propagation();
            resize_details_from_pointer(move_state.as_ref(), f32::from(event.position.y), window);
        })
        .capture_any_mouse_up(move |_, window, cx| {
            cx.stop_propagation();
            ui_state.details_resizing.set(false);
            window.refresh();
        })
}

fn resize_from_pointer(ui_state: &InspectorUiState, pointer_x: f32, window: &mut Window) {
    let width = f32::from(window.viewport_size().width) - pointer_x;
    apply_dock_width(ui_state, width, window);
}

fn clamped_details_height(viewport_height: f32, height: f32) -> f32 {
    let maximum = (viewport_height - TOOLBAR_HEIGHT - STATUS_BAR_HEIGHT - MIN_TREE_HEIGHT)
        .max(MIN_DETAILS_HEIGHT);
    height.clamp(MIN_DETAILS_HEIGHT, maximum)
}

fn resize_details_from_pointer(ui_state: &InspectorUiState, pointer_y: f32, window: &mut Window) {
    let viewport_height = f32::from(window.viewport_size().height);
    let body_bottom = viewport_height - STATUS_BAR_HEIGHT;
    ui_state.details_height.set(clamped_details_height(
        viewport_height,
        body_bottom - pointer_y,
    ));
    window.refresh();
}

fn render_scrollbar(scroll_handle: ScrollHandle, palette: InspectorPalette) -> gpui::Stateful<Div> {
    let viewport_height = f32::from(scroll_handle.bounds().size.height);
    let maximum = f32::from(scroll_handle.max_offset().y);
    let visible = maximum > 0. && viewport_height > 0.;
    let thumb_height = if visible {
        (viewport_height * viewport_height / (viewport_height + maximum))
            .clamp(28., viewport_height)
    } else {
        0.
    };
    let progress = if maximum > 0. {
        (-f32::from(scroll_handle.offset().y) / maximum).clamp(0., 1.)
    } else {
        0.
    };
    let thumb_top = (viewport_height - thumb_height).max(0.) * progress;
    let move_handle = scroll_handle.clone();

    div()
        .id("developer-inspector-scrollbar")
        .absolute()
        .top_0()
        .right_0()
        .bottom_0()
        .w(px(10.))
        .when(visible, move |this| {
            this.cursor_pointer()
                .on_mouse_down(MouseButton::Left, {
                    let scroll_handle = scroll_handle.clone();
                    move |event: &MouseDownEvent, window, cx| {
                        cx.stop_propagation();
                        scroll_from_pointer(&scroll_handle, f32::from(event.position.y), window);
                    }
                })
                .on_mouse_move(move |event: &MouseMoveEvent, window, cx| {
                    if event.pressed_button == Some(MouseButton::Left) {
                        cx.stop_propagation();
                        scroll_from_pointer(&move_handle, f32::from(event.position.y), window);
                    }
                })
                .child(
                    div()
                        .absolute()
                        .top(px(thumb_top))
                        .right(px(2.))
                        .w(px(5.))
                        .h(px(thumb_height))
                        .rounded(px(3.))
                        .bg(palette.muted.opacity(0.55)),
                )
        })
}

fn scroll_from_pointer(scroll_handle: &ScrollHandle, pointer_y: f32, window: &mut Window) {
    let bounds = scroll_handle.bounds();
    let viewport_height = f32::from(bounds.size.height);
    let maximum = f32::from(scroll_handle.max_offset().y);
    if viewport_height <= 0. || maximum <= 0. {
        return;
    }
    let thumb_height = (viewport_height * viewport_height / (viewport_height + maximum))
        .clamp(28., viewport_height);
    let track = (viewport_height - thumb_height).max(1.);
    let thumb_top = (pointer_y - f32::from(bounds.origin.y) - thumb_height / 2.).clamp(0., track);
    let current = scroll_handle.offset();
    scroll_handle.set_offset(point(current.x, px(-(thumb_top / track) * maximum)));
    window.refresh();
}

fn render_empty_state(palette: InspectorPalette) -> Div {
    div()
        .m(px(14.))
        .p(px(16.))
        .flex()
        .flex_col()
        .gap(px(7.))
        .border_1()
        .border_color(palette.border)
        .bg(palette.field)
        .child(
            div()
                .text_size(px(12.))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .child("Select a GPUI element"),
        )
        .child(
            div()
                .text_size(px(10.))
                .line_height(px(16.))
                .text_color(palette.muted)
                .child("Move over the app to highlight elements, then click to inspect one."),
        )
}

fn render_element_tree(
    id: &InspectorElementId,
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> Div {
    let source = source_location(id);
    let source_for_copy = source.clone();
    let global_id = id.path.global_id.to_string();
    let segments = global_id
        .split('.')
        .filter(|segment| !segment.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let segment_count = segments.len();
    let collapsed_depth = ui_state.collapsed_tree_depth.get();
    let visible_count = collapsed_depth
        .map(|depth| (depth + 1).min(segment_count))
        .unwrap_or(segment_count);

    div()
        .flex()
        .flex_col()
        .child(
            div()
                .py(px(5.))
                .children(segments.into_iter().take(visible_count).enumerate().map(
                    |(index, segment)| {
                        render_tree_row(
                            &segment,
                            index,
                            index + 1 < segment_count,
                            collapsed_depth != Some(index),
                            index + 1 == visible_count,
                            ui_state.clone(),
                            palette,
                        )
                    },
                ))
                .when(segment_count == 0, |this| {
                    this.child(render_tree_row(
                        "anonymous",
                        0,
                        false,
                        false,
                        true,
                        ui_state,
                        palette,
                    ))
                }),
        )
        .child(
            div()
                .px(px(10.))
                .py(px(8.))
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .border_t_1()
                .border_color(palette.border)
                .bg(palette.field)
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_size(px(9.))
                        .text_color(palette.muted)
                        .child(source),
                )
                .child(copy_button(
                    "copy-element-source",
                    "Copy",
                    source_for_copy,
                    palette,
                )),
        )
}

fn render_tree_row(
    segment: &str,
    depth: usize,
    has_children: bool,
    expanded: bool,
    selected: bool,
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    div()
        .id(SharedString::from(format!("inspector-tree-row-{depth}")))
        .h(px(22.))
        .pl(px(7. + depth as f32 * 12.))
        .pr(px(7.))
        .flex()
        .items_center()
        .bg(if selected {
            palette.selection
        } else {
            palette.transparent
        })
        .text_size(px(10.))
        .when(has_children, |this| {
            this.cursor_pointer()
                .hover(move |style| style.bg(palette.hover))
                .on_click(move |_, window, cx| {
                    cx.stop_propagation();
                    ui_state
                        .collapsed_tree_depth
                        .set(if expanded { Some(depth) } else { None });
                    window.refresh();
                })
        })
        .child(
            div()
                .w(px(12.))
                .flex_shrink_0()
                .text_color(if selected {
                    palette.text
                } else {
                    palette.muted
                })
                .child(if !has_children {
                    ""
                } else if expanded {
                    "▾"
                } else {
                    "▸"
                }),
        )
        .child(div().text_color(rgba(SYNTAX_TAG)).child("<div"))
        .child(div().text_color(rgba(SYNTAX_ATTRIBUTE)).child(" id"))
        .child(div().text_color(palette.text).child("="))
        .child(
            div()
                .text_color(rgba(SYNTAX_VALUE))
                .child(format!("\"{segment}\"")),
        )
        .child(div().text_color(rgba(SYNTAX_TAG)).child(">"))
}

fn render_selected_bar(id: &InspectorElementId, palette: InspectorPalette) -> Div {
    let global_id = id.path.global_id.to_string();
    let selected = global_id
        .rsplit('.')
        .find(|part| !part.is_empty())
        .unwrap_or("anonymous");
    let source = source_location(id);

    div()
        .h(px(32.))
        .px(px(9.))
        .flex()
        .items_center()
        .justify_between()
        .gap(px(8.))
        .border_b_1()
        .border_color(palette.border)
        .bg(palette.field)
        .text_size(px(10.))
        .child(
            div()
                .min_w_0()
                .flex()
                .items_center()
                .child(div().text_color(rgba(SYNTAX_TAG)).child("div"))
                .child(div().text_color(palette.muted).child("#"))
                .child(
                    div()
                        .text_color(rgba(SYNTAX_ATTRIBUTE))
                        .child(selected.to_owned()),
                ),
        )
        .child(
            div()
                .text_size(px(9.))
                .text_color(palette.muted)
                .child(short_source(&source)),
        )
}

fn render_div_inspector(
    id: InspectorElementId,
    state: &DivInspectorState,
    ui_state: Rc<InspectorUiState>,
    _window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let palette = palette(cx);
    match ui_state.active_tab.get() {
        InspectorTab::Elements => render_element_details(id, state, palette),
        InspectorTab::Styles => render_styles(id, state, ui_state, palette),
        InspectorTab::Layout => render_layout(state, ui_state, palette),
    }
}

fn render_element_details(
    id: InspectorElementId,
    state: &DivInspectorState,
    palette: InspectorPalette,
) -> Div {
    let bounds = &state.bounds;
    div()
        .px(px(10.))
        .py(px(8.))
        .flex()
        .items_center()
        .justify_between()
        .gap(px(8.))
        .border_t_1()
        .border_color(palette.border)
        .text_size(px(9.))
        .text_color(palette.muted)
        .child(format!(
            "{} × {}  at  {}, {}",
            bounds.size.width, bounds.size.height, bounds.origin.x, bounds.origin.y
        ))
        .child(format!("instance {}", id.instance_id))
}

fn render_styles(
    id: InspectorElementId,
    state: &DivInspectorState,
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> Div {
    let style_json = serde_json::to_string_pretty(state.base_style.as_ref())
        .unwrap_or_else(|error| format!("Unable to serialize style: {error}"));
    let style_for_copy = style_json.clone();
    let style_value = serde_json::to_value(state.base_style.as_ref()).unwrap_or(Value::Null);
    let mut declarations = Vec::new();
    flatten_style_value("", &style_value, &mut declarations);
    let collapsed = ui_state.styles_collapsed.get();

    div()
        .flex()
        .flex_col()
        .child(render_section_header(
            "styles-section",
            "element.style",
            !collapsed,
            ui_state.clone(),
            InspectorSection::Styles,
            palette,
        ))
        .when(!collapsed, |this| {
            this.child(
                div()
                    .px(px(9.))
                    .py(px(7.))
                    .flex()
                    .flex_col()
                    .when(declarations.is_empty(), |this| {
                        this.child(
                            div()
                                .py(px(8.))
                                .text_size(px(10.))
                                .text_color(palette.muted)
                                .child("No explicit base styles"),
                        )
                    })
                    .children(declarations.into_iter().map(|(property, value)| {
                        render_style_declaration(property, value, palette)
                    })),
            )
        })
        .child(
            div()
                .px(px(9.))
                .py(px(6.))
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .border_t_1()
                .border_color(palette.border)
                .text_size(px(9.))
                .text_color(palette.muted)
                .child(source_location(&id))
                .child(copy_button(
                    "copy-style-json",
                    "Copy JSON",
                    style_for_copy,
                    palette,
                )),
        )
}

fn render_style_declaration(property: String, value: String, palette: InspectorPalette) -> Div {
    div()
        .min_h(px(19.))
        .flex()
        .items_start()
        .text_size(px(10.))
        .line_height(px(16.))
        .child(
            div()
                .mt(px(3.))
                .mr(px(7.))
                .size(px(9.))
                .flex_shrink_0()
                .rounded(px(1.))
                .border_1()
                .border_color(palette.border)
                .bg(palette.raised),
        )
        .child(div().text_color(rgba(SYNTAX_PROPERTY)).child(property))
        .child(div().text_color(palette.muted).child(": "))
        .child(div().text_color(rgba(SYNTAX_VALUE)).child(value))
        .child(div().text_color(palette.muted).child(";"))
}

#[derive(Clone, Copy)]
enum InspectorSection {
    Styles,
    BoxModel,
    Geometry,
}

fn render_section_header(
    id: &'static str,
    label: &'static str,
    expanded: bool,
    ui_state: Rc<InspectorUiState>,
    section: InspectorSection,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    div()
        .id(id)
        .h(px(30.))
        .px(px(9.))
        .flex()
        .items_center()
        .gap(px(6.))
        .border_b_1()
        .border_color(palette.border)
        .bg(palette.raised)
        .text_size(px(10.))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |style| style.bg(palette.hover))
        .on_click(move |_, window, cx| {
            cx.stop_propagation();
            match section {
                InspectorSection::Styles => ui_state.styles_collapsed.set(expanded),
                InspectorSection::BoxModel => ui_state.box_model_collapsed.set(expanded),
                InspectorSection::Geometry => ui_state.geometry_collapsed.set(expanded),
            }
            window.refresh();
        })
        .child(
            div()
                .w(px(10.))
                .text_color(palette.muted)
                .child(if expanded { "▾" } else { "▸" }),
        )
        .child(label)
}

fn render_layout(
    state: &DivInspectorState,
    ui_state: Rc<InspectorUiState>,
    palette: InspectorPalette,
) -> Div {
    let box_model_collapsed = ui_state.box_model_collapsed.get();
    let geometry_collapsed = ui_state.geometry_collapsed.get();

    div()
        .flex()
        .flex_col()
        .child(render_section_header(
            "box-model-section",
            "Box model",
            !box_model_collapsed,
            ui_state.clone(),
            InspectorSection::BoxModel,
            palette,
        ))
        .when(!box_model_collapsed, |this| {
            this.child(render_box_model(state, palette))
        })
        .child(render_section_header(
            "geometry-section",
            "Geometry",
            !geometry_collapsed,
            ui_state,
            InspectorSection::Geometry,
            palette,
        ))
        .when(!geometry_collapsed, |this| {
            this.child(render_geometry(state, palette))
        })
}

fn render_box_model(state: &DivInspectorState, palette: InspectorPalette) -> Div {
    let bounds = &state.bounds;
    div().p(px(12.)).child(
        div()
            .p(px(10.))
            .bg(palette.margin.opacity(0.28))
            .border_1()
            .border_color(palette.margin)
            .text_size(px(9.))
            .text_color(palette.text)
            .child("margin")
            .child(
                div()
                    .mt(px(5.))
                    .p(px(9.))
                    .bg(palette.border_model.opacity(0.28))
                    .border_1()
                    .border_color(palette.border_model)
                    .text_color(palette.text)
                    .child("border")
                    .child(
                        div()
                            .mt(px(5.))
                            .p(px(9.))
                            .bg(palette.padding.opacity(0.28))
                            .border_1()
                            .border_color(palette.padding)
                            .text_color(palette.text)
                            .child("padding")
                            .child(
                                div()
                                    .mt(px(5.))
                                    .h(px(52.))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .bg(palette.content.opacity(0.28))
                                    .border_1()
                                    .border_color(palette.content)
                                    .text_color(palette.text)
                                    .text_size(px(10.))
                                    .child(format!(
                                        "{} × {}",
                                        bounds.size.width, bounds.size.height
                                    )),
                            ),
                    ),
            ),
    )
}

fn render_geometry(state: &DivInspectorState, palette: InspectorPalette) -> Div {
    let bounds = &state.bounds;
    div().px(px(12.)).pb(px(12.)).children([div()
        .border_t_1()
        .border_color(palette.border)
        .children([
            computed_row("position x", bounds.origin.x.to_string(), palette),
            computed_row("position y", bounds.origin.y.to_string(), palette),
            computed_row("width", bounds.size.width.to_string(), palette),
            computed_row("height", bounds.size.height.to_string(), palette),
            computed_row(
                "content width",
                state.content_size.width.to_string(),
                palette,
            ),
            computed_row(
                "content height",
                state.content_size.height.to_string(),
                palette,
            ),
        ])])
}

fn computed_row(name: &'static str, value: String, palette: InspectorPalette) -> Div {
    div()
        .h(px(25.))
        .px(px(4.))
        .flex()
        .items_center()
        .justify_between()
        .border_b_1()
        .border_color(palette.border)
        .text_size(px(10.))
        .child(div().text_color(palette.muted).child(name))
        .child(div().text_color(palette.text).child(value))
}

fn copy_button(
    id: &'static str,
    label: &'static str,
    value: String,
    palette: InspectorPalette,
) -> gpui::Stateful<Div> {
    div()
        .id(id)
        .h(px(21.))
        .px(px(6.))
        .flex()
        .items_center()
        .rounded(px(3.))
        .border_1()
        .border_color(palette.border)
        .bg(palette.raised)
        .text_size(px(9.))
        .text_color(palette.muted)
        .cursor_pointer()
        .hover(move |style| style.bg(palette.hover).text_color(palette.text))
        .on_click(move |_, _, cx| {
            cx.write_to_clipboard(ClipboardItem::new_string(value.clone()));
        })
        .child(label)
}

fn flatten_style_value(prefix: &str, value: &Value, output: &mut Vec<(String, String)>) {
    match value {
        Value::Null => {}
        Value::Object(object) => {
            for (name, value) in object {
                let name = name.replace('_', "-");
                let path = if prefix.is_empty() {
                    name
                } else {
                    format!("{prefix}.{name}")
                };
                flatten_style_value(&path, value, output);
            }
        }
        Value::Array(array) if array.is_empty() => {}
        Value::Array(_) => output.push((prefix.to_owned(), compact_json(value))),
        Value::String(value) => output.push((prefix.to_owned(), value.clone())),
        Value::Bool(value) => output.push((prefix.to_owned(), value.to_string())),
        Value::Number(value) => output.push((prefix.to_owned(), value.to_string())),
    }
}

fn compact_json(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "?".to_owned())
}

fn source_location(id: &InspectorElementId) -> String {
    let location = id.path.source_location;
    format!(
        "{}:{}:{}",
        location.file(),
        location.line(),
        location.column()
    )
}

fn short_source(source: &str) -> String {
    source
        .rsplit_once('/')
        .map(|(_, tail)| tail.to_owned())
        .unwrap_or_else(|| source.to_owned())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use gpui::{div, Entity, IntoElement, Modifiers, Render, TestAppContext, VisualTestContext};

    use super::*;

    struct InspectorTestView;

    impl Render for InspectorTestView {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().id("inspectable-test-element").size_full()
        }
    }

    struct DetailsPaneTestView {
        ui_state: Rc<InspectorUiState>,
    }

    impl Render for DetailsPaneTestView {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let palette = InspectorPalette::from(Theme::dark());
            div()
                .relative()
                .size_full()
                .child(render_details_pane(
                    vec![div().child("details").into_any_element()],
                    self.ui_state.clone(),
                    palette,
                ))
                .when(self.ui_state.details_resizing.get(), |this| {
                    this.child(render_details_resize_overlay(
                        self.ui_state.clone(),
                        palette,
                    ))
                })
        }
    }

    struct DockResizeTestView {
        ui_state: Rc<InspectorUiState>,
    }

    impl Render for DockResizeTestView {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let palette = InspectorPalette::from(Theme::dark());
            div()
                .relative()
                .size_full()
                .child(render_resize_handle(self.ui_state.clone(), palette))
                .when(self.ui_state.resizing.get(), |this| {
                    this.child(render_resize_overlay(self.ui_state.clone(), palette))
                })
        }
    }

    #[gpui::test]
    fn toggle_action_opens_and_closes_pick_mode(cx: &mut TestAppContext) {
        cx.update(init);
        let (_, cx): (Entity<InspectorTestView>, &mut VisualTestContext) =
            cx.add_window_view(|_, _| InspectorTestView);
        cx.update(|window, _| window.activate_window());
        cx.run_until_parked();
        cx.update(|window, cx| {
            inspector_ui(cx).dock_width.set(360.);
            assert_eq!(f32::from(window.rem_size()), 16.);
        });

        cx.dispatch_action(ToggleInspector);
        assert!(cx.update(|window, cx| window.is_inspector_picking(cx)));
        assert_eq!(cx.update(|window, _| f32::from(window.rem_size())), 12.);

        cx.dispatch_action(ToggleInspector);
        assert!(!cx.update(|window, cx| window.is_inspector_picking(cx)));
        assert_eq!(cx.update(|window, _| f32::from(window.rem_size())), 16.);
    }

    #[gpui::test]
    fn keyboard_shortcut_opens_pick_mode(cx: &mut TestAppContext) {
        cx.update(init);
        let (_, cx): (Entity<InspectorTestView>, &mut VisualTestContext) =
            cx.add_window_view(|_, _| InspectorTestView);
        cx.update(|window, _| window.activate_window());
        cx.run_until_parked();

        cx.simulate_keystrokes("ctrl-shift-i");

        assert!(cx.update(|window, cx| window.is_inspector_picking(cx)));
    }

    #[gpui::test]
    fn visibility_listener_tracks_the_docked_session(cx: &mut TestAppContext) {
        cx.update(init);
        let changes = Rc::new(RefCell::new(Vec::new()));
        let listener_changes = changes.clone();
        cx.update(|cx| {
            on_visibility_change(cx, move |open, _| {
                listener_changes.borrow_mut().push(open);
            });
        });
        let (_, cx): (Entity<InspectorTestView>, &mut VisualTestContext) =
            cx.add_window_view(|_, _| InspectorTestView);
        cx.update(|window, _| window.activate_window());

        cx.dispatch_action(ToggleInspector);
        cx.dispatch_action(ToggleInspector);

        assert_eq!(*changes.borrow(), vec![false, true, false]);
    }

    #[gpui::test]
    fn details_pane_collapses_and_resizes(cx: &mut TestAppContext) {
        let ui_state = Rc::new(InspectorUiState::default());
        let view_state = ui_state.clone();
        let (_, cx): (Entity<DetailsPaneTestView>, &mut VisualTestContext) =
            cx.add_window_view(move |_, _| DetailsPaneTestView {
                ui_state: view_state,
            });
        cx.run_until_parked();

        cx.simulate_click(point(px(80.), px(20.)), Modifiers::default());
        assert!(ui_state.details_collapsed.get());
        cx.simulate_click(point(px(80.), px(20.)), Modifiers::default());
        assert!(!ui_state.details_collapsed.get());

        let initial_height = ui_state.details_height.get();
        cx.simulate_mouse_down(
            point(px(80.), px(3.)),
            MouseButton::Left,
            Modifiers::default(),
        );
        assert!(ui_state.details_resizing.get());
        cx.simulate_mouse_move(
            point(px(80.), px(320.)),
            MouseButton::Left,
            Modifiers::default(),
        );
        cx.simulate_mouse_up(
            point(px(80.), px(320.)),
            MouseButton::Left,
            Modifiers::default(),
        );

        assert!(!ui_state.details_resizing.get());
        assert_ne!(ui_state.details_height.get(), initial_height);
    }

    #[gpui::test]
    fn dock_divider_resizes_the_inspector(cx: &mut TestAppContext) {
        let ui_state = Rc::new(InspectorUiState::default());
        let view_state = ui_state.clone();
        let (_, cx): (Entity<DockResizeTestView>, &mut VisualTestContext) =
            cx.add_window_view(move |_, _| DockResizeTestView {
                ui_state: view_state,
            });
        cx.run_until_parked();
        let viewport_width = cx.update(|window, _| f32::from(window.viewport_size().width));

        cx.simulate_mouse_down(
            point(px(2.), px(100.)),
            MouseButton::Left,
            Modifiers::default(),
        );
        assert!(ui_state.resizing.get());
        cx.simulate_mouse_move(
            point(px(viewport_width - 360.), px(100.)),
            MouseButton::Left,
            Modifiers::default(),
        );
        cx.simulate_mouse_up(
            point(px(viewport_width - 360.), px(100.)),
            MouseButton::Left,
            Modifiers::default(),
        );

        assert!(!ui_state.resizing.get());
        assert_eq!(ui_state.dock_width.get(), 360.);
    }

    #[test]
    fn style_values_flatten_into_devtools_declarations() {
        let value = serde_json::json!({
            "display": "flex",
            "padding": {"top": "8px", "bottom": null},
            "shadows": []
        });
        let mut declarations = Vec::new();

        flatten_style_value("", &value, &mut declarations);

        assert_eq!(
            declarations,
            vec![
                ("display".to_owned(), "flex".to_owned()),
                ("padding.top".to_owned(), "8px".to_owned()),
            ]
        );
    }

    #[test]
    fn dock_width_preserves_a_usable_app_viewport() {
        assert_eq!(clamped_dock_width(1100., 900.), 760.);
        assert_eq!(clamped_dock_width(800., 700.), 480.);
        assert_eq!(clamped_dock_width(1100., 120.), 300.);
    }

    #[test]
    fn details_height_preserves_a_usable_tree_viewport() {
        assert_eq!(clamped_details_height(720., 900.), 564.);
        assert_eq!(clamped_details_height(480., 350.), 324.);
        assert_eq!(clamped_details_height(720., 10.), 72.);
    }
}
