use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

use gpui::{
    actions, div, prelude::FluentBuilder, px, AppContext, Bounds, ClipboardEntry, ClipboardItem,
    Context, Entity, FocusHandle, ImageFormat, InteractiveElement, IntoElement, KeyBinding,
    KeyDownEvent, ParentElement, PathPromptOptions, Pixels, Point, Render, SharedString,
    StatefulInteractiveElement, Styled, Task, UniformListScrollHandle, Window,
};
use loora_engine::{
    compile_canvas, export_page_svg, standalone_html, Bounds as EngineBounds, Camera, CanvasAction,
    CanvasEngine, Color, Corners, DesignFileInfo, DesignStore, FlexDirection, HtmlCanvasOptions,
    ImportReport, Interaction, InteractionTrigger, Layout, LayoutAlign, LayoutJustify, LayoutMode,
    LayoutPosition, Node, NodeId, NodeKind, Overflow, Paint, Shadow, SizeMode, StateCondition,
    StateValue, Stroke, StrokeStyle, TextAlign, Transition, Vec2, VisualState,
};

use crate::canvas::files::FilesCommandDialog;
use crate::canvas::image_picker::{ImagePickerDialog, ImagePickerMode};
use crate::canvas::layers::{
    build_layer_rows, ipc_should_notify_chrome, LayerListKey, LayerRow, LayerSidebar,
    ShellChromeToken,
};
use crate::canvas::properties::{
    format_hex, format_number, parse_hex, PropertiesPanel, PropsField, PropsView,
};
use crate::canvas::text_edit::{self, TextCursor, TextEditSession};
use crate::canvas::web_canvas::CanvasWebView;
use crate::color_picker::ColorPickerPopover;
use crate::context_menu::{
    action_id_at, first_action_index, move_highlight, ContextMenu, ContextMenuAction,
    ContextMenuEntry,
};
use crate::icon::IconName;
use crate::settings::{resolve_keystrokes, shortcut_catalog, SettingsSection};
use crate::theme::{Theme, ThemeKind};

actions!(
    canvas_editor,
    [
        Undo,
        Redo,
        ToolSelect,
        ToolHand,
        ToolRectangle,
        ToolFrame,
        ToolText,
        ToolImage,
        SaveDesign,
        NewDesign,
        ToggleFiles,
        ToggleSettings,
        ZoomIn,
        ZoomOut,
        ZoomReset,
        FitSelection,
        FitAll,
        GroupSelection,
        UngroupSelection,
        WorkspaceQuit
    ]
);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CanvasTool {
    Select,
    Hand,
    Preview,
    Frame,
    Text,
    Rectangle,
    Shapes,
    Image,
    Component,
}

impl CanvasTool {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Select => "select",
            Self::Hand => "hand",
            Self::Preview => "preview",
            Self::Frame => "frame",
            Self::Text => "text",
            Self::Rectangle => "rectangle",
            Self::Shapes => "shapes",
            Self::Image => "image",
            Self::Component => "component",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Select => "Select",
            Self::Hand => "Hand",
            Self::Preview => "Preview",
            Self::Frame => "Frame",
            Self::Text => "Text",
            Self::Rectangle => "Rectangle",
            Self::Shapes => "Shape",
            Self::Image => "Image",
            Self::Component => "Component",
        }
    }

    pub fn shortcut(self) -> Option<&'static str> {
        match self {
            Self::Select => Some("V"),
            Self::Hand => Some("H"),
            Self::Frame => Some("F"),
            Self::Text => Some("T"),
            Self::Rectangle => Some("R"),
            Self::Image => Some("I"),
            _ => None,
        }
    }
}

fn canvas_tool_from_name(value: &str) -> Option<CanvasTool> {
    match value {
        "select" => Some(CanvasTool::Select),
        "hand" => Some(CanvasTool::Hand),
        "preview" => Some(CanvasTool::Preview),
        "frame" => Some(CanvasTool::Frame),
        "text" => Some(CanvasTool::Text),
        "rectangle" => Some(CanvasTool::Rectangle),
        "shapes" => Some(CanvasTool::Shapes),
        "image" => Some(CanvasTool::Image),
        "component" => Some(CanvasTool::Component),
        _ => None,
    }
}

pub struct CanvasWorkspace {
    pub(crate) theme: Theme,
    pub(crate) engine: CanvasEngine,
    pub(crate) camera: Camera,
    pub(crate) selection: Vec<NodeId>,
    pub(crate) tool: CanvasTool,
    pub(crate) viewport_bounds: Rc<Cell<Bounds<Pixels>>>,
    webview: Entity<CanvasWebView>,
    _web_ipc_task: Option<Task<()>>,
    web_document_key: Option<WebDocumentKey>,
    web_state_key: Option<WebStateKey>,
    web_ready: bool,
    /// Path waiting for a webview PNG rasterization result.
    pending_png_export: Option<PathBuf>,
    pub(crate) collapsed: HashSet<NodeId>,
    /// Incremented on any collapse/expand — keeps IPC chrome tokens O(1).
    collapsed_generation: u64,
    layer_scroll: UniformListScrollHandle,
    pub(crate) layer_query: String,
    layer_search_focused: bool,
    layer_search_edit: Option<TextCursor>,
    /// In-place layer rename (double-click a row).
    layer_rename: Option<NodeId>,
    layer_rename_draft: String,
    layer_rename_edit: Option<TextCursor>,
    /// Flattened layer rows; invalidated when revision / collapse / query change.
    layer_rows_cache: Option<(LayerListKey, Rc<Vec<LayerRow>>)>,
    pub(crate) preview_mode: bool,
    preview_hidden: HashSet<NodeId>,
    preview_states: HashMap<String, StateValue>,
    preview_variants: HashMap<NodeId, String>,
    preview_theme_id: Option<String>,
    preview_hovered: Option<NodeId>,
    preview_hover_started_at: Option<Instant>,
    preview_hover_exited: Option<(NodeId, Instant)>,
    preview_pressed: Option<NodeId>,
    preview_press_started_at: Option<Instant>,
    preview_focused: Option<NodeId>,
    preview_current_page: Option<NodeId>,
    preview_overlay: Option<NodeId>,
    preview_started_at: Instant,
    preview_runtime_generation: u64,
    pub(crate) sidebar_visible: bool,
    pub(crate) command_open: bool,
    command_query: String,
    command_index: usize,
    command_edit: Option<TextCursor>,
    settings_route_active: bool,
    settings_section: SettingsSection,
    shortcut_overrides: HashMap<String, String>,
    shortcut_recording: Option<String>,
    shortcut_search: String,
    shortcut_search_focused: bool,
    store: DesignStore,
    files: Vec<DesignFileInfo>,
    saved_revision: u64,
    dirty: bool,
    _autosave_task: Option<Task<()>>,
    _image_tasks: Vec<Task<()>>,
    _caret_task: Option<Task<()>>,
    text_edit: Option<TextEditSession>,
    /// Image source picker for a target image node.
    image_picker: Option<ImagePickerState>,
    image_url_edit: Option<TextCursor>,
    /// Interactive color picker popover (swatch click).
    color_picker: Option<ColorPickerState>,
    /// Canvas context menu (right-click).
    context_menu: Option<ContextMenuState>,
    /// In-app clipboard for copy / paste / duplicate of node subtrees.
    clipboard: Vec<Node>,
    /// Nudge successive pastes so copies don't stack exactly.
    paste_nudge: u32,
    /// World point of the last context-menu open (for paste-in-place).
    context_world: Option<Vec2>,
    /// Last canvas click (for paste when no context menu).
    last_pointer_world: Option<Vec2>,
    /// Properties inspector focus / draft / scrub state.
    props_focus: Option<PropsField>,
    props_draft: String,
    props_text_edit: Option<TextCursor>,
    props_scrub: Option<PropsScrub>,
    props_collapsed: HashSet<&'static str>,
    /// Inspector breakpoint (None = base). Canvas still paints base layout.
    pub(crate) active_breakpoint_id: Option<String>,
    focus_handle: FocusHandle,
}

#[derive(Clone, Debug)]
struct PropsScrub {
    field: PropsField,
    start_x: f32,
    start_value: f64,
}

#[derive(Clone, Debug)]
struct ImagePickerState {
    node_id: NodeId,
    mode: ImagePickerMode,
    url: String,
}

#[derive(Clone, Debug)]
struct ColorPickerState {
    field: PropsField,
    color: Color,
}

