use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::{
    actions, div, prelude::FluentBuilder, px, relative, AppContext, Bounds, ClipboardEntry,
    ClipboardItem, Context, Entity, ExternalPaths, FocusHandle, ImageFormat, InteractiveElement,
    IntoElement, KeyBinding, KeyDownEvent, KeyUpEvent, ParentElement, PathPromptOptions, Pixels,
    Point, Render, SharedString, StatefulInteractiveElement, Styled, Subscription, Task,
    UniformListScrollHandle, Window,
};
pub use loora_canvas::CanvasTool;
use loora_canvas::{CanvasEvent, CanvasPalette, NativeCanvas, NativeTextEdit, PreviewTrigger};
use loora_engine::{
    export_page_svg, standalone_html, AnimationKeyframe, AnimationTrigger, Bounds as EngineBounds,
    Camera, CanvasAction, CanvasEngine, Color, Corners, DesignFileInfo, DesignStore,
    DocumentAnimation, FlexDirection, HtmlCanvasOptions, ImportReport, Interaction,
    InteractionTrigger, Layout, LayoutAlign, LayoutJustify, LayoutMode, LayoutPosition,
    MotionTransform, Node, NodeAnimation, NodeId, NodeKind, Overflow, Paint, Shadow, SizeMode,
    StateCondition, StateValue, Stroke, StrokeStyle, TextAlign, TextRun, Transition,
    TypographyPatch, Vec2, VisualState,
};
use loora_mcp::{McpClient, ToolCallReceiver, UiEffect};

use crate::canvas::files::FilesCommandDialog;
use crate::canvas::image_picker::{ImagePickerDialog, ImagePickerMode};
use crate::canvas::layers::{build_layer_rows, LayerListKey, LayerRow, LayerSidebar};
use crate::canvas::properties::{
    format_hex, format_number, parse_hex, PropertiesPanel, PropsField, PropsView,
};
use crate::canvas::text_edit::{self, TextCursor, TextEditSession};
use crate::color_picker::ColorPickerPopover;
use crate::context_menu::{
    action_id_at, first_action_index, move_highlight, ContextMenu, ContextMenuAction,
    ContextMenuEntry,
};
use crate::icon::{Icon, IconName};
use crate::motion::{Ease, Motion, MotionStyle, Transition as MotionTransition};
use crate::settings::{resolve_keystrokes, shortcut_catalog, SettingsSection};
use crate::theme::{Theme, ThemeKind};
use crate::tooltip::Tooltip;
#[cfg(all(target_os = "macos", not(test)))]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