#[derive(Clone, Debug)]
struct ContextMenuState {
    position: Point<Pixels>,
    highlight: usize,
    entries: Vec<ContextMenuEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WebDocumentKey {
    document_id: String,
    revision: u64,
    preview_mode: bool,
    preview_runtime_generation: u64,
    active_breakpoint_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WebStateKey {
    pan_x: u64,
    pan_y: u64,
    zoom: u64,
    selection: Vec<NodeId>,
    tool: CanvasTool,
    preview_mode: bool,
    can_undo: bool,
    can_redo: bool,
    chrome: ThemeKind,
}

impl CanvasWorkspace {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus_handle = cx.focus_handle();
        focus_handle.focus(window, cx);

        let store = DesignStore::open().unwrap_or_else(|err| {
            eprintln!("loora: falling back to temp design store: {err}");
            let fallback = std::env::temp_dir().join("loora-designs");
            DesignStore::open_at(fallback).expect("temp design store")
        });
        let document = store
            .load_or_create_default()
            .unwrap_or_else(|_| loora_engine::Document::empty("Untitled"));
        let engine = CanvasEngine::new(document);
        let collapsed = default_collapsed_layers(&engine);
        let saved_revision = engine.revision();
        let files = store.list().unwrap_or_default();
        let theme = store
            .ui_theme()
            .ok()
            .flatten()
            .and_then(|id| ThemeKind::parse(&id))
            .map(Theme::from_kind)
            .unwrap_or_default();
        let shortcut_overrides = store.shortcuts().unwrap_or_default();
        Self::bind_workspace_keys(cx, &shortcut_overrides);

        let viewport_bounds = Rc::new(Cell::new(Bounds::default()));
        let (web_ipc_sender, web_ipc_receiver) = async_channel::unbounded();
        let webview = cx.new({
            let viewport_bounds = viewport_bounds.clone();
            let web_ipc_sender = web_ipc_sender.clone();
            move |cx| CanvasWebView::new(window, cx, web_ipc_sender, viewport_bounds)
        });

        let mut workspace = Self {
            theme,
            engine,
            camera: Camera::new(Vec2::new(40.0, 40.0), 1.0),
            selection: Vec::new(),
            tool: CanvasTool::Select,
            viewport_bounds,
            webview,
            _web_ipc_task: None,
            web_document_key: None,
            web_state_key: None,
            web_ready: false,
            pending_png_export: None,
            collapsed,
            collapsed_generation: 0,
            layer_scroll: UniformListScrollHandle::new(),
            layer_query: String::new(),
            layer_search_focused: false,
            layer_search_edit: None,
            layer_rename: None,
            layer_rename_draft: String::new(),
            layer_rename_edit: None,
            layer_rows_cache: None,
            preview_mode: false,
            preview_hidden: HashSet::new(),
            preview_states: HashMap::new(),
            preview_variants: HashMap::new(),
            preview_theme_id: None,
            preview_hovered: None,
            preview_hover_started_at: None,
            preview_hover_exited: None,
            preview_pressed: None,
            preview_press_started_at: None,
            preview_focused: None,
            preview_current_page: None,
            preview_overlay: None,
            preview_started_at: Instant::now(),
            preview_runtime_generation: 0,
            sidebar_visible: true,
            command_open: false,
            command_query: String::new(),
            command_index: 0,
            command_edit: None,
            settings_route_active: false,
            settings_section: SettingsSection::General,
            shortcut_overrides,
            shortcut_recording: None,
            shortcut_search: String::new(),
            shortcut_search_focused: false,
            store,
            files,
            saved_revision,
            dirty: false,
            _autosave_task: None,
            _image_tasks: Vec::new(),
            _caret_task: None,
            text_edit: None,
            image_picker: None,
            image_url_edit: None,
            color_picker: None,
            context_menu: None,
            clipboard: Vec::new(),
            paste_nudge: 0,
            context_world: None,
            last_pointer_world: None,
            props_focus: None,
            props_draft: String::new(),
            props_text_edit: None,
            props_scrub: None,
            props_collapsed: HashSet::new(),
            active_breakpoint_id: None,
            focus_handle,
        };
        workspace._web_ipc_task = Some(cx.spawn(async move |this, cx| {
            while let Ok(first_message) = web_ipc_receiver.recv().await {
                let mut messages = vec![first_message];
                while let Ok(message) = web_ipc_receiver.try_recv() {
                    messages.push(message);
                }

                let keep_running = this
                    .update(cx, |this, cx| {
                        let before = this.shell_chrome_token();
                        for message in messages {
                            this.handle_web_payload(&message, cx);
                        }
                        // Pan-only camera updates must not rebuild layers / props.
                        if ipc_should_notify_chrome(&before, &this.shell_chrome_token()) {
                            cx.notify();
                        }
                    })
                    .is_ok();
                if !keep_running {
                    break;
                }
            }
        }));
        workspace
    }

    fn shell_chrome_token(&self) -> ShellChromeToken {
        ShellChromeToken {
            revision: self.engine.revision(),
            selection: self.selection.clone(),
            tool: self.tool,
            zoom_bits: self.camera.zoom.to_bits(),
            layer_query: self.layer_query.clone(),
            layer_search_focused: self.layer_search_focused,
            layer_rename: self.layer_rename.clone(),
            layer_rename_draft: self.layer_rename_draft.clone(),
            collapsed_generation: self.collapsed_generation,
            sidebar_visible: self.sidebar_visible,
            command_open: self.command_open,
            command_query: self.command_query.clone(),
            command_index: self.command_index,
            dirty: self.dirty,
            doc_name: self.document_name(),
            doc_id: self.document_id(),
            files_len: self.files.len(),
            web_ready: self.web_ready,
            preview_mode: self.preview_mode,
            preview_runtime_generation: self.preview_runtime_generation,
            image_picker: self.image_picker.is_some(),
            color_picker: self.color_picker.is_some(),
            context_menu: self.context_menu.is_some(),
            can_undo: self.engine.can_undo(),
            can_redo: self.engine.can_redo(),
            props_focus: self.props_focus.is_some() || self.props_scrub.is_some(),
            props_draft: self.props_draft.clone(),
            active_breakpoint_id: self.active_breakpoint_id.clone(),
        }
    }

    pub(crate) fn invalidate_layer_rows(&mut self) {
        self.layer_rows_cache = None;
    }

    pub(crate) fn note_collapsed_changed(&mut self) {
        self.collapsed_generation = self.collapsed_generation.wrapping_add(1);
        self.invalidate_layer_rows();
    }

    fn cached_layer_rows(&mut self) -> Rc<Vec<LayerRow>> {
        let key = LayerListKey {
            revision: self.engine.revision(),
            query: self.layer_query.clone(),
            collapsed_generation: self.collapsed_generation,
        };
        if let Some((cached_key, rows)) = self.layer_rows_cache.as_ref() {
            if cached_key == &key {
                return rows.clone();
            }
        }
        let rows = Rc::new(build_layer_rows(
            &self.engine,
            &self.collapsed,
            &self.layer_query,
        ));
        self.layer_rows_cache = Some((key, rows.clone()));
        rows
    }

    fn handle_web_payload(&mut self, payload: &str, cx: &mut Context<Self>) {
        match serde_json::from_str::<serde_json::Value>(payload) {
            Ok(message) => self.handle_web_message(&message, cx),
            Err(error) => eprintln!("loora: invalid canvas message: {error}"),
        }
    }

    fn handle_web_message(
        &mut self,
        message: &serde_json::Value,
        cx: &mut Context<Self>,
    ) {
        let Some(kind) = message.get("type").and_then(|value| value.as_str()) else {
            return;
        };
        match kind {
            "ready" => {
                self.web_ready = true;
                self.web_document_key = None;
                self.web_state_key = None;
            }
            "export-png" => {
                let Some(path) = self.pending_png_export.take() else {
                    return;
                };
                if let Some(error) = message.get("error").and_then(|value| value.as_str()) {
                    eprintln!("loora: export failed: {error}");
                    cx.notify();
                    return;
                }
                let Some(data_url) = message.get("dataUrl").and_then(|value| value.as_str()) else {
                    eprintln!("loora: export failed: missing PNG payload");
                    cx.notify();
                    return;
                };
                match decode_data_url_png(data_url) {
                    Ok(bytes) => match fs::write(&path, bytes) {
                        Ok(()) => eprintln!("loora: exported {}", path.display()),
                        Err(error) => eprintln!("loora: export failed: {error}"),
                    },
                    Err(error) => eprintln!("loora: export failed: {error}"),
                }
                cx.notify();
            }
            "camera" => {
                let Some(x) = message.get("x").and_then(|value| value.as_f64()) else {
                    return;
                };
                let Some(y) = message.get("y").and_then(|value| value.as_f64()) else {
                    return;
                };
                let Some(zoom) = message.get("zoom").and_then(|value| value.as_f64()) else {
                    return;
                };
                if x.is_finite() && y.is_finite() && zoom.is_finite() {
                    self.camera = Camera::new(
                        Vec2::new(x, y),
                        zoom.clamp(Camera::MIN_ZOOM, Camera::MAX_ZOOM),
                    );
                    self.web_state_key = Some(self.current_web_state_key());
                }
            }
            "select" if !self.preview_mode => {
                self.blur_props_if_needed(cx);
                let additive = message
                    .get("additive")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                let mut ids: Vec<NodeId> = message
                    .get("ids")
                    .and_then(|value| value.as_array())
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(NodeId::from))
                            .filter(|id| self.engine.node(id).is_some())
                            .collect()
                    })
                    .unwrap_or_default();
                // Dedup while preserving order.
                {
                    let mut seen = HashSet::new();
                    ids.retain(|id| seen.insert(id.clone()));
                }
                if !ids.is_empty() {
                    if additive {
                        for id in ids {
                            if !self.selection.contains(&id) {
                                self.selection.push(id.clone());
                                self.reveal_layer(&id);
                            }
                        }
                    } else {
                        self.selection = ids;
                        if let Some(last) = self.selection.last().cloned() {
                            self.reveal_layer(&last);
                        }
                    }
                } else {
                    let id = message
                        .get("id")
                        .and_then(|value| value.as_str())
                        .map(NodeId::from);
                    if additive {
                        if let Some(id) = id {
                            if self.engine.node(&id).is_some() {
                                self.toggle_selection(id);
                            }
                        }
                    } else if let Some(id) = id {
                        if self.engine.node(&id).is_some() {
                            self.select_only(id);
                        }
                    } else {
                        self.clear_selection();
                    }
                }
                self.clear_props_focus();
                self.web_state_key = Some(self.current_web_state_key());
            }
            "bounds" if !self.preview_mode => {
                let Some(id) = message
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(NodeId::from)
                else {
                    return;
                };
                let Some(bounds) = message.get("bounds") else {
                    return;
                };
                let read = |name| bounds.get(name).and_then(|value| value.as_f64());
                let (Some(x), Some(y), Some(width), Some(height)) =
                    (read("x"), read("y"), read("width"), read("height"))
                else {
                    return;
                };
                if ![x, y, width, height].into_iter().all(f64::is_finite) {
                    return;
                }
                let parent_origin = message
                    .get("parent")
                    .and_then(|parent| {
                        Some(Vec2::new(
                            parent.get("x")?.as_f64()?,
                            parent.get("y")?.as_f64()?,
                        ))
                    })
                    .filter(|origin| origin.x.is_finite() && origin.y.is_finite());
                let move_mode = message.get("mode").and_then(|value| value.as_str()) == Some("move");
                let duplicate = message
                    .get("duplicate")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                let dx = message.get("dx").and_then(|value| value.as_f64());
                let dy = message.get("dy").and_then(|value| value.as_f64());
                let mut ids: Vec<NodeId> = message
                    .get("ids")
                    .and_then(|value| value.as_array())
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(NodeId::from))
                            .filter(|node_id| self.engine.node(node_id).is_some())
                            .collect()
                    })
                    .unwrap_or_default();
                if ids.is_empty() {
                    ids.push(id.clone());
                }
                let rendered_drop = message.get("drop").and_then(|drop| {
                    let id = NodeId::from(drop.get("id")?.as_str()?);
                    let parent = drop.get("parent")?;
                    let origin = Vec2::new(
                        parent.get("x")?.as_f64()?,
                        parent.get("y")?.as_f64()?,
                    );
                    (origin.x.is_finite() && origin.y.is_finite()).then_some((id, origin))
                });
                let leading_edge_resize = message
                    .get("handle")
                    .and_then(|value| value.as_str())
                    .is_some_and(|handle| handle.contains('n') || handle.contains('w'));

                let mut working_ids = ids;
                if move_mode && duplicate {
                    match self
                        .engine
                        .duplicate_nodes(&working_ids, Vec2::new(0.0, 0.0))
                    {
                        Ok(new_ids) if !new_ids.is_empty() => working_ids = new_ids,
                        _ => {}
                    }
                }

                let multi_move = move_mode && working_ids.len() > 1;
                let members = message.get("members").and_then(|value| value.as_array());
                let changed = if multi_move {
                    match (dx, dy) {
                        (Some(dx), Some(dy)) if dx.is_finite() && dy.is_finite() => self
                            .engine
                            .move_nodes(&working_ids, dx, dy, None)
                            .is_ok(),
                        _ => false,
                    }
                } else if move_mode {
                    let primary = working_ids.first().cloned().unwrap_or(id.clone());
                    match parent_origin {
                        Some(parent_origin) => self
                            .engine
                            .set_world_position_from_parent_origin(
                                &primary,
                                Vec2::new(x, y),
                                parent_origin,
                                None,
                            )
                            .is_ok(),
                        None => self
                            .engine
                            .set_world_position(&primary, Vec2::new(x, y), None)
                            .is_ok(),
                    }
                } else if let Some(members) = members {
                    let mut any = false;
                    let mut kept = Vec::new();
                    for member in members {
                        let Some(member_id) = member
                            .get("id")
                            .and_then(|value| value.as_str())
                            .map(NodeId::from)
                        else {
                            continue;
                        };
                        let Some(member_bounds) = member.get("bounds") else {
                            continue;
                        };
                        let read_m =
                            |name| member_bounds.get(name).and_then(|value| value.as_f64());
                        let (Some(mx), Some(my), Some(mw), Some(mh)) =
                            (read_m("x"), read_m("y"), read_m("width"), read_m("height"))
                        else {
                            continue;
                        };
                        if ![mx, my, mw, mh].into_iter().all(f64::is_finite) {
                            continue;
                        }
                        let member_parent = member.get("parent").and_then(|parent| {
                            Some(Vec2::new(
                                parent.get("x")?.as_f64()?,
                                parent.get("y")?.as_f64()?,
                            ))
                        });
                        let box_bounds = EngineBounds::new(mx, my, mw.max(1.0), mh.max(1.0));
                        let ok = match member_parent {
                            Some(origin) => self
                                .engine
                                .set_rendered_world_bounds(
                                    &member_id,
                                    box_bounds,
                                    origin,
                                    leading_edge_resize,
                                    None,
                                )
                                .is_ok(),
                            None => self
                                .engine
                                .set_world_bounds(&member_id, box_bounds, None)
                                .is_ok(),
                        };
                        if ok {
                            any = true;
                            kept.push(member_id);
                        }
                    }
                    if any {
                        working_ids = kept;
                    }
                    any
                } else {
                    let bounds = EngineBounds::new(x, y, width.max(1.0), height.max(1.0));
                    match parent_origin {
                        Some(parent_origin) => self
                            .engine
                            .set_rendered_world_bounds(
                                &id,
                                bounds,
                                parent_origin,
                                leading_edge_resize,
                                None,
                            )
                            .is_ok(),
                        None => self.engine.set_world_bounds(&id, bounds, None).is_ok(),
                    }
                };
                if changed {
                    if move_mode && !multi_move {
                        let primary = working_ids.first().cloned().unwrap_or(id.clone());
                        if let Some((target, target_origin)) = rendered_drop {
                            let current_parent = self
                                .engine
                                .node(&primary)
                                .and_then(|node| node.parent_id.clone());
                            let target_is_container = self
                                .engine
                                .node(&target)
                                .is_some_and(Node::is_container);
                            if current_parent.as_ref() != Some(&target)
                                && target != primary
                                && target_is_container
                            {
                                let _ = self.engine.reparent_from_rendered_position(
                                    &primary,
                                    &target,
                                    Vec2::new(x, y),
                                    target_origin,
                                );
                            }
                        }
                    }
                    if move_mode || members.is_some() {
                        self.selection = working_ids;
                        if let Some(last) = self.selection.last().cloned() {
                            self.reveal_layer(&last);
                        }
                    } else {
                        self.select_only(id);
                    }
                    self.note_change(cx);
                }
            }
            "create" if !self.preview_mode => {
                let Some(bounds) = message.get("bounds") else {
                    return;
                };
                let read = |name| bounds.get(name).and_then(|value| value.as_f64());
                let (Some(x), Some(y), Some(width), Some(height)) =
                    (read("x"), read("y"), read("width"), read("height"))
                else {
                    return;
                };
                let Some(tool) = message
                    .get("tool")
                    .and_then(|value| value.as_str())
                    .and_then(canvas_tool_from_name)
                else {
                    return;
                };
                if let Some(id) = self.commit_draw(tool, x, y, width, height, cx) {
                    self.select_only(id.clone());
                    self.tool = CanvasTool::Select;
                    if tool == CanvasTool::Image {
                        self.open_image_picker(id, cx);
                    }
                    self.note_change(cx);
                }
            }
            "text" if !self.preview_mode => {
                let Some(id) = message
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(NodeId::from)
                else {
                    return;
                };
                let Some(text) = message.get("text").and_then(|value| value.as_str()) else {
                    return;
                };
                if self.engine.set_text(&id, text.to_string()).is_ok() {
                    if let Some(bounds) = message.get("bounds") {
                        let read = |name| bounds.get(name).and_then(|value| value.as_f64());
                        if let (Some(x), Some(y), Some(width), Some(height)) =
                            (read("x"), read("y"), read("width"), read("height"))
                        {
                            if [x, y, width, height].into_iter().all(f64::is_finite) {
                                let node = self.engine.node(&id).cloned();
                                if let Some(node) = node {
                                    let hug = node.layout.width_mode == SizeMode::Hug
                                        || node.layout.height_mode == SizeMode::Hug;
                                    if hug {
                                        let _ = self.engine.set_world_bounds(
                                            &id,
                                            EngineBounds::new(
                                                x,
                                                y,
                                                width.max(1.0),
                                                height.max(1.0),
                                            ),
                                            Some(format!("edit-text-bounds:{id}")),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    self.select_only(id.clone());
                    self.soft_sync_text_edit(&id, text, cx);
                }
            }
            "drop-files" if !self.preview_mode => {
                let Some(paths) = message
                    .get("paths")
                    .and_then(|value| value.as_array())
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(PathBuf::from))
                            .collect::<Vec<_>>()
                    })
                else {
                    return;
                };
                let world = message.get("world").and_then(|point| {
                    Some(Vec2::new(
                        point.get("x")?.as_f64()?,
                        point.get("y")?.as_f64()?,
                    ))
                });
                if let Some(world) = world {
                    self.context_world = Some(world);
                    self.last_pointer_world = Some(world);
                }
                let mut imported = false;
                for path in paths {
                    if !is_pasteable_image_path(&path) {
                        continue;
                    }
                    match self.store.import_asset_file(&path) {
                        Ok(stored) => {
                            if let Ok(bytes) = fs::read(&stored) {
                                let format = image_format_from_path(&stored)
                                    .unwrap_or(ImageFormat::Png);
                                let name = stored
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .map(|s| s.to_string());
                                // Force paste at drop world by setting context_world.
                                if self.paste_image_bytes(
                                    &bytes,
                                    format,
                                    name.as_deref(),
                                    cx,
                                ) {
                                    imported = true;
                                }
                            }
                        }
                        Err(error) => eprintln!("loora: drop import failed: {error}"),
                    }
                }
                if !imported {
                    cx.notify();
                }
            }
            "edit-image" if !self.preview_mode => {
                if let Some(id) = message
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(NodeId::from)
                {
                    if self.engine.node(&id).is_some() {
                        self.select_only(id.clone());
                        self.open_image_picker(id, cx);
                    }
                }
            }
            "preview-trigger" if self.preview_mode => {
                let Some(id) = message
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(NodeId::from)
                else {
                    return;
                };
                let trigger = match message.get("trigger").and_then(|value| value.as_str()) {
                    Some("click") => Some(InteractionTrigger::Click),
                    Some("double_click") => Some(InteractionTrigger::DoubleClick),
                    Some("hover") => {
                        self.preview_hovered = Some(id.clone());
                        self.preview_hover_started_at = Some(Instant::now());
                        self.preview_hover_exited = None;
                        Some(InteractionTrigger::Hover)
                    }
                    Some("hover_end") => {
                        self.preview_hovered = None;
                        self.preview_hover_exited = Some((id.clone(), Instant::now()));
                        Some(InteractionTrigger::HoverEnd)
                    }
                    Some("focus") => {
                        if let Some(previous) = self.preview_focused.replace(id.clone()) {
                            if previous != id {
                                self.dispatch_preview_trigger(
                                    &previous,
                                    InteractionTrigger::Blur,
                                    None,
                                    cx,
                                );
                            }
                        }
                        Some(InteractionTrigger::Focus)
                    }
                    Some("blur") => Some(InteractionTrigger::Blur),
                    Some("submit") => Some(InteractionTrigger::Submit),
                    Some("change") => Some(InteractionTrigger::Change),
                    Some("input") => Some(InteractionTrigger::Input),
                    _ => None,
                };
                if let Some(trigger) = trigger {
                    self.dispatch_preview_trigger(&id, trigger, None, cx);
                }
            }
            "context-menu" if !self.preview_mode => {
                self.blur_props_if_needed(cx);
                self.context_menu = None;
                if let Some(id) = message
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(NodeId::from)
                {
                    if self.engine.node(&id).is_some() && !self.selection.contains(&id) {
                        self.select_only(id);
                    }
                } else {
                    self.clear_selection();
                }
                if let Some(world) = message.get("world") {
                    if let (Some(x), Some(y)) = (
                        world.get("x").and_then(|value| value.as_f64()),
                        world.get("y").and_then(|value| value.as_f64()),
                    ) {
                        self.context_world = Some(Vec2::new(x, y));
                    }
                }
                let x = message.get("x").and_then(|value| value.as_f64()).unwrap_or(0.0);
                let y = message.get("y").and_then(|value| value.as_f64()).unwrap_or(0.0);
                let entries = self.context_menu_entries(cx);
                let entries = web_context_menu_entries(&entries);
                self.webview.update(cx, |view, _| {
                    let _ = view.command(serde_json::json!({
                        "type": "context-menu",
                        "x": x,
                        "y": y,
                        "entries": entries,
                    }));
                });
            }
            "context-action" if !self.preview_mode => {
                if let Some(action) = message.get("action").and_then(|value| value.as_str()) {
                    self.run_context_action(action, cx);
                }
            }
            "command" => {
                if let Some(command) = message.get("command").and_then(|value| value.as_str()) {
                    self.handle_web_command(command, cx);
                }
            }
            "overlay-close"
                if self.preview_mode && self.preview_overlay.take().is_some() =>
            {
                self.preview_runtime_generation = self.preview_runtime_generation.wrapping_add(1);
            }
            _ => {}
        }
    }

    fn handle_web_command(&mut self, command: &str, cx: &mut Context<Self>) {
        match command {
            "undo" => {
                if self.engine.undo().unwrap_or(false) {
                    self.note_change(cx);
                }
            }
            "redo" => {
                if self.engine.redo().unwrap_or(false) {
                    self.note_change(cx);
                }
            }
            "save" => self.save_now(cx),
            "copy" if !self.preview_mode => self.copy_selection(cx),
            "cut" if !self.preview_mode => {
                self.copy_selection(cx);
                self.delete_selection(cx);
            }
            "paste" if !self.preview_mode => self.paste_clipboard(cx),
            "duplicate" if !self.preview_mode => self.duplicate_selection(cx),
            "select-all" if !self.preview_mode => self.select_all_on_page(cx),
            "lock" if !self.preview_mode => {
                let lock = self
                    .selection
                    .iter()
                    .filter_map(|id| self.engine.node(id))
                    .any(|node| !node.locked);
                let mut changed = false;
                for id in self.selection.clone() {
                    changed |= self.engine.set_locked(&id, lock).is_ok();
                }
                if changed {
                    self.note_change(cx);
                }
            }
            "group" if !self.preview_mode => self.group_selection(cx),
            "ungroup" if !self.preview_mode => self.ungroup_selection(cx),
            "bring-front" if !self.preview_mode => {
                let mut changed = false;
                for id in self.selection.clone() {
                    changed |= self.engine.bring_to_front_history(&id).is_ok();
                }
                if changed {
                    self.note_change(cx);
                }
            }
            "send-back" if !self.preview_mode => {
                let mut changed = false;
                for id in self.selection.clone() {
                    changed |= self.engine.send_to_back(&id).is_ok();
                }
                if changed {
                    self.note_change(cx);
                }
            }
            "zoom-in" => self.zoom_by(1.15, cx),
            "zoom-out" => self.zoom_by(1.0 / 1.15, cx),
            "zoom-reset" => {
                let center = self.viewport_center();
                self.camera.set_zoom_at(center, 1.0);
            }
            "fit-selection" => self.fit_selection_or_page(cx),
            "fit-all" => self.fit_all_pages(cx),
            "files" => self.toggle_files_panel(cx),
            "sidebar" => self.toggle_sidebar(cx),
            "new" => self.create_design(cx),
            "delete" if !self.preview_mode => {
                self.delete_selection(cx);
            }
            "escape" => {
                if self.preview_mode {
                    self.set_tool(CanvasTool::Preview, cx);
                } else if self.tool != CanvasTool::Select {
                    self.set_tool(CanvasTool::Select, cx);
                } else {
                    self.clear_selection();
                }
            }
            "tool:v" | "tool:select" => self.set_tool(CanvasTool::Select, cx),
            "tool:h" | "tool:hand" => self.set_tool(CanvasTool::Hand, cx),
            "tool:preview" => self.set_tool(CanvasTool::Preview, cx),
            "tool:f" | "tool:frame" => self.set_tool(CanvasTool::Frame, cx),
            "tool:t" | "tool:text" => self.set_tool(CanvasTool::Text, cx),
            "tool:r" | "tool:rectangle" => self.set_tool(CanvasTool::Rectangle, cx),
            "tool:shapes" => self.set_tool(CanvasTool::Shapes, cx),
            "tool:i" | "tool:image" => self.set_tool(CanvasTool::Image, cx),
            "tool:component" => self.set_tool(CanvasTool::Component, cx),
            _ if command.starts_with("nudge:") && !self.preview_mode => {
                let parts: Vec<_> = command.split(':').collect();
                let amount = parts
                    .get(2)
                    .and_then(|value| value.parse::<f64>().ok())
                    .unwrap_or(1.0);
                let (dx, dy) = match parts.get(1).copied() {
                    Some("left") => (-amount, 0.0),
                    Some("right") => (amount, 0.0),
                    Some("up") => (0.0, -amount),
                    Some("down") => (0.0, amount),
                    _ => return,
                };
                if self
                    .engine
                    .move_nodes(&self.selection.clone(), dx, dy, Some("keyboard-nudge".into()))
                    .is_ok()
                {
                    self.note_change(cx);
                }
            }
            _ => {}
        }
    }

    fn current_web_document_key(&self) -> WebDocumentKey {
        WebDocumentKey {
            document_id: self.engine.document().id.clone(),
            revision: self.engine.revision(),
            preview_mode: self.preview_mode,
            preview_runtime_generation: self.preview_runtime_generation,
            active_breakpoint_id: self.active_breakpoint_id.clone(),
        }
    }

    fn current_web_state_key(&self) -> WebStateKey {
        WebStateKey {
            pan_x: self.camera.pan.x.to_bits(),
            pan_y: self.camera.pan.y.to_bits(),
            zoom: self.camera.zoom.to_bits(),
            selection: self.selection.clone(),
            tool: self.tool,
            preview_mode: self.preview_mode,
            can_undo: self.engine.can_undo(),
            can_redo: self.engine.can_redo(),
            chrome: self.theme.kind,
        }
    }

    fn web_runtime_document(&self) -> loora_engine::Document {
        if self.preview_variants.is_empty() {
            return self.engine.document().clone();
        }
        let mut runtime = CanvasEngine::new(self.engine.document().clone());
        let mut variants: Vec<_> = self.preview_variants.iter().collect();
        variants.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
        for (id, variant) in variants {
            let _ = runtime.apply_variant(id, variant.clone());
        }
        runtime.document().clone()
    }

    fn sync_web_canvas(&mut self, cx: &mut Context<Self>) {
        // Hide the native webview for settings and GPUI overlays that sit under wry.
        // Canvas HTML menus stay in-webview and never set these flags.
        let hide_webview = self.webview_should_be_hidden();
        self.webview
            .update(cx, |view, _| view.set_visible(!hide_webview));
        if !self.web_ready || hide_webview {
            return;
        }

        let document_key = self.current_web_document_key();
        let state_key = self.current_web_state_key();
        if self.web_document_key.as_ref() != Some(&document_key) {
            if self
                .web_document_key
                .as_ref()
                .is_some_and(|previous| previous.document_id != document_key.document_id)
            {
                let _ = self
                    .webview
                    .update(cx, |view, _| view.invalidate_markup_cache());
            }
            let document = self.web_runtime_document();
            let viewport_width = self.active_breakpoint_id.as_ref().and_then(|id| {
                document
                    .breakpoints
                    .iter()
                    .find(|breakpoint| &breakpoint.id == id)
                    .map(|breakpoint| breakpoint.preview_width.max(1.0))
            });
            let options = HtmlCanvasOptions {
                viewport_width,
                theme_id: self.preview_mode.then(|| {
                    self.preview_theme_id
                        .clone()
                        .unwrap_or_else(|| document.active_theme_id.clone())
                }),
                hidden_nodes: self.preview_hidden.clone(),
                current_page_id: self.preview_mode.then(|| {
                    self.preview_current_page
                        .clone()
                        .unwrap_or_else(|| self.engine.root_page_id().clone())
                }),
                overlay_page_id: self.preview_mode.then(|| self.preview_overlay.clone()).flatten(),
                preview: self.preview_mode,
            };
            let compiled = compile_canvas(&document, &options);
            let allowed_assets: Vec<PathBuf> = document
                .nodes
                .values()
                .filter_map(|node| node.image_path.as_deref())
                .filter(|path| !is_http_url(path) && !path.starts_with("data:"))
                .map(PathBuf::from)
                .collect();
            let camera = self.camera;
            let selection = self.selection.clone();
            let tool = self.tool.as_str();
            let preview = self.preview_mode;
            let can_undo = self.engine.can_undo();
            let can_redo = self.engine.can_redo();
            let chrome = self.theme.kind.as_str();
            let result = self.webview.update(cx, |view, _| {
                view.set_allowed_assets(allowed_assets);
                view.apply_canvas(
                    &compiled,
                    camera,
                    &selection,
                    tool,
                    preview,
                    can_undo,
                    can_redo,
                    chrome,
                )
            });
            match result {
                Ok(()) => {
                    self.web_document_key = Some(document_key);
                    self.web_state_key = Some(state_key);
                }
                Err(error) => eprintln!("loora: {error}"),
            }
        } else if self.web_state_key.as_ref() != Some(&state_key) {
            let command = serde_json::json!({
                "type": "state",
                "camera": {
                    "x": self.camera.pan.x,
                    "y": self.camera.pan.y,
                    "zoom": self.camera.zoom,
                },
                "selection": self.selection.iter().map(NodeId::as_str).collect::<Vec<_>>(),
                "tool": self.tool.as_str(),
                "preview": self.preview_mode,
                "canUndo": self.engine.can_undo(),
                "canRedo": self.engine.can_redo(),
                "chrome": self.theme.kind.as_str(),
            });
            let result = self.webview.update(cx, |view, _| view.command(command));
            if let Err(error) = result {
                eprintln!("loora: {error}");
            } else {
                self.web_state_key = Some(state_key);
            }
        }
    }

    pub fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        self.sidebar_visible = !self.sidebar_visible;
        cx.notify();
    }

    pub fn open_command_dialog(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        self.refresh_files();
        self.command_open = true;
        self.command_query.clear();
        self.command_index = 0;
        self.command_edit = Some(TextCursor::at_end(0));
        self.text_edit = None;
        self.layer_search_focused = false;
        self.layer_search_edit = None;
        self.clear_props_focus();
        self.image_picker = None;
        self.image_url_edit = None;
        cx.notify();
    }

    pub fn close_command_dialog(&mut self, cx: &mut Context<Self>) {
        if self.command_open {
            self.command_open = false;
            self.command_query.clear();
            self.command_index = 0;
            self.command_edit = None;
            cx.notify();
        }
    }

    pub fn focus_command_input(
        &mut self,
        click_count: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.command_open {
            return;
        }
        let cursor = self
            .command_edit
            .get_or_insert_with(|| TextCursor::at_end(self.command_query.len()));
        if click_count >= 2 {
            cursor.select_all(self.command_query.len());
        } else {
            cursor.set_caret(self.command_query.len(), false);
        }
        self.focus_handle.focus(window, cx);
        cx.notify();
    }

    pub fn blur_command_input(&mut self, cx: &mut Context<Self>) {
        if self.command_edit.take().is_some() {
            cx.notify();
        }
    }

    pub fn toggle_files_panel(&mut self, cx: &mut Context<Self>) {
        if self.command_open {
            self.close_command_dialog(cx);
        } else {
            self.open_command_dialog(cx);
        }
    }

    fn filtered_command_files(&self) -> Vec<&DesignFileInfo> {
        let q = self.command_query.to_lowercase();
        self.files
            .iter()
            .filter(|f| q.is_empty() || f.name.to_lowercase().contains(&q))
            .collect()
    }

    fn command_item_count(&self) -> usize {
        // New + Import… + Import Luuma + Export…
        self.filtered_command_files().len() + COMMAND_ACTION_COUNT
    }

    fn confirm_command_selection(&mut self, cx: &mut Context<Self>) {
        match self.command_index {
            0 => {
                self.create_design(cx);
                self.close_command_dialog(cx);
            }
            1 => {
                self.close_command_dialog(cx);
                self.prompt_import_designs(cx);
            }
            2 => {
                self.import_from_luuma_folder(cx);
                self.close_command_dialog(cx);
            }
            3 => {
                self.close_command_dialog(cx);
                self.prompt_export_design(cx);
            }
            4 => {
                self.toggle_ui_theme(cx);
                self.close_command_dialog(cx);
            }
            _ => {
                let files = self.filtered_command_files();
                if let Some(file) = files.get(self.command_index - COMMAND_ACTION_COUNT) {
                    let id = file.id.clone();
                    self.open_design(&id, cx);
                    self.close_command_dialog(cx);
                }
            }
        }
    }

    pub fn toggle_ui_theme(&mut self, cx: &mut Context<Self>) {
        let next = self.theme.kind.toggle();
        self.set_ui_theme_kind(next, cx);
    }

    pub fn set_ui_theme_kind(&mut self, kind: ThemeKind, cx: &mut Context<Self>) {
        if self.theme.kind == kind {
            return;
        }
        self.theme = Theme::from_kind(kind);
        if let Err(err) = self.store.set_ui_theme(kind.as_str()) {
            eprintln!("loora: failed to persist UI theme: {err}");
        }
        cx.notify();
    }

    pub fn open_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.navigate_to(SettingsSection::General.path(), window, cx);
    }

    pub fn set_settings_route_active(
        &mut self,
        active: bool,
        section: SettingsSection,
        cx: &mut Context<Self>,
    ) {
        let changed = self.settings_route_active != active || self.settings_section != section;
        self.settings_route_active = active;
        self.settings_section = section;
        if !active {
            self.shortcut_recording = None;
            self.shortcut_search_focused = false;
        }
        // Route changes must not force-show over command/image/color/inspector overlays.
        self.sync_webview_visibility(cx);
        if changed {
            cx.notify();
        }
    }

    pub fn set_canvas_route_active(&mut self, active: bool, cx: &mut Context<Self>) {
        if active {
            self.set_settings_route_active(false, SettingsSection::General, cx);
        }
    }

    fn webview_should_be_hidden(&self) -> bool {
        self.settings_route_active
            || canvas_webview_hidden_for_overlays(
                self.command_open,
                self.image_picker.is_some(),
                self.color_picker.is_some(),
                self.context_menu.is_some(),
            )
    }

    fn sync_webview_visibility(&mut self, cx: &mut Context<Self>) {
        let hide = self.webview_should_be_hidden();
        self.webview.update(cx, |view, _| {
            view.set_visible(!hide);
        });
    }

    pub fn theme(&self) -> Theme {
        self.theme
    }

    pub fn shortcut_overrides(&self) -> &HashMap<String, String> {
        &self.shortcut_overrides
    }

    pub fn shortcut_recording(&self) -> Option<&str> {
        self.shortcut_recording.as_deref()
    }

    pub fn shortcut_search(&self) -> &str {
        &self.shortcut_search
    }

    fn navigate_to(&mut self, path: &str, window: &mut Window, cx: &mut Context<Self>) {
        gpui_router::RouterState::global_mut(cx).with_path(SharedString::from(path));
        window.refresh();
        cx.notify();
    }

    pub fn begin_shortcut_recording(&mut self, action_id: &str, cx: &mut Context<Self>) {
        self.shortcut_recording = Some(action_id.to_string());
        self.shortcut_search_focused = false;
        cx.notify();
    }

    pub fn cancel_shortcut_recording(&mut self, cx: &mut Context<Self>) {
        if self.shortcut_recording.take().is_some() {
            cx.notify();
        }
    }

    pub fn reset_shortcut(&mut self, action_id: &str, cx: &mut Context<Self>) {
        self.shortcut_overrides.remove(action_id);
        if let Err(err) = self.store.clear_shortcut(action_id) {
            eprintln!("loora: failed to clear shortcut: {err}");
        }
        self.shortcut_recording = None;
        Self::rebind_workspace_keys(cx, &self.shortcut_overrides);
        cx.notify();
    }

    pub fn reset_all_shortcuts(&mut self, cx: &mut Context<Self>) {
        self.shortcut_overrides.clear();
        if let Err(err) = self.store.clear_shortcuts() {
            eprintln!("loora: failed to clear shortcuts: {err}");
        }
        self.shortcut_recording = None;
        Self::rebind_workspace_keys(cx, &self.shortcut_overrides);
        cx.notify();
    }

    pub fn focus_shortcut_search(&mut self, cx: &mut Context<Self>) {
        self.shortcut_search_focused = true;
        self.shortcut_recording = None;
        cx.notify();
    }

    fn apply_recorded_shortcut(&mut self, keystroke: &str, cx: &mut Context<Self>) {
        let Some(action_id) = self.shortcut_recording.clone() else {
            return;
        };
        if keystroke.is_empty() || keystroke == "escape" {
            self.cancel_shortcut_recording(cx);
            return;
        }
        if matches!(keystroke, "backspace" | "delete") {
            self.reset_shortcut(&action_id, cx);
            return;
        }
        self.shortcut_overrides
            .insert(action_id.clone(), keystroke.to_string());
        if let Err(err) = self.store.set_shortcut(&action_id, keystroke) {
            eprintln!("loora: failed to persist shortcut: {err}");
        }
        self.shortcut_recording = None;
        Self::rebind_workspace_keys(cx, &self.shortcut_overrides);
        cx.notify();
    }

    fn bind_workspace_keys(cx: &mut Context<Self>, overrides: &HashMap<String, String>) {
        let mut bindings = workspace_key_bindings(overrides);
        bindings.extend([
            KeyBinding::new("cmd-q", WorkspaceQuit, None),
            KeyBinding::new("ctrl-q", WorkspaceQuit, None),
        ]);
        cx.bind_keys(bindings);
    }

    fn rebind_workspace_keys(cx: &mut Context<Self>, overrides: &HashMap<String, String>) {
        cx.clear_key_bindings();
        Self::bind_workspace_keys(cx, overrides);
    }

    pub fn create_design(&mut self, cx: &mut Context<Self>) {
        self.save_now(cx);
        match self.store.create(next_untitled_name(&self.files)) {
            Ok(doc) => {
                self.load_document(doc, cx);
            }
            Err(err) => eprintln!("loora: create design failed: {err}"),
        }
    }

    pub fn open_design(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.engine.document().id == id {
            return;
        }
        self.save_now(cx);
        match self.store.load(id) {
            Ok(doc) => {
                let _ = self.store.set_active(id);
                self.load_document(doc, cx);
            }
            Err(err) => eprintln!("loora: open design failed: {err}"),
        }
    }

    /// Open a file picker for `.loora.json` / `.luuma.json` / Document JSON files.
    pub fn prompt_import_designs(&mut self, cx: &mut Context<Self>) {
        let receiver = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some("Import Loora / Luuma designs".into()),
        });
        let task = cx.spawn(async move |this, cx| {
            let result = receiver.await;
            let paths = match result {
                Ok(Ok(Some(paths))) => paths,
                _ => Vec::new(),
            };
            this.update(cx, |this, cx| {
                if paths.is_empty() {
                    cx.notify();
                    return;
                }
                // A deliberate file-picker import is also the recovery path for
                // a previously broken import, so replace the matching design.
                match this.store.import_paths(&paths, true) {
                    Ok(report) => this.apply_import_report(report, cx),
                    Err(err) => eprintln!("loora: import failed: {err}"),
                }
            })
            .ok();
        });
        self._image_tasks.push(task);
    }

    /// Copy designs from `~/Library/Application Support/Luuma/designs`.
    pub fn import_from_luuma_folder(&mut self, cx: &mut Context<Self>) {
        match self.store.migrate_from_luuma() {
            Ok(report) => self.apply_import_report(report, cx),
            Err(err) => eprintln!("loora: import from Luuma failed: {err}"),
        }
    }

    /// Save the current document to a user-chosen path.
    pub fn prompt_export_design(&mut self, cx: &mut Context<Self>) {
        let suggested = format!("{}.loora.json", self.document_name());
        let dir = self.store.designs_dir();
        let receiver = cx.prompt_for_new_path(&dir, Some(&suggested));
        let task = cx.spawn(async move |this, cx| {
            let result = receiver.await;
            let path = match result {
                Ok(Ok(Some(path))) => path,
                _ => return,
            };
            this.update(cx, |this, cx| {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if ext == "png" {
                    this.pending_png_export = Some(path);
                    let result = this
                        .webview
                        .update(cx, |view, _| view.request_png_export());
                    if let Err(error) = result {
                        this.pending_png_export = None;
                        eprintln!("loora: export failed: {error}");
                    }
                    cx.notify();
                    return;
                }
                let result = match ext.as_str() {
                    "html" | "htm" => {
                        let html = standalone_html(
                            this.engine.document(),
                            &HtmlCanvasOptions::default(),
                        );
                        fs::write(&path, html).map_err(|error| error.to_string())
                    }
                    "svg" => {
                        let svg = export_page_svg(this.engine.document(), None);
                        fs::write(&path, svg).map_err(|error| error.to_string())
                    }
                    _ => {
                        let doc = this.engine.document().clone();
                        this.store
                            .export_document(&doc, &path)
                            .map_err(|e| e.to_string())
                    }
                };
                match result {
                    Ok(()) => eprintln!("loora: exported {}", path.display()),
                    Err(err) => eprintln!("loora: export failed: {err}"),
                }
                cx.notify();
            })
            .ok();
        });
        self._image_tasks.push(task);
    }

    fn apply_import_report(&mut self, report: ImportReport, cx: &mut Context<Self>) {
        for msg in &report.errors {
            eprintln!("loora: import: {msg}");
        }
        for msg in &report.skipped {
            eprintln!("loora: import skipped (already present): {msg}");
        }
        if report.imported.is_empty() && report.errors.is_empty() && report.skipped.is_empty() {
            eprintln!("loora: no designs found to import");
        } else if !report.imported.is_empty() {
            eprintln!(
                "loora: imported {} design{}",
                report.imported.len(),
                if report.imported.len() == 1 { "" } else { "s" }
            );
        }
        self.refresh_files();
        if let Some(first) = report.imported.first() {
            let id = first.id.clone();
            if self.engine.document().id != id {
                self.save_now(cx);
            }
            match self.store.load(&id) {
                Ok(document) => {
                    let _ = self.store.set_active(&id);
                    self.load_document(document, cx);
                }
                Err(err) => eprintln!("loora: reload imported design failed: {err}"),
            }
        } else {
            cx.notify();
        }
    }

    fn load_document(&mut self, doc: loora_engine::Document, cx: &mut Context<Self>) {
        self.engine.replace_document(doc);
        self.saved_revision = self.engine.revision();
        self.dirty = false;
        self.clear_selection();
        self.text_edit = None;
        self._caret_task = None;
        self.collapsed = default_collapsed_layers(&self.engine);
        self.layer_scroll = UniformListScrollHandle::new();
        self.note_collapsed_changed();
        self.camera = Camera::new(Vec2::new(40.0, 40.0), 1.0);
        self.refresh_files();
        self.fit_all_pages(cx);
    }

    pub fn save_now(&mut self, cx: &mut Context<Self>) {
        if self.engine.revision() == self.saved_revision && !self.dirty {
            return;
        }
        let document = self.engine.document().clone();
        match self.store.save(&document) {
            Ok(()) => {
                let _ = self.store.set_active(&document.id);
                self.saved_revision = self.engine.revision();
                self.dirty = false;
                self.refresh_files();
                cx.notify();
            }
            Err(err) => eprintln!("loora: save failed: {err}"),
        }
    }

    fn schedule_autosave(&mut self, cx: &mut Context<Self>) {
        if self.engine.revision() == self.saved_revision {
            return;
        }
        self.dirty = true;
        self._autosave_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(450))
                .await;
            this.update(cx, |this, cx| {
                this.save_now(cx);
            })
            .ok();
        }));
        cx.notify();
    }

    fn note_change(&mut self, cx: &mut Context<Self>) {
        self.schedule_autosave(cx);
    }

    fn refresh_files(&mut self) {
        self.files = self.store.list().unwrap_or_default();
    }

    fn document_name(&self) -> String {
        self.engine.document().name.clone()
    }

    fn document_id(&self) -> String {
        self.engine.document().id.clone()
    }

    pub fn drop_layer(&mut self, dragged: &NodeId, target: &NodeId, cx: &mut Context<Self>) {
        if self.engine.sidebar_drop(dragged, target).is_ok() {
            self.select_only(dragged.clone());
            self.note_change(cx);
        }
    }

    pub fn begin_edit_text(&mut self, id: NodeId, cx: &mut Context<Self>) {
        if let Some(node) = self.engine.node(&id) {
            if node.kind != NodeKind::Text {
                return;
            }
            let len = node.text.as_deref().unwrap_or("").len();
            self.text_edit = Some(TextEditSession::new(id.clone(), len));
            self.select_only(id);
            self.start_caret_blink(cx);
            cx.notify();
        }
    }

    fn end_edit_text(&mut self, cx: &mut Context<Self>) {
        self._caret_task = None;
        if self.text_edit.take().is_some() {
            self.note_change(cx);
        } else {
            cx.notify();
        }
    }

    fn start_caret_blink(&mut self, cx: &mut Context<Self>) {
        self._caret_task = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(530))
                    .await;
                let cont = this
                    .update(cx, |this, cx| {
                        if this.text_edit.is_some() {
                            cx.notify();
                            true
                        } else {
                            false
                        }
                    })
                    .unwrap_or(false);
                if !cont {
                    break;
                }
            }
        }));
    }

    fn apply_text_edit(&mut self, text: String, cx: &mut Context<Self>) -> bool {
        let Some(session) = self.text_edit.as_mut() else {
            return false;
        };
        let id = session.id.clone();
        session.clamp_in_text(&text);
        if self.engine.set_text(&id, text).is_ok() {
            self.dirty = true;
            self.schedule_autosave(cx);
            cx.notify();
            true
        } else {
            false
        }
    }

    fn soft_sync_text_edit(&mut self, id: &NodeId, text: &str, cx: &mut Context<Self>) {
        // Keep the live DOM node (caret/selection) and only refresh CSS + text.
        let document = self.web_runtime_document();
        let options = HtmlCanvasOptions {
            viewport_width: self.active_breakpoint_id.as_ref().and_then(|bid| {
                document
                    .breakpoints
                    .iter()
                    .find(|breakpoint| &breakpoint.id == bid)
                    .map(|breakpoint| breakpoint.preview_width.max(1.0))
            }),
            theme_id: self.preview_mode.then(|| {
                self.preview_theme_id
                    .clone()
                    .unwrap_or_else(|| document.active_theme_id.clone())
            }),
            hidden_nodes: self.preview_hidden.clone(),
            current_page_id: self.preview_mode.then(|| {
                self.preview_current_page
                    .clone()
                    .unwrap_or_else(|| self.engine.root_page_id().clone())
            }),
            overlay_page_id: self
                .preview_mode
                .then(|| self.preview_overlay.clone())
                .flatten(),
            preview: self.preview_mode,
        };
        let compiled = compile_canvas(&document, &options);
        let camera = self.camera;
        let selection = self.selection.clone();
        let tool = self.tool.as_str();
        let preview = self.preview_mode;
        let can_undo = self.engine.can_undo();
        let can_redo = self.engine.can_redo();
        let patch = serde_json::json!({
            "type": "patch-text",
            "id": id.as_str(),
            "text": text,
            "css": compiled.css,
            "camera": {"x": camera.pan.x, "y": camera.pan.y, "zoom": camera.zoom},
            "selection": selection.iter().map(NodeId::as_str).collect::<Vec<_>>(),
            "tool": tool,
            "preview": preview,
            "canUndo": can_undo,
            "canRedo": can_redo,
        });
        let result = self.webview.update(cx, |view, _| {
            view.accept_markup_baseline(&compiled.markup);
            view.command(patch)
        });
        if let Err(error) = result {
            eprintln!("loora: {error}");
            self.note_change(cx);
            return;
        }
        self.web_document_key = Some(self.current_web_document_key());
        self.web_state_key = Some(self.current_web_state_key());
        self.note_change(cx);
    }

    fn open_image_picker(&mut self, id: NodeId, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        self.image_picker = Some(ImagePickerState {
            node_id: id,
            mode: ImagePickerMode::Choose,
            url: String::new(),
        });
        self.image_url_edit = None;
        self.command_open = false;
        self.command_edit = None;
        self.text_edit = None;
        self.layer_search_focused = false;
        self.layer_search_edit = None;
        self.clear_props_focus();
        cx.notify();
    }

    pub fn close_image_picker(&mut self, cx: &mut Context<Self>) {
        if self.image_picker.take().is_some() {
            self.image_url_edit = None;
            cx.notify();
        }
    }

    pub fn pick_image_from_folder(&mut self, cx: &mut Context<Self>) {
        let Some(state) = self.image_picker.clone() else {
            return;
        };
        let id = state.node_id;
        self.image_picker = None;
        self.image_url_edit = None;
        self.prompt_image_for_node(id, cx);
        cx.notify();
    }

    pub fn begin_image_url_input(&mut self, cx: &mut Context<Self>) {
        if let Some(state) = self.image_picker.as_mut() {
            state.mode = ImagePickerMode::Url;
            state.url.clear();
            self.image_url_edit = Some(TextCursor::at_end(0));
            cx.notify();
        }
    }

    pub fn focus_image_url_input(
        &mut self,
        click_count: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(state) = self.image_picker.as_ref() else {
            return;
        };
        if state.mode != ImagePickerMode::Url {
            return;
        }
        let text_len = state.url.len();
        let cursor = self
            .image_url_edit
            .get_or_insert_with(|| TextCursor::at_end(text_len));
        if click_count >= 2 {
            cursor.select_all(text_len);
        } else {
            cursor.set_caret(text_len, false);
        }
        self.focus_handle.focus(window, cx);
        cx.notify();
    }

    pub fn blur_image_url_input(&mut self, cx: &mut Context<Self>) {
        if self.image_url_edit.take().is_some() {
            cx.notify();
        }
    }

    pub fn image_picker_back(&mut self, cx: &mut Context<Self>) {
        if let Some(state) = self.image_picker.as_mut() {
            state.mode = ImagePickerMode::Choose;
            state.url.clear();
            self.image_url_edit = None;
            cx.notify();
        }
    }

    pub fn apply_image_url(&mut self, cx: &mut Context<Self>) {
        let Some(state) = self.image_picker.clone() else {
            return;
        };
        let url = state.url.trim().to_string();
        if !is_http_url(&url) {
            return;
        }
        let id = state.node_id;
        self.image_picker = None;
        self.image_url_edit = None;
        self.fetch_and_set_image_url(id, url, cx);
        cx.notify();
    }

    fn fetch_and_set_image_url(&mut self, id: NodeId, url: String, cx: &mut Context<Self>) {
        if self.engine.set_image_path(&id, Some(url)).is_ok() {
            self.note_change(cx);
        }
    }

    fn prompt_image_for_node(&mut self, id: NodeId, cx: &mut Context<Self>) {
        let receiver = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose image".into()),
        });
        let task = cx.spawn(async move |this, cx| {
            let result = receiver.await;
            let path = match result {
                Ok(Ok(Some(mut paths))) => paths.pop(),
                _ => None,
            };
            this.update(cx, |this, cx| {
                if let Some(path) = path {
                    match this.store.import_asset_file(&path) {
                        Ok(stored) => {
                            let path_str = stored.to_string_lossy().to_string();
                            let _ = this.engine.set_image_path(&id, Some(path_str));
                            this.note_change(cx);
                        }
                        Err(error) => {
                            eprintln!("loora: import asset failed: {error}");
                            cx.notify();
                        }
                    }
                } else {
                    cx.notify();
                }
            })
            .ok();
        });
        self._image_tasks.push(task);
    }

    /// Apply an already-imported library asset to the current image picker target.
    pub fn apply_library_asset(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let Some(state) = self.image_picker.take() else {
            return;
        };
        let path_str = path.to_string_lossy().to_string();
        if self
            .engine
            .set_image_path(&state.node_id, Some(path_str))
            .is_ok()
        {
            self.note_change(cx);
        } else {
            cx.notify();
        }
    }

    pub fn library_assets(&self) -> Vec<PathBuf> {
        self.store.list_assets().unwrap_or_default()
    }

    pub fn set_tool(&mut self, tool: CanvasTool, cx: &mut Context<Self>) {
        if tool == CanvasTool::Preview {
            self.preview_mode = !self.preview_mode;
            if self.preview_mode {
                self.tool = CanvasTool::Preview;
                self.reset_preview_runtime();
            } else {
                self.tool = CanvasTool::Select;
                self.clear_preview_runtime();
            }
        } else {
            self.preview_mode = false;
            self.tool = tool;
            self.clear_preview_runtime();
        }
        cx.notify();
    }

    fn reset_preview_runtime(&mut self) {
        self.preview_hidden.clear();
        self.preview_states.clear();
        for node in self.engine.document().nodes.values() {
            for state in node.states.values() {
                self.preview_states
                    .insert(state.id.clone(), state.initial.clone());
            }
        }
        self.preview_variants.clear();
        self.preview_theme_id = Some(self.engine.document().active_theme_id.clone());
        self.preview_hovered = None;
        self.preview_hover_started_at = None;
        self.preview_hover_exited = None;
        self.preview_pressed = None;
        self.preview_press_started_at = None;
        self.preview_focused = None;
        self.preview_current_page = Some(self.engine.root_page_id().clone());
        self.preview_overlay = None;
        self.preview_started_at = Instant::now();
        self.preview_runtime_generation = self.preview_runtime_generation.wrapping_add(1);
    }

    fn clear_preview_runtime(&mut self) {
        self.preview_hidden.clear();
        self.preview_states.clear();
        self.preview_variants.clear();
        self.preview_theme_id = None;
        self.preview_hovered = None;
        self.preview_hover_started_at = None;
        self.preview_hover_exited = None;
        self.preview_pressed = None;
        self.preview_press_started_at = None;
        self.preview_focused = None;
        self.preview_current_page = None;
        self.preview_overlay = None;
        self.preview_runtime_generation = self.preview_runtime_generation.wrapping_add(1);
    }

    fn preview_condition_matches(&self, condition: &StateCondition) -> bool {
        let equal = self.preview_states.get(&condition.state_id) == Some(&condition.value);
        match condition.operator.as_str() {
            "not-equals" | "not_equals" => !equal,
            _ => equal,
        }
    }

    fn dispatch_preview_trigger(
        &mut self,
        node_id: &NodeId,
        trigger: InteractionTrigger,
        changed_state: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        self.dispatch_preview_trigger_inner(node_id, trigger, changed_state, cx, 0);
    }

    fn dispatch_preview_trigger_inner(
        &mut self,
        node_id: &NodeId,
        trigger: InteractionTrigger,
        changed_state: Option<&str>,
        cx: &mut Context<Self>,
        depth: usize,
    ) {
        if depth >= 8 {
            return;
        }
        let interactions = self
            .engine
            .node(node_id)
            .map(|node| node.interactions.clone())
            .unwrap_or_default();
        let mut changed_states = Vec::new();
        let mut changed_visuals = false;
        for interaction in interactions {
            if interaction.trigger != trigger {
                continue;
            }
            if trigger == InteractionTrigger::StateChange {
                if let (Some(expected), Some(changed)) =
                    (interaction.state_id.as_deref(), changed_state)
                {
                    if expected != changed {
                        continue;
                    }
                }
            }
            if !interaction
                .when
                .iter()
                .all(|condition| self.preview_condition_matches(condition))
            {
                continue;
            }
            for action in interaction.actions {
                match action {
                    CanvasAction::OpenUrl { url, .. } => {
                        #[cfg(target_os = "macos")]
                        {
                            let _ = std::process::Command::new("open").arg(&url).spawn();
                        }
                        #[cfg(not(target_os = "macos"))]
                        eprintln!("loora preview open-url: {url}");
                    }
                    CanvasAction::Navigate { page_id } => {
                        self.preview_overlay = None;
                        let page = NodeId::from(page_id.as_str());
                        self.preview_current_page = Some(page.clone());
                        self.focus_page(&page, cx);
                    }
                    CanvasAction::Visibility { node_id, value } => {
                        let target = NodeId::from(node_id.as_str());
                        match value.as_str() {
                            "show" => {
                                self.preview_hidden.remove(&target);
                            }
                            "hide" => {
                                self.preview_hidden.insert(target);
                            }
                            _ => {
                                if !self.preview_hidden.remove(&target) {
                                    self.preview_hidden.insert(target);
                                }
                            }
                        }
                        changed_visuals = true;
                    }
                    CanvasAction::OpenOverlay { page_id } => {
                        let page = NodeId::from(page_id.as_str());
                        self.preview_overlay = Some(page.clone());
                        changed_visuals = true;
                    }
                    CanvasAction::CloseOverlay => {
                        self.preview_overlay = None;
                        changed_visuals = true;
                    }
                    CanvasAction::SetVariant {
                        instance_id,
                        variant,
                    } => {
                        self.preview_variants
                            .insert(NodeId::from(instance_id.as_str()), variant);
                        changed_visuals = true;
                    }
                    CanvasAction::SetState { state_id, value } => {
                        if self.preview_states.get(&state_id) != Some(&value) {
                            self.preview_states.insert(state_id.clone(), value);
                            changed_states.push(state_id);
                        }
                    }
                    CanvasAction::ToggleState { state_id } => {
                        let next = match self.preview_states.get(&state_id) {
                            Some(StateValue::Boolean(value)) => StateValue::Boolean(!value),
                            _ => StateValue::Boolean(true),
                        };
                        self.preview_states.insert(state_id.clone(), next);
                        changed_states.push(state_id);
                    }
                    CanvasAction::IncrementState { state_id, amount } => {
                        let current = match self.preview_states.get(&state_id) {
                            Some(StateValue::Number(value)) => *value,
                            _ => 0.0,
                        };
                        self.preview_states
                            .insert(state_id.clone(), StateValue::Number(current + amount));
                        changed_states.push(state_id);
                    }
                    CanvasAction::SetTheme { theme_id } => {
                        self.preview_theme_id = Some(theme_id);
                        changed_visuals = true;
                    }
                }
            }
        }
        if changed_visuals || !changed_states.is_empty() {
            self.preview_runtime_generation = self.preview_runtime_generation.wrapping_add(1);
            cx.notify();
        }
        for state_id in changed_states {
            let targets: Vec<NodeId> = self
                .engine
                .document()
                .nodes
                .values()
                .filter(|node| {
                    node.interactions.iter().any(|interaction| {
                        interaction.trigger == InteractionTrigger::StateChange
                            && interaction
                                .state_id
                                .as_deref()
                                .map(|expected| expected == state_id)
                                .unwrap_or(true)
                    })
                })
                .map(|node| node.id.clone())
                .collect();
            for target in targets {
                self.dispatch_preview_trigger_inner(
                    &target,
                    InteractionTrigger::StateChange,
                    Some(&state_id),
                    cx,
                    depth + 1,
                );
            }
        }
    }

    /// True when a faux text field is capturing keystrokes (props, search, etc.).
    fn typing_capture_active(&self) -> bool {
        self.props_focus.is_some()
            || self.layer_search_edit.is_some()
            || self.layer_rename_edit.is_some()
            || self.text_edit.is_some()
            || self.command_open
            || matches!(
                self.image_picker.as_ref().map(|picker| &picker.mode),
                Some(ImagePickerMode::Url)
            )
    }

    /// Absorb a single-letter tool binding into the active text draft.
    /// GPUI actions stop key propagation by default, so hex chars like `f`/`t`
    /// never reach `on_props_key_down` unless we handle them here.
    fn capture_typing_char(&mut self, ch: &str, cx: &mut Context<Self>) -> bool {
        if !self.typing_capture_active() {
            return false;
        }
        if let Some(mut cursor) = self.layer_rename_edit.take() {
            text_edit::insert(&mut self.layer_rename_draft, &mut cursor, ch);
            self.layer_rename_edit = Some(cursor);
            cx.notify();
            return true;
        }
        if self.props_focus.is_some() {
            if let Some(mut session) = self.props_text_edit.take() {
                text_edit::insert(&mut self.props_draft, &mut session, ch);
                self.props_text_edit = Some(session);
            } else {
                self.props_draft.push_str(ch);
            }
            cx.notify();
            return true;
        }
        if let Some(mut cursor) = self.layer_search_edit.take() {
            text_edit::insert(&mut self.layer_query, &mut cursor, ch);
            self.layer_search_edit = Some(cursor);
            cx.notify();
            return true;
        }
        if self.command_open {
            if let Some(mut cursor) = self.command_edit.take() {
                text_edit::insert(&mut self.command_query, &mut cursor, ch);
                self.command_edit = Some(cursor);
                self.command_index = 0;
                cx.notify();
            }
            return true;
        }
        if matches!(
            self.image_picker.as_ref().map(|picker| &picker.mode),
            Some(ImagePickerMode::Url)
        ) {
            if let Some(mut cursor) = self.image_url_edit.take() {
                if let Some(state) = self.image_picker.as_mut() {
                    text_edit::insert(&mut state.url, &mut cursor, ch);
                    self.image_url_edit = Some(cursor);
                    cx.notify();
                }
            }
            return true;
        }
        if let Some(session) = self.text_edit.clone() {
            if let Some(node) = self.engine.node(&session.id).cloned() {
                let mut text = node.text.unwrap_or_default();
                let mut session = session;
                text_edit::insert(&mut text, &mut session, ch);
                self.text_edit = Some(session);
                return self.apply_text_edit(text, cx);
            }
        }
        false
    }

    pub fn primary_selection(&self) -> Option<NodeId> {
        self.selection.last().cloned()
    }

    pub fn is_selected(&self, id: &NodeId) -> bool {
        self.selection.contains(id)
    }

    pub fn select_only(&mut self, id: NodeId) {
        self.selection.clear();
        self.selection.push(id.clone());
        self.reveal_layer(&id);
    }

    pub fn clear_selection(&mut self) {
        self.selection.clear();
    }

    pub fn toggle_selection(&mut self, id: NodeId) {
        if let Some(index) = self.selection.iter().position(|selected| selected == &id) {
            self.selection.remove(index);
        } else {
            self.selection.push(id.clone());
            self.reveal_layer(&id);
        }
    }

    fn reveal_layer(&mut self, id: &NodeId) {
        let mut parent = self
            .engine
            .node(id)
            .and_then(|node| node.parent_id.clone());
        let mut expanded = false;
        while let Some(parent_id) = parent {
            if self.collapsed.remove(&parent_id) {
                expanded = true;
            }
            parent = self
                .engine
                .node(&parent_id)
                .and_then(|node| node.parent_id.clone());
        }

        if expanded {
            self.note_collapsed_changed();
        }
        if let Some(index) = self.cached_layer_rows().iter().position(|row| &row.id == id) {
            self.layer_scroll
                .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
        }
    }

    pub fn select(&mut self, id: Option<NodeId>, cx: &mut Context<Self>) {
        self.commit_layer_rename_if_needed(cx);
        self.blur_props_if_needed(cx);
        if let Some(id) = id {
            self.select_only(id);
        } else {
            self.clear_selection();
        }
        self.clear_props_focus();
        cx.notify();
    }

    pub fn begin_layer_rename(&mut self, id: NodeId, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        self.blur_layer_search(cx);
        let Some(node) = self.engine.node(&id) else {
            return;
        };
        self.layer_rename_draft = node.name.clone();
        self.layer_rename = Some(id.clone());
        self.layer_rename_edit = Some(TextCursor::selecting_all(self.layer_rename_draft.len()));
        self.select_only(id);
        self.clear_props_focus();
        cx.notify();
    }

    pub fn commit_layer_rename(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.layer_rename.take() else {
            return;
        };
        self.layer_rename_edit = None;
        let name = self.layer_rename_draft.trim().to_string();
        self.layer_rename_draft.clear();
        if name.is_empty() {
            cx.notify();
            return;
        }
        if self.engine.rename_node(&id, name).is_ok() {
            self.note_change(cx);
        } else {
            cx.notify();
        }
    }

    pub fn cancel_layer_rename(&mut self, cx: &mut Context<Self>) {
        if self.layer_rename.take().is_some() {
            self.layer_rename_draft.clear();
            self.layer_rename_edit = None;
            cx.notify();
        }
    }

    pub fn focus_layer_rename(
        &mut self,
        click_count: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.layer_rename.is_none() {
            return;
        }
        let cursor = self
            .layer_rename_edit
            .get_or_insert_with(|| TextCursor::at_end(self.layer_rename_draft.len()));
        if click_count >= 2 {
            cursor.select_all(self.layer_rename_draft.len());
        } else {
            cursor.set_caret(self.layer_rename_draft.len(), false);
        }
        self.focus_handle.focus(window, cx);
        cx.notify();
    }

    fn commit_layer_rename_if_needed(&mut self, cx: &mut Context<Self>) {
        if self.layer_rename.is_some() {
            self.commit_layer_rename(cx);
        }
    }

    pub fn layer_rename_state(&self) -> Option<(&NodeId, &str)> {
        self.layer_rename
            .as_ref()
            .map(|id| (id, self.layer_rename_draft.as_str()))
    }

    pub fn toggle_collapsed(&mut self, id: &NodeId, cx: &mut Context<Self>) {
        if !self.collapsed.remove(id) {
            self.collapsed.insert(id.clone());
        }
        self.note_collapsed_changed();
        cx.notify();
    }

    pub fn set_layer_query(&mut self, query: String, cx: &mut Context<Self>) {
        self.layer_query = query;
        self.invalidate_layer_rows();
        cx.notify();
    }

    pub fn focus_layer_search(
        &mut self,
        click_count: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.commit_layer_rename_if_needed(cx);
        self.blur_props_if_needed(cx);
        self.layer_search_focused = true;
        let cursor = self
            .layer_search_edit
            .get_or_insert_with(|| TextCursor::at_end(self.layer_query.len()));
        if click_count >= 2 {
            cursor.select_all(self.layer_query.len());
        } else {
            cursor.set_caret(self.layer_query.len(), false);
        }
        self.text_edit = None;
        self.clear_props_focus();
        self.focus_handle.focus(window, cx);
        cx.notify();
    }

    pub fn blur_layer_search(&mut self, cx: &mut Context<Self>) {
        if self.layer_search_focused {
            self.layer_search_focused = false;
            self.layer_search_edit = None;
            cx.notify();
        }
    }

    fn clear_props_focus(&mut self) {
        self.props_focus = None;
        self.props_draft.clear();
        self.props_text_edit = None;
        self.props_scrub = None;
    }

    /// Commit the active property draft (if any) and clear focus.
    pub fn blur_props_if_needed(&mut self, cx: &mut Context<Self>) {
        if self.props_focus.is_none() && self.props_scrub.is_none() {
            return;
        }
        if self.props_focus.is_some() {
            self.commit_props_draft(cx);
        } else {
            self.clear_props_focus();
            cx.notify();
        }
    }

    fn props_view(&self) -> PropsView {
        let readonly = self.preview_mode
            || self
                .selection
                .iter()
                .any(|id| self.engine.node(id).map(|node| node.locked).unwrap_or(true));
        PropsView {
            focus: self.props_focus,
            draft: self.props_draft.clone(),
            selection: self
                .props_text_edit
                .as_ref()
                .map(|session| (session.anchor, session.caret)),
            readonly,
            collapsed: self.props_collapsed.clone(),
        }
    }

    pub fn toggle_props_section(&mut self, title: &'static str, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if !self.props_collapsed.remove(title) {
            self.props_collapsed.insert(title);
        }
        cx.notify();
    }

    pub fn focus_props_field(
        &mut self,
        field: PropsField,
        click_count: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.preview_mode {
            return;
        }
        if self.props_focus == Some(field) {
            if let Some(session) = self.props_text_edit.as_mut() {
                if click_count >= 2 {
                    session.select_all(self.props_draft.len());
                } else {
                    session.set_caret(self.props_draft.len(), false);
                }
            }
            self.focus_handle.focus(window, cx);
            cx.notify();
            return;
        }
        self.commit_layer_rename_if_needed(cx);
        let Some(id) = self.primary_selection() else {
            return;
        };
        let Some(node) = self.engine.node(&id).cloned() else {
            return;
        };
        if node.locked {
            return;
        }
        // Switching fields: commit the previous draft first.
        if self.props_focus.is_some() {
            self.commit_props_draft(cx);
        }
        self.layer_search_focused = false;
        self.layer_search_edit = None;
        self.text_edit = None;
        self.command_open = false;
        self.command_edit = None;
        self.props_scrub = None;
        self.color_picker = None;
        self.props_focus = Some(field);
        self.props_draft = self.props_field_value(&node, field);
        let mut session = TextCursor::at_end(self.props_draft.len());
        if click_count >= 2 {
            session.select_all(self.props_draft.len());
        }
        self.props_text_edit = Some(session);
        // Keep workspace key focus so typed hex / numbers reach on_key_down.
        self.focus_handle.focus(window, cx);
        cx.notify();
    }

    pub fn open_color_picker(
        &mut self,
        field: PropsField,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.preview_mode {
            return;
        }
        if self.color_picker.as_ref().map(|s| s.field) == Some(field) {
            self.close_color_picker(cx);
            return;
        }
        let Some(id) = self.primary_selection() else {
            return;
        };
        let Some(node) = self.engine.node(&id).cloned() else {
            return;
        };
        if node.locked {
            return;
        }
        self.blur_props_if_needed(cx);
        let color = match field {
            PropsField::Fill => node
                .style
                .solid_fill()
                .unwrap_or(Color::rgb(0x7a, 0xa2, 0xf7)),
            PropsField::StrokeColor => node
                .style
                .stroke
                .as_ref()
                .map(|s| s.color)
                .unwrap_or(Color::rgb(0xff, 0xff, 0xff)),
            PropsField::ShadowColor => node
                .style
                .shadows
                .first()
                .map(|s| s.color)
                .unwrap_or(Color::rgba(0.0, 0.0, 0.0, 0.4)),
            PropsField::TextColor => node.effective_typography().color,
            PropsField::VectorFill => node
                .paths
                .first()
                .and_then(|p| p.fill)
                .unwrap_or(Color::rgb(0x7a, 0xa2, 0xf7)),
            _ => Color::rgb(0x7a, 0xa2, 0xf7),
        };
        self.color_picker = Some(ColorPickerState { field, color });
        self.focus_handle.focus(window, cx);
        cx.notify();
    }

    pub fn close_color_picker(&mut self, cx: &mut Context<Self>) {
        if self.color_picker.take().is_some() {
            cx.notify();
        }
    }

    pub fn close_context_menu(&mut self, cx: &mut Context<Self>) {
        if self.context_menu.take().is_some() {
            cx.notify();
        }
    }

    /// Open an inspector enum menu at the click position.
    pub fn open_enum_menu(
        &mut self,
        position: Point<Pixels>,
        entries: Vec<ContextMenuEntry>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.blur_props_if_needed(cx);
        let highlight = first_action_index(&entries);
        self.context_menu = Some(ContextMenuState {
            position,
            highlight,
            entries,
        });
        self.webview.update(cx, |view, _| {
            let _ = view.command(serde_json::json!({ "type": "dismiss-context-menu" }));
        });
        self.focus_handle.focus(window, cx);
        cx.notify();
    }

    fn context_menu_entries(&self, cx: &Context<Self>) -> Vec<ContextMenuEntry> {
        let has_clipboard = self.can_paste(cx);
        let editable: Vec<&Node> = self
            .selection
            .iter()
            .filter_map(|id| self.engine.node(id))
            .collect();
        let has_selection = !editable.is_empty();
        let can_edit = editable.iter().any(|n| !n.locked);
        let all_locked = has_selection && editable.iter().all(|n| n.locked);
        let any_hidden = editable.iter().any(|n| n.hidden);
        let any_unlocked = editable.iter().any(|n| !n.locked);
        let can_group = editable.len() >= 2
            && editable.iter().all(|n| !n.locked)
            && {
                let parent = editable[0].parent_id.clone();
                editable.iter().all(|n| n.parent_id == parent)
            };
        let can_ungroup = editable
            .iter()
            .any(|n| n.kind == NodeKind::Frame && !n.locked);

        if !has_selection {
            return vec![
                ContextMenuEntry::Action(
                    ContextMenuAction::new("paste", "Paste")
                        .shortcut("⌘V")
                        .icon(IconName::ClipboardPaste)
                        .enabled(has_clipboard),
                ),
                ContextMenuEntry::Separator,
                ContextMenuEntry::Action(
                    ContextMenuAction::new("select-all", "Select all")
                        .shortcut("⌘A")
                        .icon(IconName::BoundingBox),
                ),
                ContextMenuEntry::Action(
                    ContextMenuAction::new("fit-all", "Fit all frames")
                        .shortcut("⌘2")
                        .icon(IconName::View),
                ),
                ContextMenuEntry::Action(
                    ContextMenuAction::new("zoom-reset", "Reset zoom")
                        .shortcut("⌘0")
                        .icon(IconName::View),
                ),
            ];
        }

        vec![
            ContextMenuEntry::Action(
                ContextMenuAction::new("cut", "Cut")
                    .shortcut("⌘X")
                    .icon(IconName::Scissors)
                    .enabled(can_edit),
            ),
            ContextMenuEntry::Action(
                ContextMenuAction::new("copy", "Copy")
                    .shortcut("⌘C")
                    .icon(IconName::Copy),
            ),
            ContextMenuEntry::Action(
                ContextMenuAction::new("paste", "Paste")
                    .shortcut("⌘V")
                    .icon(IconName::ClipboardPaste)
                    .enabled(has_clipboard),
            ),
            ContextMenuEntry::Action(
                ContextMenuAction::new("duplicate", "Duplicate")
                    .shortcut("⌘D")
                    .icon(IconName::Duplicate)
                    .enabled(can_edit),
            ),
            ContextMenuEntry::Separator,
            ContextMenuEntry::Action(
                ContextMenuAction::new("group", "Group")
                    .shortcut("⌘G")
                    .icon(IconName::GroupItems)
                    .enabled(can_group),
            ),
            ContextMenuEntry::Action(
                ContextMenuAction::new("ungroup", "Ungroup")
                    .shortcut("⌘⇧G")
                    .icon(IconName::UngroupItems)
                    .enabled(can_ungroup),
            ),
            ContextMenuEntry::Separator,
            ContextMenuEntry::Action(
                ContextMenuAction::new("bring-front", "Bring to front")
                    .shortcut("⌘]")
                    .icon(IconName::BringToFront)
                    .enabled(can_edit),
            ),
            ContextMenuEntry::Action(
                ContextMenuAction::new("bring-forward", "Bring forward")
                    .icon(IconName::BringForward)
                    .enabled(can_edit),
            ),
            ContextMenuEntry::Action(
                ContextMenuAction::new("send-backward", "Send backward")
                    .icon(IconName::SendBackward)
                    .enabled(can_edit),
            ),
            ContextMenuEntry::Action(
                ContextMenuAction::new("send-back", "Send to back")
                    .shortcut("⌘[")
                    .icon(IconName::SendToBack)
                    .enabled(can_edit),
            ),
            ContextMenuEntry::Separator,
            ContextMenuEntry::Action(
                ContextMenuAction::new("fit-selection", "Fit selection")
                    .shortcut("⌘1")
                    .icon(IconName::View),
            ),
            ContextMenuEntry::Separator,
            ContextMenuEntry::Action(
                ContextMenuAction::new(
                    if all_locked { "unlock" } else { "lock" },
                    if all_locked { "Unlock" } else { "Lock" },
                )
                .shortcut("⌘L")
                .icon(if all_locked {
                    IconName::Unlock
                } else {
                    IconName::Lock
                })
                .enabled(has_selection),
            ),
            ContextMenuEntry::Action(
                ContextMenuAction::new(
                    if any_hidden { "show" } else { "hide" },
                    if any_hidden { "Show" } else { "Hide" },
                )
                .icon(if any_hidden {
                    IconName::View
                } else {
                    IconName::ViewOff
                })
                .enabled(any_unlocked || any_hidden),
            ),
            ContextMenuEntry::Separator,
            ContextMenuEntry::Action(
                ContextMenuAction::new("delete", "Delete")
                    .shortcut("⌫")
                    .icon(IconName::Delete)
                    .enabled(can_edit)
                    .destructive(),
            ),
        ]
    }

    pub fn run_context_action(&mut self, action: &str, cx: &mut Context<Self>) {
        self.close_context_menu(cx);
        match action {
            "cut" => {
                self.copy_selection(cx);
                let _ = self.delete_selection(cx);
            }
            "copy" => {
                self.copy_selection(cx);
                cx.notify();
            }
            "paste" => {
                self.paste_clipboard(cx);
            }
            "duplicate" => {
                self.duplicate_selection(cx);
            }
            "bring-front" => {
                for id in self.selection.clone() {
                    let _ = self.engine.bring_to_front_history(&id);
                }
                self.note_change(cx);
            }
            "bring-forward" => {
                for id in self.selection.clone() {
                    let _ = self.engine.bring_forward(&id);
                }
                self.note_change(cx);
            }
            "send-backward" => {
                for id in self.selection.clone() {
                    let _ = self.engine.send_backward(&id);
                }
                self.note_change(cx);
            }
            "send-back" => {
                for id in self.selection.clone() {
                    let _ = self.engine.send_to_back(&id);
                }
                self.note_change(cx);
            }
            "lock" => {
                for id in self.selection.clone() {
                    let _ = self.engine.set_locked(&id, true);
                }
                self.note_change(cx);
            }
            "unlock" => {
                for id in self.selection.clone() {
                    let _ = self.engine.set_locked(&id, false);
                }
                self.note_change(cx);
            }
            "hide" => {
                for id in self.selection.clone() {
                    let _ = self.engine.set_hidden(&id, true);
                }
                self.note_change(cx);
            }
            "show" => {
                for id in self.selection.clone() {
                    let _ = self.engine.set_hidden(&id, false);
                }
                self.note_change(cx);
            }
            "delete" => {
                let _ = self.delete_selection(cx);
            }
            "select-all" => {
                self.select_all_on_page(cx);
            }
            "zoom-reset" => {
                self.camera.zoom = 1.0;
                cx.notify();
            }
            "fit-selection" => {
                self.fit_selection_or_page(cx);
            }
            "fit-all" => {
                self.fit_all_pages(cx);
            }
            "group" => {
                self.group_selection(cx);
            }
            "ungroup" => {
                self.ungroup_selection(cx);
            }
            other => {
                if let Some(rest) = other.strip_prefix("enum:") {
                    self.apply_enum_action(rest, cx);
                }
            }
        }
    }

    fn apply_enum_action(&mut self, action: &str, cx: &mut Context<Self>) {
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        if let Some(mode) = action.strip_prefix("mode:") {
            let mode = match mode {
                "absolute" => LayoutMode::Absolute,
                "flex" => LayoutMode::Flex,
                "grid" => LayoutMode::Grid,
                _ => return,
            };
            for id in self.selection.clone() {
                let Some(node) = self.engine.node(&id).cloned() else {
                    continue;
                };
                if !matches!(node.kind, NodeKind::Frame | NodeKind::Component) || node.locked {
                    continue;
                }
                let mut layout = node.layout;
                layout.mode = mode;
                let is_stack = matches!(mode, LayoutMode::Flex | LayoutMode::Grid);
                if self.engine.set_layout(&id, layout, None).is_ok() {
                    if is_stack {
                        let children: Vec<NodeId> = self
                            .engine
                            .children(Some(&id))
                            .into_iter()
                            .map(|c| c.id.clone())
                            .collect();
                        for child in children {
                            if let Some(child_node) = self.engine.node(&child).cloned() {
                                let mut child_layout = child_node.layout;
                                child_layout.position = LayoutPosition::Flow;
                                let _ = self.engine.set_layout(&child, child_layout, None);
                            }
                        }
                    }
                    let _ = self.engine.resolve_stack(&id);
                    changed = true;
                }
            }
        } else if let Some(dir) = action.strip_prefix("direction:") {
            let dir = match dir {
                "row" => FlexDirection::Row,
                "column" => FlexDirection::Column,
                _ => return,
            };
            changed = self.patch_selected_layout_bool(|layout| {
                layout.direction = dir;
            });
        } else if let Some(align) = action.strip_prefix("align:") {
            let align = match align {
                "start" => LayoutAlign::Start,
                "center" => LayoutAlign::Center,
                "end" => LayoutAlign::End,
                "stretch" => LayoutAlign::Stretch,
                _ => return,
            };
            changed = self.patch_selected_layout_bool(|layout| {
                layout.align = align;
            });
        } else if let Some(justify) = action.strip_prefix("justify:") {
            let justify = match justify {
                "start" => LayoutJustify::Start,
                "center" => LayoutJustify::Center,
                "end" => LayoutJustify::End,
                "between" => LayoutJustify::SpaceBetween,
                "around" => LayoutJustify::SpaceAround,
                _ => return,
            };
            changed = self.patch_selected_layout_bool(|layout| {
                layout.justify = justify;
            });
        } else if let Some(style) = action.strip_prefix("stroke:") {
            let style = match style {
                "solid" => StrokeStyle::Solid,
                "dashed" => StrokeStyle::Dashed,
                "dotted" => StrokeStyle::Dotted,
                _ => return,
            };
            for id in self.selection.clone() {
                let Some(node) = self.engine.node(&id).cloned() else {
                    continue;
                };
                if node.locked {
                    continue;
                }
                let mut stroke = node
                    .style
                    .stroke
                    .unwrap_or_else(|| Stroke::solid(Color::rgb(0xff, 0xff, 0xff), 1.0));
                stroke.style = style;
                changed |= self
                    .engine
                    .set_stroke(&id, Some(stroke), None)
                    .is_ok();
            }
        } else if let Some(axis) = action.strip_prefix("wmode:") {
            let mode = match axis {
                "fixed" => SizeMode::Fixed,
                "hug" => SizeMode::Hug,
                "fill" => SizeMode::Fill,
                _ => return,
            };
            changed = self.patch_selected_layout_bool(|layout| {
                layout.width_mode = mode;
                if mode == SizeMode::Fill {
                    layout.grow = layout.grow.max(1.0);
                }
            });
        } else if let Some(axis) = action.strip_prefix("hmode:") {
            let mode = match axis {
                "fixed" => SizeMode::Fixed,
                "hug" => SizeMode::Hug,
                "fill" => SizeMode::Fill,
                _ => return,
            };
            changed = self.patch_selected_layout_bool(|layout| {
                layout.height_mode = mode;
            });
        } else if let Some(name) = action.strip_prefix("variant:") {
            for id in self.selection.clone() {
                changed |= self
                    .engine
                    .set_variant(&id, Some(name.to_string()))
                    .is_ok();
            }
        }
        if changed {
            self.note_change(cx);
        }
    }

    fn patch_selected_layout_bool(&mut self, f: impl Fn(&mut Layout)) -> bool {
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let mut layout = node.layout;
            f(&mut layout);
            if self.engine.set_layout(&id, layout, None).is_ok() {
                changed = true;
            }
        }
        changed
    }

    fn copy_selection(&mut self, cx: &mut Context<Self>) {
        let mut nodes = Vec::new();
        let mut seen = HashSet::new();
        for id in &self.selection {
            if self.engine.node(id).is_none() {
                continue;
            }
            let mut stack = vec![id.clone()];
            while let Some(cur) = stack.pop() {
                if !seen.insert(cur.clone()) {
                    continue;
                }
                if let Some(node) = self.engine.node(&cur).cloned() {
                    for child in self.engine.children(Some(&cur)) {
                        stack.push(child.id.clone());
                    }
                    nodes.push(node);
                }
            }
        }
        if !nodes.is_empty() {
            self.clipboard = nodes;
            self.paste_nudge = 0;
            if let Ok(json) = serde_json::to_string(&self.clipboard) {
                let payload = format!("{CLIPBOARD_PREFIX}{json}");
                cx.write_to_clipboard(ClipboardItem::new_string(payload));
            }
        }
    }

    fn can_paste(&self, cx: &Context<Self>) -> bool {
        if !self.clipboard.is_empty() {
            return true;
        }
        let Some(item) = cx.read_from_clipboard() else {
            return false;
        };
        for entry in item.entries() {
            match entry {
                ClipboardEntry::Image(image) if !image.bytes().is_empty() => return true,
                ClipboardEntry::ExternalPaths(paths)
                    if paths.0.iter().any(|p| is_pasteable_image_path(p)) =>
                {
                    return true;
                }
                ClipboardEntry::String(s) => {
                    let text = s.text.trim();
                    if text.is_empty() {
                        continue;
                    }
                    if text.starts_with(CLIPBOARD_PREFIX) {
                        return true;
                    }
                    // Plain text is pasteable as a text layer.
                    return true;
                }
                _ => {}
            }
        }
        false
    }

    fn paste_anchor(&self) -> Vec2 {
        let nudge = (self.paste_nudge as f64) * 16.0;
        let base = self
            .context_world
            .or(self.last_pointer_world)
            .unwrap_or_else(|| {
                let vb = self.viewport_bounds.get();
                let screen = Vec2::new(
                    f32::from(vb.size.width) as f64 * 0.5,
                    f32::from(vb.size.height) as f64 * 0.5,
                );
                self.camera.screen_to_world(screen)
            });
        Vec2::new(base.x + nudge, base.y + nudge)
    }

    fn paste_clipboard(&mut self, cx: &mut Context<Self>) {
        // Prefer system clipboard contents (images, files, loora nodes, text).
        if let Some(item) = cx.read_from_clipboard() {
            let mut loora_nodes: Option<Vec<Node>> = None;
            let mut plain_text: Option<String> = None;
            let mut did_media = false;

            for entry in item.entries() {
                match entry {
                    ClipboardEntry::Image(image) => {
                        if image.bytes().is_empty() {
                            continue;
                        }
                        if self.paste_image_bytes(image.bytes(), image.format(), None, cx) {
                            did_media = true;
                            break;
                        }
                    }
                    ClipboardEntry::ExternalPaths(paths) => {
                        if self.paste_external_paths(&paths.0, cx) {
                            did_media = true;
                            break;
                        }
                    }
                    ClipboardEntry::String(s) => {
                        let text = s.text.as_str();
                        if let Some(json) = text.strip_prefix(CLIPBOARD_PREFIX) {
                            if let Ok(nodes) = serde_json::from_str::<Vec<Node>>(json) {
                                if !nodes.is_empty() {
                                    loora_nodes = Some(nodes);
                                }
                            }
                        } else if !text.trim().is_empty() {
                            plain_text = Some(text.to_string());
                        }
                    }
                }
            }

            if did_media {
                self.context_world = None;
                return;
            }
            if let Some(nodes) = loora_nodes {
                self.clipboard = nodes;
                self.paste_nodes_from_clipboard(cx);
                return;
            }
            // Fall through to in-app clipboard before plain text, so ⌘C/⌘V of
            // layers still wins when the OS clipboard has unrelated text.
            if !self.clipboard.is_empty() {
                self.paste_nodes_from_clipboard(cx);
                return;
            }
            if let Some(text) = plain_text {
                self.paste_plain_text(&text, cx);
                return;
            }
        }

        if !self.clipboard.is_empty() {
            self.paste_nodes_from_clipboard(cx);
        }
    }

    fn paste_nodes_from_clipboard(&mut self, cx: &mut Context<Self>) {
        if self.clipboard.is_empty() {
            return;
        }

        let roots: Vec<NodeId> = self
            .clipboard
            .iter()
            .filter(|n| {
                n.parent_id
                    .as_ref()
                    .map(|p| !self.clipboard.iter().any(|c| &c.id == p))
                    .unwrap_or(true)
            })
            .map(|n| n.id.clone())
            .collect();

        let mut id_map: HashMap<NodeId, NodeId> = HashMap::new();
        for node in &self.clipboard {
            let prefix = node.id.as_str().split('_').next().unwrap_or("node");
            id_map.insert(node.id.clone(), NodeId::new(prefix));
        }

        let page = self.engine.root_page_id().clone();
        let anchor = self.paste_anchor();
        let origin = roots
            .first()
            .and_then(|id| self.clipboard.iter().find(|n| &n.id == id))
            .map(|n| Vec2::new(n.layout.x, n.layout.y))
            .unwrap_or(Vec2::new(0.0, 0.0));
        let delta = Vec2::new(anchor.x - origin.x, anchor.y - origin.y);

        let mut ordered = self.clipboard.clone();
        ordered.sort_by_key(|n| {
            let mut depth = 0usize;
            let mut cur = n.parent_id.clone();
            while let Some(pid) = cur {
                depth += 1;
                cur = self
                    .clipboard
                    .iter()
                    .find(|c| c.id == pid)
                    .and_then(|c| c.parent_id.clone());
                if depth > 10_000 {
                    break;
                }
            }
            depth
        });

        let mut ops = Vec::new();
        let mut new_selection = Vec::new();
        for src in &ordered {
            let mut node = src.clone();
            let new_id = id_map[&src.id].clone();
            let is_root = roots.iter().any(|r| r == &src.id);
            node.id = new_id.clone();
            node.parent_id = match &src.parent_id {
                Some(pid) if id_map.contains_key(pid) => Some(id_map[pid].clone()),
                Some(pid) if self.engine.node(pid).is_some() => Some(pid.clone()),
                _ => Some(page.clone()),
            };
            if is_root {
                // Parent-local when dropping onto page; keep relative layout for nested.
                if node
                    .parent_id
                    .as_ref()
                    .map(|p| {
                        self.engine
                            .node(p)
                            .map(|n| n.is_root_frame())
                            .unwrap_or(true)
                    })
                    .unwrap_or(true)
                {
                    node.layout.x = src.layout.x + delta.x;
                    node.layout.y = src.layout.y + delta.y;
                } else {
                    node.layout.x += 16.0;
                    node.layout.y += 16.0;
                }
                node.order = self.engine.next_order(node.parent_id.as_ref());
                new_selection.push(new_id);
            }
            ops.push(loora_engine::Operation::Insert { node });
        }

        if ops.is_empty() {
            return;
        }
        let _ = self.engine.apply(
            loora_engine::Transaction::new("Paste", ops),
            loora_engine::ApplyOptions::with_history(),
        );
        self.selection = new_selection;
        self.paste_nudge = self.paste_nudge.saturating_add(1);
        self.context_world = None;
        self.note_change(cx);
    }

    fn paste_plain_text(&mut self, text: &str, cx: &mut Context<Self>) {
        let anchor = self.paste_anchor();
        let parent = self.engine.drop_target_at(anchor, None);
        let parent_origin = if self
            .engine
            .node(&parent)
            .map(|n| n.is_root_frame())
            .unwrap_or(true)
        {
            Vec2::new(0.0, 0.0)
        } else if let Some(b) = self.engine.absolute_bounds(&parent) {
            Vec2::new(b.x, b.y)
        } else {
            Vec2::new(0.0, 0.0)
        };
        let mut probe = Node::text(
            "Text",
            parent.clone(),
            Layout::new(0.0, 0.0, 100.0, 40.0),
            text,
        );
        let (w, h) = probe.estimate_text_size();
        probe.layout = Layout::new(anchor.x - parent_origin.x, anchor.y - parent_origin.y, w, h);
        probe.order = self.engine.next_order(Some(&parent));
        let id = probe.id.clone();
        let _ = self.engine.apply(
            loora_engine::Transaction::new(
                "Paste text",
                vec![loora_engine::Operation::Insert { node: probe }],
            ),
            loora_engine::ApplyOptions::with_history(),
        );
        self.select_only(id);
        self.paste_nudge = self.paste_nudge.saturating_add(1);
        self.context_world = None;
        self.note_change(cx);
    }

    fn paste_image_bytes(
        &mut self,
        bytes: &[u8],
        format: ImageFormat,
        suggested_name: Option<&str>,
        cx: &mut Context<Self>,
    ) -> bool {
        if bytes.is_empty() {
            return false;
        }
        let ext = format.extension();
        let assets = self.store.assets_dir();
        if let Err(err) = std::fs::create_dir_all(&assets) {
            eprintln!("loora: create assets dir failed: {err}");
            return false;
        }
        let name = suggested_name
            .map(|n| n.to_string())
            .unwrap_or_else(|| format!("paste-{}", chrono_like_id()));
        let file_name = if Path::new(&name).extension().is_some() {
            name
        } else {
            format!("{name}.{ext}")
        };
        let path = assets.join(&file_name);
        // Avoid overwrite collisions.
        let path = if path.exists() {
            assets.join(format!(
                "{}-{}.{}",
                Path::new(&file_name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("paste"),
                chrono_like_id(),
                ext
            ))
        } else {
            path
        };
        if let Err(err) = std::fs::write(&path, bytes) {
            eprintln!("loora: write pasted image failed: {err}");
            return false;
        }
        let path_str = path.to_string_lossy().to_string();

        let (w, h) = image::load_from_memory(bytes)
            .ok()
            .map(|img| (img.width() as f64, img.height() as f64))
            .unwrap_or((320.0, 240.0));
        let max_side = 640.0;
        let scale = (max_side / w.max(1.0)).min(max_side / h.max(1.0)).min(1.0);
        let w = (w * scale).max(8.0);
        let h = (h * scale).max(8.0);

        let anchor = self.paste_anchor();
        let parent = self.engine.drop_target_at(anchor, None);
        let parent_origin = if self
            .engine
            .node(&parent)
            .map(|n| n.is_root_frame())
            .unwrap_or(true)
        {
            Vec2::new(0.0, 0.0)
        } else if let Some(b) = self.engine.absolute_bounds(&parent) {
            Vec2::new(b.x, b.y)
        } else {
            Vec2::new(0.0, 0.0)
        };
        let mut node = Node::image(
            Path::new(&file_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Image"),
            parent.clone(),
            Layout::new(anchor.x - parent_origin.x, anchor.y - parent_origin.y, w, h),
        );
        node.order = self.engine.next_order(Some(&parent));
        node.image_path = Some(path_str.clone());
        let id = node.id.clone();
        let _ = self.engine.apply(
            loora_engine::Transaction::new(
                "Paste image",
                vec![loora_engine::Operation::Insert { node }],
            ),
            loora_engine::ApplyOptions::with_history(),
        );
        self.select_only(id);
        self.paste_nudge = self.paste_nudge.saturating_add(1);
        self.context_world = None;
        self.note_change(cx);
        true
    }

    fn paste_external_paths(&mut self, paths: &[std::path::PathBuf], cx: &mut Context<Self>) -> bool {
        let mut pasted = false;
        let mut offset = 0.0_f64;
        for path in paths {
            if !is_pasteable_image_path(path) {
                continue;
            }
            let Ok(bytes) = std::fs::read(path) else {
                continue;
            };
            let format = image_format_from_path(path).unwrap_or(ImageFormat::Png);
            // Temporarily nudge so multiple files tile.
            let saved_nudge = self.paste_nudge;
            self.paste_nudge = saved_nudge.saturating_add((offset / 16.0) as u32);
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string());
            if self.paste_image_bytes(&bytes, format, name.as_deref(), cx) {
                pasted = true;
                offset += 24.0;
            }
            self.paste_nudge = saved_nudge.saturating_add(1);
        }
        pasted
    }

    fn duplicate_selection(&mut self, cx: &mut Context<Self>) {
        let ids = self.selection.clone();
        match self
            .engine
            .duplicate_nodes(&ids, Vec2::new(16.0, 16.0))
        {
            Ok(new_ids) if !new_ids.is_empty() => {
                self.selection = new_ids;
                self.note_change(cx);
            }
            _ => {}
        }
    }

    fn select_all_on_page(&mut self, cx: &mut Context<Self>) {
        let page = self.engine.root_page_id().clone();
        let mut ids: Vec<NodeId> = self
            .engine
            .document()
            .nodes
            .values()
            .filter(|n| !n.is_root_frame())
            .filter(|n| {
                // On current page tree (any descendant of page).
                let mut cur = n.parent_id.clone();
                while let Some(pid) = cur {
                    if pid == page {
                        return true;
                    }
                    cur = self.engine.node(&pid).and_then(|p| p.parent_id.clone());
                }
                false
            })
            .map(|n| n.id.clone())
            .collect();
        ids.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        self.selection = ids;
        cx.notify();
    }

    pub fn set_color_picker_color(&mut self, color: Color, cx: &mut Context<Self>) {
        let Some(state) = self.color_picker.as_mut() else {
            return;
        };
        state.color = color;
        let field = state.field;
        self.apply_props_color(field, color, true, cx);
        cx.notify();
    }

    fn apply_props_color(
        &mut self,
        field: PropsField,
        color: Color,
        live: bool,
        cx: &mut Context<Self>,
    ) {
        if self.selection.is_empty() || self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let coalesce = if live {
                Some(format!("color-picker:{field:?}:{id}"))
            } else {
                None
            };
            let ok = match field {
                PropsField::Fill => self.engine.set_fill(&id, Some(color), coalesce).is_ok(),
                PropsField::StrokeColor => {
                    let width = node.style.stroke.as_ref().map(|s| s.width).unwrap_or(1.0);
                    let style = node
                        .style
                        .stroke
                        .as_ref()
                        .map(|s| s.style)
                        .unwrap_or_default();
                    self.engine
                        .set_stroke(
                            &id,
                            Some(Stroke {
                                color,
                                token_id: None,
                                width,
                                style,
                            }),
                            coalesce,
                        )
                        .is_ok()
                }
                PropsField::ShadowColor => {
                    let mut shadows = node.style.shadows;
                    if shadows.is_empty() {
                        shadows.push(Shadow::default());
                    }
                    shadows[0].color = color;
                    self.engine.set_shadows(&id, shadows, coalesce).is_ok()
                }
                PropsField::TextColor if node.kind == NodeKind::Text => {
                    let mut typography = node.effective_typography();
                    typography.color = color;
                    self.engine
                        .set_typography(&id, typography, coalesce)
                        .is_ok()
                }
                PropsField::VectorFill => {
                    let mut paths = node.paths;
                    if paths.is_empty() {
                        paths.push(loora_engine::VectorPath {
                            d: "M0 0 L100 0 L100 100 L0 100 Z".into(),
                            fill: Some(color),
                            fill_token: None,
                            stroke: None,
                            stroke_token: None,
                            stroke_width: None,
                        });
                    } else {
                        paths[0].fill = Some(color);
                        paths[0].fill_token = None;
                    }
                    self.engine.set_paths(&id, paths).is_ok()
                }
                _ => false,
            };
            changed |= ok;
        }
        if changed {
            if live {
                self.dirty = true;
                self.schedule_autosave(cx);
            } else {
                self.note_change(cx);
            }
        }
    }

    fn props_field_value(&self, node: &Node, field: PropsField) -> String {
        let bounds = self
            .engine
            .absolute_bounds(&node.id)
            .unwrap_or(EngineBounds::new(
                node.layout.x,
                node.layout.y,
                node.layout.width,
                node.layout.height,
            ));
        match field {
            PropsField::Name => node.name.clone(),
            PropsField::X => format_number(bounds.x, 2),
            PropsField::Y => format_number(bounds.y, 2),
            PropsField::W => format_number(bounds.width, 2),
            PropsField::H => format_number(bounds.height, 2),
            PropsField::Rotation => format_number(node.rotation as f64, 1),
            PropsField::LayoutMode => match node.layout.mode {
                LayoutMode::Flex => "flex",
                LayoutMode::Grid => "grid",
                LayoutMode::Absolute => "absolute",
            }
            .into(),
            PropsField::Direction => match node.layout.direction {
                FlexDirection::Row => "row",
                FlexDirection::Column => "column",
            }
            .into(),
            PropsField::Align => format!("{:?}", node.layout.align).to_lowercase(),
            PropsField::Justify => format!("{:?}", node.layout.justify).to_lowercase(),
            PropsField::Gap => format_number(node.layout.gap as f64, 1),
            PropsField::Grow => format_number(node.layout.grow as f64, 2),
            PropsField::Shrink => format_number(node.layout.shrink.unwrap_or(1.0) as f64, 2),
            PropsField::PaddingTop => format_number(node.layout.padding.top as f64, 1),
            PropsField::PaddingRight => format_number(node.layout.padding.right as f64, 1),
            PropsField::PaddingBottom => format_number(node.layout.padding.bottom as f64, 1),
            PropsField::PaddingLeft => format_number(node.layout.padding.left as f64, 1),
            PropsField::Fill => node
                .style
                .solid_fill()
                .map(format_hex)
                .unwrap_or_else(|| String::new()),
            PropsField::Opacity => format_number((node.style.opacity * 100.0) as f64, 0),
            PropsField::Radius => format_number(node.style.radius() as f64, 1),
            PropsField::CornerTl => format_number(node.style.corners.tl as f64, 1),
            PropsField::CornerTr => format_number(node.style.corners.tr as f64, 1),
            PropsField::CornerBr => format_number(node.style.corners.br as f64, 1),
            PropsField::CornerBl => format_number(node.style.corners.bl as f64, 1),
            PropsField::GradientAngle => match node.style.fills.first() {
                Some(Paint::LinearGradient { angle, .. }) => format_number(*angle as f64, 1),
                _ => String::new(),
            },
            PropsField::StrokeColor => node
                .style
                .stroke
                .as_ref()
                .map(|s| format_hex(s.color))
                .unwrap_or_else(|| "#FFFFFF".into()),
            PropsField::StrokeWidth => format_number(
                node.style
                    .stroke
                    .as_ref()
                    .map(|s| s.width as f64)
                    .unwrap_or(1.0),
                1,
            ),
            PropsField::StrokeStyle => node
                .style
                .stroke
                .as_ref()
                .map(|s| format!("{:?}", s.style).to_lowercase())
                .unwrap_or_else(|| "solid".into()),
            PropsField::ShadowColor => node
                .style
                .shadows
                .first()
                .map(|s| format_hex(s.color))
                .unwrap_or_default(),
            PropsField::ShadowX => node
                .style
                .shadows
                .first()
                .map(|s| format_number(s.x as f64, 1))
                .unwrap_or_default(),
            PropsField::ShadowY => node
                .style
                .shadows
                .first()
                .map(|s| format_number(s.y as f64, 1))
                .unwrap_or_default(),
            PropsField::ShadowBlur => node
                .style
                .shadows
                .first()
                .map(|s| format_number(s.blur as f64, 1))
                .unwrap_or_default(),
            PropsField::ShadowSpread => node
                .style
                .shadows
                .first()
                .map(|s| format_number(s.spread as f64, 1))
                .unwrap_or_default(),
            PropsField::FontSize => format_number(node.font_size as f64, 0),
            PropsField::FontFamily => node.effective_typography().family,
            PropsField::FontWeight => format_number(node.effective_typography().weight as f64, 0),
            PropsField::LineHeight => node
                .effective_typography()
                .line_height
                .map(|v| format_number(v as f64, 1))
                .unwrap_or_default(),
            PropsField::LetterSpacing => {
                format_number(node.effective_typography().letter_spacing as f64, 1)
            }
            PropsField::TextColor => format_hex(node.effective_typography().color),
            PropsField::TextAlign => format!("{:?}", node.effective_typography().align).to_lowercase(),
            PropsField::MinWidth => node
                .layout
                .min_width
                .map(|v| format_number(v, 1))
                .unwrap_or_default(),
            PropsField::MaxWidth => node
                .layout
                .max_width
                .map(|v| format_number(v, 1))
                .unwrap_or_default(),
            PropsField::MinHeight => node
                .layout
                .min_height
                .map(|v| format_number(v, 1))
                .unwrap_or_default(),
            PropsField::MaxHeight => node
                .layout
                .max_height
                .map(|v| format_number(v, 1))
                .unwrap_or_default(),
            PropsField::AspectRatio => node
                .layout
                .aspect_ratio
                .map(|v| format_number(v, 2))
                .unwrap_or_default(),
            PropsField::Text => node.text_content().to_string(),
            PropsField::Columns => format_number(node.layout.columns as f64, 0),
            PropsField::MotionDuration => format_number(
                node.transition
                    .as_ref()
                    .map(|t| t.duration_ms as f64)
                    .unwrap_or(300.0),
                0,
            ),
            PropsField::ActionUrl => node
                .interactions
                .iter()
                .flat_map(|i| i.actions.iter())
                .find_map(|a| match a {
                    CanvasAction::OpenUrl { url, .. } => Some(url.clone()),
                    CanvasAction::Navigate { page_id } => Some(format!("page:{page_id}")),
                    _ => None,
                })
                .unwrap_or_default(),
            PropsField::VectorFill => node
                .paths
                .first()
                .and_then(|p| p.fill)
                .map(format_hex)
                .unwrap_or_else(|| "None".into()),
            PropsField::VectorWeight => format_number(
                node.paths
                    .first()
                    .and_then(|p| p.stroke_width)
                    .unwrap_or(1.0) as f64,
                1,
            ),
            _ => String::new(),
        }
    }

    pub fn begin_props_scrub(
        &mut self,
        field: PropsField,
        start_value: f64,
        start_x: f32,
        cx: &mut Context<Self>,
    ) {
        if self.preview_mode {
            return;
        }
        if self.selection.is_empty()
            || self
                .selection
                .iter()
                .any(|id| self.engine.node(id).map(|node| node.locked).unwrap_or(true))
        {
            return;
        }
        self.clear_props_focus();
        self.props_scrub = Some(PropsScrub {
            field,
            start_x,
            start_value,
        });
        cx.notify();
    }

    pub fn update_props_scrub(&mut self, x: f32, step: f64, cx: &mut Context<Self>) {
        let Some(scrub) = self.props_scrub.clone() else {
            return;
        };
        let delta = ((x - scrub.start_x) as f64) * step;
        let value = scrub.start_value + delta;
        self.apply_props_number(scrub.field, value, true, cx);
    }

    pub fn end_props_scrub(&mut self, cx: &mut Context<Self>) {
        if self.props_scrub.take().is_some() {
            self.note_change(cx);
            cx.notify();
        }
    }

    pub fn toggle_selection_stroke(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.selection.is_empty() {
            return;
        }
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let next = if node.style.stroke.is_some() {
                None
            } else {
                Some(Stroke::solid(Color::rgb(0xff, 0xff, 0xff), 1.0))
            };
            changed |= self.engine.set_stroke(&id, next, None).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn toggle_selection_overflow(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id) else {
                continue;
            };
            if node.locked {
                continue;
            }
            let overflow = if node.style.overflow == Overflow::Hidden {
                Overflow::Visible
            } else {
                Overflow::Hidden
            };
            changed |= self.engine.set_overflow(&id, overflow, None).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn toggle_selection_stack(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if !matches!(node.kind, NodeKind::Frame | NodeKind::Component) || node.locked {
                continue;
            }
            let mut layout = node.layout;
            layout.mode = match layout.mode {
                LayoutMode::Absolute => LayoutMode::Flex,
                LayoutMode::Flex => LayoutMode::Grid,
                LayoutMode::Grid => LayoutMode::Absolute,
            };
            let is_stack = matches!(layout.mode, LayoutMode::Flex | LayoutMode::Grid);
            if self.engine.set_layout(&id, layout, None).is_ok() {
                if is_stack {
                    let children: Vec<NodeId> = self
                        .engine
                        .children(Some(&id))
                        .into_iter()
                        .map(|child| child.id.clone())
                        .collect();
                    for child in children {
                        if let Some(child_node) = self.engine.node(&child).cloned() {
                            let mut child_layout = child_node.layout;
                            child_layout.position = LayoutPosition::Flow;
                            let _ = self.engine.set_layout(&child, child_layout, None);
                        }
                    }
                }
                let _ = self.engine.resolve_stack(&id);
                changed = true;
            }
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn toggle_selection_wrap(&mut self, cx: &mut Context<Self>) {
        self.patch_selected_layout(|layout| layout.wrap = !layout.wrap, cx);
    }

    pub fn cycle_selection_direction(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        self.patch_selected_layout(
            |layout| {
                layout.direction = match layout.direction {
                    FlexDirection::Row => FlexDirection::Column,
                    FlexDirection::Column => FlexDirection::Row,
                };
            },
            cx,
        );
    }

    pub fn cycle_selection_align(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        self.patch_selected_layout(
            |layout| {
                layout.align = match layout.align {
                    LayoutAlign::Start => LayoutAlign::Center,
                    LayoutAlign::Center => LayoutAlign::End,
                    LayoutAlign::End => LayoutAlign::Stretch,
                    LayoutAlign::Stretch => LayoutAlign::Start,
                };
            },
            cx,
        );
    }

    pub fn cycle_selection_justify(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        self.patch_selected_layout(
            |layout| {
                layout.justify = match layout.justify {
                    LayoutJustify::Start => LayoutJustify::Center,
                    LayoutJustify::Center => LayoutJustify::End,
                    LayoutJustify::End => LayoutJustify::SpaceBetween,
                    LayoutJustify::SpaceBetween => LayoutJustify::SpaceAround,
                    LayoutJustify::SpaceAround => LayoutJustify::Start,
                };
            },
            cx,
        );
    }

    pub fn cycle_selection_stroke_style(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let Some(mut stroke) = node.style.stroke else {
                continue;
            };
            stroke.style = match stroke.style {
                StrokeStyle::Solid => StrokeStyle::Dashed,
                StrokeStyle::Dashed => StrokeStyle::Dotted,
                StrokeStyle::Dotted => StrokeStyle::Solid,
            };
            changed |= self.engine.set_stroke(&id, Some(stroke), None).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn toggle_selection_shadow(&mut self, cx: &mut Context<Self>) {
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            let shadows = if node.style.shadows.is_empty() {
                vec![Shadow::default()]
            } else {
                Vec::new()
            };
            changed |= self.engine.set_shadows(&id, shadows, None).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn toggle_selection_shadow_inset(&mut self, cx: &mut Context<Self>) {
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            let mut shadows = node.style.shadows;
            if let Some(shadow) = shadows.first_mut() {
                shadow.inset = !shadow.inset;
                changed |= self.engine.set_shadows(&id, shadows, None).is_ok();
            }
        }
        if changed {
            self.note_change(cx);
        }
    }

    fn patch_selected_layout(&mut self, patch: impl Fn(&mut Layout), cx: &mut Context<Self>) {
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        let bp = self.active_breakpoint_id.clone();
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            if let Some(bp) = bp.clone() {
                let mut responsive = node.responsive.clone();
                let mut override_patch = responsive.remove(&bp).unwrap_or_default();
                let mut layout = override_patch.layout.clone().unwrap_or(node.layout.clone());
                patch(&mut layout);
                override_patch.layout = Some(layout);
                responsive.insert(bp, override_patch);
                changed |= self.engine.set_responsive(&id, responsive).is_ok();
            } else {
                let mut layout = node.layout;
                patch(&mut layout);
                changed |= self.engine.set_layout(&id, layout, None).is_ok();
                let _ = self.engine.resolve_stack(&id);
            }
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn cycle_active_breakpoint(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        let breakpoints = self.engine.document().breakpoints.clone();
        if breakpoints.is_empty() {
            self.active_breakpoint_id = None;
            cx.notify();
            return;
        }
        let next = match &self.active_breakpoint_id {
            None => Some(breakpoints[0].id.clone()),
            Some(current) => {
                let idx = breakpoints.iter().position(|b| &b.id == current);
                match idx {
                    Some(i) if i + 1 < breakpoints.len() => Some(breakpoints[i + 1].id.clone()),
                    _ => None,
                }
            }
        };
        self.active_breakpoint_id = next;
        cx.notify();
    }

    pub fn clear_responsive_overrides(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        let Some(bp) = self.active_breakpoint_id.clone() else {
            return;
        };
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if !node.responsive.contains_key(&bp) {
                continue;
            }
            let mut responsive = node.responsive;
            responsive.remove(&bp);
            changed |= self.engine.set_responsive(&id, responsive).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn toggle_hover_preset(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let mut states = node.visual_states.unwrap_or_default();
            if states.hover.is_some() {
                states.hover = None;
            } else {
                states.hover = Some(VisualState {
                    opacity: Some(0.85),
                    scale: Some(1.02),
                    fill: None,
                    transform: None,
                    style: None,
                });
            }
            let visual_states = if states.hover.is_none() && states.press.is_none() {
                None
            } else {
                Some(states)
            };
            if node.transition.is_none() {
                let _ = self.engine.set_transition(&id, Some(Transition::default()));
            }
            changed |= self.engine.set_visual_states(&id, visual_states).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn cycle_transition_easing(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        let easings = ["ease-out", "ease-in", "ease-in-out", "linear"];
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let mut transition = node.transition.unwrap_or_default();
            let idx = easings
                .iter()
                .position(|e| *e == transition.easing.as_str())
                .unwrap_or(0);
            transition.easing = easings[(idx + 1) % easings.len()].into();
            changed |= self.engine.set_transition(&id, Some(transition)).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn cycle_instance_variant(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if !matches!(node.kind, NodeKind::Component | NodeKind::Instance) || node.locked {
                continue;
            }
            let variants = self.variant_names_for(&node);
            if variants.is_empty() {
                continue;
            }
            let current = node.variant.clone().unwrap_or_else(|| variants[0].clone());
            let idx = variants.iter().position(|v| v == &current).unwrap_or(0);
            let next = variants[(idx + 1) % variants.len()].clone();
            changed |= self.engine.set_variant(&id, Some(next)).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub(crate) fn variant_names_for(&self, node: &Node) -> Vec<String> {
        let mut names = node.component_variants.clone();
        if names.is_empty() {
            if let Some(component_id) = node
                .component_id
                .as_ref()
                .map(|id| NodeId::from(id.as_str()))
            {
                if let Some(master) = self.engine.node(&component_id) {
                    names = master.component_variants.clone();
                    for key in master.variant_overrides.keys() {
                        if !names.iter().any(|n| n == key) {
                            names.push(key.clone());
                        }
                    }
                }
            }
            for key in node.variant_overrides.keys() {
                if !names.iter().any(|n| n == key) {
                    names.push(key.clone());
                }
            }
        }
        if names.is_empty() {
            names.push("Default".into());
        }
        names
    }

    pub fn reset_instance_overrides(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.kind == NodeKind::Instance {
                changed |= self.engine.reset_instance(&id).is_ok();
            } else if matches!(node.kind, NodeKind::Component) {
                // Masters have no instance overrides; no-op.
                continue;
            }
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn add_selected_variant(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if !matches!(node.kind, NodeKind::Component | NodeKind::Instance) || node.locked {
                continue;
            }
            let names = self.variant_names_for(&node);
            let name = format!("Variant {}", names.len() + 1);
            changed |= self.engine.add_variant(&id, name).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn capture_selected_variant(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if !matches!(node.kind, NodeKind::Component | NodeKind::Instance) || node.locked {
                continue;
            }
            let names = self.variant_names_for(&node);
            // Always capture as a new named variant (never overwrite Default in place).
            let name = format!("Variant {}", names.len() + 1);
            changed |= self.engine.capture_variant(&id, name).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn delete_selected_variant(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if !matches!(node.kind, NodeKind::Component | NodeKind::Instance) || node.locked {
                continue;
            }
            let names = self.variant_names_for(&node);
            if names.len() <= 1 {
                continue;
            }
            let current = node
                .variant
                .clone()
                .unwrap_or_else(|| names[0].clone());
            changed |= self.engine.delete_variant(&id, &current).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn apply_next_token_fill(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        let tokens = self.engine.document().tokens.clone();
        if tokens.is_empty() || self.preview_mode {
            return;
        }
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let current = node.style.solid_fill();
            let idx = current
                .and_then(|c| tokens.iter().position(|t| t.color == c))
                .map(|i| (i + 1) % tokens.len())
                .unwrap_or(0);
            changed |= self
                .engine
                .set_fill(&id, Some(tokens[idx].color), None)
                .is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn replace_selection_image(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.primary_selection() else {
            return;
        };
        if self
            .engine
            .node(&id)
            .map(|n| n.kind != NodeKind::Image || n.locked)
            .unwrap_or(true)
            || self.preview_mode
        {
            return;
        }
        self.open_image_picker(id, cx);
    }

    fn apply_props_number(
        &mut self,
        field: PropsField,
        value: f64,
        scrubbing: bool,
        cx: &mut Context<Self>,
    ) {
        if self.selection.is_empty() {
            return;
        };
        let ids = self.selection.clone();
        let mut changed = false;
        for id in ids {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let coalesce = |key: &str| Some(format!("{key}:{id}"));
            let ok = match field {
                PropsField::X | PropsField::Y | PropsField::W | PropsField::H => {
                    let Some(mut bounds) = self.engine.absolute_bounds(&id) else {
                        return;
                    };
                    match field {
                        PropsField::X => bounds.x = value,
                        PropsField::Y => bounds.y = value,
                        PropsField::W => bounds.width = value.max(1.0),
                        PropsField::H => bounds.height = value.max(1.0),
                        _ => {}
                    }
                    self.engine
                        .set_world_bounds(&id, bounds, coalesce("property:layout"))
                        .is_ok()
                }
                PropsField::Opacity => self
                    .engine
                    .set_opacity(
                        &id,
                        (value as f32 / 100.0).clamp(0.0, 1.0),
                        coalesce("property:opacity"),
                    )
                    .is_ok(),
                PropsField::Radius => self
                    .engine
                    .set_radius(&id, value.max(0.0) as f32, coalesce("property:radius"))
                    .is_ok(),
                PropsField::StrokeWidth => {
                    let color = node
                        .style
                        .stroke
                        .as_ref()
                        .map(|s| s.color)
                        .unwrap_or(Color::rgb(0xff, 0xff, 0xff));
                    self.engine
                        .set_stroke(
                            &id,
                            Some(Stroke::solid(color, value.max(0.0) as f32)),
                            coalesce("property:stroke"),
                        )
                        .is_ok()
                }
                PropsField::FontSize => self
                    .engine
                    .set_font_size(&id, value.max(1.0) as f32, coalesce("font-size"))
                    .is_ok(),
                PropsField::Rotation => self
                    .engine
                    .set_rotation(&id, value as f32, coalesce("property:rotation"))
                    .is_ok(),
                PropsField::Gap
                | PropsField::Grow
                | PropsField::Shrink
                | PropsField::PaddingTop
                | PropsField::PaddingRight
                | PropsField::PaddingBottom
                | PropsField::PaddingLeft
                | PropsField::MinWidth
                | PropsField::MaxWidth
                | PropsField::MinHeight
                | PropsField::MaxHeight
                | PropsField::AspectRatio => {
                    let mut layout = node.layout;
                    match field {
                        PropsField::Gap => layout.gap = value.max(0.0) as f32,
                        PropsField::Grow => layout.grow = value.max(0.0) as f32,
                        PropsField::Shrink => layout.shrink = Some(value.max(0.0) as f32),
                        PropsField::PaddingTop => layout.padding.top = value.max(0.0) as f32,
                        PropsField::PaddingRight => layout.padding.right = value.max(0.0) as f32,
                        PropsField::PaddingBottom => layout.padding.bottom = value.max(0.0) as f32,
                        PropsField::PaddingLeft => layout.padding.left = value.max(0.0) as f32,
                        PropsField::MinWidth => layout.min_width = Some(value.max(0.0)),
                        PropsField::MaxWidth => layout.max_width = Some(value.max(0.0)),
                        PropsField::MinHeight => layout.min_height = Some(value.max(0.0)),
                        PropsField::MaxHeight => layout.max_height = Some(value.max(0.0)),
                        PropsField::AspectRatio => layout.aspect_ratio = Some(value.max(0.01)),
                        _ => {}
                    }
                    self.engine
                        .set_layout(&id, layout, coalesce("property:layout"))
                        .is_ok()
                }
                PropsField::CornerTl
                | PropsField::CornerTr
                | PropsField::CornerBr
                | PropsField::CornerBl => {
                    let mut corners = node.style.corners;
                    match field {
                        PropsField::CornerTl => corners.tl = value.max(0.0) as f32,
                        PropsField::CornerTr => corners.tr = value.max(0.0) as f32,
                        PropsField::CornerBr => corners.br = value.max(0.0) as f32,
                        PropsField::CornerBl => corners.bl = value.max(0.0) as f32,
                        _ => {}
                    }
                    self.engine
                        .set_corners(&id, corners, coalesce("property:corners"))
                        .is_ok()
                }
                PropsField::ShadowX
                | PropsField::ShadowY
                | PropsField::ShadowBlur
                | PropsField::ShadowSpread => {
                    let mut shadows = node.style.shadows;
                    if shadows.is_empty() {
                        shadows.push(Shadow::default());
                    }
                    let shadow = &mut shadows[0];
                    match field {
                        PropsField::ShadowX => shadow.x = value as f32,
                        PropsField::ShadowY => shadow.y = value as f32,
                        PropsField::ShadowBlur => shadow.blur = value.max(0.0) as f32,
                        PropsField::ShadowSpread => shadow.spread = value as f32,
                        _ => {}
                    }
                    self.engine
                        .set_shadows(&id, shadows, coalesce("property:shadow"))
                        .is_ok()
                }
                PropsField::FontWeight | PropsField::LineHeight | PropsField::LetterSpacing => {
                    if node.kind != NodeKind::Text {
                        false
                    } else {
                        let mut typography = node.effective_typography();
                        match field {
                            PropsField::FontWeight => {
                                typography.weight = value.clamp(1.0, 1000.0) as u16
                            }
                            PropsField::LineHeight => {
                                typography.line_height = Some(value.max(0.0) as f32)
                            }
                            PropsField::LetterSpacing => typography.letter_spacing = value as f32,
                            _ => {}
                        }
                        self.engine
                            .set_typography(&id, typography, coalesce("property:type"))
                            .is_ok()
                    }
                }
                PropsField::GradientAngle => {
                    let mut fills = node.style.fills;
                    if let Some(Paint::LinearGradient { angle, .. }) = fills.first_mut() {
                        *angle = value as f32;
                        self.engine
                            .set_fills(&id, fills, coalesce("property:gradient"))
                            .is_ok()
                    } else {
                        false
                    }
                }
                PropsField::Columns => {
                    let mut layout = node.layout;
                    layout.columns = value.max(1.0) as u32;
                    self.engine
                        .set_layout(&id, layout, coalesce("property:columns"))
                        .is_ok()
                        && {
                            let _ = self.engine.resolve_stack(&id);
                            true
                        }
                }
                PropsField::MotionDuration => {
                    let mut transition = node.transition.unwrap_or_default();
                    transition.duration_ms = value.max(0.0) as f32;
                    self.engine.set_transition(&id, Some(transition)).is_ok()
                }
                PropsField::VectorWeight => {
                    let mut paths = node.paths;
                    if paths.is_empty() {
                        paths.push(loora_engine::VectorPath {
                            d: "M0 0 L100 0 L100 100 L0 100 Z".into(),
                            fill: Some(Color::rgb(0x7a, 0xa2, 0xf7)),
                            fill_token: None,
                            stroke: Some(Color::rgb(0xff, 0xff, 0xff)),
                            stroke_token: None,
                            stroke_width: Some(value.max(0.0) as f32),
                        });
                    } else {
                        paths[0].stroke_width = Some(value.max(0.0) as f32);
                        if paths[0].stroke.is_none() {
                            paths[0].stroke = Some(Color::rgb(0xff, 0xff, 0xff));
                        }
                    }
                    self.engine.set_paths(&id, paths).is_ok()
                }
                _ => false,
            };
            changed |= ok;
        }

        if changed {
            if scrubbing {
                cx.notify();
            } else {
                self.note_change(cx);
            }
        }
    }

    fn commit_props_draft(&mut self, cx: &mut Context<Self>) {
        let Some(field) = self.props_focus else {
            return;
        };
        let draft = self.props_draft.clone();
        let Some(id) = self.primary_selection() else {
            self.clear_props_focus();
            cx.notify();
            return;
        };
        let Some(node) = self.engine.node(&id).cloned() else {
            self.clear_props_focus();
            cx.notify();
            return;
        };
        if node.locked {
            self.clear_props_focus();
            cx.notify();
            return;
        }

        let mut changed = false;
        match field {
            PropsField::Name => {
                let name = draft.trim();
                if !name.is_empty() && name != node.name {
                    changed = self.engine.rename_node(&id, name).is_ok();
                }
            }
            PropsField::Fill => {
                let fill = if draft.trim().is_empty()
                    || draft.eq_ignore_ascii_case("none")
                    || draft.eq_ignore_ascii_case("transparent")
                {
                    Some(None)
                } else if let Some(color) = parse_hex(&draft) {
                    Some(Some(color))
                } else {
                    None
                };
                if let Some(fill) = fill {
                    for selected in self.selection.clone() {
                        changed |= self.engine.set_fill(&selected, fill, None).is_ok();
                    }
                };
            }
            PropsField::StrokeColor => {
                if let Some(color) = parse_hex(&draft) {
                    let width = node.style.stroke.as_ref().map(|s| s.width).unwrap_or(1.0);
                    let style = node
                        .style
                        .stroke
                        .as_ref()
                        .map(|stroke| stroke.style)
                        .unwrap_or_default();
                    for selected in self.selection.clone() {
                        let selected_width = self
                            .engine
                            .node(&selected)
                            .and_then(|selected_node| selected_node.style.stroke.as_ref())
                            .map(|stroke| stroke.width)
                            .unwrap_or(width);
                        changed |= self
                            .engine
                            .set_stroke(
                                &selected,
                                Some(Stroke {
                                    color,
                                    token_id: None,
                                    width: selected_width,
                                    style,
                                }),
                                None,
                            )
                            .is_ok();
                    }
                }
            }
            PropsField::Text => {
                for selected in self.selection.clone() {
                    changed |= self.engine.set_text(&selected, draft.clone()).is_ok();
                }
            }
            PropsField::ShadowColor | PropsField::TextColor => {
                if let Some(color) = parse_hex(&draft) {
                    for selected in self.selection.clone() {
                        let Some(selected_node) = self.engine.node(&selected).cloned() else {
                            continue;
                        };
                        if field == PropsField::ShadowColor {
                            let mut shadows = selected_node.style.shadows;
                            if shadows.is_empty() {
                                shadows.push(Shadow::default());
                            }
                            shadows[0].color = color;
                            changed |= self.engine.set_shadows(&selected, shadows, None).is_ok();
                        } else if selected_node.kind == NodeKind::Text {
                            let mut typography = selected_node.effective_typography();
                            typography.color = color;
                            changed |= self
                                .engine
                                .set_typography(&selected, typography, None)
                                .is_ok();
                        }
                    }
                }
            }
            PropsField::FontFamily => {
                let family = draft.trim();
                if !family.is_empty() {
                    for selected in self.selection.clone() {
                        if let Some(selected_node) = self.engine.node(&selected).cloned() {
                            if selected_node.kind == NodeKind::Text {
                                let mut typography = selected_node.effective_typography();
                                typography.family = family.into();
                                changed |= self
                                    .engine
                                    .set_typography(&selected, typography, None)
                                    .is_ok();
                            }
                        }
                    }
                }
            }
            PropsField::LayoutMode
            | PropsField::Direction
            | PropsField::Align
            | PropsField::Justify
            | PropsField::StrokeStyle
            | PropsField::TextAlign => {
                let value = draft.trim().to_ascii_lowercase();
                for selected in self.selection.clone() {
                    let Some(selected_node) = self.engine.node(&selected).cloned() else {
                        continue;
                    };
                    if field == PropsField::TextAlign && selected_node.kind == NodeKind::Text {
                        let mut typography = selected_node.effective_typography();
                        typography.align = match value.as_str() {
                            "center" => TextAlign::Center,
                            "right" => TextAlign::Right,
                            _ => TextAlign::Left,
                        };
                        changed |= self.engine.set_typography(&selected, typography, None).is_ok();
                    } else if field == PropsField::StrokeStyle {
                        let mut stroke = selected_node
                            .style
                            .stroke
                            .unwrap_or_else(|| Stroke::solid(Color::rgb(255, 255, 255), 1.0));
                        stroke.style = match value.as_str() {
                            "dashed" => StrokeStyle::Dashed,
                            "dotted" => StrokeStyle::Dotted,
                            _ => StrokeStyle::Solid,
                        };
                        changed |= self
                            .engine
                            .set_stroke(&selected, Some(stroke), None)
                            .is_ok();
                    } else {
                        let mut layout = selected_node.layout;
                        match field {
                            PropsField::LayoutMode => {
                                layout.mode = match value.as_str() {
                                    "flex" => LayoutMode::Flex,
                                    "grid" => LayoutMode::Grid,
                                    _ => LayoutMode::Absolute,
                                }
                            }
                            PropsField::Direction => {
                                layout.direction = if value == "column" {
                                    FlexDirection::Column
                                } else {
                                    FlexDirection::Row
                                }
                            }
                            PropsField::Align => {
                                layout.align = match value.as_str() {
                                    "center" => LayoutAlign::Center,
                                    "end" => LayoutAlign::End,
                                    "stretch" => LayoutAlign::Stretch,
                                    _ => LayoutAlign::Start,
                                }
                            }
                            PropsField::Justify => {
                                layout.justify = match value.as_str() {
                                    "center" => LayoutJustify::Center,
                                    "end" => LayoutJustify::End,
                                    "spacebetween" | "space-between" => LayoutJustify::SpaceBetween,
                                    "spacearound" | "space-around" => LayoutJustify::SpaceAround,
                                    _ => LayoutJustify::Start,
                                }
                            }
                            _ => {}
                        }
                        changed |= self.engine.set_layout(&selected, layout, None).is_ok();
                        let _ = self.engine.resolve_stack(&selected);
                    }
                }
            }
            PropsField::X
            | PropsField::Y
            | PropsField::W
            | PropsField::H
            | PropsField::Opacity
            | PropsField::Radius
            | PropsField::StrokeWidth
            | PropsField::FontSize
            | PropsField::Rotation
            | PropsField::Gap
            | PropsField::Grow
            | PropsField::Shrink
            | PropsField::PaddingTop
            | PropsField::PaddingRight
            | PropsField::PaddingBottom
            | PropsField::PaddingLeft
            | PropsField::MinWidth
            | PropsField::MaxWidth
            | PropsField::MinHeight
            | PropsField::MaxHeight
            | PropsField::AspectRatio
            | PropsField::CornerTl
            | PropsField::CornerTr
            | PropsField::CornerBr
            | PropsField::CornerBl
            | PropsField::ShadowX
            | PropsField::ShadowY
            | PropsField::ShadowBlur
            | PropsField::ShadowSpread
            |             PropsField::FontWeight
            | PropsField::LineHeight
            | PropsField::LetterSpacing
            | PropsField::GradientAngle
            | PropsField::Columns
            | PropsField::MotionDuration
            | PropsField::VectorWeight => {
                if let Ok(value) = draft.trim().parse::<f64>() {
                    self.apply_props_number(field, value, false, cx);
                    self.clear_props_focus();
                    return;
                }
            }
            PropsField::ActionUrl => {
                let raw = draft.trim().to_string();
                for selected in self.selection.clone() {
                    let interactions = if raw.is_empty() {
                        Vec::new()
                    } else if let Some(page_id) = raw.strip_prefix("page:") {
                        vec![Interaction {
                            trigger: InteractionTrigger::Click,
                            state_id: None,
                            when: Vec::new(),
                            actions: vec![CanvasAction::Navigate {
                                page_id: page_id.trim().to_string(),
                            }],
                        }]
                    } else {
                        vec![Interaction {
                            trigger: InteractionTrigger::Click,
                            state_id: None,
                            when: Vec::new(),
                            actions: vec![CanvasAction::OpenUrl {
                                url: raw.clone(),
                                target: "_blank".into(),
                            }],
                        }]
                    };
                    changed |= self.engine.set_interactions(&selected, interactions).is_ok();
                }
            }
            PropsField::VectorFill => {
                let fill = if draft.trim().is_empty()
                    || draft.eq_ignore_ascii_case("none")
                    || draft.eq_ignore_ascii_case("transparent")
                {
                    Some(None)
                } else {
                    parse_hex(&draft).map(Some)
                };
                if let Some(fill) = fill {
                    for selected in self.selection.clone() {
                        let Some(selected_node) = self.engine.node(&selected).cloned() else {
                            continue;
                        };
                        let mut paths = selected_node.paths;
                        if paths.is_empty() {
                            paths.push(loora_engine::VectorPath {
                                d: "M0 0 L100 0 L100 100 L0 100 Z".into(),
                                fill,
                                fill_token: None,
                                stroke: None,
                                stroke_token: None,
                                stroke_width: None,
                            });
                        } else {
                            paths[0].fill = fill;
                            paths[0].fill_token = None;
                        }
                        changed |= self.engine.set_paths(&selected, paths).is_ok();
                    }
                }
            }
            _ => {}
        }

        self.clear_props_focus();
        if changed {
            self.note_change(cx);
        } else {
            cx.notify();
        }
    }

    fn on_props_key_down(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        let modifiers = &event.keystroke.modifiers;
        let Some(mut session) = self.props_text_edit.take() else {
            return;
        };
        if key == "escape" {
            self.clear_props_focus();
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if key == "enter" {
            self.props_text_edit = Some(session);
            self.commit_props_draft(cx);
            cx.stop_propagation();
            return;
        }
        if modifiers.platform {
            match key {
                "a" => session.select_all(self.props_draft.len()),
                "c" => {
                    let (start, end) = session.sorted();
                    if start < end {
                        cx.write_to_clipboard(ClipboardItem::new_string(
                            self.props_draft[start..end].to_string(),
                        ));
                    }
                }
                "x" => {
                    let (start, end) = session.sorted();
                    if start < end {
                        cx.write_to_clipboard(ClipboardItem::new_string(
                            self.props_draft[start..end].to_string(),
                        ));
                        text_edit::delete_selection(&mut self.props_draft, &mut session);
                    }
                }
                "v" => {
                    if let Some(item) = cx.read_from_clipboard() {
                        for entry in item.entries() {
                            if let ClipboardEntry::String(value) = entry {
                                text_edit::insert(
                                    &mut self.props_draft,
                                    &mut session,
                                    &value.text,
                                );
                                break;
                            }
                        }
                    }
                }
                "left" => text_edit::move_home(
                    &mut session,
                    &self.props_draft,
                    modifiers.shift,
                ),
                "right" => text_edit::move_end(
                    &mut session,
                    &self.props_draft,
                    modifiers.shift,
                ),
                _ => {
                    self.props_text_edit = Some(session);
                    return;
                }
            }
            self.props_text_edit = Some(session);
            cx.stop_propagation();
            cx.notify();
            return;
        }

        match key {
            "backspace" => {
                text_edit::backspace(&mut self.props_draft, &mut session);
            }
            "delete" => {
                text_edit::delete_forward(&mut self.props_draft, &mut session);
            }
            "left" => text_edit::move_left(
                &mut session,
                &self.props_draft,
                modifiers.shift,
            ),
            "right" => text_edit::move_right(
                &mut session,
                &self.props_draft,
                modifiers.shift,
            ),
            "up" | "home" => text_edit::move_home(
                &mut session,
                &self.props_draft,
                modifiers.shift,
            ),
            "down" | "end" => text_edit::move_end(
                &mut session,
                &self.props_draft,
                modifiers.shift,
            ),
            _ => {
                if let Some(ch) = event.keystroke.key_char.as_deref() {
                    if !modifiers.modified() {
                        text_edit::insert(&mut self.props_draft, &mut session, ch);
                    } else {
                        self.props_text_edit = Some(session);
                        return;
                    }
                } else {
                    self.props_text_edit = Some(session);
                    return;
                }
            }
        }
        self.props_text_edit = Some(session);
        cx.stop_propagation();
        cx.notify();
    }

    pub fn toggle_hidden(&mut self, id: &NodeId, cx: &mut Context<Self>) {
        if let Some(node) = self.engine.node(id) {
            let next = !node.hidden;
            let _ = self.engine.set_hidden(id, next);
            self.note_change(cx);
        }
    }

    pub fn toggle_locked(&mut self, id: &NodeId, cx: &mut Context<Self>) {
        if let Some(node) = self.engine.node(id) {
            let next = !node.locked;
            let _ = self.engine.set_locked(id, next);
            self.note_change(cx);
        }
    }

    pub fn add_child_frame(&mut self, cx: &mut Context<Self>) {
        let parent = self
            .primary_selection()
            .filter(|id| {
                self.engine
                    .node(id)
                    .map(|n| n.is_container())
                    .unwrap_or(false)
            })
            .unwrap_or_else(|| self.engine.root_page_id().clone());
        let order = self.engine.next_order(Some(&parent));
        let mut frame = Node::frame(
            "Frame",
            parent.clone(),
            Layout::new(40.0, 40.0, 240.0, 160.0),
        );
        frame.order = order;
        let id = frame.id.clone();
        let _ = self.engine.apply(
            loora_engine::Transaction::new(
                "Add frame",
                vec![loora_engine::Operation::Insert { node: frame }],
            ),
            loora_engine::ApplyOptions::with_history(),
        );
        let _ = self.engine.resolve_stack(&parent);
        self.select_only(id);
        self.note_change(cx);
    }

    pub fn insert_component_instance(&mut self, component_id: &NodeId, cx: &mut Context<Self>) {
        if self.preview_mode {
            return;
        }
        let parent = self
            .primary_selection()
            .filter(|id| {
                self.engine
                    .node(id)
                    .map(|n| n.is_container() && n.kind != NodeKind::Component)
                    .unwrap_or(false)
            })
            .unwrap_or_else(|| self.engine.root_page_id().clone());
        let at = Vec2::new(40.0, 40.0);
        match self.engine.instantiate_component(component_id, &parent, at) {
            Ok(id) => {
                self.select_only(id);
                self.tool = CanvasTool::Select;
                self.note_change(cx);
            }
            Err(err) => eprintln!("loora: insert component failed: {err}"),
        }
    }

    pub fn focus_page(&mut self, page_id: &NodeId, cx: &mut Context<Self>) {
        if self.engine.set_root_page(page_id).is_ok() {
            self.select_only(page_id.clone());
            self.fit_page(page_id, cx);
        }
    }

    pub fn fit_page(&mut self, page_id: &NodeId, cx: &mut Context<Self>) {
        let Some(bounds) = self.engine.absolute_bounds(page_id) else {
            return;
        };
        let vb = self.viewport_bounds.get();
        let w = f32::from(vb.size.width) as f64;
        let h = f32::from(vb.size.height) as f64;
        if w > 1.0 && h > 1.0 {
            self.camera.fit_bounds(w, h, bounds, 48.0);
        }
        cx.notify();
    }

    pub fn fit_selection_or_page(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.primary_selection() {
            if let Some(bounds) = self.engine.absolute_bounds(&id) {
                let vb = self.viewport_bounds.get();
                let w = f32::from(vb.size.width) as f64;
                let h = f32::from(vb.size.height) as f64;
                if w > 1.0 && h > 1.0 {
                    self.camera.fit_bounds(w, h, bounds, 64.0);
                    cx.notify();
                    return;
                }
            }
        }
        let page = self.engine.root_page_id().clone();
        self.fit_page(&page, cx);
    }

    pub fn fit_all_pages(&mut self, cx: &mut Context<Self>) {
        let pages = self.engine.page_ids();
        let mut union: Option<EngineBounds> = None;
        for page in &pages {
            let Some(b) = self.engine.absolute_bounds(page) else {
                continue;
            };
            union = Some(match union {
                None => b,
                Some(u) => {
                    let min_x = u.x.min(b.x);
                    let min_y = u.y.min(b.y);
                    let max_x = u.right().max(b.right());
                    let max_y = u.bottom().max(b.bottom());
                    EngineBounds::new(min_x, min_y, max_x - min_x, max_y - min_y)
                }
            });
        }
        let Some(bounds) = union else {
            cx.notify();
            return;
        };
        let vb = self.viewport_bounds.get();
        let w = f32::from(vb.size.width) as f64;
        let h = f32::from(vb.size.height) as f64;
        if w > 1.0 && h > 1.0 {
            self.camera.fit_bounds(w, h, bounds, 72.0);
        }
        cx.notify();
    }

    pub fn group_selection(&mut self, cx: &mut Context<Self>) {
        if self.preview_mode || self.selection.len() < 2 {
            return;
        }
        match self.engine.group_nodes(&self.selection.clone()) {
            Ok(id) => {
                self.select_only(id);
                self.note_change(cx);
            }
            Err(err) => eprintln!("loora: group failed: {err}"),
        }
    }

    pub fn ungroup_selection(&mut self, cx: &mut Context<Self>) {
        if self.preview_mode {
            return;
        }
        let ids: Vec<NodeId> = self
            .selection
            .iter()
            .filter(|id| {
                self.engine
                    .node(id)
                    .map(|n| n.kind == NodeKind::Frame)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        if ids.is_empty() {
            return;
        }
        let mut ok = false;
        for id in &ids {
            if self.engine.ungroup_node(id).is_ok() {
                ok = true;
            }
        }
        if ok {
            self.clear_selection();
            self.note_change(cx);
        }
    }

    fn undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        if self.engine.undo().is_ok() {
            self.note_change(cx);
        }
    }

    fn redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        if self.engine.redo().is_ok() {
            self.note_change(cx);
        }
    }

    fn save_design(&mut self, _: &SaveDesign, _: &mut Window, cx: &mut Context<Self>) {
        self.save_now(cx);
    }

    fn new_design(&mut self, _: &NewDesign, _: &mut Window, cx: &mut Context<Self>) {
        self.create_design(cx);
    }

    fn toggle_files(&mut self, _: &ToggleFiles, _: &mut Window, cx: &mut Context<Self>) {
        self.toggle_files_panel(cx);
    }

    fn toggle_settings(&mut self, _: &ToggleSettings, window: &mut Window, cx: &mut Context<Self>) {
        self.open_settings(window, cx);
    }

    fn workspace_quit(&mut self, _: &WorkspaceQuit, _: &mut Window, cx: &mut Context<Self>) {
        cx.quit();
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        if self.settings_route_active {
            self.on_settings_key_down(event, _window, cx);
            return;
        }

        if self.context_menu.is_some() {
            self.on_context_menu_key_down(event, cx);
            return;
        }

        if self.color_picker.is_some() {
            if event.keystroke.key.as_str() == "escape" {
                self.close_color_picker(cx);
                self.note_change(cx);
                cx.stop_propagation();
            }
            return;
        }

        if self.image_picker.is_some() {
            self.on_image_picker_key_down(event, cx);
            return;
        }

        if self.command_open {
            self.on_command_key_down(event, cx);
            return;
        }

        if self.layer_rename.is_some() {
            self.on_layer_rename_key_down(event, cx);
            return;
        }

        if self.props_focus.is_some() {
            self.on_props_key_down(event, cx);
            return;
        }

        if self.layer_search_focused {
            self.on_layer_search_key_down(event, cx);
            return;
        }

        if let Some(session) = self.text_edit.clone() {
            let Some(node) = self.engine.node(&session.id).cloned() else {
                self.text_edit = None;
                return;
            };

            let key = event.keystroke.key.as_str();
            let mods = &event.keystroke.modifiers;
            let extend = mods.shift;

            if key == "escape" {
                self.end_edit_text(cx);
                cx.stop_propagation();
                return;
            }

            let mut text = node.text.unwrap_or_default();
            let mut session = session;
            let mut changed = false;

            if mods.platform {
                match key {
                    "a" => {
                        session.select_all(text.len());
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "c" => {
                        let (a, b) = session.sorted();
                        if a < b {
                            cx.write_to_clipboard(ClipboardItem::new_string(
                                text[a..b].to_string(),
                            ));
                        }
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        return;
                    }
                    "x" => {
                        let (a, b) = session.sorted();
                        if a < b {
                            cx.write_to_clipboard(ClipboardItem::new_string(
                                text[a..b].to_string(),
                            ));
                            changed = text_edit::delete_selection(&mut text, &mut session);
                        }
                    }
                    "v" => {
                        if let Some(item) = cx.read_from_clipboard() {
                            for entry in item.entries() {
                                if let ClipboardEntry::String(s) = entry {
                                    let paste = s.text.clone();
                                    if !paste.is_empty() {
                                        text_edit::insert(&mut text, &mut session, &paste);
                                        changed = true;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                    _ => {
                        self.text_edit = Some(session);
                        return;
                    }
                }
            } else {
                match key {
                    "enter" => {
                        text_edit::insert(&mut text, &mut session, "\n");
                        changed = true;
                    }
                    "backspace" => {
                        changed = text_edit::backspace(&mut text, &mut session);
                    }
                    "delete" => {
                        changed = text_edit::delete_forward(&mut text, &mut session);
                    }
                    "left" => {
                        text_edit::move_left(&mut session, &text, extend);
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "right" => {
                        text_edit::move_right(&mut session, &text, extend);
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "up" => {
                        text_edit::move_up(&mut session, &text, extend);
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "down" => {
                        text_edit::move_down(&mut session, &text, extend);
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "home" => {
                        text_edit::move_home(&mut session, &text, extend);
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "end" => {
                        text_edit::move_end(&mut session, &text, extend);
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    _ => {
                        if let Some(ch) = event.keystroke.key_char.as_deref() {
                            if !mods.modified() && !ch.is_empty() {
                                text_edit::insert(&mut text, &mut session, ch);
                                changed = true;
                            } else {
                                self.text_edit = Some(session);
                                return;
                            }
                        } else {
                            self.text_edit = Some(session);
                            return;
                        }
                    }
                }
            }

            self.text_edit = Some(session);
            if changed {
                let _ = self.apply_text_edit(text, cx);
            } else {
                cx.notify();
            }
            cx.stop_propagation();
            return;
        }

        let key = event.keystroke.key.as_str();
        if key == "delete" || key == "backspace" {
            if self.delete_selection(cx) {
                cx.stop_propagation();
            }
            return;
        }

        // Standard editing shortcuts when not typing in a field.
        let mods = &event.keystroke.modifiers;
        if mods.platform {
            match key {
                "c" => {
                    self.copy_selection(cx);
                    cx.stop_propagation();
                    cx.notify();
                }
                "x" => {
                    self.copy_selection(cx);
                    let _ = self.delete_selection(cx);
                    cx.stop_propagation();
                }
                "v" => {
                    self.paste_clipboard(cx);
                    cx.stop_propagation();
                }
                "d" => {
                    self.duplicate_selection(cx);
                    cx.stop_propagation();
                }
                "a" => {
                    self.select_all_on_page(cx);
                    cx.stop_propagation();
                }
                "l" => {
                    let lock = self
                        .selection
                        .iter()
                        .filter_map(|id| self.engine.node(id))
                        .any(|n| !n.locked);
                    for id in self.selection.clone() {
                        let _ = self.engine.set_locked(&id, lock);
                    }
                    self.note_change(cx);
                    cx.stop_propagation();
                }
                "]" => {
                    for id in self.selection.clone() {
                        let _ = self.engine.bring_to_front_history(&id);
                    }
                    self.note_change(cx);
                    cx.stop_propagation();
                }
                "[" => {
                    for id in self.selection.clone() {
                        let _ = self.engine.send_to_back(&id);
                    }
                    self.note_change(cx);
                    cx.stop_propagation();
                }
                _ => {}
            }
        }
    }

    fn on_context_menu_key_down(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        let entries = self
            .context_menu
            .as_ref()
            .map(|menu| menu.entries.clone())
            .unwrap_or_default();
        let Some(state) = self.context_menu.as_mut() else {
            return;
        };
        match key {
            "escape" => {
                self.close_context_menu(cx);
                cx.stop_propagation();
            }
            "up" | "arrowup" => {
                state.highlight = move_highlight(&entries, state.highlight, -1);
                cx.stop_propagation();
                cx.notify();
            }
            "down" | "arrowdown" => {
                state.highlight = move_highlight(&entries, state.highlight, 1);
                cx.stop_propagation();
                cx.notify();
            }
            "enter" => {
                let highlight = state.highlight;
                if let Some(id) = action_id_at(&entries, highlight).map(str::to_string) {
                    self.run_context_action(&id, cx);
                }
                cx.stop_propagation();
            }
            _ => {
                cx.stop_propagation();
            }
        }
    }

    /// Delete the current selection. Returns true if something was removed.
    fn delete_selection(&mut self, cx: &mut Context<Self>) -> bool {
        if self.selection.is_empty() {
            return false;
        }
        let to_delete = self.selection.clone();
        let mut deleted = false;
        for id in to_delete {
            if self
                .engine
                .node(&id)
                .map(|node| !node.locked)
                .unwrap_or(false)
                && self.engine.delete_node(&id).is_ok()
            {
                deleted = true;
            }
        }
        if !deleted {
            return false;
        }
        self.clear_selection();
        self.text_edit = None;
        self.clear_props_focus();
        self.note_change(cx);
        true
    }

    fn on_image_picker_key_down(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        if key == "escape" {
            let mode = self
                .image_picker
                .as_ref()
                .map(|s| s.mode.clone())
                .unwrap_or(ImagePickerMode::Choose);
            if mode == ImagePickerMode::Url {
                self.image_picker_back(cx);
            } else {
                self.close_image_picker(cx);
            }
            cx.stop_propagation();
            return;
        }

        if self.image_picker.as_ref().map(|state| &state.mode) != Some(&ImagePickerMode::Url) {
            return;
        }

        if key == "enter" {
            self.apply_image_url(cx);
            cx.stop_propagation();
            return;
        }
        let Some(mut cursor) = self.image_url_edit.take() else {
            return;
        };
        let handled = self
            .image_picker
            .as_mut()
            .map(|state| edit_text_input_key(event, &mut state.url, &mut cursor, cx))
            .unwrap_or(false);
        self.image_url_edit = Some(cursor);
        if handled {
            cx.stop_propagation();
            cx.notify();
        }
    }

    pub fn handle_settings_key_down(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.on_settings_key_down(event, window, cx);
    }

    fn on_settings_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();

        if self.shortcut_recording.is_some() {
            if key == "escape" {
                self.cancel_shortcut_recording(cx);
                cx.stop_propagation();
                return;
            }
            // Ignore pure modifier presses while recording.
            if matches!(
                key,
                "control" | "ctrl" | "shift" | "alt" | "meta" | "cmd" | "super" | "win" | "fn"
            ) {
                cx.stop_propagation();
                return;
            }
            let binding = event.keystroke.unparse();
            self.apply_recorded_shortcut(&binding, cx);
            cx.stop_propagation();
            return;
        }

        if key == "escape" {
            self.navigate_to("/", window, cx);
            cx.stop_propagation();
            return;
        }

        if self.shortcut_search_focused && self.settings_section == SettingsSection::Shortcuts {
            let mut cursor = TextCursor {
                caret: self.shortcut_search.len(),
                anchor: self.shortcut_search.len(),
            };
            if edit_text_input_key(event, &mut self.shortcut_search, &mut cursor, cx) {
                cx.stop_propagation();
                cx.notify();
            }
        }
    }

    fn on_command_key_down(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        let count = self.command_item_count().max(1);

        if key == "escape" {
            self.close_command_dialog(cx);
            cx.stop_propagation();
            return;
        }
        if key == "enter" {
            self.confirm_command_selection(cx);
            cx.stop_propagation();
            return;
        }
        if key == "up" || key == "arrowup" {
            self.command_index = if self.command_index == 0 {
                count - 1
            } else {
                self.command_index - 1
            };
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if key == "down" || key == "arrowdown" {
            self.command_index = (self.command_index + 1) % count;
            cx.stop_propagation();
            cx.notify();
            return;
        }
        let Some(mut cursor) = self.command_edit.take() else {
            return;
        };
        if edit_text_input_key(event, &mut self.command_query, &mut cursor, cx) {
            self.command_edit = Some(cursor);
            self.command_index = 0;
            cx.stop_propagation();
            cx.notify();
            return;
        }
        self.command_edit = Some(cursor);
    }

    fn on_layer_rename_key_down(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        if key == "escape" {
            self.cancel_layer_rename(cx);
            cx.stop_propagation();
            return;
        }
        if key == "enter" {
            self.commit_layer_rename(cx);
            cx.stop_propagation();
            return;
        }
        let Some(mut cursor) = self.layer_rename_edit.take() else {
            return;
        };
        if edit_text_input_key(event, &mut self.layer_rename_draft, &mut cursor, cx) {
            self.layer_rename_edit = Some(cursor);
            cx.stop_propagation();
            cx.notify();
            return;
        }
        self.layer_rename_edit = Some(cursor);
    }

    fn on_layer_search_key_down(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        if key == "escape" {
            self.blur_layer_search(cx);
            cx.stop_propagation();
            return;
        }
        let Some(mut cursor) = self.layer_search_edit.take() else {
            return;
        };
        if edit_text_input_key(event, &mut self.layer_query, &mut cursor, cx) {
            self.layer_search_edit = Some(cursor);
            cx.stop_propagation();
            cx.notify();
            return;
        }
        self.layer_search_edit = Some(cursor);
    }

    fn tool_select(&mut self, _: &ToolSelect, _: &mut Window, cx: &mut Context<Self>) {
        if self.capture_typing_char("v", cx) {
            return;
        }
        self.set_tool(CanvasTool::Select, cx);
    }

    fn tool_hand(&mut self, _: &ToolHand, _: &mut Window, cx: &mut Context<Self>) {
        if self.capture_typing_char("h", cx) {
            return;
        }
        self.set_tool(CanvasTool::Hand, cx);
    }

    fn tool_rectangle(&mut self, _: &ToolRectangle, _: &mut Window, cx: &mut Context<Self>) {
        if self.capture_typing_char("r", cx) {
            return;
        }
        self.set_tool(CanvasTool::Rectangle, cx);
    }

    fn tool_frame(&mut self, _: &ToolFrame, _: &mut Window, cx: &mut Context<Self>) {
        if self.capture_typing_char("f", cx) {
            return;
        }
        self.set_tool(CanvasTool::Frame, cx);
    }

    fn tool_text(&mut self, _: &ToolText, _: &mut Window, cx: &mut Context<Self>) {
        if self.capture_typing_char("t", cx) {
            return;
        }
        self.set_tool(CanvasTool::Text, cx);
    }

    fn tool_image(&mut self, _: &ToolImage, _: &mut Window, cx: &mut Context<Self>) {
        if self.capture_typing_char("i", cx) {
            return;
        }
        self.set_tool(CanvasTool::Image, cx);
    }

    fn zoom_in(&mut self, _: &ZoomIn, _: &mut Window, cx: &mut Context<Self>) {
        self.zoom_by(1.15, cx);
    }

    fn zoom_out(&mut self, _: &ZoomOut, _: &mut Window, cx: &mut Context<Self>) {
        self.zoom_by(1.0 / 1.15, cx);
    }

    fn zoom_reset(&mut self, _: &ZoomReset, _: &mut Window, cx: &mut Context<Self>) {
        let center = self.viewport_center();
        self.camera.set_zoom_at(center, 1.0);
        cx.notify();
    }

    fn fit_selection_action(&mut self, _: &FitSelection, _: &mut Window, cx: &mut Context<Self>) {
        self.fit_selection_or_page(cx);
    }

    fn fit_all_action(&mut self, _: &FitAll, _: &mut Window, cx: &mut Context<Self>) {
        self.fit_all_pages(cx);
    }

    fn group_action(&mut self, _: &GroupSelection, _: &mut Window, cx: &mut Context<Self>) {
        self.group_selection(cx);
    }

    fn ungroup_action(&mut self, _: &UngroupSelection, _: &mut Window, cx: &mut Context<Self>) {
        self.ungroup_selection(cx);
    }

    fn zoom_by(&mut self, factor: f64, cx: &mut Context<Self>) {
        let center = self.viewport_center();
        self.camera.zoom_at(center, factor);
        cx.notify();
    }

    fn viewport_center(&self) -> Vec2 {
        let bounds = self.viewport_bounds.get();
        Vec2::new(
            f32::from(bounds.size.width) as f64 * 0.5,
            f32::from(bounds.size.height) as f64 * 0.5,
        )
    }

    fn commit_draw(
        &mut self,
        kind: CanvasTool,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        _cx: &mut Context<Self>,
    ) -> Option<NodeId> {
        let center = Vec2::new(x + w * 0.5, y + h * 0.5);
        let parent = self.engine.drop_target_at(center, None);
        let parent_origin = if self
            .engine
            .node(&parent)
            .map(|n| n.is_root_frame())
            .unwrap_or(true)
        {
            Vec2::new(0.0, 0.0)
        } else if let Some(b) = self.engine.absolute_bounds(&parent) {
            Vec2::new(b.x, b.y)
        } else {
            Vec2::new(0.0, 0.0)
        };
        let layout = Layout::new(x - parent_origin.x, y - parent_origin.y, w, h);
        let order = self.engine.next_order(Some(&parent));

        let node = match kind {
            CanvasTool::Frame => {
                let mut n = Node::frame("Frame", parent.clone(), layout);
                n.order = order;
                n.style.set_solid_fill(Some(Color::rgb(0x2a, 0x2a, 0x2e)));
                n
            }
            CanvasTool::Text => {
                let mut n = Node::text("Text", parent.clone(), layout, "Text");
                n.order = order;
                n
            }
            CanvasTool::Image => {
                let mut n = Node::image("Image", parent.clone(), layout);
                n.order = order;
                n
            }
            CanvasTool::Component => {
                let mut n = Node::component("Component", parent.clone(), layout);
                n.order = order;
                n
            }
            CanvasTool::Shapes | CanvasTool::Rectangle => {
                let mut n = Node::rectangle("Rectangle", parent.clone(), layout);
                n.order = order;
                if kind == CanvasTool::Shapes {
                    n.name = "Ellipse".into();
                    n.style.corners = Corners::uniform((w.min(h) / 2.0) as f32);
                    n.style.set_solid_fill(Some(Color::rgb(0xbb, 0x9a, 0xf7)));
                }
                n
            }
            _ => return None,
        };

        let id = node.id.clone();
        self.engine
            .apply(
                loora_engine::Transaction::new(
                    format!("Add {}", node.name),
                    vec![loora_engine::Operation::Insert { node }],
                ),
                loora_engine::ApplyOptions::with_history(),
            )
            .ok()?;
        let _ = self.engine.resolve_stack(&parent);
        Some(id)
    }
}

fn canvas_webview_hidden_for_overlays(
    command_open: bool,
    image_picker_open: bool,
    color_picker_open: bool,
    inspector_menu_open: bool,
) -> bool {
    // Full-window / properties GPUI chrome that can sit under the wry child.
    // Canvas right-click menus render inside the WebView HTML and never set
    // `inspector_menu_open` / `color_picker_open`.
    command_open || image_picker_open || color_picker_open || inspector_menu_open
}

fn web_context_menu_entries(entries: &[ContextMenuEntry]) -> Vec<serde_json::Value> {
    entries
        .iter()
        .map(|entry| match entry {
            ContextMenuEntry::Separator => serde_json::json!({ "separator": true }),
            ContextMenuEntry::Action(action) => serde_json::json!({
                "id": action.id.as_ref(),
                "label": action.label.as_ref(),
                "shortcut": action.shortcut.as_ref().map(|shortcut| shortcut.as_ref()),
                "enabled": action.enabled,
                "destructive": action.destructive,
            }),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{canvas_webview_hidden_for_overlays, web_context_menu_entries};
    use crate::context_menu::{ContextMenuAction, ContextMenuEntry};

    #[test]
    fn gpui_overlays_hide_the_canvas_webview() {
        // command / image picker / color picker / inspector enum menu
        assert!(canvas_webview_hidden_for_overlays(true, false, false, false));
        assert!(canvas_webview_hidden_for_overlays(false, true, false, false));
        assert!(canvas_webview_hidden_for_overlays(false, false, true, false));
        assert!(canvas_webview_hidden_for_overlays(false, false, false, true));
        // Idle canvas (HTML context menus do not use these flags)
        assert!(!canvas_webview_hidden_for_overlays(false, false, false, false));
    }

    #[test]
    fn settings_route_hides_webview_even_without_overlays() {
        // Mirrors webview_should_be_hidden: settings_route_active ORs with overlay hides.
        let settings_route_active = true;
        let hide = settings_route_active
            || canvas_webview_hidden_for_overlays(false, false, false, false);
        assert!(hide);
        assert!(!canvas_webview_hidden_for_overlays(false, false, false, false));
    }

    #[test]
    fn canvas_route_does_not_force_show_over_command_palette() {
        // Returning to `/` must still hide while a full-window overlay is open.
        let settings_route_active = false;
        let hide = settings_route_active
            || canvas_webview_hidden_for_overlays(true, false, false, false);
        assert!(hide);
    }

    #[test]
    fn web_context_menu_payload_preserves_action_state() {
        let entries = vec![
            ContextMenuEntry::Action(
                ContextMenuAction::new("copy", "Copy")
                    .shortcut("⌘C")
                    .enabled(false),
            ),
            ContextMenuEntry::Separator,
            ContextMenuEntry::Action(ContextMenuAction::new("delete", "Delete").destructive()),
        ];
        let payload = web_context_menu_entries(&entries);
        assert_eq!(payload[0]["id"], "copy");
        assert_eq!(payload[0]["shortcut"], "⌘C");
        assert_eq!(payload[0]["enabled"], false);
        assert_eq!(payload[1]["separator"], true);
        assert_eq!(payload[2]["destructive"], true);
    }
}

fn default_collapsed_layers(engine: &CanvasEngine) -> HashSet<NodeId> {
    engine
        .document()
        .nodes
        .values()
        .filter(|node| !node.is_root_frame() && node.is_container())
        .map(|node| node.id.clone())
        .collect()
}

/// Files command dialog: New, Import…, Import Luuma, Export…, Toggle theme
const COMMAND_ACTION_COUNT: usize = 5;
const CLIPBOARD_PREFIX: &str = "loora-nodes-v1:";

fn next_untitled_name(files: &[DesignFileInfo]) -> String {
    let mut n = 1usize;
    loop {
        let name = if n == 1 {
            "Untitled".to_string()
        } else {
            format!("Untitled {n}")
        };
        if !files.iter().any(|f| f.name == name) {
            return name;
        }
        n += 1;
    }
}

fn edit_text_input_key(
    event: &KeyDownEvent,
    text: &mut String,
    cursor: &mut TextCursor,
    cx: &mut Context<CanvasWorkspace>,
) -> bool {
    let key = event.keystroke.key.as_str();
    let modifiers = &event.keystroke.modifiers;

    if modifiers.platform {
        match key {
            "a" => cursor.select_all(text.len()),
            "c" => {
                let (start, end) = cursor.sorted();
                if start < end {
                    cx.write_to_clipboard(ClipboardItem::new_string(text[start..end].to_string()));
                }
            }
            "x" => {
                let (start, end) = cursor.sorted();
                if start < end {
                    cx.write_to_clipboard(ClipboardItem::new_string(text[start..end].to_string()));
                    text_edit::delete_selection(text, cursor);
                }
            }
            "v" => {
                if let Some(item) = cx.read_from_clipboard() {
                    for entry in item.entries() {
                        if let ClipboardEntry::String(value) = entry {
                            text_edit::insert(text, cursor, &value.text);
                            break;
                        }
                    }
                }
            }
            "left" => text_edit::move_home(cursor, text, modifiers.shift),
            "right" => text_edit::move_end(cursor, text, modifiers.shift),
            _ => return false,
        }
        return true;
    }

    match key {
        "backspace" => {
            text_edit::backspace(text, cursor);
        }
        "delete" => {
            text_edit::delete_forward(text, cursor);
        }
        "left" => text_edit::move_left(cursor, text, modifiers.shift),
        "right" => text_edit::move_right(cursor, text, modifiers.shift),
        "up" | "home" => text_edit::move_home(cursor, text, modifiers.shift),
        "down" | "end" => text_edit::move_end(cursor, text, modifiers.shift),
        _ => {
            let Some(ch) = event.keystroke.key_char.as_deref() else {
                return false;
            };
            if modifiers.modified() || ch.is_empty() {
                return false;
            }
            text_edit::insert(text, cursor, ch);
        }
    }
    true
}

fn is_http_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn decode_data_url_png(data_url: &str) -> Result<Vec<u8>, String> {
    const PREFIX: &str = "data:image/png;base64,";
    let encoded = data_url
        .strip_prefix(PREFIX)
        .ok_or_else(|| "expected a PNG data URL".to_string())?;
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|error| format!("decode PNG: {error}"))
}

fn is_pasteable_image_path(path: &Path) -> bool {
    image_format_from_path(path).is_some()
}

fn image_format_from_path(path: &Path) -> Option<ImageFormat> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some(ImageFormat::Png),
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "webp" => Some(ImageFormat::Webp),
        "gif" => Some(ImageFormat::Gif),
        "bmp" => Some(ImageFormat::Bmp),
        "tif" | "tiff" => Some(ImageFormat::Tiff),
        "ico" => Some(ImageFormat::Ico),
        _ => None,
    }
}

fn chrono_like_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms:x}")
}

fn workspace_key_bindings(overrides: &HashMap<String, String>) -> Vec<KeyBinding> {
    let mut bindings = Vec::new();
    for def in shortcut_catalog() {
        for keystroke in resolve_keystrokes(def, overrides) {
            if let Some(binding) = binding_for_action(def.id, &keystroke) {
                bindings.push(binding);
            }
        }
    }
    bindings
}

fn binding_for_action(action_id: &str, keystroke: &str) -> Option<KeyBinding> {
    let context = Some("CanvasWorkspace");
    let binding = match action_id {
        "toggle_settings" => KeyBinding::new(keystroke, ToggleSettings, None),
        "new_design" => KeyBinding::new(keystroke, NewDesign, context),
        "open_designs" => KeyBinding::new(keystroke, ToggleFiles, context),
        "save_design" => KeyBinding::new(keystroke, SaveDesign, context),
        "undo" => KeyBinding::new(keystroke, Undo, context),
        "redo" => KeyBinding::new(keystroke, Redo, context),
        "zoom_in" => KeyBinding::new(keystroke, ZoomIn, context),
        "zoom_out" => KeyBinding::new(keystroke, ZoomOut, context),
        "zoom_reset" => KeyBinding::new(keystroke, ZoomReset, context),
        "fit_selection" => KeyBinding::new(keystroke, FitSelection, context),
        "fit_all" => KeyBinding::new(keystroke, FitAll, context),
        "group" => KeyBinding::new(keystroke, GroupSelection, context),
        "ungroup" => KeyBinding::new(keystroke, UngroupSelection, context),
        "tool_select" => KeyBinding::new(keystroke, ToolSelect, context),
        "tool_hand" => KeyBinding::new(keystroke, ToolHand, context),
        "tool_rectangle" => KeyBinding::new(keystroke, ToolRectangle, context),
        "tool_frame" => KeyBinding::new(keystroke, ToolFrame, context),
        "tool_text" => KeyBinding::new(keystroke, ToolText, context),
        "tool_image" => KeyBinding::new(keystroke, ToolImage, context),
        _ => return None,
    };
    Some(binding)
}

impl Render for CanvasWorkspace {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_web_canvas(cx);
        let theme = self.theme;
        let entity = cx.entity();
        let webview = self.webview.clone();
        let sidebar_visible = self.sidebar_visible;
        let rows = if sidebar_visible {
            self.cached_layer_rows()
        } else {
            Rc::new(Vec::new())
        };
        let components: Vec<(NodeId, SharedString)> = self
            .engine
            .component_nodes()
            .into_iter()
            .map(|n| (n.id.clone(), SharedString::from(n.name.clone())))
            .collect();
        let pages: Vec<(NodeId, SharedString)> = self
            .engine
            .page_ids()
            .into_iter()
            .filter_map(|id| {
                self.engine
                    .node(&id)
                    .map(|n| (id, SharedString::from(n.name.clone())))
            })
            .collect();
        let active_page = self.engine.root_page_id().clone();
        let selection_set: HashSet<NodeId> = self.selection.iter().cloned().collect();
        let query = self.layer_query.clone();
        let layer_search_focused = self.layer_search_focused;
        let layer_search_selection = self
            .layer_search_edit
            .as_ref()
            .map(|cursor| (cursor.anchor, cursor.caret));
        let layer_rename = self.layer_rename.clone();
        let layer_rename_draft = self.layer_rename_draft.clone();
        let layer_rename_selection = self
            .layer_rename_edit
            .as_ref()
            .map(|cursor| (cursor.anchor, cursor.caret));
        let layer_scroll = self.layer_scroll.clone();
        let command_open = self.command_open;
        let command_query = self.command_query.clone();
        let command_index = self.command_index;
        let command_selection = self
            .command_edit
            .as_ref()
            .map(|cursor| (cursor.anchor, cursor.caret));
        let files = self.files.clone();
        let active_id = self.document_id();
        let dirty = self.dirty;
        let doc_name = self.document_name();
        let image_picker = self.image_picker.clone();
        let library_assets = image_picker
            .as_ref()
            .filter(|picker| picker.mode == ImagePickerMode::Choose)
            .map(|_| self.library_assets())
            .unwrap_or_default();
        let image_url_selection = self
            .image_url_edit
            .as_ref()
            .map(|cursor| (cursor.anchor, cursor.caret));
        let color_picker = self.color_picker.clone();
        let context_menu = self.context_menu.clone();
        let context_entries = context_menu
            .as_ref()
            .map(|menu| menu.entries.clone())
            .unwrap_or_default();
        let props_nodes: Vec<Node> = self
            .selection
            .iter()
            .filter_map(|id| self.engine.node(id).cloned())
            .collect();
        let props_bounds = props_nodes
            .first()
            .and_then(|node| self.engine.absolute_bounds(&node.id));
        let props_view = self.props_view();

        div()
            .relative()
            .flex()
            .size_full()
            .bg(theme.window_fill())
            .text_color(theme.foreground)
            .key_context("CanvasWorkspace")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::undo))
            .on_action(cx.listener(Self::redo))
            .on_action(cx.listener(Self::save_design))
            .on_action(cx.listener(Self::new_design))
            .on_action(cx.listener(Self::toggle_files))
            .on_action(cx.listener(Self::toggle_settings))
            .on_action(cx.listener(Self::workspace_quit))
            .on_action(cx.listener(Self::tool_select))
            .on_action(cx.listener(Self::tool_hand))
            .on_action(cx.listener(Self::tool_rectangle))
            .on_action(cx.listener(Self::tool_frame))
            .on_action(cx.listener(Self::tool_text))
            .on_action(cx.listener(Self::tool_image))
            .on_action(cx.listener(Self::zoom_in))
            .on_action(cx.listener(Self::zoom_out))
            .on_action(cx.listener(Self::zoom_reset))
            .on_action(cx.listener(Self::fit_selection_action))
            .on_action(cx.listener(Self::fit_all_action))
            .on_action(cx.listener(Self::group_action))
            .on_action(cx.listener(Self::ungroup_action))
            .on_key_down(cx.listener(Self::on_key_down))
            .when(sidebar_visible, |this| {
                this.child(LayerSidebar::new(
                    entity.clone(),
                    theme,
                    selection_set,
                    rows,
                    query,
                    layer_search_focused,
                    layer_search_selection,
                    layer_rename,
                    layer_rename_draft,
                    layer_rename_selection,
                    components,
                    layer_scroll,
                ))
            })
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .size_full()
                    .bg(theme.main_bg)
                    .child(
                        div()
                            .id("canvas-titlebar")
                            .flex()
                            .items_center()
                            .justify_between()
                            .h(px(52.))
                            .pl(if sidebar_visible { px(16.) } else { px(76.) })
                            .pr_4()
                            .border_b_1()
                            .border_color(theme.border)
                            .bg(theme.header_bg())
                            .on_click(|event, window, _| {
                                if event.click_count() == 2 {
                                    window.titlebar_double_click();
                                }
                            })
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_3()
                                    .child(
                                        div()
                                            .id("open-files")
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .cursor_pointer()
                                            .on_click({
                                                let entity = entity.clone();
                                                move |_, _, cx| {
                                                    cx.stop_propagation();
                                                    entity.update(cx, |this, cx| {
                                                        this.open_command_dialog(cx);
                                                    });
                                                }
                                            })
                                            .child(
                                                div()
                                                    .text_size(px(13.))
                                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                                    .text_color(theme.bright_white)
                                                    .child(doc_name),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(11.))
                                                    .text_color(theme.muted)
                                                    .child(if dirty { "•" } else { "" }),
                                            ),
                                    )
                                    .when(pages.len() > 1, |this| {
                                        this.child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_1()
                                                .children(pages.into_iter().map(|(page_id, name)| {
                                                    let selected = page_id == active_page;
                                                    let entity = entity.clone();
                                                    let id_for_click = page_id.clone();
                                                    div()
                                                        .id(SharedString::from(format!(
                                                            "page-tab-{}",
                                                            page_id.as_str()
                                                        )))
                                                        .px_2()
                                                        .py_1()
                                                        .rounded(px(6.))
                                                        .cursor_pointer()
                                                        .bg(if selected {
                                                            theme.highlight_fill()
                                                        } else {
                                                            gpui::transparent_black()
                                                        })
                                                        .hover(|s| s.bg(theme.wash()))
                                                        .on_click(move |_, _, cx| {
                                                            cx.stop_propagation();
                                                            entity.update(cx, |this, cx| {
                                                                this.focus_page(&id_for_click, cx);
                                                            });
                                                        })
                                                        .child(
                                                            div()
                                                                .text_size(px(12.))
                                                                .text_color(if selected {
                                                                    theme.bright_white
                                                                } else {
                                                                    theme.muted
                                                                })
                                                                .child(name),
                                                        )
                                                })),
                                        )
                                    }),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_3()
                                    .child(
                                        div()
                                            .id("open-settings")
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .size(px(28.))
                                            .rounded(px(8.))
                                            .cursor_pointer()
                                            .text_color(theme.muted)
                                            .hover(|s| {
                                                s.bg(theme.hover).text_color(theme.foreground)
                                            })
                                            .on_click({
                                                let entity = entity.clone();
                                                move |_, window, cx| {
                                                    cx.stop_propagation();
                                                    entity.update(cx, |this, cx| {
                                                        this.open_settings(window, cx);
                                                    });
                                                }
                                            })
                                            .child(
                                                crate::icon::Icon::hugeicon(IconName::Settings)
                                                    .size(px(15.)),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .id("fit-all")
                                            .text_size(px(11.))
                                            .text_color(theme.muted)
                                            .cursor_pointer()
                                            .hover(|s| s.text_color(theme.muted_strong))
                                            .on_click({
                                                let entity = entity.clone();
                                                move |_, _, cx| {
                                                    cx.stop_propagation();
                                                    entity.update(cx, |this, cx| {
                                                        this.fit_all_pages(cx);
                                                    });
                                                }
                                            })
                                            .child("Fit all"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.))
                                            .text_color(theme.muted)
                                            .child(if dirty { "Autosaving…" } else { "Saved" }),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .id("viewport-host")
                            .relative()
                            .flex_1()
                            .size_full()
                            .min_h_0()
                            .overflow_hidden()
                            .bg(theme.canvas_bg())
                            // Full-bleed webview — floating toolbar/zoom live inside HTML.
                            .child(webview),
                    ),
            )
            .child(PropertiesPanel::new(
                entity.clone(),
                theme,
                props_nodes,
                props_bounds,
                props_view,
            ))
            .when(command_open, |this| {
                this.child(FilesCommandDialog::new(
                    entity.clone(),
                    theme,
                    active_id,
                    files,
                    command_query,
                    command_index,
                    command_selection,
                    dirty,
                ))
            })
            .when_some(image_picker, |this, picker| {
                this.child(ImagePickerDialog::new(
                    entity.clone(),
                    theme,
                    picker.mode,
                    picker.url,
                    image_url_selection,
                    library_assets,
                ))
            })
            .when_some(color_picker, |this, picker| {
                this.child(ColorPickerPopover::new(
                    theme,
                    picker.color,
                    {
                        let entity = entity.clone();
                        move |color, _, cx| {
                            entity.update(cx, |this, cx| this.set_color_picker_color(color, cx))
                        }
                    },
                    {
                        let entity = entity.clone();
                        move |_, _, cx| {
                            entity.update(cx, |this, cx| this.close_color_picker(cx));
                        }
                    },
                ))
            })
            .when_some(context_menu, |this, menu| {
                this.child(ContextMenu::new(
                    theme,
                    context_entries,
                    menu.position,
                    menu.highlight,
                    {
                        let entity = entity.clone();
                        move |_, _, cx| {
                            entity.update(cx, |this, cx| this.close_context_menu(cx));
                        }
                    },
                    {
                        let entity = entity.clone();
                        move |action, _, cx| {
                            let action = action.to_string();
                            entity.update(cx, |this, cx| this.run_context_action(&action, cx));
                        }
                    },
                ))
            })
    }
}