actions!(
    canvas_editor,
    [
        Undo,
        Redo,
        ToolSelect,
        ToolHand,
        ToolPreview,
        ToolRectangle,
        ToolFrame,
        ToolText,
        ToolImage,
        SaveDesign,
        NewDesign,
        ToggleFiles,
        ToggleSettings,
        ToggleLayersSidebar,
        TogglePropertiesSidebar,
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

pub struct CanvasWorkspace {
    pub(crate) theme: Theme,
    pub(crate) engine: CanvasEngine,
    pub(crate) camera: Camera,
    pub(crate) selection: Vec<NodeId>,
    pub(crate) tool: CanvasTool,
    pub(crate) viewport_bounds: Rc<Cell<Bounds<Pixels>>>,
    native_canvas: Entity<NativeCanvas>,
    _native_canvas_subscription: Subscription,
    runtime_document_cache: Option<(RuntimeDocumentKey, Arc<loora_engine::Document>)>,
    runtime_document_generation: u64,
    _mcp_task: Option<Task<()>>,
    mcp_endpoint: Option<String>,
    _mcp_activity_task: Option<Task<()>>,
    mcp_activity: Option<McpActivity>,
    mcp_activity_sequence: u64,
    /// Fit-all deferred until the native viewport has a real size.
    pending_fit_all: bool,
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
    pub(crate) properties_visible: bool,
    pub(crate) command_open: bool,
    command_query: String,
    command_index: usize,
    command_edit: Option<TextCursor>,
    command_mcp_open: bool,
    mcp_setup_status: Option<(String, bool)>,
    developer_inspector_open: bool,
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
    /// Last `save_now` failed; titlebar shows "Save failed" until a save succeeds.
    save_failed: bool,
    _autosave_task: Option<Task<()>>,
    _image_tasks: Vec<Task<()>>,
    _caret_task: Option<Task<()>>,
    text_edit: Option<TextEditSession>,
    native_caret_visible: bool,
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
    /// Space temporarily turns the native select tool into the hand tool.
    native_space_pan: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RuntimeDocumentKey {
    revision: u64,
    preview_generation: u64,
    preview_mode: bool,
    breakpoint_id: Option<String>,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum McpActivityPhase {
    Running,
    Complete,
    Failed,
    Leaving,
}

impl McpActivityPhase {
    fn key(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Leaving => "leaving",
        }
    }
}

#[derive(Clone, Debug)]
struct McpActivity {
    sequence: u64,
    tool: String,
    phase: McpActivityPhase,
    succeeded: Option<bool>,
    node_ids: Vec<NodeId>,
}

impl CanvasWorkspace {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::new_with_mcp_endpoint(window, cx, None, None)
    }

    pub fn focus_canvas(&self, window: &mut Window, cx: &mut Context<Self>) {
        self.focus_handle.focus(window, cx);
    }

    pub fn new_with_mcp(
        window: &mut Window,
        cx: &mut Context<Self>,
        mcp_receiver: Option<ToolCallReceiver>,
    ) -> Self {
        Self::new_with_mcp_endpoint(window, cx, mcp_receiver, None)
    }

    pub fn new_with_mcp_endpoint(
        window: &mut Window,
        cx: &mut Context<Self>,
        mcp_receiver: Option<ToolCallReceiver>,
        mcp_endpoint: Option<String>,
    ) -> Self {
        let focus_handle = cx.focus_handle();
        focus_handle.focus(window, cx);

        let store = DesignStore::open().unwrap_or_else(|err| {
            eprintln!("loora: falling back to temp design store: {err}");
            let fallback = std::env::temp_dir().join("loora-designs");
            DesignStore::open_at(fallback).expect("temp design store")
        });
        let using_style_fixture = std::env::var_os("LOORA_STYLE_FIXTURE").is_some();
        let document = if using_style_fixture {
            loora_canvas::style_fixture::style_fixture_document()
        } else {
            store
                .load_or_create_default()
                .unwrap_or_else(|_| loora_engine::Document::empty("Untitled"))
        };
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
        let initial_camera = Camera::new(Vec2::new(40.0, 40.0), 1.0);
        let native_canvas = cx.new({
            let document = engine.document().clone();
            let viewport_bounds = viewport_bounds.clone();
            let input_focus = focus_handle.clone();
            move |_cx| {
                let mut canvas =
                    NativeCanvas::new_with_viewport(document, initial_camera, viewport_bounds);
                canvas.set_input_focus(input_focus);
                canvas
            }
        });
        let native_canvas_subscription =
            cx.subscribe(&native_canvas, |workspace, _, event: &CanvasEvent, cx| {
                workspace.handle_native_canvas_event(event, cx);
            });
        let mut workspace = Self {
            theme,
            engine,
            camera: initial_camera,
            selection: if using_style_fixture {
                vec![NodeId::from("fixture_transform_card")]
            } else {
                Vec::new()
            },
            tool: CanvasTool::Select,
            viewport_bounds,
            native_canvas,
            _native_canvas_subscription: native_canvas_subscription,
            runtime_document_cache: None,
            runtime_document_generation: 0,
            _mcp_task: None,
            mcp_endpoint,
            _mcp_activity_task: None,
            mcp_activity: None,
            mcp_activity_sequence: 0,
            pending_fit_all: true,
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
            properties_visible: true,
            command_open: false,
            command_query: String::new(),
            command_index: 0,
            command_edit: None,
            command_mcp_open: false,
            mcp_setup_status: None,
            developer_inspector_open: false,
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
            save_failed: false,
            _autosave_task: None,
            _image_tasks: Vec::new(),
            _caret_task: None,
            text_edit: None,
            native_caret_visible: true,
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
            native_space_pan: false,
        };
        if let Some(mcp_receiver) = mcp_receiver {
            let this = cx.weak_entity();
            workspace._mcp_task = Some(window.spawn(cx, async move |cx| {
                while let Ok(call) = mcp_receiver.recv().await {
                    let reply = call.reply.clone();
                    let sequence = match this.update_in(cx, |this, window, cx| {
                        this.begin_mcp_activity(&call.name, &call.arguments, window, cx)
                    }) {
                        Ok(sequence) => sequence,
                        Err(_) => {
                            let _ = reply.send(Err(
                                "The Loora canvas closed before the tool started.".into(),
                            ));
                            break;
                        }
                    };

                    // Give the native title bar one frame to show the running tool
                    // before fast local calls complete on the next UI update.
                    cx.background_executor()
                        .timer(Duration::from_millis(16))
                        .await;
                    let outcome = this.update_in(cx, |this, window, cx| {
                        let before_document = this.engine.document().id.clone();
                        let before_revision = this.engine.revision();
                        let result = loora_mcp::execute_tool(
                            &mut this.engine,
                            &this.store,
                            &call.name,
                            &call.arguments,
                        );
                        match result {
                            Ok(execution) => {
                                let agent_nodes = mcp_result_node_ids(
                                    &execution.value,
                                    &execution.effect,
                                    &this.engine,
                                );
                                let document_changed = before_document != this.engine.document().id
                                    || before_revision != this.engine.revision();
                                this.apply_mcp_execution(
                                    execution.effect,
                                    document_changed,
                                    window,
                                    cx,
                                );
                                this.finish_mcp_activity(sequence, true, agent_nodes, window, cx);
                                let _ = call.reply.send(Ok(execution.value));
                            }
                            Err(error) => {
                                this.finish_mcp_activity(sequence, false, Vec::new(), window, cx);
                                let _ = call.reply.send(Err(error));
                            }
                        }
                    });
                    if outcome.is_err() {
                        let _ = reply.send(Err(
                            "The Loora canvas closed before the tool completed.".into(),
                        ));
                        break;
                    }
                }
            }));
        }
        // Cold start never went through load_document — fit once the viewport exists.
        workspace.pending_fit_all = true;
        workspace.fit_all_pages(cx);
        workspace
    }

    fn apply_mcp_execution(
        &mut self,
        effect: UiEffect,
        document_changed: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if document_changed {
            self.saved_revision = self.engine.revision();
            self.dirty = false;
            self.save_failed = false;
            self.selection
                .retain(|id| self.engine.document().nodes.contains_key(id));
            self.refresh_files();
            self.note_collapsed_changed();
        }

        match effect {
            UiEffect::None | UiEffect::DocumentChanged => {}
            UiEffect::DocumentReplaced => {
                self.clear_selection();
                self.text_edit = None;
                self._caret_task = None;
                self.collapsed = default_collapsed_layers(&self.engine);
                self.layer_scroll = UniformListScrollHandle::new();
                self.note_collapsed_changed();
                self.camera = Camera::new(Vec2::new(40.0, 40.0), 1.0);
                self.pending_fit_all = true;
                self.fit_all_pages(cx);
            }
            UiEffect::FocusNodes(ids) => {
                self.selection = ids
                    .into_iter()
                    .map(|id| NodeId::from(id.as_str()))
                    .filter(|id| self.engine.document().nodes.contains_key(id))
                    .collect();
                self.fit_selection_or_page(cx);
            }
            UiEffect::FocusCanvas => {
                self.clear_selection();
                self.fit_all_pages(cx);
            }
        }
        notify_mcp_window(window, cx);
    }

    fn begin_mcp_activity(
        &mut self,
        tool: &str,
        arguments: &serde_json::Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> u64 {
        self._mcp_activity_task = None;
        self.mcp_activity_sequence = self.mcp_activity_sequence.wrapping_add(1);
        let sequence = self.mcp_activity_sequence;
        self.mcp_activity = Some(McpActivity {
            sequence,
            tool: tool.to_owned(),
            phase: McpActivityPhase::Running,
            succeeded: None,
            node_ids: mcp_argument_node_ids(tool, arguments, &self.engine),
        });
        notify_mcp_window(window, cx);
        sequence
    }

    fn finish_mcp_activity(
        &mut self,
        sequence: u64,
        succeeded: bool,
        node_ids: Vec<NodeId>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(activity) = self
            .mcp_activity
            .as_mut()
            .filter(|activity| activity.sequence == sequence)
        else {
            return;
        };
        activity.phase = if succeeded {
            McpActivityPhase::Complete
        } else {
            McpActivityPhase::Failed
        };
        activity.succeeded = Some(succeeded);
        if !node_ids.is_empty() {
            activity.node_ids = node_ids;
        }
        notify_mcp_window(window, cx);

        let this = cx.weak_entity();
        self._mcp_activity_task = Some(window.spawn(cx, async move |cx| {
            cx.background_executor()
                .timer(Duration::from_millis(if succeeded { 1_450 } else { 2_300 }))
                .await;
            let should_clear = this
                .update_in(cx, |this, window, cx| {
                    let Some(activity) = this
                        .mcp_activity
                        .as_mut()
                        .filter(|activity| activity.sequence == sequence)
                    else {
                        return false;
                    };
                    activity.phase = McpActivityPhase::Leaving;
                    notify_mcp_window(window, cx);
                    true
                })
                .unwrap_or(false);
            if !should_clear {
                return;
            }
            cx.background_executor()
                .timer(Duration::from_millis(180))
                .await;
            this.update_in(cx, |this, window, cx| {
                if this
                    .mcp_activity
                    .as_ref()
                    .is_some_and(|activity| activity.sequence == sequence)
                {
                    this.mcp_activity = None;
                    notify_mcp_window(window, cx);
                }
            })
            .ok();
        }));
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

    fn cached_runtime_document(&mut self) -> (Arc<loora_engine::Document>, u64) {
        let key = RuntimeDocumentKey {
            revision: self.engine.revision(),
            preview_generation: self.preview_runtime_generation,
            preview_mode: self.preview_mode,
            breakpoint_id: self.active_breakpoint_id.clone(),
        };
        if let Some((cached_key, document)) = self.runtime_document_cache.as_ref() {
            if cached_key == &key {
                return (document.clone(), self.runtime_document_generation);
            }
        }

        let mut document = if self.preview_variants.is_empty() {
            self.engine.document().clone()
        } else {
            let mut runtime = CanvasEngine::new(self.engine.document().clone());
            let mut variants: Vec<_> = self.preview_variants.iter().collect();
            variants.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
            for (id, variant) in variants {
                let _ = runtime.apply_variant(id, variant.clone());
            }
            runtime.document().clone()
        };
        if let Some(width) = self.active_breakpoint_id.as_ref().and_then(|id| {
            document
                .breakpoints
                .iter()
                .find(|breakpoint| &breakpoint.id == id)
                .map(|breakpoint| breakpoint.preview_width.max(1.0))
        }) {
            document = CanvasEngine::new(document).resolved_document_at_width(width);
        }
        if self.preview_mode {
            let current_page = self
                .preview_current_page
                .as_ref()
                .unwrap_or(&document.root_page_id)
                .clone();
            let overlay = self.preview_overlay.clone();
            for node in document.nodes.values_mut() {
                if node.is_root_frame()
                    && node.id != current_page
                    && overlay.as_ref() != Some(&node.id)
                {
                    node.hidden = true;
                }
            }
            for id in &self.preview_hidden {
                if let Some(node) = document.nodes.get_mut(id) {
                    node.hidden = true;
                }
            }
        }
        self.runtime_document_generation = self.runtime_document_generation.wrapping_add(1);
        let document = Arc::new(document);
        self.runtime_document_cache = Some((key, document.clone()));
        (document, self.runtime_document_generation)
    }

    fn sync_native_canvas(&mut self, cx: &mut Context<Self>) {
        let (document, revision) = self.cached_runtime_document();
        let camera = self.camera;
        let selection = self.selection.clone();
        let agent_nodes = self
            .mcp_activity
            .as_ref()
            .map(|activity| activity.node_ids.clone())
            .unwrap_or_default();
        let tool = self.tool;
        let preview = self.preview_mode;
        let preview_overlay = self
            .preview_mode
            .then(|| self.preview_overlay.clone())
            .flatten();
        let text_edit = self.text_edit.as_ref().map(|session| NativeTextEdit {
            id: session.id.clone(),
            anchor: session.anchor,
            caret: session.caret,
            caret_visible: self.native_caret_visible,
            marked_range: session.marked_range.clone(),
        });
        self.native_canvas.update(cx, |canvas, cx| {
            canvas.set_scene(
                document,
                revision,
                camera,
                selection,
                agent_nodes,
                tool,
                preview,
                preview_overlay,
                text_edit,
                CanvasPalette::default(),
                cx,
            );
        });
    }

    fn handle_native_canvas_event(&mut self, event: &CanvasEvent, cx: &mut Context<Self>) {
        match event {
            CanvasEvent::SelectionChanged(selection) => {
                self.selection = selection
                    .iter()
                    .filter(|id| self.engine.node(id).is_some())
                    .cloned()
                    .collect();
                self.clear_props_focus();
                if let Some(last) = self.selection.last().cloned() {
                    self.reveal_layer(&last);
                }
            }
            CanvasEvent::CameraChanged(camera) => {
                self.camera = *camera;
            }
            CanvasEvent::MoveCommitted {
                ids,
                dx,
                dy,
                duplicate,
                drop_world,
            } => {
                let mut working_ids = ids.clone();
                if *duplicate {
                    if let Ok(new_ids) = self.engine.duplicate_nodes(&working_ids, Vec2::default())
                    {
                        if !new_ids.is_empty() {
                            working_ids = new_ids;
                        }
                    }
                }
                let mut changed = false;
                let mut handled_by_stack = false;
                if working_ids.len() == 1 {
                    let id = &working_ids[0];
                    let target = self.engine.drop_target_at(*drop_world, Some(id));
                    let target_is_stack = self.engine.node(&target).is_some_and(|node| {
                        matches!(node.layout.mode, LayoutMode::Flex | LayoutMode::Grid)
                    });
                    if target_is_stack {
                        if let Ok(placed) = self.engine.place_in_stack_at(id, &target, *drop_world)
                        {
                            handled_by_stack = true;
                            changed |= placed;
                        }
                    } else {
                        let was_flow = self
                            .engine
                            .node(id)
                            .is_some_and(|node| node.layout.position == LayoutPosition::Flow);
                        if was_flow {
                            if let Some(bounds) = self.engine.absolute_bounds(id) {
                                changed |= self
                                    .engine
                                    .set_world_position(
                                        id,
                                        Vec2::new(bounds.x + dx, bounds.y + dy),
                                        None,
                                    )
                                    .is_ok();
                            }
                            let current_parent =
                                self.engine.node(id).and_then(|node| node.parent_id.clone());
                            if current_parent.as_ref() != Some(&target)
                                && self.engine.node(&target).is_some_and(Node::is_container)
                            {
                                changed |= self.engine.reparent_keep_world(id, &target).is_ok();
                            }
                            handled_by_stack = true;
                        }
                    }
                }
                if !handled_by_stack && self.engine.move_nodes(&working_ids, *dx, *dy, None).is_ok()
                {
                    changed = true;
                    if working_ids.len() == 1 {
                        let id = &working_ids[0];
                        let target = self.engine.drop_target_at(*drop_world, Some(id));
                        let current_parent =
                            self.engine.node(id).and_then(|node| node.parent_id.clone());
                        if current_parent.as_ref() != Some(&target)
                            && self.engine.node(&target).is_some_and(Node::is_container)
                        {
                            changed |= self.engine.reparent_keep_world(id, &target).is_ok();
                        }
                    }
                }
                if changed {
                    self.selection = working_ids;
                    self.note_change(cx);
                }
            }
            CanvasEvent::TransformCommitted { bounds, rotations } => {
                if self.engine.transform_nodes(bounds, rotations).is_ok() {
                    let mut selection = bounds
                        .iter()
                        .map(|(id, _)| id.clone())
                        .chain(rotations.iter().map(|(id, _)| id.clone()))
                        .collect::<Vec<_>>();
                    selection.sort();
                    selection.dedup();
                    if !selection.is_empty() {
                        self.selection = selection;
                        self.note_change(cx);
                    }
                }
            }
            CanvasEvent::LayoutMetricsChanged { id, gap, padding } => {
                if self.selection.as_slice() == std::slice::from_ref(id) {
                    self.patch_selected_layout(
                        |layout| {
                            layout.gap = *gap;
                            layout.padding = *padding;
                        },
                        cx,
                    );
                }
            }
            CanvasEvent::CreateCommitted { tool, bounds } => {
                if let Some(id) =
                    self.commit_draw(*tool, bounds.x, bounds.y, bounds.width, bounds.height, cx)
                {
                    self.select_only(id.clone());
                    self.tool = CanvasTool::Select;
                    if *tool == CanvasTool::Image {
                        self.open_image_picker(id, cx);
                    } else if *tool == CanvasTool::Text {
                        self.begin_edit_text(id, cx);
                    }
                    self.note_change(cx);
                }
            }
            CanvasEvent::ToolChanged(tool) => self.set_tool(*tool, cx),
            CanvasEvent::ContextMenuRequested {
                position,
                world,
                hit,
            } => {
                self.blur_props_if_needed(cx);
                self.context_menu = None;
                if let Some(id) = hit {
                    if self.engine.node(id).is_some() && !self.selection.contains(id) {
                        self.select_only(id.clone());
                    }
                } else {
                    self.clear_selection();
                }
                self.context_world = Some(*world);
                let entries = self.context_menu_entries(cx);
                let highlight = first_action_index(&entries);
                self.context_menu = Some(ContextMenuState {
                    position: *position,
                    highlight,
                    entries,
                });
            }
            CanvasEvent::PreviewTriggered { id, trigger } => {
                let trigger = match trigger {
                    PreviewTrigger::Click => InteractionTrigger::Click,
                    PreviewTrigger::DoubleClick => InteractionTrigger::DoubleClick,
                    PreviewTrigger::Hover => {
                        self.preview_hovered = Some(id.clone());
                        self.preview_hover_started_at = Some(Instant::now());
                        self.preview_hover_exited = None;
                        InteractionTrigger::Hover
                    }
                    PreviewTrigger::HoverEnd => {
                        self.preview_hovered = None;
                        self.preview_hover_exited = Some((id.clone(), Instant::now()));
                        InteractionTrigger::HoverEnd
                    }
                };
                self.dispatch_preview_trigger(id, trigger, None, cx);
            }
            CanvasEvent::OverlayCloseRequested => {
                if self.preview_mode && self.preview_overlay.take().is_some() {
                    self.preview_runtime_generation =
                        self.preview_runtime_generation.wrapping_add(1);
                }
            }
            CanvasEvent::BeginTextEdit { id, anchor, caret } => {
                self.begin_edit_text(id.clone(), cx);
                if let Some(session) = self.text_edit.as_mut() {
                    session.anchor = *anchor;
                    session.caret = *caret;
                }
            }
            CanvasEvent::EndTextEdit => self.end_edit_text(cx),
            CanvasEvent::TextSelectionChanged { id, anchor, caret } => {
                if let Some(session) = self.text_edit.as_mut().filter(|session| &session.id == id) {
                    session.anchor = *anchor;
                    session.caret = *caret;
                    session.marked_range = None;
                    self.native_caret_visible = true;
                }
            }
            CanvasEvent::TextEdited {
                id,
                text,
                anchor,
                caret,
                marked_range,
            } => {
                if let Some(session) = self.text_edit.as_mut().filter(|session| &session.id == id) {
                    session.anchor = *anchor;
                    session.caret = *caret;
                    session.marked_range = marked_range.clone();
                    self.native_caret_visible = true;
                    let _ = self.apply_text_edit(text.clone(), cx);
                }
            }
            CanvasEvent::ChooseImage(id) => {
                self.select_only(id.clone());
                self.open_image_picker(id.clone(), cx);
            }
        }
        cx.notify();
    }

    fn handle_native_external_drop(
        &mut self,
        paths: &ExternalPaths,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let world = self.native_canvas.read(cx).pointer_world();
        self.context_world = world;
        self.last_pointer_world = world;
        if !self.paste_external_paths(paths.paths(), cx) {
            cx.notify();
        }
    }

    pub fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        self.sidebar_visible = !self.sidebar_visible;
        cx.notify();
    }

    pub fn toggle_properties(&mut self, cx: &mut Context<Self>) {
        self.properties_visible = !self.properties_visible;
        if !self.properties_visible {
            self.clear_props_focus();
            self.close_color_picker(cx);
        }
        cx.notify();
    }

    pub fn open_command_dialog(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        self.refresh_files();
        self.command_open = true;
        self.command_query.clear();
        self.command_index = 0;
        self.command_edit = Some(TextCursor::at_end(0));
        self.command_mcp_open = false;
        self.mcp_setup_status = None;
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
            self.command_mcp_open = false;
            self.mcp_setup_status = None;
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
        if self.command_mcp_open {
            MCP_SUBCOMMAND_COUNT
        } else {
            self.filtered_command_files().len() + self.command_action_count()
        }
    }

    fn command_action_count(&self) -> usize {
        command_action_count(self.mcp_endpoint.is_some(), self.command_mcp_open)
    }

    pub fn open_mcp_commands(&mut self, cx: &mut Context<Self>) {
        if self.mcp_endpoint.is_none() {
            return;
        }
        self.command_mcp_open = true;
        self.command_query.clear();
        self.command_index = 0;
        self.command_edit = None;
        self.mcp_setup_status = None;
        cx.notify();
    }

    fn close_mcp_commands(&mut self, cx: &mut Context<Self>) {
        self.command_mcp_open = false;
        self.command_query.clear();
        self.command_index = BASE_COMMAND_ACTION_COUNT;
        self.command_edit = Some(TextCursor::at_end(0));
        self.mcp_setup_status = None;
        cx.notify();
    }

    fn confirm_command_selection(&mut self, cx: &mut Context<Self>) {
        if self.command_mcp_open {
            match self.command_index {
                0 => {
                    self.copy_mcp_url(cx);
                    self.close_command_dialog(cx);
                }
                1 => self.add_mcp_to_client(McpClient::Claude, cx),
                2 => self.add_mcp_to_client(McpClient::Codex, cx),
                3 => self.add_mcp_to_client(McpClient::Cursor, cx),
                4 => self.add_mcp_to_client(McpClient::OpenCode, cx),
                _ => {}
            }
            return;
        }

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
            5 if self.mcp_endpoint.is_some() => {
                self.open_mcp_commands(cx);
            }
            _ => {
                let action_count = self.command_action_count();
                let files = self.filtered_command_files();
                if let Some(file) = self
                    .command_index
                    .checked_sub(action_count)
                    .and_then(|index| files.get(index))
                {
                    let id = file.id.clone();
                    self.open_design(&id, cx);
                    self.close_command_dialog(cx);
                }
            }
        }
    }

    pub fn copy_mcp_url(&mut self, cx: &mut Context<Self>) {
        if let Some(endpoint) = self.mcp_endpoint.as_ref() {
            cx.write_to_clipboard(ClipboardItem::new_string(endpoint.clone()));
        }
    }

    pub fn add_mcp_to_client(&mut self, client: McpClient, cx: &mut Context<Self>) {
        let Some(endpoint) = self.mcp_endpoint.as_deref() else {
            return;
        };
        self.mcp_setup_status = Some(match loora_mcp::install_client(client, endpoint) {
            Ok(_) => (
                format!(
                    "Added to {} · reopen it if it is already running",
                    client.name()
                ),
                true,
            ),
            Err(err) => {
                eprintln!(
                    "loora: failed to add MCP server to {}: {err}",
                    client.name()
                );
                (format!("Could not add to {} · {err}", client.name()), false)
            }
        });
        cx.notify();
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
        if !changed {
            return;
        }
        self.settings_route_active = active;
        self.settings_section = section;
        if !active {
            self.shortcut_recording = None;
            self.shortcut_search_focused = false;
        }
        cx.notify();
    }

    pub fn set_canvas_route_active(&mut self, active: bool, cx: &mut Context<Self>) {
        if active {
            self.set_settings_route_active(false, SettingsSection::General, cx);
        }
    }

    pub fn set_developer_inspector_open(&mut self, open: bool, cx: &mut Context<Self>) {
        if self.developer_inspector_open == open {
            return;
        }
        self.developer_inspector_open = open;
        cx.notify();
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

    pub fn shortcut_search_focused(&self) -> bool {
        self.shortcut_search_focused
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

    pub fn clear_shortcut_search(&mut self, cx: &mut Context<Self>) {
        if self.shortcut_search.is_empty() {
            return;
        }
        self.shortcut_search.clear();
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
                eprintln!("loora: create_design → {}", doc.id);
                let _ = std::io::Write::flush(&mut std::io::stderr());
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
                let result = match ext.as_str() {
                    "png" => export_page_png(this.engine.document(), &path),
                    "html" | "htm" => {
                        let html =
                            standalone_html(this.engine.document(), &HtmlCanvasOptions::default());
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
        self._autosave_task = None;
        self.engine.replace_document(doc);
        self.saved_revision = self.engine.revision();
        self.dirty = false;
        self.save_failed = false;
        self.clear_selection();
        self.text_edit = None;
        self._caret_task = None;
        self.collapsed = default_collapsed_layers(&self.engine);
        self.layer_scroll = UniformListScrollHandle::new();
        self.note_collapsed_changed();
        self.camera = Camera::new(Vec2::new(40.0, 40.0), 1.0);
        self.refresh_files();
        self.pending_fit_all = true;
        self.fit_all_pages(cx);
    }

    pub fn save_now(&mut self, cx: &mut Context<Self>) {
        if self.engine.revision() == self.saved_revision && !self.dirty && !self.save_failed {
            return;
        }
        let document = self.engine.document().clone();
        match self.store.save(&document) {
            Ok(()) => {
                let _ = self.store.set_active(&document.id);
                self.saved_revision = self.engine.revision();
                self.dirty = false;
                self.save_failed = false;
                self.refresh_files();
                cx.notify();
            }
            Err(err) => {
                eprintln!("loora: save failed: {err}");
                self.save_failed = true;
                self.dirty = true;
                cx.notify();
            }
        }
    }

    fn schedule_autosave(&mut self, cx: &mut Context<Self>) {
        if self.engine.revision() == self.saved_revision {
            // Nothing to write; don't leave a stale dirty flag without a task.
            self.dirty = false;
            return;
        }
        self.dirty = true;
        self.save_failed = false;
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
            self.native_caret_visible = true;
            self.select_only(id);
            self.start_caret_blink(cx);
            cx.notify();
        }
    }

    fn end_edit_text(&mut self, cx: &mut Context<Self>) {
        self._caret_task = None;
        self.native_caret_visible = true;
        if self.text_edit.take().is_some() {
            self.note_change(cx);
        } else {
            cx.notify();
        }
    }

    fn start_caret_blink(&mut self, cx: &mut Context<Self>) {
        self._caret_task = Some(cx.spawn(async move |this, cx| loop {
            cx.background_executor()
                .timer(Duration::from_millis(530))
                .await;
            let cont = this
                .update(cx, |this, cx| {
                    if this.text_edit.is_some() {
                        this.native_caret_visible = !this.native_caret_visible;
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

    fn apply_inline_text_style(
        &mut self,
        id: &NodeId,
        typography: TypographyPatch,
        color: Option<Color>,
        coalesce_key: Option<String>,
    ) -> Option<bool> {
        let session = self
            .text_edit
            .as_ref()
            .filter(|session| &session.id == id && session.has_selection())?;
        let node = self.engine.node(id)?.clone();
        let text = node.text.as_deref().unwrap_or("");
        let (start, end) = session.sorted();
        let runs = patch_text_runs(text, &node.text_runs, start..end, typography, color);
        Some(self.engine.set_text_runs(id, runs, coalesce_key).is_ok())
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
        let mut parent = self.engine.node(id).and_then(|node| node.parent_id.clone());
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
        if let Some(index) = self
            .cached_layer_rows()
            .iter()
            .position(|row| &row.id == id)
        {
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
        let can_group = editable.len() >= 2 && editable.iter().all(|n| !n.locked) && {
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
                changed |= self.engine.set_stroke(&id, Some(stroke), None).is_ok();
            }
        } else if let Some(axis) = action.strip_prefix("wmode:") {
            let mode = match axis {
                "fixed" => SizeMode::Fixed,
                "percent" => SizeMode::Percent,
                "hug" => SizeMode::Hug,
                "fill" => SizeMode::Fill,
                _ => return,
            };
            changed = self.patch_selected_layout_bool(|layout| {
                layout.width_mode = mode;
                if mode == SizeMode::Fill {
                    layout.grow = layout.grow.max(1.0);
                }
                if mode == SizeMode::Percent && layout.width_percent.is_none() {
                    layout.width_percent = Some(100.0);
                }
            });
        } else if let Some(axis) = action.strip_prefix("hmode:") {
            let mode = match axis {
                "fixed" => SizeMode::Fixed,
                "percent" => SizeMode::Percent,
                "hug" => SizeMode::Hug,
                "fill" => SizeMode::Fill,
                _ => return,
            };
            changed = self.patch_selected_layout_bool(|layout| {
                layout.height_mode = mode;
                if mode == SizeMode::Percent && layout.height_percent.is_none() {
                    layout.height_percent = Some(100.0);
                }
            });
        } else if let Some(name) = action.strip_prefix("variant:") {
            for id in self.selection.clone() {
                changed |= self.engine.set_variant(&id, Some(name.to_string())).is_ok();
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

    fn paste_external_paths(
        &mut self,
        paths: &[std::path::PathBuf],
        cx: &mut Context<Self>,
    ) -> bool {
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
        match self.engine.duplicate_nodes(&ids, Vec2::new(16.0, 16.0)) {
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
                    if let Some(changed) = self.apply_inline_text_style(
                        &id,
                        TypographyPatch::default(),
                        Some(color),
                        coalesce.clone(),
                    ) {
                        changed
                    } else {
                        let mut typography = node.effective_typography();
                        typography.color = color;
                        self.engine
                            .set_typography(&id, typography, coalesce)
                            .is_ok()
                    }
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
            PropsField::WidthPercent => {
                format_number(node.layout.width_percent.unwrap_or(100.0), 1)
            }
            PropsField::HeightPercent => {
                format_number(node.layout.height_percent.unwrap_or(100.0), 1)
            }
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
            PropsField::TextAlign => {
                format!("{:?}", node.effective_typography().align).to_lowercase()
            }
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
            PropsField::MotionDelay => format_number(
                node.transition
                    .as_ref()
                    .map(|t| t.delay_ms as f64)
                    .unwrap_or(0.0),
                0,
            ),
            PropsField::AnimationDelay => format_number(
                node.animations
                    .first()
                    .map(|animation| animation.delay_ms as f64)
                    .unwrap_or(0.0),
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

    pub fn cycle_selection_columns(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        self.patch_selected_layout(
            |layout| {
                layout.columns = if layout.columns >= 6 {
                    1
                } else {
                    layout.columns.max(1) + 1
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
            let visual_states =
                if states.hover.is_none() && states.press.is_none() && states.focus.is_none() {
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

    pub fn toggle_press_preset(&mut self, cx: &mut Context<Self>) {
        self.toggle_visual_state_preset("press", cx);
    }

    pub fn toggle_focus_preset(&mut self, cx: &mut Context<Self>) {
        self.toggle_visual_state_preset("focus", cx);
    }

    fn toggle_visual_state_preset(&mut self, kind: &str, cx: &mut Context<Self>) {
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
            match kind {
                "press" => {
                    states.press = states.press.is_none().then_some(VisualState {
                        opacity: Some(0.94),
                        scale: Some(0.97),
                        fill: None,
                        transform: None,
                        style: None,
                    });
                }
                "focus" => {
                    states.focus = states.focus.is_none().then_some(VisualState {
                        opacity: None,
                        scale: Some(1.01),
                        fill: None,
                        transform: Some(MotionTransform {
                            y: Some(-2.0),
                            ..MotionTransform::default()
                        }),
                        style: None,
                    });
                }
                _ => return,
            }
            let visual_states =
                if states.hover.is_none() && states.press.is_none() && states.focus.is_none() {
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

    pub fn cycle_animation_preset(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        if self.preview_mode {
            return;
        }

        let presets = animation_presets();
        let mut library = self.engine.document().animations.clone();
        let mut library_changed = false;
        for preset in &presets {
            if !library.iter().any(|animation| animation.id == preset.id) {
                library.push(preset.clone());
                library_changed = true;
            }
        }
        if library_changed {
            let _ = self.engine.set_document_animations(library);
        }

        let ids = ["loora-fade-up", "loora-scale-in", "loora-pulse"];
        let mut changed = library_changed;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked {
                continue;
            }
            let mut attachments = node.animations;
            let current = attachments.first().map(|a| a.animation_id.as_str());
            let next = match current {
                None => Some(ids[0]),
                Some(current) if current == ids[0] => Some(ids[1]),
                Some(current) if current == ids[1] => Some(ids[2]),
                Some(current) if current == ids[2] => None,
                Some(_) => Some(ids[0]),
            };
            match (attachments.first_mut(), next) {
                (Some(attachment), Some(next)) => attachment.animation_id = next.into(),
                (None, Some(next)) => attachments.push(NodeAnimation {
                    animation_id: next.into(),
                    trigger: AnimationTrigger::Load,
                    delay_ms: 0.0,
                    once: false,
                }),
                (Some(_), None) => {
                    attachments.remove(0);
                }
                (None, None) => {}
            }
            changed |= self.engine.set_node_animations(&id, attachments).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn cycle_animation_trigger(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        let triggers = [
            AnimationTrigger::Load,
            AnimationTrigger::InView,
            AnimationTrigger::Hover,
            AnimationTrigger::Press,
            AnimationTrigger::Always,
        ];
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked || node.animations.is_empty() {
                continue;
            }
            let mut attachments = node.animations;
            let current = attachments[0].trigger;
            let index = triggers
                .iter()
                .position(|trigger| *trigger == current)
                .unwrap_or(0);
            attachments[0].trigger = triggers[(index + 1) % triggers.len()];
            changed |= self.engine.set_node_animations(&id, attachments).is_ok();
        }
        if changed {
            self.note_change(cx);
        }
    }

    pub fn toggle_animation_once(&mut self, cx: &mut Context<Self>) {
        self.blur_props_if_needed(cx);
        let mut changed = false;
        for id in self.selection.clone() {
            let Some(node) = self.engine.node(&id).cloned() else {
                continue;
            };
            if node.locked || node.animations.is_empty() {
                continue;
            }
            let mut attachments = node.animations;
            attachments[0].once = !attachments[0].once;
            changed |= self.engine.set_node_animations(&id, attachments).is_ok();
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
            let current = node.variant.clone().unwrap_or_else(|| names[0].clone());
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
                PropsField::FontSize => {
                    let size = value.max(1.0) as f32;
                    self.apply_inline_text_style(
                        &id,
                        TypographyPatch {
                            size: Some(size),
                            ..TypographyPatch::default()
                        },
                        None,
                        coalesce("font-size"),
                    )
                    .unwrap_or_else(|| {
                        self.engine
                            .set_font_size(&id, size, coalesce("font-size"))
                            .is_ok()
                    })
                }
                PropsField::Rotation => self
                    .engine
                    .set_rotation(&id, value as f32, coalesce("property:rotation"))
                    .is_ok(),
                PropsField::Gap
                | PropsField::Grow
                | PropsField::Shrink
                | PropsField::WidthPercent
                | PropsField::HeightPercent
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
                        PropsField::WidthPercent => {
                            layout.width_percent = Some(value.clamp(0.0, 1000.0))
                        }
                        PropsField::HeightPercent => {
                            layout.height_percent = Some(value.clamp(0.0, 1000.0))
                        }
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
                        let patch = match field {
                            PropsField::FontWeight => TypographyPatch {
                                weight: Some(value.clamp(1.0, 1000.0) as u16),
                                ..TypographyPatch::default()
                            },
                            PropsField::LineHeight => TypographyPatch {
                                line_height: Some(value.max(0.0) as f32),
                                ..TypographyPatch::default()
                            },
                            PropsField::LetterSpacing => TypographyPatch {
                                letter_spacing: Some(value as f32),
                                ..TypographyPatch::default()
                            },
                            _ => TypographyPatch::default(),
                        };
                        self.apply_inline_text_style(&id, patch, None, coalesce("property:type"))
                            .unwrap_or_else(|| {
                                let mut typography = node.effective_typography();
                                match field {
                                    PropsField::FontWeight => {
                                        typography.weight = value.clamp(1.0, 1000.0) as u16
                                    }
                                    PropsField::LineHeight => {
                                        typography.line_height = Some(value.max(0.0) as f32)
                                    }
                                    PropsField::LetterSpacing => {
                                        typography.letter_spacing = value as f32
                                    }
                                    _ => {}
                                }
                                self.engine
                                    .set_typography(&id, typography, coalesce("property:type"))
                                    .is_ok()
                            })
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
                PropsField::MotionDelay => {
                    let mut transition = node.transition.unwrap_or_default();
                    transition.delay_ms = value.max(0.0) as f32;
                    self.engine.set_transition(&id, Some(transition)).is_ok()
                }
                PropsField::AnimationDelay => {
                    let mut animations = node.animations;
                    let Some(animation) = animations.first_mut() else {
                        continue;
                    };
                    animation.delay_ms = value.max(0.0) as f32;
                    self.engine.set_node_animations(&id, animations).is_ok()
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
                            changed |= self
                                .apply_inline_text_style(
                                    &selected,
                                    TypographyPatch::default(),
                                    Some(color),
                                    None,
                                )
                                .unwrap_or_else(|| {
                                    let mut typography = selected_node.effective_typography();
                                    typography.color = color;
                                    self.engine
                                        .set_typography(&selected, typography, None)
                                        .is_ok()
                                });
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
                                changed |= self
                                    .apply_inline_text_style(
                                        &selected,
                                        TypographyPatch {
                                            family: Some(family.into()),
                                            ..TypographyPatch::default()
                                        },
                                        None,
                                        None,
                                    )
                                    .unwrap_or_else(|| {
                                        let mut typography = selected_node.effective_typography();
                                        typography.family = family.into();
                                        self.engine
                                            .set_typography(&selected, typography, None)
                                            .is_ok()
                                    });
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
                        changed |= self
                            .engine
                            .set_typography(&selected, typography, None)
                            .is_ok();
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
            | PropsField::WidthPercent
            | PropsField::HeightPercent
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
            | PropsField::FontWeight
            | PropsField::LineHeight
            | PropsField::LetterSpacing
            | PropsField::GradientAngle
            | PropsField::Columns
            | PropsField::MotionDuration
            | PropsField::MotionDelay
            | PropsField::AnimationDelay
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
                    changed |= self
                        .engine
                        .set_interactions(&selected, interactions)
                        .is_ok();
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
                                text_edit::insert(&mut self.props_draft, &mut session, &value.text);
                                break;
                            }
                        }
                    }
                }
                "left" => text_edit::move_home(&mut session, &self.props_draft, modifiers.shift),
                "right" => text_edit::move_end(&mut session, &self.props_draft, modifiers.shift),
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
            "left" => text_edit::move_left(&mut session, &self.props_draft, modifiers.shift),
            "right" => text_edit::move_right(&mut session, &self.props_draft, modifiers.shift),
            "up" | "home" => text_edit::move_home(&mut session, &self.props_draft, modifiers.shift),
            "down" | "end" => text_edit::move_end(&mut session, &self.props_draft, modifiers.shift),
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
            self.pending_fit_all = false;
            cx.notify();
            return;
        };
        let vb = self.viewport_bounds.get();
        let w = f32::from(vb.size.width) as f64;
        let h = f32::from(vb.size.height) as f64;
        if w > 1.0 && h > 1.0 {
            self.camera.fit_bounds(w, h, bounds, 72.0);
            self.pending_fit_all = false;
        } else {
            self.pending_fit_all = true;
        }
        cx.notify();
    }

    fn flush_pending_fit_all(&mut self, cx: &mut Context<Self>) {
        if !self.pending_fit_all {
            return;
        }
        let vb = self.viewport_bounds.get();
        let w = f32::from(vb.size.width) as f64;
        let h = f32::from(vb.size.height) as f64;
        if w > 1.0 && h > 1.0 {
            self.fit_all_pages(cx);
        }
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

    fn toggle_layers_sidebar(
        &mut self,
        _: &ToggleLayersSidebar,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.toggle_sidebar(cx);
    }

    fn toggle_properties_sidebar(
        &mut self,
        _: &TogglePropertiesSidebar,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.toggle_properties(cx);
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
                        if mods.alt {
                            text_edit::move_word_left(&mut session, &text, extend);
                        } else {
                            text_edit::move_left(&mut session, &text, extend);
                        }
                        session.marked_range = None;
                        self.text_edit = Some(session);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "right" => {
                        if mods.alt {
                            text_edit::move_word_right(&mut session, &text, extend);
                        } else {
                            text_edit::move_right(&mut session, &text, extend);
                        }
                        session.marked_range = None;
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
                                self.text_edit = Some(session);
                                // Printable text goes through GPUI's input handler so IME,
                                // dead keys and composed Unicode all share one path.
                                return;
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
        if key == "space" {
            self.native_space_pan = true;
            self.native_canvas
                .update(cx, |canvas, cx| canvas.set_space_pan(true, cx));
            cx.stop_propagation();
            return;
        }
        if key == "escape" {
            if self.preview_mode {
                if self.preview_overlay.take().is_some() {
                    self.preview_runtime_generation =
                        self.preview_runtime_generation.wrapping_add(1);
                    cx.notify();
                } else {
                    self.set_tool(CanvasTool::Preview, cx);
                }
            } else if self.tool != CanvasTool::Select {
                self.set_tool(CanvasTool::Select, cx);
            } else {
                self.clear_selection();
                cx.notify();
            }
            cx.stop_propagation();
            return;
        }
        if matches!(key, "left" | "right" | "up" | "down") && !self.selection.is_empty() {
            let amount = if event.keystroke.modifiers.shift {
                10.0
            } else {
                1.0
            };
            let (dx, dy) = match key {
                "left" => (-amount, 0.0),
                "right" => (amount, 0.0),
                "up" => (0.0, -amount),
                "down" => (0.0, amount),
                _ => unreachable!(),
            };
            if self
                .engine
                .move_nodes(
                    &self.selection.clone(),
                    dx,
                    dy,
                    Some("keyboard-nudge".into()),
                )
                .is_ok()
            {
                self.note_change(cx);
            }
            cx.stop_propagation();
            return;
        }
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

    fn on_key_up(&mut self, event: &KeyUpEvent, _window: &mut Window, cx: &mut Context<Self>) {
        if self.native_space_pan && event.keystroke.key.as_str() == "space" {
            self.native_space_pan = false;
            self.native_canvas
                .update(cx, |canvas, cx| canvas.set_space_pan(false, cx));
            cx.stop_propagation();
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

    fn on_settings_key_down(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
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

        if key == "escape"
            && self.shortcut_search_focused
            && self.settings_section == SettingsSection::Shortcuts
        {
            if self.shortcut_search.is_empty() {
                self.shortcut_search_focused = false;
            } else {
                self.shortcut_search.clear();
            }
            cx.stop_propagation();
            cx.notify();
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
            if self.command_mcp_open {
                self.close_mcp_commands(cx);
            } else {
                self.close_command_dialog(cx);
            }
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

    fn tool_preview(&mut self, _: &ToolPreview, _: &mut Window, cx: &mut Context<Self>) {
        if self.capture_typing_char("p", cx) {
            return;
        }
        self.set_tool(CanvasTool::Preview, cx);
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

fn mcp_argument_node_ids(
    tool: &str,
    arguments: &serde_json::Value,
    engine: &CanvasEngine,
) -> Vec<NodeId> {
    let mut ids = Vec::new();
    match tool {
        "readTree" => push_mcp_node_ref(arguments.get("root"), &mut ids),
        "readNode" | "viewNode" => push_mcp_node_ref(arguments.get("ref"), &mut ids),
        "insertNodes" => push_mcp_node_ref(arguments.get("parent"), &mut ids),
        "patchNodes" => {
            for change in arguments
                .get("changes")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
            {
                push_mcp_node_ref(change.get("ref"), &mut ids);
            }
        }
        "moveNodes" => {
            for change in arguments
                .get("changes")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
            {
                push_mcp_node_ref(change.get("nodeId"), &mut ids);
                push_mcp_node_ref(change.get("parentId"), &mut ids);
            }
        }
        "deleteNodes" => push_mcp_node_refs(arguments.get("nodeIds"), &mut ids),
        "createInstance" => {
            push_mcp_node_ref(arguments.get("parent"), &mut ids);
            push_mcp_node_ref(arguments.get("componentId"), &mut ids);
        }
        "animateNodes" => push_mcp_node_refs(arguments.get("refs"), &mut ids),
        "exportCode" | "getScreenshot" | "viewPage" => {
            push_mcp_node_ref(arguments.get("pageId"), &mut ids)
        }
        _ => {}
    }
    retain_live_unique_nodes(ids, engine)
}

fn mcp_result_node_ids(
    result: &serde_json::Value,
    effect: &UiEffect,
    engine: &CanvasEngine,
) -> Vec<NodeId> {
    let mut ids = Vec::new();
    for key in ["created", "changed", "moved", "animated"] {
        push_mcp_node_refs(result.get(key), &mut ids);
    }
    for key in ["page", "component", "instance", "focused"] {
        push_mcp_node_ref(result.get(key), &mut ids);
    }
    if let UiEffect::FocusNodes(focused) = effect {
        ids.extend(focused.iter().map(|id| NodeId::from(id.as_str())));
    }
    retain_live_unique_nodes(ids, engine)
}

fn push_mcp_node_refs(value: Option<&serde_json::Value>, ids: &mut Vec<NodeId>) {
    if let Some(values) = value.and_then(serde_json::Value::as_array) {
        for value in values {
            push_mcp_node_ref(Some(value), ids);
        }
    }
}

fn push_mcp_node_ref(value: Option<&serde_json::Value>, ids: &mut Vec<NodeId>) {
    let Some(value) = value else {
        return;
    };
    let id = value
        .as_str()
        .or_else(|| value.get("nodeId").and_then(serde_json::Value::as_str));
    if let Some(id) = id {
        ids.push(NodeId::from(id));
    }
}

fn retain_live_unique_nodes(ids: Vec<NodeId>, engine: &CanvasEngine) -> Vec<NodeId> {
    let mut seen = HashSet::new();
    ids.into_iter()
        .filter(|id| engine.document().nodes.contains_key(id) && seen.insert(id.clone()))
        .collect()
}

fn mcp_activity_copy(tool: &str, succeeded: Option<bool>) -> &'static str {
    let (running, complete) = match tool {
        "getUsage" => ("Checking local usage", "Usage checked"),
        "listDesigns" => ("Browsing designs", "Designs loaded"),
        "getDesignContext" => ("Reading the design", "Design read"),
        "readTree" => ("Reading layers", "Layers read"),
        "readNode" => ("Inspecting a layer", "Layer inspected"),
        "searchNodes" => ("Searching the canvas", "Canvas searched"),
        "createPage" => ("Creating a page", "Page created"),
        "insertNodes" => ("Adding layers", "Layers added"),
        "patchNodes" => ("Updating layers", "Layers updated"),
        "moveNodes" => ("Moving layers", "Layers moved"),
        "deleteNodes" => ("Removing layers", "Layers removed"),
        "createComponent" => ("Creating a component", "Component created"),
        "createInstance" => ("Creating an instance", "Instance created"),
        "setTokens" => ("Updating tokens", "Tokens updated"),
        "setAnimations" => ("Updating animations", "Animations updated"),
        "animateNodes" => ("Animating layers", "Layers animated"),
        "exportCode" => ("Exporting code", "Code exported"),
        "getScreenshot" => ("Capturing the canvas", "Canvas captured"),
        "viewNode" => ("Focusing a layer", "Layer focused"),
        "viewPage" => ("Focusing a page", "Page focused"),
        "viewCanvas" => ("Focusing the canvas", "Canvas focused"),
        "createDesign" => ("Creating a design", "Design created"),
        "renameDesign" => ("Renaming the design", "Design renamed"),
        "deleteDesign" => ("Deleting a design", "Design deleted"),
        "listBranches" => ("Reading branches", "Branches read"),
        "createBranch" => ("Creating a branch", "Branch created"),
        "proposeBranch" => ("Proposing a branch", "Branch proposed"),
        "reopenBranch" => ("Reopening a branch", "Branch reopened"),
        "compareBranch" => ("Comparing a branch", "Branch compared"),
        "applyBranch" => ("Applying a branch", "Branch applied"),
        "closeBranch" => ("Closing a branch", "Branch closed"),
        "listVersions" => ("Reading versions", "Versions read"),
        "listAssets" => ("Reading assets", "Assets read"),
        _ => ("Using a canvas tool", "Tool completed"),
    };
    match succeeded {
        None => running,
        Some(true) => complete,
        Some(false) => "Tool failed",
    }
}

fn mcp_activity_pill(activity: McpActivity, theme: Theme) -> Motion {
    let leaving = activity.phase == McpActivityPhase::Leaving;
    let color = match activity.succeeded {
        Some(true) => theme.green,
        Some(false) => theme.red,
        None => theme.accent,
    };
    let copy = mcp_activity_copy(&activity.tool, activity.succeeded);
    let initial = if leaving {
        MotionStyle::new().opacity(1.).y(px(0.))
    } else {
        MotionStyle::new().opacity(0.).y(px(-4.))
    };
    let animate = if leaving {
        MotionStyle::new().opacity(0.).y(px(-4.))
    } else {
        MotionStyle::new().opacity(1.).y(px(0.))
    };

    Motion::new()
        .id(SharedString::from(format!(
            "mcp-activity-{}-{}",
            activity.sequence,
            activity.phase.key()
        )))
        .initial(initial)
        .animate(animate)
        .transition(
            MotionTransition::tween(Duration::from_millis(if leaving { 180 } else { 160 }))
                .ease(Ease::EaseOut),
        )
        .flex()
        .items_center()
        .gap_2()
        .h(px(32.))
        .px_3()
        .rounded(px(10.))
        .border_1()
        .border_color(theme.border)
        .bg(theme.surface_raised)
        .child(div().size(px(6.)).rounded(px(3.)).bg(color))
        .child(
            div()
                .text_size(px(11.))
                .font_weight(gpui::FontWeight::MEDIUM)
                .text_color(theme.foreground)
                .child(copy),
        )
        .child(
            div()
                .text_size(px(10.))
                .text_color(theme.muted)
                .child(SharedString::from(activity.tool)),
        )
}

fn notify_mcp_window<T: 'static>(window: &mut Window, cx: &mut Context<T>) {
    cx.notify();
    window.refresh();
    // Background MCP work does not arrive through a platform input event, so
    // marking the window dirty alone does not request a native frame.
    cx.refresh_windows();
    request_native_mcp_frame(window, cx);
}

#[cfg(all(target_os = "macos", not(test)))]
fn request_native_mcp_frame<T: 'static>(window: &Window, cx: &Context<T>) {
    use objc2::rc::Retained;
    use objc2_app_kit::NSView;

    let Ok(handle) = HasWindowHandle::window_handle(window) else {
        return;
    };
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return;
    };
    // SAFETY: GPUI owns this NSView for at least as long as the Window. Retaining
    // it lets the queued main-thread redraw finish safely if the window closes.
    let Some(view) = (unsafe { Retained::<NSView>::retain(handle.ns_view.as_ptr().cast()) }) else {
        return;
    };
    cx.spawn(async move |_, _| {
        view.setNeedsDisplay(true);
        view.displayIfNeeded();
    })
    .detach();
}

#[cfg(any(not(target_os = "macos"), test))]
fn request_native_mcp_frame<T: 'static>(_: &Window, _: &Context<T>) {}

#[cfg(test)]
mod tests {
    use super::{
        command_action_count, mcp_activity_copy, mcp_argument_node_ids, notify_mcp_window,
        patch_text_runs, raster_export_svg,
    };
    use gpui::{
        div, Context, Entity, IntoElement, Render, TestAppContext, VisualTestContext, Window,
    };
    use loora_engine::{
        CanvasEngine, Color, Document, GradientStop, Layout, Node, Paint, TextRun, TypographyPatch,
    };

    struct WindowRefreshProbe {
        renders: usize,
    }

    impl Render for WindowRefreshProbe {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            self.renders += 1;
            div()
        }
    }

    #[gpui::test]
    fn mcp_updates_refresh_the_owning_window(cx: &mut TestAppContext) {
        let (view, cx): (Entity<WindowRefreshProbe>, &mut VisualTestContext) =
            cx.add_window_view(|_, _| WindowRefreshProbe { renders: 0 });

        view.update_in(cx, |_, window, cx| notify_mcp_window(window, cx));
        cx.run_until_parked();
        assert!(view.read_with(cx, |this, _| this.renders) >= 2);
    }

    #[test]
    fn native_raster_export_contains_real_svg_primitives() {
        let mut document = Document::empty("Raster export");
        let page = document.root_page_id.clone();
        let mut card = Node::rectangle("Card", page.clone(), Layout::new(20.0, 30.0, 240.0, 120.0));
        card.style.fills = vec![Paint::LinearGradient {
            angle: 90.0,
            stops: vec![
                GradientStop {
                    offset: 0.0,
                    color: Color::rgb(255, 0, 0),
                    token_id: None,
                },
                GradientStop {
                    offset: 0.5,
                    color: Color::rgb(0, 255, 0),
                    token_id: None,
                },
                GradientStop {
                    offset: 1.0,
                    color: Color::rgb(0, 0, 255),
                    token_id: None,
                },
            ],
        }];
        let label = Node::text(
            "Label",
            page,
            Layout::new(32.0, 48.0, 180.0, 36.0),
            "Native PNG",
        );
        document.nodes.insert(card.id.clone(), card);
        document.nodes.insert(label.id.clone(), label);

        let svg = raster_export_svg(&document).unwrap();
        assert!(svg.contains("<linearGradient"));
        assert_eq!(svg.matches("<stop ").count(), 3);
        assert!(svg.contains("<text "));
        assert!(!svg.contains("foreignObject"));
        let mut options = resvg::usvg::Options::default();
        options.fontdb_mut().load_system_fonts();
        assert!(resvg::usvg::Tree::from_str(&svg, &options).is_ok());
    }

    #[test]
    fn mcp_activity_tracks_patch_targets_and_readable_status() {
        let engine = CanvasEngine::new(Document::empty("Activity test"));
        let root = engine.root_page_id().as_str();
        let arguments = serde_json::json!({
            "changes": [{"ref": {"nodeId": root}, "patch": {"name": "Updated"}}]
        });

        let ids = mcp_argument_node_ids("patchNodes", &arguments, &engine);
        assert_eq!(ids.len(), 1);
        assert_eq!(ids[0].as_str(), root);
        assert_eq!(mcp_activity_copy("patchNodes", None), "Updating layers");
        assert_eq!(
            mcp_activity_copy("patchNodes", Some(true)),
            "Layers updated"
        );
        assert_eq!(mcp_activity_copy("patchNodes", Some(false)), "Tool failed");
    }

    #[test]
    fn command_palette_hides_mcp_subcommands_until_opened() {
        assert_eq!(command_action_count(false, false), 5);
        assert_eq!(command_action_count(true, false), 6);
        assert_eq!(command_action_count(true, true), 5);
    }

    #[test]
    fn inline_style_splits_and_preserves_existing_text_runs() {
        let existing = TextRun {
            start: 0,
            end: 11,
            typography: Some(TypographyPatch {
                weight: Some(700),
                ..TypographyPatch::default()
            }),
            color: None,
            color_token: None,
        };

        let runs = patch_text_runs(
            "hello world",
            &[existing],
            6..11,
            TypographyPatch::default(),
            Some(Color::rgb(255, 0, 0)),
        );

        assert_eq!(runs.len(), 2);
        assert_eq!((runs[0].start, runs[0].end), (0, 6));
        assert_eq!(runs[0].typography.as_ref().unwrap().weight, Some(700));
        assert_eq!((runs[1].start, runs[1].end), (6, 11));
        assert_eq!(runs[1].typography.as_ref().unwrap().weight, Some(700));
        assert_eq!(runs[1].color, Some(Color::rgb(255, 0, 0)));
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

/// Command palette actions always shown before the optional MCP setup actions.
const BASE_COMMAND_ACTION_COUNT: usize = 5;
const MCP_COMMAND_ACTION_COUNT: usize = 1;
const MCP_SUBCOMMAND_COUNT: usize = 5;

pub(super) fn command_action_count(mcp_available: bool, mcp_subcommands_open: bool) -> usize {
    if mcp_subcommands_open {
        MCP_SUBCOMMAND_COUNT
    } else {
        BASE_COMMAND_ACTION_COUNT + usize::from(mcp_available) * MCP_COMMAND_ACTION_COUNT
    }
}

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

fn patch_text_runs(
    text: &str,
    runs: &[TextRun],
    selection: Range<usize>,
    typography: TypographyPatch,
    color: Option<Color>,
) -> Vec<TextRun> {
    let selection = text_edit::clamp_boundary(text, selection.start)
        ..text_edit::clamp_boundary(text, selection.end);
    let selection_chars =
        text[..selection.start].chars().count()..text[..selection.end].chars().count();
    if selection_chars.is_empty() {
        return runs.to_vec();
    }
    let text_chars = text.chars().count();
    let mut boundaries = vec![0, text_chars, selection_chars.start, selection_chars.end];
    for run in runs {
        boundaries.push(run.start.min(text_chars));
        boundaries.push(run.end.min(text_chars));
    }
    boundaries.sort_unstable();
    boundaries.dedup();

    let mut normalized = Vec::<TextRun>::new();
    for boundary in boundaries.windows(2) {
        let start = boundary[0];
        let end = boundary[1];
        if start >= end {
            continue;
        }
        let existing = runs
            .iter()
            .rev()
            .find(|run| run.start <= start && run.end >= end);
        let selected = start >= selection_chars.start && end <= selection_chars.end;
        let mut run = existing.cloned().unwrap_or(TextRun {
            start,
            end,
            typography: None,
            color: None,
            color_token: None,
        });
        run.start = start;
        run.end = end;
        if selected {
            merge_typography_patch(&mut run.typography, &typography);
            if let Some(color) = color {
                run.color = Some(color);
                run.color_token = None;
            }
        }
        if run.typography.is_none() && run.color.is_none() && run.color_token.is_none() {
            continue;
        }
        if let Some(previous) = normalized.last_mut().filter(|previous| {
            previous.end == run.start
                && previous.typography == run.typography
                && previous.color == run.color
                && previous.color_token == run.color_token
        }) {
            previous.end = run.end;
        } else {
            normalized.push(run);
        }
    }
    normalized
}

fn merge_typography_patch(target: &mut Option<TypographyPatch>, patch: &TypographyPatch) {
    if patch == &TypographyPatch::default() {
        return;
    }
    let target = target.get_or_insert_with(TypographyPatch::default);
    if patch.family.is_some() {
        target.family.clone_from(&patch.family);
    }
    if patch.size.is_some() {
        target.size = patch.size;
    }
    if patch.weight.is_some() {
        target.weight = patch.weight;
    }
    if patch.line_height.is_some() {
        target.line_height = patch.line_height;
    }
    if patch.letter_spacing.is_some() {
        target.letter_spacing = patch.letter_spacing;
    }
    if patch.align.is_some() {
        target.align.clone_from(&patch.align);
    }
    if patch.wrap.is_some() {
        target.wrap = patch.wrap;
    }
    if patch.decoration.is_some() {
        target.decoration.clone_from(&patch.decoration);
    }
    if patch.transform.is_some() {
        target.transform.clone_from(&patch.transform);
    }
}

fn is_http_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn export_page_png(document: &loora_engine::Document, path: &Path) -> Result<(), String> {
    let svg = raster_export_svg(document)?;
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    options.resources_dir = path.parent().map(Path::to_path_buf);
    let tree = resvg::usvg::Tree::from_str(&svg, &options)
        .map_err(|error| format!("parse native SVG: {error}"))?;
    let size = tree.size().to_int_size();
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size.width(), size.height())
        .ok_or_else(|| "page is too large to rasterize".to_string())?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::default(),
        &mut pixmap.as_mut(),
    );
    pixmap
        .save_png(path)
        .map_err(|error| format!("write PNG: {error}"))
}

fn raster_export_svg(document: &loora_engine::Document) -> Result<String, String> {
    let engine = CanvasEngine::new(document.clone());
    let page_id = engine.root_page_id().clone();
    let page = engine
        .node(&page_id)
        .ok_or_else(|| "document has no active page".to_string())?;
    let page_bounds = engine
        .absolute_bounds(&page_id)
        .unwrap_or_else(|| EngineBounds::new(0.0, 0.0, page.layout.width, page.layout.height));
    let width = page_bounds.width.max(1.0);
    let height = page_bounds.height.max(1.0);
    let mut defs = String::new();
    let mut body = String::new();
    let mut gradient_index = 0usize;

    fn visit(
        engine: &CanvasEngine,
        id: &NodeId,
        page_origin: Vec2,
        defs: &mut String,
        body: &mut String,
        gradient_index: &mut usize,
    ) {
        let Some(node) = engine.node(id) else {
            return;
        };
        if node.hidden {
            return;
        }
        let Some(bounds) = engine.absolute_bounds(id) else {
            return;
        };
        let x = bounds.x - page_origin.x;
        let y = bounds.y - page_origin.y;
        let rotation = if node.rotation.abs() > f32::EPSILON {
            format!(
                " transform=\"rotate({} {} {})\"",
                svg_number(node.rotation as f64),
                svg_number(x + bounds.width * 0.5),
                svg_number(y + bounds.height * 0.5)
            )
        } else {
            String::new()
        };
        let opacity = node.style.opacity.clamp(0.0, 1.0);

        match node.kind {
            NodeKind::Text => body.push_str(&raster_text_markup(
                node,
                x,
                y,
                bounds.width,
                opacity,
                &rotation,
            )),
            NodeKind::Image => {
                for paint in node.style.fills.iter().rev() {
                    let fill = raster_fill(paint, defs, gradient_index);
                    body.push_str(&raster_shape_markup(
                        node,
                        x,
                        y,
                        bounds.width,
                        bounds.height,
                        &fill,
                        false,
                        opacity,
                        &rotation,
                    ));
                }
                if let Some(source) = node.image_path.as_deref() {
                    let preserve = match node.image_fit {
                        loora_engine::ImageFit::Cover => "xMidYMid slice",
                        loora_engine::ImageFit::Contain => "xMidYMid meet",
                        loora_engine::ImageFit::Fill => "none",
                    };
                    body.push_str(&format!(
                        "<image x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" href=\"{}\" preserveAspectRatio=\"{}\" opacity=\"{}\"{}/>",
                        svg_number(x),
                        svg_number(y),
                        svg_number(bounds.width),
                        svg_number(bounds.height),
                        xml_escape(source),
                        preserve,
                        svg_number(opacity as f64),
                        rotation,
                    ));
                }
            }
            NodeKind::Vector if !node.paths.is_empty() => {
                for path in &node.paths {
                    let fill = path.fill.map(svg_color).unwrap_or_else(|| "none".into());
                    let stroke = path
                        .stroke
                        .map(|color| {
                            format!(
                                " stroke=\"{}\" stroke-width=\"{}\"",
                                svg_color(color),
                                svg_number(path.stroke_width.unwrap_or(1.0) as f64)
                            )
                        })
                        .unwrap_or_default();
                    body.push_str(&format!(
                        "<path d=\"{}\" fill=\"{}\"{} opacity=\"{}\" transform=\"translate({} {}) scale({} {}) rotate({} {} {})\"/>",
                        xml_escape(&path.d),
                        fill,
                        stroke,
                        svg_number(opacity as f64),
                        svg_number(x),
                        svg_number(y),
                        svg_number(bounds.width / 100.0),
                        svg_number(bounds.height / 100.0),
                        svg_number(node.rotation as f64),
                        50,
                        50,
                    ));
                }
            }
            _ => {
                if node.style.fills.is_empty() {
                    body.push_str(&raster_shape_markup(
                        node,
                        x,
                        y,
                        bounds.width,
                        bounds.height,
                        "none",
                        true,
                        opacity,
                        &rotation,
                    ));
                } else {
                    for (index, paint) in node.style.fills.iter().rev().enumerate() {
                        let fill = raster_fill(paint, defs, gradient_index);
                        body.push_str(&raster_shape_markup(
                            node,
                            x,
                            y,
                            bounds.width,
                            bounds.height,
                            &fill,
                            index + 1 == node.style.fills.len(),
                            opacity,
                            &rotation,
                        ));
                    }
                }
            }
        }

        for child in engine.children(Some(id)) {
            visit(engine, &child.id, page_origin, defs, body, gradient_index);
        }
    }

    visit(
        &engine,
        &page_id,
        Vec2::new(page_bounds.x, page_bounds.y),
        &mut defs,
        &mut body,
        &mut gradient_index,
    );
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\"><defs>{}</defs>{}</svg>",
        svg_number(width),
        svg_number(height),
        svg_number(width),
        svg_number(height),
        defs,
        body,
    ))
}

fn raster_fill(paint: &Paint, defs: &mut String, index: &mut usize) -> String {
    match paint {
        Paint::Solid { color, .. } => svg_color(*color),
        Paint::LinearGradient { angle, stops } => {
            let id = format!("gradient-{}", *index);
            *index += 1;
            let radians = angle.to_radians();
            let dx = radians.sin() * 50.0;
            let dy = -radians.cos() * 50.0;
            defs.push_str(&format!(
                "<linearGradient id=\"{}\" x1=\"{}%\" y1=\"{}%\" x2=\"{}%\" y2=\"{}%\">",
                id,
                svg_number((50.0 - dx) as f64),
                svg_number((50.0 - dy) as f64),
                svg_number((50.0 + dx) as f64),
                svg_number((50.0 + dy) as f64),
            ));
            push_svg_stops(defs, stops);
            defs.push_str("</linearGradient>");
            format!("url(#{id})")
        }
        Paint::RadialGradient { cx, cy, stops, .. } => {
            let id = format!("gradient-{}", *index);
            *index += 1;
            let position = |value: f32| {
                if value.abs() <= 1.0 {
                    value * 100.0
                } else {
                    value
                }
            };
            defs.push_str(&format!(
                "<radialGradient id=\"{}\" cx=\"{}%\" cy=\"{}%\" r=\"75%\">",
                id,
                svg_number(position(*cx) as f64),
                svg_number(position(*cy) as f64),
            ));
            push_svg_stops(defs, stops);
            defs.push_str("</radialGradient>");
            format!("url(#{id})")
        }
    }
}

fn push_svg_stops(output: &mut String, stops: &[loora_engine::GradientStop]) {
    for stop in stops {
        output.push_str(&format!(
            "<stop offset=\"{}%\" stop-color=\"{}\" stop-opacity=\"{}\"/>",
            svg_number(stop.offset.clamp(0.0, 1.0) as f64 * 100.0),
            svg_color_opaque(stop.color),
            svg_number(stop.color.a.clamp(0.0, 1.0) as f64),
        ));
    }
}

fn raster_shape_markup(
    node: &Node,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    fill: &str,
    stroke: bool,
    opacity: f32,
    rotation: &str,
) -> String {
    let stroke = stroke
        .then(|| node.style.stroke.as_ref())
        .flatten()
        .map(|stroke| {
            format!(
                " stroke=\"{}\" stroke-width=\"{}\"",
                svg_color(stroke.color),
                svg_number(stroke.width as f64)
            )
        })
        .unwrap_or_default();
    let common = format!(
        " fill=\"{}\"{} opacity=\"{}\"{}",
        fill,
        stroke,
        svg_number(opacity as f64),
        rotation,
    );
    match node.shape_kind {
        loora_engine::ShapeKind::Ellipse => format!(
            "<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\"{}/>",
            svg_number(x + width * 0.5),
            svg_number(y + height * 0.5),
            svg_number(width * 0.5),
            svg_number(height * 0.5),
            common,
        ),
        loora_engine::ShapeKind::Line => format!(
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\"{}/>",
            svg_number(x),
            svg_number(y + height * 0.5),
            svg_number(x + width),
            svg_number(y + height * 0.5),
            common,
        ),
        _ => format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"{}\"{}/>",
            svg_number(x),
            svg_number(y),
            svg_number(width),
            svg_number(height),
            svg_number(node.style.corners.tl as f64),
            common,
        ),
    }
}

fn raster_text_markup(
    node: &Node,
    x: f64,
    y: f64,
    width: f64,
    opacity: f32,
    rotation: &str,
) -> String {
    let typography = node.effective_typography();
    let (text_x, anchor) = match typography.align {
        TextAlign::Left | TextAlign::Justify => (x, "start"),
        TextAlign::Center => (x + width * 0.5, "middle"),
        TextAlign::Right => (x + width, "end"),
    };
    let line_height = typography.line_height.unwrap_or(typography.size * 1.25);
    let lines = node
        .display_text()
        .split('\n')
        .enumerate()
        .map(|(index, line)| {
            format!(
                "<tspan x=\"{}\" y=\"{}\">{}</tspan>",
                svg_number(text_x),
                svg_number(y + typography.size as f64 + line_height as f64 * index as f64),
                xml_escape(line),
            )
        })
        .collect::<String>();
    format!(
        "<text font-family=\"{}\" font-size=\"{}\" font-weight=\"{}\" text-anchor=\"{}\" fill=\"{}\" opacity=\"{}\"{}>{}</text>",
        xml_escape(&typography.family),
        svg_number(typography.size as f64),
        typography.weight,
        anchor,
        svg_color(typography.color),
        svg_number(opacity as f64),
        rotation,
        lines,
    )
}

fn svg_color(color: Color) -> String {
    format!(
        "rgba({},{},{},{})",
        (color.r.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.g.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.b.clamp(0.0, 1.0) * 255.0).round() as u8,
        svg_number(color.a.clamp(0.0, 1.0) as f64),
    )
}

fn svg_color_opaque(color: Color) -> String {
    format!(
        "rgb({},{},{})",
        (color.r.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.g.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.b.clamp(0.0, 1.0) * 255.0).round() as u8,
    )
}

fn svg_number(value: f64) -> String {
    let mut value = format!("{value:.3}");
    while value.contains('.') && value.ends_with('0') {
        value.pop();
    }
    if value.ends_with('.') {
        value.pop();
    }
    value
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
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
        // App-level file/settings actions: work even when AppRoot (not canvas) is focused.
        "toggle_settings" => KeyBinding::new(keystroke, ToggleSettings, None),
        "new_design" => KeyBinding::new(keystroke, NewDesign, None),
        "open_designs" => KeyBinding::new(keystroke, ToggleFiles, None),
        "save_design" => KeyBinding::new(keystroke, SaveDesign, None),
        "undo" => KeyBinding::new(keystroke, Undo, context),
        "redo" => KeyBinding::new(keystroke, Redo, context),
        "zoom_in" => KeyBinding::new(keystroke, ZoomIn, context),
        "zoom_out" => KeyBinding::new(keystroke, ZoomOut, context),
        "zoom_reset" => KeyBinding::new(keystroke, ZoomReset, context),
        "fit_selection" => KeyBinding::new(keystroke, FitSelection, context),
        "fit_all" => KeyBinding::new(keystroke, FitAll, context),
        "toggle_layers" => KeyBinding::new(keystroke, ToggleLayersSidebar, context),
        "toggle_properties" => KeyBinding::new(keystroke, TogglePropertiesSidebar, context),
        "group" => KeyBinding::new(keystroke, GroupSelection, context),
        "ungroup" => KeyBinding::new(keystroke, UngroupSelection, context),
        "tool_select" => KeyBinding::new(keystroke, ToolSelect, context),
        "tool_hand" => KeyBinding::new(keystroke, ToolHand, context),
        "tool_preview" => KeyBinding::new(keystroke, ToolPreview, context),
        "tool_rectangle" => KeyBinding::new(keystroke, ToolRectangle, context),
        "tool_frame" => KeyBinding::new(keystroke, ToolFrame, context),
        "tool_text" => KeyBinding::new(keystroke, ToolText, context),
        "tool_image" => KeyBinding::new(keystroke, ToolImage, context),
        _ => return None,
    };
    Some(binding)
}

#[allow(clippy::too_many_arguments)]
fn native_toolbar_button(
    entity: Entity<CanvasWorkspace>,
    id: impl Into<SharedString>,
    icon: IconName,
    title: &'static str,
    shortcut: Option<&'static str>,
    selected: bool,
    enabled: bool,
    theme: Theme,
    action: impl 'static + Fn(&mut CanvasWorkspace, &mut Context<CanvasWorkspace>),
) -> impl IntoElement {
    let icon_color = if selected {
        theme.bright_white
    } else {
        theme.muted_strong
    };
    let button = div()
        .id(id.into())
        .flex()
        .items_center()
        .justify_center()
        .size(px(30.))
        .rounded(px(8.))
        .text_color(if selected {
            theme.bright_white
        } else {
            theme.muted_strong
        })
        .bg(if selected {
            theme.selected
        } else {
            gpui::transparent_black()
        })
        .when(enabled, |this| {
            this.cursor_pointer()
                .hover(move |style| style.bg(theme.hover))
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    entity.update(cx, |workspace, cx| action(workspace, cx));
                })
        })
        .when(!enabled, |this| this.opacity(0.35))
        .child(Icon::hugeicon(icon).size(px(15.)).text_color(icon_color));
    match shortcut {
        Some(shortcut) => button.tooltip(Tooltip::with_key(title, shortcut)),
        None => button.tooltip(Tooltip::text(title)),
    }
}

fn native_toolbar_divider(theme: Theme) -> impl IntoElement {
    div().w(px(1.)).h(px(18.)).mx(px(3.)).bg(theme.hairline())
}

#[allow(clippy::too_many_arguments)]
fn native_canvas_toolbar(
    entity: Entity<CanvasWorkspace>,
    selected_tool: CanvasTool,
    can_undo: bool,
    can_redo: bool,
    empty_page: bool,
    theme: Theme,
) -> impl IntoElement {
    let width = if empty_page { 532.0 } else { 444.0 };
    div()
        .absolute()
        .left(relative(0.5))
        .ml(px(-width / 2.0))
        .bottom(px(16.))
        .w(px(width))
        .h(px(40.))
        .px(px(6.))
        .flex()
        .items_center()
        .gap(px(2.))
        .rounded(px(12.))
        .border_1()
        .border_color(theme.hairline())
        .bg(theme.panel_bg())
        .shadow_lg()
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-select",
            IconName::Cursor,
            "Select",
            Some("V"),
            selected_tool == CanvasTool::Select,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Select, cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-hand",
            IconName::Hand,
            "Hand",
            Some("H"),
            selected_tool == CanvasTool::Hand,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Hand, cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-preview",
            IconName::View,
            "Preview",
            Some("P"),
            selected_tool == CanvasTool::Preview,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Preview, cx),
        ))
        .child(native_toolbar_divider(theme))
        .child(native_toolbar_button(
            entity.clone(),
            "native-toolbar-layers",
            IconName::LayoutRight,
            "Layers",
            Some("⌘B"),
            false,
            true,
            theme,
            |workspace, cx| workspace.toggle_sidebar(cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-toolbar-files",
            IconName::Folder,
            "Open…",
            Some("⌘K"),
            false,
            true,
            theme,
            |workspace, cx| workspace.toggle_files_panel(cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-frame",
            IconName::Grid,
            "Frame",
            Some("F"),
            selected_tool == CanvasTool::Frame,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Frame, cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-text",
            IconName::Text,
            "Text",
            Some("T"),
            selected_tool == CanvasTool::Text,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Text, cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-rectangle",
            IconName::Square,
            "Rectangle",
            Some("R"),
            selected_tool == CanvasTool::Rectangle,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Rectangle, cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-shapes",
            IconName::Shapes,
            "Shape",
            None,
            selected_tool == CanvasTool::Shapes,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Shapes, cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-image",
            IconName::Image,
            "Image",
            Some("I"),
            selected_tool == CanvasTool::Image,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Image, cx),
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-tool-component",
            IconName::Diamond,
            "Component",
            None,
            selected_tool == CanvasTool::Component,
            true,
            theme,
            |workspace, cx| workspace.set_tool(CanvasTool::Component, cx),
        ))
        .child(native_toolbar_divider(theme))
        .child(native_toolbar_button(
            entity.clone(),
            "native-toolbar-undo",
            IconName::Undo,
            "Undo",
            Some("⌘Z"),
            false,
            can_undo,
            theme,
            |workspace, cx| {
                if workspace.engine.undo().unwrap_or(false) {
                    workspace.note_change(cx);
                }
            },
        ))
        .child(native_toolbar_button(
            entity.clone(),
            "native-toolbar-redo",
            IconName::Redo,
            "Redo",
            Some("⌘⇧Z"),
            false,
            can_redo,
            theme,
            |workspace, cx| {
                if workspace.engine.redo().unwrap_or(false) {
                    workspace.note_change(cx);
                }
            },
        ))
        .when(empty_page, |this| {
            this.child(native_toolbar_divider(theme)).child(
                div()
                    .id("native-empty-draw")
                    .h(px(28.))
                    .px(px(10.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(8.))
                    .border_1()
                    .border_color(theme.hairline())
                    .bg(theme.highlight_fill())
                    .text_size(px(11.))
                    .text_color(theme.muted_strong)
                    .cursor_pointer()
                    .hover(move |style| style.text_color(theme.bright_white))
                    .on_click(move |_, _, cx| {
                        cx.stop_propagation();
                        entity.update(cx, |workspace, cx| {
                            workspace.set_tool(CanvasTool::Rectangle, cx);
                        });
                    })
                    .child("Draw · R"),
            )
        })
}

fn native_zoom_chip(entity: Entity<CanvasWorkspace>, zoom: f64, theme: Theme) -> impl IntoElement {
    div()
        .id("native-canvas-zoom")
        .absolute()
        .right(px(16.))
        .bottom(px(16.))
        .h(px(28.))
        .px(px(10.))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(7.))
        .border_1()
        .border_color(theme.hairline())
        .bg(theme.panel_bg())
        .shadow_lg()
        .text_size(px(11.))
        .text_color(theme.muted_strong)
        .cursor_pointer()
        .hover(move |style| style.text_color(theme.bright_white))
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            entity.update(cx, |workspace, cx| workspace.fit_selection_or_page(cx));
        })
        .child(format!("{:.0}%", zoom * 100.0))
}

fn animation_presets() -> [DocumentAnimation; 3] {
    let keyframe = |offset, opacity, transform| AnimationKeyframe {
        offset,
        opacity,
        transform,
    };
    [
        DocumentAnimation {
            id: "loora-fade-up".into(),
            name: "Fade up".into(),
            duration_ms: 300.0,
            easing: "ease-out".into(),
            cubic_bezier: None,
            delay_ms: 0.0,
            keyframes: vec![
                keyframe(
                    0.0,
                    Some(0.0),
                    Some(MotionTransform {
                        y: Some(16.0),
                        ..MotionTransform::default()
                    }),
                ),
                keyframe(
                    1.0,
                    Some(1.0),
                    Some(MotionTransform {
                        y: Some(0.0),
                        ..MotionTransform::default()
                    }),
                ),
            ],
            iterations: 1.0,
            infinite: false,
            direction: "normal".into(),
            fill: "both".into(),
        },
        DocumentAnimation {
            id: "loora-scale-in".into(),
            name: "Scale in".into(),
            duration_ms: 240.0,
            easing: "ease-out".into(),
            cubic_bezier: None,
            delay_ms: 0.0,
            keyframes: vec![
                keyframe(
                    0.0,
                    Some(0.0),
                    Some(MotionTransform {
                        scale: Some(0.94),
                        ..MotionTransform::default()
                    }),
                ),
                keyframe(
                    1.0,
                    Some(1.0),
                    Some(MotionTransform {
                        scale: Some(1.0),
                        ..MotionTransform::default()
                    }),
                ),
            ],
            iterations: 1.0,
            infinite: false,
            direction: "normal".into(),
            fill: "both".into(),
        },
        DocumentAnimation {
            id: "loora-pulse".into(),
            name: "Pulse".into(),
            duration_ms: 900.0,
            easing: "ease-in-out".into(),
            cubic_bezier: None,
            delay_ms: 0.0,
            keyframes: vec![
                keyframe(
                    0.0,
                    None,
                    Some(MotionTransform {
                        scale: Some(1.0),
                        ..MotionTransform::default()
                    }),
                ),
                keyframe(
                    0.5,
                    None,
                    Some(MotionTransform {
                        scale: Some(1.04),
                        ..MotionTransform::default()
                    }),
                ),
                keyframe(
                    1.0,
                    None,
                    Some(MotionTransform {
                        scale: Some(1.0),
                        ..MotionTransform::default()
                    }),
                ),
            ],
            iterations: 1.0,
            infinite: true,
            direction: "normal".into(),
            fill: "both".into(),
        },
    ]
}

impl Render for CanvasWorkspace {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.flush_pending_fit_all(cx);
        self.sync_native_canvas(cx);
        let theme = self.theme;
        let entity = cx.entity();
        let native_canvas = self.native_canvas.clone();
        let native_tool = self.tool;
        let native_zoom = self.camera.zoom;
        let native_can_undo = self.engine.can_undo();
        let native_can_redo = self.engine.can_redo();
        let sidebar_visible = self.sidebar_visible;
        let properties_visible = self.properties_visible;
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
        let native_empty_page = !self.preview_mode
            && pages.iter().any(|(page_id, _)| {
                !self
                    .engine
                    .document()
                    .nodes
                    .values()
                    .any(|node| node.parent_id.as_ref() == Some(page_id))
            });
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
        let command_mcp_open = self.command_mcp_open;
        let command_selection = self
            .command_edit
            .as_ref()
            .map(|cursor| (cursor.anchor, cursor.caret));
        let files = self.files.clone();
        let active_id = self.document_id();
        let dirty = self.dirty;
        let save_failed = self.save_failed;
        let doc_name = self.document_name();
        let mcp_available = self.mcp_endpoint.is_some();
        let mcp_setup_status = self.mcp_setup_status.clone();
        let mcp_activity = self.mcp_activity.clone();
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
            .on_action(cx.listener(Self::toggle_layers_sidebar))
            .on_action(cx.listener(Self::toggle_properties_sidebar))
            .on_action(cx.listener(Self::workspace_quit))
            .on_action(cx.listener(Self::tool_select))
            .on_action(cx.listener(Self::tool_hand))
            .on_action(cx.listener(Self::tool_preview))
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
            .on_key_up(cx.listener(Self::on_key_up))
            .on_drop(cx.listener(Self::handle_native_external_drop))
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
                            .relative()
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
                                        this.child(div().flex().items_center().gap_1().children(
                                            pages.into_iter().map(|(page_id, name)| {
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
                                            }),
                                        ))
                                    }),
                            )
                            .when_some(mcp_activity, |this, activity| {
                                this.child(
                                    div()
                                        .absolute()
                                        .top(px(10.))
                                        .left_0()
                                        .right_0()
                                        .flex()
                                        .justify_center()
                                        .h(px(32.))
                                        .child(mcp_activity_pill(activity, theme)),
                                )
                            })
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
                                            .text_color(if save_failed {
                                                theme.red
                                            } else {
                                                theme.muted
                                            })
                                            .child(if save_failed {
                                                "Save failed"
                                            } else if dirty {
                                                "Unsaved"
                                            } else {
                                                "Saved"
                                            }),
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
                            .child(native_canvas)
                            .child(native_canvas_toolbar(
                                entity.clone(),
                                native_tool,
                                native_can_undo,
                                native_can_redo,
                                native_empty_page,
                                theme,
                            ))
                            .child(native_zoom_chip(entity.clone(), native_zoom, theme)),
                    ),
            )
            .when(properties_visible, |this| {
                this.child(PropertiesPanel::new(
                    entity.clone(),
                    theme,
                    props_nodes,
                    props_bounds,
                    props_view,
                ))
            })
            .when(command_open, |this| {
                this.child(FilesCommandDialog::new(
                    entity.clone(),
                    theme,
                    active_id,
                    files,
                    command_query,
                    command_index,
                    command_selection,
                    command_mcp_open,
                    dirty,
                    mcp_available,
                    mcp_setup_status,
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
