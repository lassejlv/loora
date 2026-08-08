//! Embedded WebKit canvas hosted inside the native GPUI editor shell.
//!
//! This is a small compatibility adapter around Wry's child webview API. It is
//! intentionally local: the published `gpui-wry` crate pulls a separate GPUI
//! source, while this adapter uses the exact GPUI revision of the application.

use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    rc::Rc,
};

use gpui::{
    canvas, div, prelude::FluentBuilder, px, rgba, App, Bounds, ContentMask, Element, ElementId,
    Entity, FocusHandle, Focusable, GlobalElementId, Hitbox, InteractiveElement, IntoElement,
    LayoutId, MouseDownEvent, ParentElement, Pixels, Render, Size, Style, Styled, Window,
};
use loora_engine::CompiledCanvas;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use wry::{
    dpi::{LogicalPosition, LogicalSize, Position, Size as WrySize},
    http::{header::CONTENT_TYPE, Response},
    Rect, WebViewBuilder,
};

pub type CanvasIpcSender = async_channel::Sender<String>;

/// Prepare Linux for wry's WebKitGTK child webview: force the X11 GDK backend
/// and initialize GTK on this thread. Safe to call multiple times.
#[cfg(target_os = "linux")]
pub fn init_linux_canvas() {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        // wry downcasts gdk::Display to X11Display for build_as_child.
        std::env::set_var("GDK_BACKEND", "x11");
        if let Err(err) = gtk::init() {
            eprintln!("loora: gtk::init failed (canvas webview may be unavailable): {err}");
        }
    });
}

/// Remap GPUI's Linux `Xcb` window handle to the `Xlib` shape wry's child
/// webview expects. Xlib/xcb window ids are the same server-side XID; wry only
/// reads `.window` and parents via GDK's own display.
struct WryParent<'a>(&'a Window);

impl HasWindowHandle for WryParent<'_> {
    fn window_handle(
        &self,
    ) -> Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError> {
        let raw = HasWindowHandle::window_handle(self.0)?.as_raw();
        match raw {
            RawWindowHandle::Xlib(_) => {
                // SAFETY: reborrowing the same raw handle already obtained above.
                Ok(unsafe { raw_window_handle::WindowHandle::borrow_raw(raw) })
            }
            #[cfg(target_os = "linux")]
            RawWindowHandle::Xcb(xcb) => {
                let mut xlib = raw_window_handle::XlibWindowHandle::new(xcb.window.get() as _);
                xlib.visual_id = xcb.visual_id.map(|v| v.get() as _).unwrap_or(0);
                // SAFETY: forged Xlib handle carries the same XID wry needs for parenting.
                Ok(unsafe { raw_window_handle::WindowHandle::borrow_raw(xlib.into()) })
            }
            _ => Err(raw_window_handle::HandleError::NotSupported),
        }
    }
}

pub struct CanvasWebView {
    focus_handle: FocusHandle,
    webview: Option<Rc<wry::WebView>>,
    visible: bool,
    bounds: Bounds<Pixels>,
    applied_bounds: Rc<Cell<Bounds<Pixels>>>,
    viewport_bounds: Rc<Cell<Bounds<Pixels>>>,
    allowed_assets: Rc<RefCell<HashSet<PathBuf>>>,
    /// Last applied markup. Matching markup means we can refresh CSS only.
    last_markup: RefCell<String>,
}

impl CanvasWebView {
    pub fn new(
        window: &mut Window,
        cx: &mut App,
        ipc_sender: CanvasIpcSender,
        viewport_bounds: Rc<Cell<Bounds<Pixels>>>,
    ) -> Self {
        #[cfg(target_os = "linux")]
        init_linux_canvas();

        let allowed_assets = Rc::new(RefCell::new(HashSet::new()));
        let protocol_assets = allowed_assets.clone();
        let webview = WebViewBuilder::new()
            .with_html(CANVAS_SHELL)
            .with_devtools(cfg!(debug_assertions))
            .with_ipc_handler(move |request| {
                let _ = ipc_sender.try_send(request.body().clone());
            })
            .with_custom_protocol("loora-asset".into(), move |_id, request| {
                asset_response(request.uri().path(), &protocol_assets.borrow())
            })
            .build_as_child(&WryParent(window))
            .and_then(|webview| {
                webview.set_bounds(Rect {
                    position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                    size: WrySize::Logical(LogicalSize::new(1.0, 1.0)),
                })?;
                Ok(Rc::new(webview))
            })
            .map_err(|error| {
                eprintln!("loora: embedded HTML canvas unavailable: {error}");
                error
            })
            .ok();

        Self {
            focus_handle: cx.focus_handle(),
            webview,
            visible: true,
            bounds: Bounds::default(),
            applied_bounds: Rc::new(Cell::new(Bounds::default())),
            viewport_bounds,
            allowed_assets,
            last_markup: RefCell::new(String::new()),
        }
    }

    pub fn apply_canvas(
        &mut self,
        compiled: &CompiledCanvas,
        camera: loora_engine::Camera,
        selection: &[loora_engine::NodeId],
        tool: &str,
        preview: bool,
        can_undo: bool,
        can_redo: bool,
        chrome: &str,
    ) -> Result<(), String> {
        let Some(webview) = self.webview.as_ref() else {
            return Ok(());
        };
        let selection_ids = selection.iter().map(|id| id.as_str()).collect::<Vec<_>>();
        let camera_json = serde_json::json!({
            "x": camera.pan.x,
            "y": camera.pan.y,
            "zoom": camera.zoom,
        });
        let css_only = *self.last_markup.borrow() == compiled.markup && !compiled.markup.is_empty();
        if css_only {
            let payload = serde_json::json!({
                "type": "patch-css",
                "css": compiled.css,
                "camera": camera_json,
                "selection": selection_ids,
                "tool": tool,
                "preview": preview,
                "canUndo": can_undo,
                "canRedo": can_redo,
                "chrome": chrome,
            });
            return self.command(payload);
        }
        *self.last_markup.borrow_mut() = compiled.markup.clone();
        let payload = serde_json::json!({
            "markup": compiled.markup,
            "css": compiled.css,
            "camera": camera_json,
            "selection": selection_ids,
            "tool": tool,
            "preview": preview,
            "canUndo": can_undo,
            "canRedo": can_redo,
            "chrome": chrome,
        });
        let script = format!("window.__looraApply({payload});");
        webview
            .evaluate_script(&script)
            .map_err(|error| format!("update canvas webview: {error}"))
    }

    pub fn request_png_export(&self) -> Result<(), String> {
        self.command(serde_json::json!({ "type": "export-png" }))
    }

    pub fn invalidate_markup_cache(&self) {
        self.last_markup.borrow_mut().clear();
    }

    pub fn accept_markup_baseline(&self, markup: &str) {
        *self.last_markup.borrow_mut() = markup.to_string();
    }

    pub fn command(&self, command: serde_json::Value) -> Result<(), String> {
        let Some(webview) = self.webview.as_ref() else {
            return Ok(());
        };
        webview
            .evaluate_script(&format!("window.__looraCommand({command});"))
            .map_err(|error| format!("canvas command: {error}"))
    }

    pub fn set_allowed_assets(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        let mut allowed = self.allowed_assets.borrow_mut();
        allowed.clear();
        for path in paths {
            allowed.insert(path.clone());
            if let Ok(canonical) = path.canonicalize() {
                allowed.insert(canonical);
            }
        }
    }

    pub fn set_visible(&mut self, visible: bool) {
        if self.visible == visible {
            return;
        }
        if let Some(webview) = self.webview.as_ref() {
            if visible {
                let _ = webview.set_visible(true);
            } else {
                let _ = webview.focus_parent();
                let _ = webview.set_visible(false);
            }
        }
        self.visible = visible;
    }

    pub fn visible(&self) -> bool {
        self.visible
    }
}

impl Drop for CanvasWebView {
    fn drop(&mut self) {
        if let Some(webview) = self.webview.as_ref() {
            let _ = webview.set_visible(false);
        }
    }
}

impl Focusable for CanvasWebView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for CanvasWebView {
    fn render(&mut self, window: &mut Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        let available = self.webview.is_some();
        div()
            .track_focus(&self.focus_handle)
            .size_full()
            .child({
                let entity = entity.clone();
                canvas(
                    move |bounds, _, cx| {
                        entity.update(cx, |view, _| {
                            view.bounds = bounds;
                            view.viewport_bounds.set(bounds);
                        })
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full()
            })
            .when(available, |this| {
                this.child(CanvasWebViewElement::new(
                    self.webview.clone().expect("checked available"),
                    entity,
                    window,
                    cx,
                ))
            })
            .when(!available, |this| {
                this.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(13.))
                        .text_color(rgba(0xffffff66))
                        .child("Canvas webview unavailable on this platform"),
                )
            })
    }
}

struct CanvasWebViewElement {
    parent: Entity<CanvasWebView>,
    view: Rc<wry::WebView>,
}

impl CanvasWebViewElement {
    fn new(
        view: Rc<wry::WebView>,
        parent: Entity<CanvasWebView>,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Self {
        Self { parent, view }
    }
}

impl IntoElement for CanvasWebViewElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for CanvasWebViewElement {
    type RequestLayoutState = ();
    type PrepaintState = Option<Hitbox>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let style = Style {
            flex_grow: 0.0,
            flex_shrink: 1.0,
            size: Size::full(),
            ..Style::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let parent = self.parent.read(cx);
        if !parent.visible() {
            return None;
        }
        let applied_bounds = parent.applied_bounds.clone();
        let bounds_changed = applied_bounds.get() != bounds;
        if bounds_changed {
            self.view
                .set_bounds(Rect {
                    position: Position::Logical(LogicalPosition::new(
                        f32::from(bounds.origin.x) as f64,
                        f32::from(bounds.origin.y) as f64,
                    )),
                    size: WrySize::Logical(LogicalSize::new(
                        f32::from(bounds.size.width) as f64,
                        f32::from(bounds.size.height) as f64,
                    )),
                })
                .ok()?;
            applied_bounds.set(bounds);
        }
        Some(window.insert_hitbox(bounds, gpui::HitboxBehavior::Normal))
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        hitbox: &mut Self::PrepaintState,
        window: &mut Window,
        _: &mut App,
    ) {
        #[cfg(target_os = "linux")]
        {
            // wry hosts WebKitGTK outside GPUI's event loop; drain GTK each frame.
            while gtk::events_pending() {
                gtk::main_iteration_do(false);
            }
        }

        let bounds = hitbox
            .as_ref()
            .map(|hitbox| hitbox.bounds)
            .unwrap_or(bounds);
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            let webview = self.view.clone();
            window.on_mouse_event(move |event: &MouseDownEvent, _, _, _| {
                if !bounds.contains(&event.position) {
                    let _ = webview.focus_parent();
                }
            });
        });
    }
}

fn asset_response(path: &str, allowed: &HashSet<PathBuf>) -> Response<Cow<'static, [u8]>> {
    let encoded = path.trim_start_matches('/');
    let decoded = decode_hex(encoded).map(PathBuf::from);
    let Some(path) = decoded else {
        return response(400, "text/plain", b"invalid asset path".to_vec());
    };
    let canonical = path.canonicalize().ok();
    if !allowed.contains(&path)
        && !canonical
            .as_ref()
            .is_some_and(|canonical| allowed.contains(canonical))
    {
        return response(403, "text/plain", b"asset not allowed".to_vec());
    }
    match fs::read(&path) {
        Ok(bytes) => response(200, mime_for_path(&path), bytes),
        Err(_) => response(404, "text/plain", b"asset not found".to_vec()),
    }
}

fn response(status: u16, mime: &'static str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, mime)
        .header("Access-Control-Allow-Origin", "*")
        .body(Cow::Owned(body))
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(&b"response error"[..])))
}

fn decode_hex(value: &str) -> Option<String> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    let mut bytes = Vec::with_capacity(value.len() / 2);
    for pair in value.as_bytes().chunks_exact(2) {
        let pair = std::str::from_utf8(pair).ok()?;
        bytes.push(u8::from_str_radix(pair, 16).ok()?);
    }
    String::from_utf8(bytes).ok()
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

const CANVAS_SHELL: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https: loora-asset:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data: http: https:">
<style>
:root{
  --loora-surface-bg:#0f0f10;
  --loora-surface-fg:#f1f2f6;
  --loora-page-label:rgba(255,255,255,.58);
  --loora-toolbar-bg:rgba(26,26,26,.95);
  --loora-toolbar-border:rgba(255,255,255,.1);
  --loora-toolbar-fg:rgba(220,220,225,.88);
  --loora-toolbar-hover:rgba(255,255,255,.08);
  --loora-toolbar-active:rgba(42,47,58,.95);
  --loora-toolbar-active-fg:#fff;
  --loora-toolbar-tip-bg:rgba(20,20,20,.96);
  --loora-toolbar-tip-fg:#f0f0f2;
  --loora-toolbar-shadow:0 8px 28px rgba(0,0,0,.35);
}
html[data-chrome="light"]{
  --loora-surface-bg:#e4e4e6;
  --loora-surface-fg:#1a1a1a;
  --loora-page-label:rgba(0,0,0,.45);
  --loora-toolbar-bg:rgba(255,255,255,.94);
  --loora-toolbar-border:rgba(0,0,0,.12);
  --loora-toolbar-fg:rgba(40,40,45,.88);
  --loora-toolbar-hover:rgba(0,0,0,.06);
  --loora-toolbar-active:rgba(0,0,0,.08);
  --loora-toolbar-active-fg:#111;
  --loora-toolbar-tip-bg:rgba(255,255,255,.96);
  --loora-toolbar-tip-fg:#1a1a1a;
  --loora-toolbar-shadow:0 8px 28px rgba(0,0,0,.12);
}
html,body,#loora-app{width:100%;height:100%;margin:0;overflow:hidden;background:var(--loora-surface-bg);color:var(--loora-surface-fg)}
#loora-surface{position:absolute;inset:0;overflow:hidden;touch-action:none;outline:none;background:var(--loora-surface-bg)}
/* Toolbar/zoom are peers of the surface — never a full-screen overlay above it.
   A full-bleed chrome layer (even with pointer-events:none) broke hit-testing for
   move/resize in the WKWebView. */
#loora-toolbar{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:2px;height:40px;padding:0 6px;border-radius:12px;border:1px solid var(--loora-toolbar-border);background:var(--loora-toolbar-bg);backdrop-filter:blur(12px);box-shadow:var(--loora-toolbar-shadow);z-index:50;pointer-events:auto}
#loora-toolbar .loora-tool,#loora-toolbar .loora-action{position:relative;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--loora-toolbar-fg);cursor:pointer}
#loora-toolbar .loora-tool:hover,#loora-toolbar .loora-action:hover{background:var(--loora-toolbar-hover)}
#loora-toolbar .loora-tool.is-active{background:var(--loora-toolbar-active);color:var(--loora-toolbar-active-fg)}
#loora-toolbar .loora-action:disabled{opacity:.35;cursor:default}
#loora-toolbar .loora-action:disabled:hover{background:transparent}
#loora-toolbar .loora-divider{width:1px;height:18px;margin:0 3px;background:var(--loora-toolbar-border)}
#loora-toolbar svg{width:15px;height:15px;display:block}
#loora-toolbar [data-tip]:hover::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);white-space:nowrap;padding:0 8px;height:24px;line-height:24px;border-radius:7px;border:1px solid var(--loora-toolbar-border);background:var(--loora-toolbar-tip-bg);color:var(--loora-toolbar-tip-fg);font:500 11px/24px -apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none;z-index:2;box-shadow:var(--loora-toolbar-shadow)}
#loora-zoom{position:absolute;right:16px;bottom:16px;height:28px;padding:0 10px;border-radius:7px;border:1px solid var(--loora-toolbar-border);background:var(--loora-toolbar-bg);color:var(--loora-toolbar-fg);font:500 11px/26px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;z-index:50;pointer-events:auto;box-shadow:var(--loora-toolbar-shadow)}
#loora-zoom:hover{color:var(--loora-toolbar-active-fg)}
#loora-context-menu[hidden]{display:none}
#loora-context-menu{position:fixed;z-index:100;min-width:220px;max-height:calc(100vh - 16px);padding:6px;border:1px solid var(--loora-toolbar-border);border-radius:10px;background:var(--loora-toolbar-bg);box-shadow:var(--loora-toolbar-shadow);backdrop-filter:blur(16px);overflow:auto;box-sizing:border-box;font:500 12px/1 -apple-system,BlinkMacSystemFont,sans-serif}
.loora-context-item{display:flex;align-items:center;justify-content:space-between;width:100%;height:32px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--loora-toolbar-fg);font:inherit;text-align:left;cursor:default}
.loora-context-item:hover,.loora-context-item.is-highlighted{background:var(--loora-toolbar-hover);color:var(--loora-toolbar-active-fg)}
.loora-context-item:disabled{opacity:.38}
.loora-context-item:disabled:hover{background:transparent;color:var(--loora-toolbar-fg)}
.loora-context-item.is-destructive{color:#ff6b72}
.loora-context-shortcut{margin-left:24px;color:color-mix(in srgb,var(--loora-toolbar-fg) 62%,transparent);font-size:11px}
.loora-context-separator{height:1px;margin:4px 8px;background:var(--loora-toolbar-border)}
</style>
<style id="loora-document-css"></style>
</head>
<body>
<div id="loora-app">
  <div id="loora-surface" tabindex="0"><div id="loora-scene"></div></div>
  <div id="loora-toolbar">
      <button type="button" class="loora-tool" data-tool="select" data-tip="Select  V"><svg viewBox="0 0 24 24" fill="none"><path d="M9.8 4.63 15.84 6.99c3.48 1.36 5.22 2.04 5.16 3.12-.06 1.08-1.87 1.58-5.5 2.57-.98.27-1.47.42-1.82.78-.35.35-.47.87-.75 1.87-1 3.63-1.49 5.45-2.57 5.51-1.08.06-1.76-1.68-3.12-5.16L4.63 9.8C3.2 6.16 2.49 4.34 3.41 3.41c.93-.92 2.75-.21 6.39 1.22Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>
      <button type="button" class="loora-tool" data-tool="hand" data-tip="Hand  H"><svg viewBox="0 0 24 24" fill="none"><path d="M14 5.5A1.5 1.5 0 0 1 17 5.5V12M14 5.5V3.5A1.5 1.5 0 0 0 11 3.5V5M14 5.5V11M11 5A1.5 1.5 0 0 0 8 5v8.46L6.38 11.84a2.05 2.05 0 0 0-2.51.14 1.9 1.9 0 0 0-.03 2.21L7.44 18.65C8.13 19.53 8.5 20.88 8.5 22M11 5v5M18 22v-1.16c0-.53.21-1.04.57-1.44.4-.46.9-1.1 1.1-1.6.33-.87.33-1.95.33-4.13V7.5A1.5 1.5 0 0 0 17 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="loora-tool" data-tool="preview" data-tip="Preview"><svg viewBox="0 0 24 24" fill="none"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg></button>
      <div class="loora-divider"></div>
      <button type="button" class="loora-action" data-cmd="sidebar" data-tip="Layers"><svg viewBox="0 0 24 24" fill="none"><path d="M3.89 3.89C5.28 2.5 7.52 2.5 12 2.5s6.72 0 8.11 1.39C21.5 5.28 21.5 7.52 21.5 12s0 6.72-1.39 8.11C18.72 21.5 16.48 21.5 12 21.5s-6.72 0-8.11-1.39C2.5 18.72 2.5 16.48 2.5 12s0-6.72 1.39-8.11Z" stroke="currentColor" stroke-width="1.5"/><path d="M15 2.5v19" stroke="currentColor" stroke-width="1.5"/></svg></button>
      <button type="button" class="loora-action" data-cmd="files" data-tip="Open…  ⌘K"><svg viewBox="0 0 24 24" fill="none"><path d="M3.5 8.5V7a2 2 0 0 1 2-2h4.2l2 2H18.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-6.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>
      <button type="button" class="loora-tool" data-tool="frame" data-tip="Frame  F"><svg viewBox="0 0 24 24" fill="none"><path d="M6 3v18M18 3v18M3 6h18M3 18h18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
      <button type="button" class="loora-tool" data-tool="text" data-tip="Text  T"><svg viewBox="0 0 24 24" fill="none"><path d="M5 5h14M12 5v14M9 19h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
      <button type="button" class="loora-tool" data-tool="rectangle" data-tip="Rectangle  R"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/></svg></button>
      <button type="button" class="loora-tool" data-tool="shapes" data-tip="Shape"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 20.5 18h-17L12 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>
      <button type="button" class="loora-tool" data-tool="image" data-tip="Image  I"><svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r="1.5" stroke="currentColor" stroke-width="1.5"/><path d="m7.5 16 3-3 2.5 2.5L16 12.5l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="loora-tool" data-tool="component" data-tip="Component"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3.5 8.5 8.5L12 20.5 3.5 12 12 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>
      <div class="loora-divider"></div>
      <button type="button" class="loora-action" data-cmd="undo" data-tip="Undo  ⌘Z" id="loora-undo"><svg viewBox="0 0 24 24" fill="none"><path d="M4 10h10a5 5 0 1 1 0 10H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 6 4 10l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="loora-action" data-cmd="redo" data-tip="Redo  ⌘⇧Z" id="loora-redo"><svg viewBox="0 0 24 24" fill="none"><path d="M20 10H10a5 5 0 1 0 0 10h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m16 6 4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>
  <button type="button" id="loora-zoom" data-cmd="fit-selection">100%</button>
  <div id="loora-context-menu" role="menu" hidden></div>
</div>
<script>
(() => {
  'use strict';
  const surface = document.getElementById('loora-surface');
  const scene = document.getElementById('loora-scene');
  const css = document.getElementById('loora-document-css');
  const zoomChip = document.getElementById('loora-zoom');
  const undoBtn = document.getElementById('loora-undo');
  const redoBtn = document.getElementById('loora-redo');
  const contextMenu = document.getElementById('loora-context-menu');
  const state = {
    camera: { x: 40, y: 40, zoom: 1 },
    selection: [],
    tool: 'select',
    preview: false,
    canUndo: false,
    canRedo: false,
    drag: null,
    dragFrame: 0,
    dragPointer: null,
    pendingDragCommit: null,
    pendingDragCommitTimer: 0,
    cameraPost: 0,
    spacePan: false,
    nodes: new Map(),
    handles: new Map(),
    groupBox: null,
    guideEls: [],
    contextMenuIndex: 0,
  };
  const SNAP_PX = 5;
  const GUIDE_LABEL_MIN = 1;
  const GUIDE_LABEL_MAX = 400;

  const post = (type, payload = {}) => {
    if (window.ipc && typeof window.ipc.postMessage === 'function') {
      window.ipc.postMessage(JSON.stringify({ type, ...payload }));
    }
  };
  const syncChromeTheme = chrome => {
    const next = chrome === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.chrome = next;
  };
  const syncChrome = () => {
    document.querySelectorAll('#loora-toolbar .loora-tool').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tool === state.tool);
    });
    if (zoomChip) zoomChip.textContent = `${Math.round(Math.max(.001, state.camera.zoom) * 100)}%`;
    if (undoBtn) undoBtn.disabled = !state.canUndo;
    if (redoBtn) redoBtn.disabled = !state.canRedo;
  };
  const contextMenuItems = () => [...contextMenu.querySelectorAll('.loora-context-item:not(:disabled)')];
  const highlightContextMenuItem = index => {
    const items = contextMenuItems();
    if (!items.length) return;
    state.contextMenuIndex = (index + items.length) % items.length;
    items.forEach((item, itemIndex) => item.classList.toggle('is-highlighted', itemIndex === state.contextMenuIndex));
  };
  const hideContextMenu = () => {
    contextMenu.hidden = true;
    contextMenu.replaceChildren();
    state.contextMenuIndex = 0;
  };
  const showContextMenu = command => {
    contextMenu.replaceChildren();
    for (const entry of command.entries || []) {
      if (entry.separator) {
        const separator = document.createElement('div');
        separator.className = 'loora-context-separator';
        separator.setAttribute('role', 'separator');
        contextMenu.appendChild(separator);
        continue;
      }
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `loora-context-item${entry.destructive ? ' is-destructive' : ''}`;
      item.dataset.contextAction = entry.id || '';
      item.disabled = entry.enabled === false;
      item.setAttribute('role', 'menuitem');
      const label = document.createElement('span');
      label.textContent = entry.label || '';
      item.appendChild(label);
      if (entry.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'loora-context-shortcut';
        shortcut.textContent = entry.shortcut;
        item.appendChild(shortcut);
      }
      item.addEventListener('pointerenter', () => {
        const items = contextMenuItems();
        const index = items.indexOf(item);
        if (index >= 0) highlightContextMenuItem(index);
      });
      contextMenu.appendChild(item);
    }
    contextMenu.hidden = false;
    const margin = 8;
    const x = Math.max(margin, Math.min(Number(command.x) || 0, innerWidth - contextMenu.offsetWidth - margin));
    const y = Math.max(margin, Math.min(Number(command.y) || 0, innerHeight - contextMenu.offsetHeight - margin));
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    highlightContextMenuItem(0);
  };
  contextMenu.addEventListener('pointerdown', event => event.stopPropagation());
  contextMenu.addEventListener('click', event => {
    const item = event.target.closest('[data-context-action]');
    if (!item || item.disabled) return;
    const action = item.dataset.contextAction;
    hideContextMenu();
    post('context-action', { action });
  });
  document.addEventListener('pointerdown', event => {
    if (!contextMenu.hidden && !contextMenu.contains(event.target)) hideContextMenu();
  }, true);
  window.addEventListener('blur', hideContextMenu);
  document.getElementById('loora-toolbar')?.addEventListener('pointerdown', event => {
    event.stopPropagation();
  });
  document.getElementById('loora-toolbar')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-tool],[data-cmd]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    if (btn.dataset.tool) post('command', { command: `tool:${btn.dataset.tool}` });
    else if (btn.dataset.cmd) post('command', { command: btn.dataset.cmd });
  });
  zoomChip?.addEventListener('pointerdown', event => event.stopPropagation());
  zoomChip?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    post('command', { command: 'fit-selection' });
  });
  const readyTimer = setInterval(() => post('ready'), 250);
  const nodeForId = id => state.nodes.get(id) || null;
  const targetNode = target => {
    const node = target instanceof Element ? target.closest('[data-loora-node]') : null;
    if (node) return node;
    const label = target instanceof Element ? target.closest('[data-loora-page-label]') : null;
    return label ? nodeForId(label.dataset.looraPageLabel) : null;
  };
  const isRootFrame = node => node?.dataset.looraRoot === 'true';
  const visualNode = node => isRootFrame(node)
    ? node.closest('.loora-page-host') || node
    : node;
  const cameraTransform = () => {
    scene.style.transform = `translate(${state.camera.x}px,${state.camera.y}px) scale(${state.camera.zoom})`;
    scene.style.setProperty('--loora-inverse-zoom', String(1 / Math.max(.001, state.camera.zoom)));
    syncOverlay();
    syncChrome();
  };
  const syncOverlay = () => {
    const overlay = scene.querySelector('.loora-overlay-page-host');
    let scrim = scene.querySelector('.loora-overlay-scrim');
    if (!overlay) { scrim?.remove(); return; }
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.className = 'loora-overlay-scrim';
      scrim.addEventListener('pointerdown', event => {
        if (event.target === scrim) post('overlay-close');
      });
      scene.insertBefore(scrim, scene.firstChild);
    }
    const zoom = Math.max(.001, state.camera.zoom);
    const viewportWidth = surface.clientWidth / zoom;
    const viewportHeight = surface.clientHeight / zoom;
    const left = -state.camera.x / zoom;
    const top = -state.camera.y / zoom;
    Object.assign(scrim.style, {
      left:`${left}px`, top:`${top}px`, width:`${viewportWidth}px`, height:`${viewportHeight}px`
    });
    const width = Math.max(1, overlay.offsetWidth);
    const height = Math.max(1, overlay.offsetHeight);
    const scale = Math.min(1, viewportWidth*.86/width, viewportHeight*.86/height);
    overlay.style.left = `${left + (viewportWidth-width*scale)/2}px`;
    overlay.style.top = `${top + (viewportHeight-height*scale)/2}px`;
    overlay.style.transform = `scale(${scale})`;
  };
  const worldPoint = event => {
    const bounds = surface.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - state.camera.x) / state.camera.zoom,
      y: (event.clientY - bounds.top - state.camera.y) / state.camera.zoom,
    };
  };
  const worldRect = node => {
    const rect = node.getBoundingClientRect();
    const bounds = surface.getBoundingClientRect();
    return {
      x: (rect.left - bounds.left - state.camera.x) / state.camera.zoom,
      y: (rect.top - bounds.top - state.camera.y) / state.camera.zoom,
      width: rect.width / state.camera.zoom,
      height: rect.height / state.camera.zoom,
    };
  };
  const renderedParentOrigin = node => {
    const parent = nodeForId(node?.dataset.looraParent);
    if (!parent) return { x:0, y:0 };
    const rect = worldRect(parent);
    return { x:rect.x, y:rect.y };
  };
  const xEdges = b => [b.x, b.x + b.width * 0.5, b.x + b.width];
  const yEdges = b => [b.y, b.y + b.height * 0.5, b.y + b.height];
  const clearGuides = () => {
    for (const el of state.guideEls) el.remove();
    state.guideEls = [];
  };
  // Distance from the dragged box to the nearest target that shares the snapped
  // edge, measured across the guide. Turns a bare alignment line into the
  // spacing readout designers expect while nudging things into a rhythm.
  const spacingLabels = (bounds, guides, targets) => {
    const labels = [];
    for (const g of guides) {
      const vertical = g.axis === 'v';
      let best = null;
      for (const tb of targets) {
        const aligned = vertical
          ? xEdges(tb).some(edge => Math.abs(edge - g.position) <= 0.75)
          : yEdges(tb).some(edge => Math.abs(edge - g.position) <= 0.75);
        if (!aligned) continue;
        const near = vertical ? bounds.y + bounds.height : bounds.x + bounds.width;
        const far = vertical ? bounds.y : bounds.x;
        const targetNear = vertical ? tb.y : tb.x;
        const targetFar = vertical ? tb.y + tb.height : tb.x + tb.width;
        let gap = null;
        let start = 0;
        if (targetNear >= near) { gap = targetNear - near; start = near; }
        else if (far >= targetFar) { gap = far - targetFar; start = targetFar; }
        if (gap === null || gap < GUIDE_LABEL_MIN || gap > GUIDE_LABEL_MAX) continue;
        if (best && gap >= best.gap) continue;
        best = {
          gap,
          x: vertical ? g.position : start + gap / 2,
          y: vertical ? start + gap / 2 : g.position,
        };
      }
      if (best) labels.push({ x:best.x, y:best.y, text:String(Math.round(best.gap)) });
    }
    return labels;
  };
  const snapFeedback = (bounds, targets) => {
    const guides = collectMatchingGuides(bounds, targets, 0.75);
    return { guides, labels:spacingLabels(bounds, guides, targets) };
  };
  const drawGuideLabels = labels => {
    for (const label of labels) {
      const el = document.createElement('div');
      el.className = 'loora-guide-label';
      el.textContent = label.text;
      el.style.left = `${label.x}px`;
      el.style.top = `${label.y}px`;
      scene.appendChild(el);
      state.guideEls.push(el);
    }
  };
  const drawGuides = (guides, labels = []) => {
    clearGuides();
    for (const g of guides) {
      const el = document.createElement('div');
      el.className = 'loora-guide ' + (g.axis === 'v' ? 'loora-guide-v' : 'loora-guide-h');
      if (g.axis === 'v') {
        Object.assign(el.style, {
          left: `${g.position}px`,
          top: `${g.start}px`,
          height: `${Math.max(0, g.end - g.start)}px`,
        });
      } else {
        Object.assign(el.style, {
          left: `${g.start}px`,
          top: `${g.position}px`,
          width: `${Math.max(0, g.end - g.start)}px`,
        });
      }
      scene.appendChild(el);
      state.guideEls.push(el);
    }
    drawGuideLabels(labels);
  };
  const pushMergedGuide = (list, pos, start, end, epsilon) => {
    const existing = list.find(item => Math.abs(item[0] - pos) <= epsilon);
    if (existing) {
      existing[1] = Math.min(existing[1], start);
      existing[2] = Math.max(existing[2], end);
    } else {
      list.push([pos, start, end]);
    }
  };
  const collectMatchingGuides = (bounds, targets, epsilon) => {
    const vertical = [];
    const horizontal = [];
    const mx = xEdges(bounds);
    const my = yEdges(bounds);
    for (const tb of targets) {
      const tx = xEdges(tb);
      const ty = yEdges(tb);
      for (const me of mx) {
        for (const te of tx) {
          if (Math.abs(me - te) <= epsilon) {
            pushMergedGuide(
              vertical,
              te,
              Math.min(bounds.y, tb.y),
              Math.max(bounds.y + bounds.height, tb.y + tb.height),
              epsilon
            );
          }
        }
      }
      for (const me of my) {
        for (const te of ty) {
          if (Math.abs(me - te) <= epsilon) {
            pushMergedGuide(
              horizontal,
              te,
              Math.min(bounds.x, tb.x),
              Math.max(bounds.x + bounds.width, tb.x + tb.width),
              epsilon
            );
          }
        }
      }
    }
    const guides = [];
    for (const [position, start, end] of vertical) {
      if (end - start > 0.5) guides.push({ axis: 'v', position, start, end });
    }
    for (const [position, start, end] of horizontal) {
      if (end - start > 0.5) guides.push({ axis: 'h', position, start, end });
    }
    return guides;
  };
  // `axis` locks movement to a single direction (shift-constrained drags), so the
  // perpendicular snap must be discarded or the lock leaks by a few pixels.
  const snapMove = (proposed, targets, threshold, axis) => {
    let dx = 0;
    let dy = 0;
    let bestX = threshold + 1;
    let bestY = threshold + 1;
    const mx = xEdges(proposed);
    const my = yEdges(proposed);
    for (const tb of targets) {
      const tx = xEdges(tb);
      const ty = yEdges(tb);
      for (const me of mx) {
        for (const te of tx) {
          const delta = te - me;
          const abs = Math.abs(delta);
          if (abs <= threshold && abs < bestX) {
            bestX = abs;
            dx = delta;
          }
        }
      }
      for (const me of my) {
        for (const te of ty) {
          const delta = te - me;
          const abs = Math.abs(delta);
          if (abs <= threshold && abs < bestY) {
            bestY = abs;
            dy = delta;
          }
        }
      }
    }
    const bounds = {
      ...proposed,
      x: proposed.x + (axis === 'y' ? 0 : dx),
      y: proposed.y + (axis === 'x' ? 0 : dy),
    };
    return { bounds, ...snapFeedback(bounds, targets) };
  };
  const nearestDelta = (value, candidates, threshold) => {
    let best = null;
    for (const c of candidates) {
      const delta = c - value;
      const abs = Math.abs(delta);
      if (abs <= threshold && (best === null || abs < best.abs)) best = { abs, delta };
    }
    return best ? best.delta : null;
  };
  const snapResize = (origin, proposed, targets, threshold) => {
    const eps = 0.01;
    const left = Math.abs(proposed.x - origin.x) > eps;
    const right = Math.abs(proposed.x + proposed.width - (origin.x + origin.width)) > eps;
    const top = Math.abs(proposed.y - origin.y) > eps;
    const bottom = Math.abs(proposed.y + proposed.height - (origin.y + origin.height)) > eps;
    let b = { ...proposed };
    const xs = targets.flatMap(xEdges);
    const ys = targets.flatMap(yEdges);
    if (left) {
      const delta = nearestDelta(proposed.x, xs, threshold);
      if (delta !== null) {
        b.x = proposed.x + delta;
        b.width = Math.max(1, proposed.width - delta);
      }
    }
    if (right) {
      const delta = nearestDelta(proposed.x + proposed.width, xs, threshold);
      if (delta !== null) b.width = Math.max(1, proposed.x + proposed.width + delta - b.x);
    }
    if (top) {
      const delta = nearestDelta(proposed.y, ys, threshold);
      if (delta !== null) {
        b.y = proposed.y + delta;
        b.height = Math.max(1, proposed.height - delta);
      }
    }
    if (bottom) {
      const delta = nearestDelta(proposed.y + proposed.height, ys, threshold);
      if (delta !== null) b.height = Math.max(1, proposed.y + proposed.height + delta - b.y);
    }
    return { bounds: b, ...snapFeedback(b, targets) };
  };
  const dragNodes = drag => (drag.origins || [{ node:drag.node }]).map(item => item.node);
  // Accepts one element or the whole multi-drag set. Parents come first so their
  // edges and centers win ties against unrelated siblings.
  const collectSnapTargets = exclude => {
    const excluded = Array.isArray(exclude) ? exclude.filter(Boolean) : [exclude];
    const skip = new Set();
    for (const element of excluded) {
      skip.add(element.dataset.looraNode);
      element.querySelectorAll('[data-loora-node]').forEach(node => skip.add(node.dataset.looraNode));
    }
    const targets = [];
    const taken = new Set();
    const push = node => {
      const id = node.dataset.looraNode;
      if (skip.has(id) || taken.has(id)) return;
      if (getComputedStyle(node).display === 'none') return;
      const visual = visualNode(node);
      if (!visual) return;
      taken.add(id);
      targets.push(worldRect(visual));
    };
    for (const element of excluded) {
      const parent = nodeForId(element.dataset.looraParent);
      if (parent) push(parent);
    }
    for (const node of state.nodes.values()) push(node);
    return targets;
  };
  const renderedDropTarget = (event, drag) => {
    const dragged = dragNodes(drag);
    const visuals = dragged.map(visualNode).filter(Boolean);
    if (!visuals.length) return null;
    const previousPointerEvents = visuals.map(visual => visual.style.pointerEvents);
    visuals.forEach(visual => { visual.style.pointerEvents = 'none'; });
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    visuals.forEach((visual, index) => { visual.style.pointerEvents = previousPointerEvents[index]; });
    const containers = new Set(['frame', 'component', 'instance']);
    const visited = new Set();
    for (const element of stack) {
      let candidate = element.closest?.('[data-loora-node]') || null;
      while (candidate) {
        const id = candidate.dataset.looraNode;
        if (!visited.has(id)) {
          visited.add(id);
          const inside = dragged.some(node => node === candidate || node.contains(candidate));
          if (!inside && containers.has(candidate.dataset.looraKind)) {
            const rect = worldRect(candidate);
            return { id, parent:{ x:rect.x, y:rect.y } };
          }
        }
        candidate = candidate.parentElement?.closest?.('[data-loora-node]') || null;
      }
    }
    return null;
  };
  const queueCamera = () => {
    clearTimeout(state.cameraPost);
    state.cameraPost = setTimeout(() => post('camera', state.camera), 90);
  };
  const setSelection = selection => {
    for (const id of state.selection) nodeForId(id)?.removeAttribute('data-loora-selected');
    state.selection = [...new Set(selection.filter(Boolean))];
    for (const id of state.selection) nodeForId(id)?.setAttribute('data-loora-selected', 'true');
    syncHandles();
  };
  const selectionUnionRect = () => {
    const nodes = state.selection
      .map(id => nodeForId(id))
      .filter(node => node && node.dataset.looraLocked !== 'true');
    if (!nodes.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const node of nodes) {
      const rect = worldRect(visualNode(node) || node);
      x1 = Math.min(x1, rect.x);
      y1 = Math.min(y1, rect.y);
      x2 = Math.max(x2, rect.x + rect.width);
      y2 = Math.max(y2, rect.y + rect.height);
    }
    if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;
    return { x:x1, y:y1, width:Math.max(1, x2 - x1), height:Math.max(1, y2 - y1), nodes };
  };
  const handleCursor = { nw:'nwse-resize',n:'ns-resize',ne:'nesw-resize',e:'ew-resize',se:'nwse-resize',s:'ns-resize',sw:'nesw-resize',w:'ew-resize' };
  const setDragCursor = cursor => {
    surface.style.cursor = cursor || '';
    document.documentElement.style.cursor = cursor || '';
  };
  const positionHandles = rect => {
    const positions = {
      nw:[rect.x,rect.y], n:[rect.x+rect.width/2,rect.y], ne:[rect.x+rect.width,rect.y],
      e:[rect.x+rect.width,rect.y+rect.height/2], se:[rect.x+rect.width,rect.y+rect.height],
      s:[rect.x+rect.width/2,rect.y+rect.height], sw:[rect.x,rect.y+rect.height], w:[rect.x,rect.y+rect.height/2],
    };
    for (const [handle, [x,y]] of Object.entries(positions)) {
      const element = state.handles.get(handle);
      if (!element) continue;
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    }
    if (state.groupBox) {
      Object.assign(state.groupBox.style, {
        left:`${rect.x}px`, top:`${rect.y}px`, width:`${rect.width}px`, height:`${rect.height}px`
      });
    }
  };
  const syncHandles = () => {
    for (const handle of state.handles.values()) handle.remove();
    state.handles.clear();
    state.groupBox?.remove();
    state.groupBox = null;
    if (state.preview || state.tool !== 'select') return;
    const union = selectionUnionRect();
    if (!union) return;
    const primary = union.nodes[union.nodes.length - 1];
    const group = union.nodes.length > 1;
    if (group) {
      state.groupBox = document.createElement('div');
      state.groupBox.className = 'loora-group-box';
      scene.appendChild(state.groupBox);
    }
    for (const handle of Object.keys(handleCursor)) {
      const element = document.createElement('div');
      element.className = 'loora-resize-handle';
      element.dataset.handle = handle;
      element.dataset.node = primary.dataset.looraNode;
      if (group) element.dataset.group = 'true';
      element.style.cursor = handleCursor[handle];
      scene.appendChild(element);
      state.handles.set(handle, element);
    }
    positionHandles(union);
  };
  const choose = (id, additive) => {
    const next = additive
      ? (state.selection.includes(id) ? state.selection.filter(value => value !== id) : [...state.selection, id])
      : (id ? [id] : []);
    setSelection(next);
    post('select', { id: id || null, additive: !!additive });
  };
  const resize = (origin, handle, point, constrain) => {
    let {x,y,width,height} = origin;
    const right = origin.x + origin.width;
    const bottom = origin.y + origin.height;
    if (handle.includes('w')) { x = Math.min(point.x, right - 1); width = right - x; }
    if (handle.includes('e')) width = Math.max(1, point.x - origin.x);
    if (handle.includes('n')) { y = Math.min(point.y, bottom - 1); height = bottom - y; }
    if (handle.includes('s')) height = Math.max(1, point.y - origin.y);
    if (constrain && origin.width > 0 && origin.height > 0) {
      const ratio = origin.width / origin.height;
      const horizontal = handle.includes('e') || handle.includes('w');
      const vertical = handle.includes('n') || handle.includes('s');
      if (horizontal && vertical) {
        if (width / ratio >= height) height = Math.max(1, width / ratio);
        else width = Math.max(1, height * ratio);
      } else if (horizontal) {
        height = Math.max(1, width / ratio);
      } else {
        width = Math.max(1, height * ratio);
      }
      if (handle.includes('w')) x = right - width;
      if (handle.includes('n')) y = bottom - height;
    }
    return {x,y,width,height};
  };
  const previewBounds = (drag, bounds) => {
    if (drag.type === 'resize' && drag.group && drag.origins?.length) {
      const sx = bounds.width / Math.max(1, drag.origin.width);
      const sy = bounds.height / Math.max(1, drag.origin.height);
      drag.members = [];
      for (const item of drag.origins) {
        const next = {
          x: bounds.x + (item.origin.x - drag.origin.x) * sx,
          y: bounds.y + (item.origin.y - drag.origin.y) * sy,
          width: Math.max(1, item.origin.width * sx),
          height: Math.max(1, item.origin.height * sy),
        };
        const element = visualNode(item.node);
        if (element) {
          element.style.translate = `${next.x - item.origin.x}px ${next.y - item.origin.y}px`;
          element.style.width = `${next.width}px`;
          element.style.height = `${next.height}px`;
        }
        drag.members.push({ id:item.node.dataset.looraNode, bounds:next, parent:renderedParentOrigin(item.node) });
      }
      positionHandles(bounds);
      drag.bounds = bounds;
      return;
    }
    const element = visualNode(drag.node);
    if (!element) return;
    const offset = `${bounds.x - drag.origin.x}px ${bounds.y - drag.origin.y}px`;
    for (const item of drag.origins || [{ node:drag.node }]) {
      const moved = visualNode(item.node);
      if (moved) moved.style.translate = offset;
    }
    if (drag.type === 'resize') {
      if (isRootFrame(drag.node)) {
        // The visible artboard is a host around the root frame. Resizing only
        // the inner node is ignored by its width:100% root rule and leaves the
        // handles detached from the actual edge.
        element.style.width = `${bounds.width}px`;
        element.style.height = `${bounds.height}px`;
        element.style.minHeight = `${bounds.height}px`;
        drag.node.style.setProperty('width', '100%', 'important');
        drag.node.style.setProperty('height', '100%', 'important');
        drag.node.style.setProperty('min-height', '0px', 'important');
      } else {
        drag.node.style.width = `${bounds.width}px`;
        drag.node.style.height = `${bounds.height}px`;
      }
    }
    // CSS constraints and flex sizing can change the requested resize. Read
    // the one authoritative rendered box once per animation frame and commit
    // exactly what the user sees.
    const renderedBounds = drag.type === 'resize' && !drag.group ? worldRect(drag.node) : bounds;
    positionHandles(renderedBounds);
    drag.bounds = renderedBounds;
  };
  const startCreate = point => {
    const element = document.createElement('div');
    element.style.cssText = 'position:absolute;border:1.5px solid #6f8cff;background:rgba(111,140,255,.12);pointer-events:none;z-index:2147483646';
    scene.appendChild(element);
    state.drag = { type:'create', tool:state.tool, start:point, bounds:{x:point.x,y:point.y,width:0,height:0}, element };
  };
  const startMarquee = (point, additive) => {
    const element = document.createElement('div');
    element.style.cssText = 'position:absolute;border:1.5px dashed #6f8cff;background:rgba(111,140,255,.12);pointer-events:none;z-index:2147483646';
    scene.appendChild(element);
    state.drag = { type:'marquee', start:point, additive:!!additive, bounds:{x:point.x,y:point.y,width:0,height:0}, element, moved:false };
  };
  const rectsIntersect = (a, b) => a.x < b.x + b.width
    && b.x < a.x + a.width
    && a.y < b.y + b.height
    && b.y < a.y + a.height;
  const marqueeSelection = bounds => {
    const ids = [];
    for (const node of state.nodes.values()) {
      // Root hosts span the whole artboard, so any marquee inside one would
      // select the frame itself instead of the content the user swept over.
      if (isRootFrame(node)) continue;
      if (getComputedStyle(node).display === 'none') continue;
      if (rectsIntersect(bounds, worldRect(node))) ids.push(node.dataset.looraNode);
    }
    return ids;
  };
  // Dragging a frame already moves its children; keeping a selected descendant in
  // the set would translate it twice on screen and again in the engine.
  const movableDragSet = ids => {
    const items = [];
    for (const id of ids) {
      const node = nodeForId(id);
      if (!node) continue;
      if (node.dataset.looraLocked === 'true') continue;
      items.push({ node, origin:worldRect(node) });
    }
    return items.filter(item => !items.some(other => other !== item && other.node.contains(item.node)));
  };
  const setSpacePan = active => {
    if (state.spacePan === active) return;
    state.spacePan = active;
    surface.classList.toggle('loora-space-pan', active);
  };

  surface.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 1) return;
    surface.focus({ preventScroll:true });
    const point = worldPoint(event);
    // Space/middle-button panning outranks handles and tools: it is the escape
    // hatch users reach for while a create tool is armed.
    if (event.button === 1 || (state.spacePan && !state.preview) || state.tool === 'hand') {
      state.drag = { type:'pan', clientX:event.clientX, clientY:event.clientY };
      surface.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const handle = event.target instanceof Element ? event.target.closest('.loora-resize-handle') : null;
    if (handle && !state.preview) {
      const group = handle.dataset.group === 'true';
      const union = group ? selectionUnionRect() : null;
      const node = nodeForId(handle.dataset.node);
      if (!node && !union) return;
      const primary = union?.nodes?.[union.nodes.length - 1] || node;
      if (!primary) return;
      state.drag = {
        type:'resize',
        handle:handle.dataset.handle,
        node: primary,
        origin: union || worldRect(primary),
        parentOrigin:renderedParentOrigin(primary),
        start:point,
        moved:false,
        group: !!union,
        origins: union
          ? union.nodes.map(n => ({ node:n, origin:worldRect(n) }))
          : [{ node:primary, origin:worldRect(primary) }],
        snapTargets:collectSnapTargets(primary),
      };
      for (const item of state.drag.origins) {
        visualNode(item.node)?.style.setProperty('will-change', 'transform,width,height');
      }
      setDragCursor(handleCursor[handle.dataset.handle] || 'nwse-resize');
      surface.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (!state.preview && ['frame','text','rectangle','shapes','image','component'].includes(state.tool)) {
      startCreate(point);
      surface.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const node = targetNode(event.target);
    if (!node) {
      if (!state.preview) {
        // Selection is resolved on pointerup: clearing here would drop the very
        // nodes an additive marquee is meant to keep.
        startMarquee(point, event.shiftKey);
        surface.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      return;
    }
    if (state.preview) {
      node.setAttribute('data-loora-focused', 'true');
      post('preview-trigger', { id:node.dataset.looraNode, trigger:'focus' });
      return;
    }
    if (node.dataset.looraEditing === 'true') return;
    const id = node.dataset.looraNode;
    const multi = !event.shiftKey && state.selection.length > 1 && state.selection.includes(id);
    if (!multi) choose(id, event.shiftKey);
    const origins = multi ? movableDragSet(state.selection) : movableDragSet([id]);
    const primary = origins.find(item => item.node === node) || origins[0];
    if (primary) {
      const ordered = [primary, ...origins.filter(item => item !== primary)];
      state.drag = {
        type:'move',
        node:primary.node,
        origins:ordered,
        origin:primary.origin,
        parentOrigin:renderedParentOrigin(primary.node),
        start:point,
        moved:false,
        altDuplicate:event.altKey,
        snapTargets:collectSnapTargets(ordered.map(item => item.node)),
      };
      for (const item of ordered) visualNode(item.node)?.style.setProperty('will-change', 'transform');
      setDragCursor('move');
      surface.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  });

  const applyDragPointer = event => {
    const drag = state.drag;
    if (!drag) return;
    if (drag.type === 'pan') {
      state.camera.x += event.clientX - drag.clientX;
      state.camera.y += event.clientY - drag.clientY;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      cameraTransform();
      queueCamera();
      return;
    }
    const point = worldPoint(event);
    const threshold = SNAP_PX / Math.max(0.01, state.camera.zoom);
    if (drag.type === 'move') {
      const distance = Math.hypot(point.x-drag.start.x, point.y-drag.start.y) * state.camera.zoom;
      if (!drag.moved && distance < 5) return;
      drag.moved = true;
      drag.altDuplicate = !!event.altKey;
      let dx = point.x - drag.start.x;
      let dy = point.y - drag.start.y;
      const axis = event.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : null;
      if (axis === 'x') dy = 0;
      else if (axis === 'y') dx = 0;
      const proposed = { ...drag.origin, x:drag.origin.x + dx, y:drag.origin.y + dy };
      const snapped = snapMove(proposed, drag.snapTargets || [], threshold, axis);
      drawGuides(snapped.guides, snapped.labels);
      previewBounds(drag, snapped.bounds);
    } else if (drag.type === 'resize') {
      const distance = Math.hypot(point.x-drag.start.x, point.y-drag.start.y) * state.camera.zoom;
      if (!drag.moved && distance < 2) return;
      drag.moved = true;
      const constrain = !!event.shiftKey;
      const proposed = resize(drag.origin, drag.handle, point, constrain);
      // Snapping would fight the locked aspect ratio, so a constrained resize keeps
      // the proposed box and only reports the alignments it happens to hit.
      const snapped = constrain
        ? { bounds:proposed, ...snapFeedback(proposed, drag.snapTargets || []) }
        : snapResize(drag.origin, proposed, drag.snapTargets || [], threshold);
      drawGuides(snapped.guides, snapped.labels);
      previewBounds(drag, snapped.bounds);
    } else if (drag.type === 'create' || drag.type === 'marquee') {
      const x = Math.min(drag.start.x, point.x);
      const y = Math.min(drag.start.y, point.y);
      drag.bounds = { x, y, width:Math.abs(point.x-drag.start.x), height:Math.abs(point.y-drag.start.y) };
      if (drag.bounds.width * state.camera.zoom >= 3 || drag.bounds.height * state.camera.zoom >= 3) drag.moved = true;
      Object.assign(drag.element.style, { left:`${x}px`, top:`${y}px`, width:`${drag.bounds.width}px`, height:`${drag.bounds.height}px` });
    }
  };
  const flushDragPointer = () => {
    state.dragFrame = 0;
    const event = state.dragPointer;
    state.dragPointer = null;
    if (event) applyDragPointer(event);
  };
  const queueDragPointer = event => {
    if (!state.drag) return;
    state.dragPointer = { clientX:event.clientX, clientY:event.clientY, shiftKey:event.shiftKey, altKey:event.altKey };
    if (!state.dragFrame) state.dragFrame = requestAnimationFrame(flushDragPointer);
  };
  const cancelQueuedDragPointer = () => {
    if (state.dragFrame) cancelAnimationFrame(state.dragFrame);
    state.dragFrame = 0;
    state.dragPointer = null;
  };
  surface.addEventListener('pointermove', queueDragPointer);

  const clearDragPreview = drag => {
    if (!drag || (drag.type !== 'move' && drag.type !== 'resize')) return;
    for (const item of drag.origins || [{ node:drag.node, origin:drag.origin }]) {
      const moved = visualNode(item.node);
      if (!moved) continue;
      moved.style.removeProperty('translate');
      moved.style.removeProperty('will-change');
      if (drag.type === 'resize') {
        if (isRootFrame(item.node)) {
          moved.style.width = `${item.origin.width}px`;
          moved.style.removeProperty('height');
          moved.style.minHeight = `${item.origin.height}px`;
          item.node.style.removeProperty('width');
          item.node.style.removeProperty('height');
          item.node.style.removeProperty('min-height');
        } else {
          moved.style.removeProperty('width');
          moved.style.removeProperty('height');
        }
      }
    }
  };
  const finishDragCommit = () => {
    if (!state.pendingDragCommit) return;
    const drag = state.pendingDragCommit;
    state.pendingDragCommit = null;
    clearTimeout(state.pendingDragCommitTimer);
    state.pendingDragCommitTimer = 0;
    clearDragPreview(drag);
    syncHandles();
  };
  const awaitDragCommit = drag => {
    finishDragCommit();
    state.pendingDragCommit = drag;
    // A rejected or interrupted native update must not leave an inline preview
    // transform stuck forever. Normal commits finish on the next CSS refresh.
    state.pendingDragCommitTimer = setTimeout(finishDragCommit, 1000);
  };
  const cancelDrag = event => {
    cancelQueuedDragPointer();
    const drag = state.drag;
    state.drag = null;
    setDragCursor('');
    clearGuides();
    if (!drag) return;
    if (event && surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    drag.element?.remove();
    clearDragPreview(drag);
    syncHandles();
  };
  surface.addEventListener('pointercancel', cancelDrag);

  surface.addEventListener('pointerup', event => {
    cancelQueuedDragPointer();
    applyDragPointer(event);
    const drag = state.drag;
    state.drag = null;
    setDragCursor('');
    clearGuides();
    if (!drag) return;
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (drag.type === 'pan') {
      clearTimeout(state.cameraPost);
      post('camera', state.camera);
    } else if ((drag.type === 'move' || drag.type === 'resize') && drag.moved) {
      const bounds = drag.bounds || drag.origin;
      const move = drag.type === 'move';
      const drop = move ? renderedDropTarget(event, drag) : null;
      awaitDragCommit(drag);
      const payload = {
        id:drag.node.dataset.looraNode,
        mode:drag.type,
        bounds,
        parent:drag.parentOrigin,
        drop,
        handle:drag.handle || null,
      };
      if (move) {
        payload.ids = dragNodes(drag).map(node => node.dataset.looraNode);
        payload.dx = bounds.x - drag.origin.x;
        payload.dy = bounds.y - drag.origin.y;
        payload.duplicate = !!drag.altDuplicate;
      } else if (drag.group && drag.members?.length) {
        payload.members = drag.members;
        payload.ids = drag.members.map(member => member.id);
      }
      post('bounds', payload);
    } else if (drag.type === 'create') {
      drag.element.remove();
      if (drag.bounds.width >= 3 && drag.bounds.height >= 3) post('create', { tool:drag.tool, bounds:drag.bounds });
    } else if (drag.type === 'marquee') {
      drag.element.remove();
      if (drag.moved) {
        const ids = marqueeSelection(drag.bounds);
        setSelection(drag.additive ? [...state.selection, ...ids] : ids);
        post('select', { id:ids.length ? ids[ids.length-1] : null, ids, additive:drag.additive });
      } else {
        choose(null, false);
      }
    } else {
      clearDragPreview(drag);
      syncHandles();
    }
  });

  surface.addEventListener('wheel', event => {
    event.preventDefault();
    const bounds = surface.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      const before = {
        x:(event.clientX-bounds.left-state.camera.x)/state.camera.zoom,
        y:(event.clientY-bounds.top-state.camera.y)/state.camera.zoom,
      };
      state.camera.zoom = Math.max(.08, Math.min(8, state.camera.zoom * Math.exp(-event.deltaY*.003)));
      state.camera.x = event.clientX-bounds.left-before.x*state.camera.zoom;
      state.camera.y = event.clientY-bounds.top-before.y*state.camera.zoom;
    } else {
      state.camera.x -= event.deltaX;
      state.camera.y -= event.deltaY;
    }
    cameraTransform();
    queueCamera();
  }, { passive:false });

  surface.addEventListener('dblclick', event => {
    const node = targetNode(event.target);
    if (!node) return;
    if (state.preview) {
      post('preview-trigger', { id:node.dataset.looraNode, trigger:'double_click' });
      return;
    }
    if (node.dataset.looraKind === 'text' && node.dataset.looraLocked !== 'true') {
      node.dataset.looraEditing = 'true';
      node.contentEditable = 'plaintext-only';
      node.focus({ preventScroll:true });
      // Place caret at click instead of selecting all — feels like a real text tool.
      try {
        const selection = window.getSelection();
        if (document.caretRangeFromPoint) {
          const range = document.caretRangeFromPoint(event.clientX, event.clientY);
          if (range) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      } catch (_) {}
    } else if (node.dataset.looraKind === 'image') {
      post('edit-image', { id:node.dataset.looraNode });
    }
    event.preventDefault();
  });

  surface.addEventListener('dragover', event => {
    if (state.preview) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  surface.addEventListener('drop', event => {
    if (state.preview) return;
    event.preventDefault();
    const world = worldPoint(event);
    const paths = [];
    const uriList = event.dataTransfer.getData('text/uri-list') || '';
    for (const line of uriList.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('file://')) {
        try {
          const raw = decodeURIComponent(trimmed.replace(/^file:\/\/(localhost)?/i, ''));
          paths.push(raw);
        } catch (_) {
          paths.push(trimmed.replace(/^file:\/\/(localhost)?/i, ''));
        }
      }
    }
    if (paths.length) post('drop-files', { paths, world });
  });

  surface.addEventListener('focusout', event => {
    const node = event.target instanceof Element ? event.target.closest('[data-loora-editing="true"]') : null;
    if (node) {
      const bounds = worldRect(node);
      post('text', { id:node.dataset.looraNode, text:node.innerText.replace(/\r/g,''), bounds });
      node.removeAttribute('contenteditable');
      node.removeAttribute('data-loora-editing');
    }
    if (state.preview) {
      const previewNode = targetNode(event.target);
      if (previewNode) post('preview-trigger', { id:previewNode.dataset.looraNode, trigger:'blur' });
    }
  });

  surface.addEventListener('click', event => {
    if (!state.preview) return;
    const node = targetNode(event.target);
    if (node) post('preview-trigger', { id:node.dataset.looraNode, trigger:'click' });
  });
  surface.addEventListener('mouseover', event => {
    if (!state.preview) return;
    const node = targetNode(event.target);
    if (node && !node.contains(event.relatedTarget)) post('preview-trigger', { id:node.dataset.looraNode, trigger:'hover' });
  });
  surface.addEventListener('mouseout', event => {
    if (!state.preview) return;
    const node = targetNode(event.target);
    if (node && !node.contains(event.relatedTarget)) post('preview-trigger', { id:node.dataset.looraNode, trigger:'hover_end' });
  });
  surface.addEventListener('submit', event => {
    if (!state.preview) return;
    event.preventDefault();
    const node = targetNode(event.target);
    if (node) post('preview-trigger', { id:node.dataset.looraNode, trigger:'submit' });
  });
  surface.addEventListener('change', event => {
    if (!state.preview) return;
    const node = targetNode(event.target);
    if (node) post('preview-trigger', { id:node.dataset.looraNode, trigger:'change' });
  });
  surface.addEventListener('input', event => {
    if (!state.preview) return;
    const node = targetNode(event.target);
    if (node) post('preview-trigger', { id:node.dataset.looraNode, trigger:'input' });
  });
  surface.addEventListener('contextmenu', event => {
    event.preventDefault();
    const node = targetNode(event.target);
    const world = worldPoint(event);
    post('context-menu', { id:node?.dataset.looraNode || null, x:event.clientX, y:event.clientY, world });
  });
  surface.addEventListener('keydown', event => {
    if (!contextMenu.hidden) {
      if (event.key === 'Escape') hideContextMenu();
      else if (event.key === 'ArrowDown') highlightContextMenuItem(state.contextMenuIndex + 1);
      else if (event.key === 'ArrowUp') highlightContextMenuItem(state.contextMenuIndex - 1);
      else if (event.key === 'Enter' || event.key === ' ') contextMenuItems()[state.contextMenuIndex]?.click();
      else return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const editing = event.target instanceof Element && !!event.target.closest('[data-loora-editing="true"]');
    if (editing) {
      if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) event.target.blur();
      return;
    }
    // Prototypes use Space to activate focused controls, so only the editor
    // surface claims it for panning.
    if (event.code === 'Space' && !state.preview) {
      setSpacePan(true);
      event.preventDefault();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    let command = null;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') command = event.shiftKey ? 'redo' : 'undo';
    else if (mod && key === 'y') command = 'redo';
    else if (mod && key === 's') command = 'save';
    else if (mod && key === 'c') command = 'copy';
    else if (mod && key === 'x') command = 'cut';
    else if (mod && key === 'v') command = 'paste';
    else if (mod && key === 'd') command = 'duplicate';
    else if (mod && key === 'a') command = 'select-all';
    else if (mod && key === 'l') command = 'lock';
    else if (mod && key === 'g') command = event.shiftKey ? 'ungroup' : 'group';
    else if (mod && key === ']') command = 'bring-front';
    else if (mod && key === '[') command = 'send-back';
    else if (mod && (key === '=' || key === '+')) command = 'zoom-in';
    else if (mod && key === '-') command = 'zoom-out';
    else if (mod && key === '0') command = 'zoom-reset';
    else if (mod && key === '1') command = 'fit-selection';
    else if (mod && key === '2') command = 'fit-all';
    else if (mod && (key === 'k' || key === 'o')) command = 'files';
    else if (mod && key === 'n') command = 'new';
    else if (event.key === 'Delete' || event.key === 'Backspace') command = 'delete';
    else if (event.key === 'Escape') command = 'escape';
    else if (!mod && !event.altKey && event.key.startsWith('Arrow')) command = `nudge:${event.key.slice(5).toLowerCase()}:${event.shiftKey ? 10 : 1}`;
    else if (!mod && !event.altKey && ['v','h','f','t','r','i'].includes(key)) command = `tool:${key}`;
    if (command) { event.preventDefault(); post('command', { command }); }
  });
  surface.addEventListener('keyup', event => {
    if (event.code === 'Space') setSpacePan(false);
  });
  // A pointer capture or focus loss while Space is down would otherwise leave the
  // surface stuck in pan mode.
  window.addEventListener('blur', () => setSpacePan(false));

  const fitAll = () => {
    const hosts = [...scene.querySelectorAll('.loora-page-host')];
    if (!hosts.length) return;
    const boxes = hosts.map(host => ({ x:parseFloat(host.style.left)||0, y:parseFloat(host.style.top)||0, width:host.getBoundingClientRect().width/state.camera.zoom, height:host.getBoundingClientRect().height/state.camera.zoom }));
    const left = Math.min(...boxes.map(box=>box.x));
    const top = Math.min(...boxes.map(box=>box.y));
    const right = Math.max(...boxes.map(box=>box.x+box.width));
    const bottom = Math.max(...boxes.map(box=>box.y+box.height));
    const width = surface.clientWidth, height = surface.clientHeight, padding = 80;
    state.camera.zoom = Math.max(.08, Math.min(8, Math.min((width-padding*2)/Math.max(1,right-left),(height-padding*2)/Math.max(1,bottom-top))));
    state.camera.x = width/2-(left+right)/2*state.camera.zoom;
    state.camera.y = height/2-(top+bottom)/2*state.camera.zoom;
    cameraTransform(); queueCamera();
  };
  const focusPage = id => {
    const node = nodeForId(id); if (!node) return;
    const rect = worldRect(node), width=surface.clientWidth, height=surface.clientHeight, padding=72;
    state.camera.zoom = Math.max(.08, Math.min(8, Math.min((width-padding*2)/Math.max(1,rect.width),(height-padding*2)/Math.max(1,rect.height))));
    state.camera.x = width/2-(rect.x+rect.width/2)*state.camera.zoom;
    state.camera.y = height/2-(rect.y+rect.height/2)*state.camera.zoom;
    cameraTransform(); queueCamera();
  };

  window.__looraApply = payload => {
    finishDragCommit();
    // A full DOM replace invalidates any in-flight drag node references.
    if (state.drag) {
      cancelQueuedDragPointer();
      state.drag.element?.remove();
      clearDragPreview(state.drag);
      state.drag = null;
    }
    clearGuides();
    clearInterval(readyTimer);
    css.textContent = payload.css || '';
    scene.innerHTML = payload.markup || '';
    state.nodes = new Map(
      [...scene.querySelectorAll('[data-loora-node]')]
        .map(node => [node.dataset.looraNode, node])
    );
    state.camera = { ...state.camera, ...(payload.camera || {}) };
    state.tool = payload.tool || 'select';
    state.preview = !!payload.preview;
    state.canUndo = !!payload.canUndo;
    state.canRedo = !!payload.canRedo;
    if (payload.chrome) syncChromeTheme(payload.chrome);
    surface.classList.toggle('loora-preview', state.preview);
    surface.dataset.tool = state.tool;
    cameraTransform();
    setSelection(payload.selection || []);
    requestAnimationFrame(() => { syncHandles(); syncOverlay(); });
  };
  const exportPng = () => {
    const host = scene.querySelector('.loora-page-host:not([data-loora-overlay-page])');
    if (!host) {
      post('export-png', { error: 'No page to export' });
      return;
    }
    const width = Math.max(1, Math.round(host.offsetWidth));
    const height = Math.max(1, Math.round(host.offsetHeight));
    const cssText = css.textContent || '';
    const clone = host.cloneNode(true);
    clone.querySelectorAll('[data-loora-selected],.loora-resize-handle,.loora-guide,.loora-guide-label,.loora-page-label').forEach(el => el.remove());
    clone.style.left = '0px';
    clone.style.top = '0px';
    const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;background:#fff"><style>.loora-page-host{left:0!important;top:0!important}${cssText}</style>${clone.outerHTML}</div>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      post('export-png', { dataUrl: canvas.toDataURL('image/png') });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      post('export-png', { error: 'Rasterize failed' });
    };
    img.src = url;
  };
  window.__looraCommand = command => {
    if (!command) return;
    if (command.type === 'context-menu') showContextMenu(command);
    else if (command.type === 'dismiss-context-menu') hideContextMenu();
    else if (command.type === 'fit-all') fitAll();
    else if (command.type === 'focus-page') focusPage(command.id);
    else if (command.type === 'camera') { state.camera={...state.camera,...command.camera}; cameraTransform(); }
    else if (command.type === 'export-png') exportPng();
    else if (command.type === 'patch-text') {
      if (typeof command.css === 'string') css.textContent = command.css;
      const node = nodeForId(command.id);
      if (node && typeof command.text === 'string' && node.dataset.looraEditing !== 'true') {
        node.textContent = command.text;
      }
      state.camera = { ...state.camera, ...(command.camera || {}) };
      state.tool = command.tool || state.tool;
      state.preview = !!command.preview;
      if ('canUndo' in command) state.canUndo = !!command.canUndo;
      if ('canRedo' in command) state.canRedo = !!command.canRedo;
      surface.classList.toggle('loora-preview', state.preview);
      surface.dataset.tool = state.tool;
      cameraTransform();
      if (command.selection) setSelection(command.selection);
      else syncHandles();
    }
    else if (command.type === 'patch-css') {
      // Style-only refresh keeps DOM identity (and in-flight drag) intact.
      if (typeof command.css === 'string') css.textContent = command.css;
      // Clear the inline preview only after the committed CSS is installed so
      // there is never a painted frame at the old document position.
      finishDragCommit();
      state.camera = { ...state.camera, ...(command.camera || {}) };
      state.tool = command.tool || state.tool;
      state.preview = !!command.preview;
      if ('canUndo' in command) state.canUndo = !!command.canUndo;
      if ('canRedo' in command) state.canRedo = !!command.canRedo;
      if (command.chrome) syncChromeTheme(command.chrome);
      surface.classList.toggle('loora-preview', state.preview);
      surface.dataset.tool = state.tool;
      cameraTransform();
      if (command.selection) setSelection(command.selection);
      else syncHandles();
    }
    else if (command.type === 'state') {
      state.camera = { ...state.camera, ...(command.camera || {}) };
      state.tool = command.tool || 'select';
      state.preview = !!command.preview;
      if ('canUndo' in command) state.canUndo = !!command.canUndo;
      if ('canRedo' in command) state.canRedo = !!command.canRedo;
      if (command.chrome) syncChromeTheme(command.chrome);
      surface.classList.toggle('loora-preview', state.preview);
      surface.dataset.tool = state.tool;
      cameraTransform();
      setSelection(command.selection || []);
    }
  };
  syncChrome();
  post('ready');
})();
</script>
</body></html>"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_path_roundtrip() {
        let path = "/tmp/hello world.png";
        let encoded = path
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(decode_hex(&encoded).as_deref(), Some(path));
    }

    #[test]
    fn page_resize_updates_the_artboard_host() {
        assert!(CANVAS_SHELL.contains("if (isRootFrame(drag.node))"));
        assert!(CANVAS_SHELL.contains("element.style.width = `${bounds.width}px`"));
        assert!(CANVAS_SHELL.contains("element.style.height = `${bounds.height}px`"));
        assert!(CANVAS_SHELL.contains("positionHandles(renderedBounds)"));
    }

    #[test]
    fn drag_preview_is_coalesced_to_animation_frames() {
        assert!(CANVAS_SHELL.contains("const queueDragPointer"));
        assert!(CANVAS_SHELL.contains("requestAnimationFrame(flushDragPointer)"));
        assert!(CANVAS_SHELL.contains("cancelAnimationFrame(state.dragFrame)"));
    }

    #[test]
    fn drag_preview_survives_until_committed_css_applies() {
        assert!(CANVAS_SHELL.contains("pendingDragCommit: null"));
        assert!(CANVAS_SHELL.contains("state.pendingDragCommit = drag"));
        assert!(CANVAS_SHELL.contains("const finishDragCommit = () =>"));

        let pointer_up = CANVAS_SHELL
            .split("surface.addEventListener('pointerup', event => {")
            .nth(1)
            .and_then(|tail| tail.split("surface.addEventListener('wheel'").next())
            .expect("pointerup handler");
        assert!(!pointer_up
            .contains("clearDragPreview(drag);\n      syncHandles();\n      const payload"));
    }

    #[test]
    fn canvas_ready_handshake_recovers_from_startup_races() {
        assert!(CANVAS_SHELL.contains("const readyTimer = setInterval"));
        assert!(CANVAS_SHELL.contains("clearInterval(readyTimer)"));
        assert!(CANVAS_SHELL.contains("--loora-surface-bg:#0f0f10"));
        assert!(CANVAS_SHELL.contains("data-chrome"));
        assert!(CANVAS_SHELL.contains("syncChromeTheme"));
    }

    #[test]
    fn floating_toolbar_lives_inside_webview_chrome() {
        assert!(CANVAS_SHELL.contains("id=\"loora-toolbar\""));
        assert!(CANVAS_SHELL.contains("id=\"loora-zoom\""));
        assert!(CANVAS_SHELL.contains("syncChrome"));
        assert!(CANVAS_SHELL.contains("tool:${btn.dataset.tool}"));
        // Must not cover the surface with a full-bleed overlay (breaks hit-testing).
        assert!(!CANVAS_SHELL.contains("id=\"loora-chrome\""));
        assert!(CANVAS_SHELL.contains("clearDragPreview"));
    }

    #[test]
    fn context_menu_lives_inside_webview_chrome() {
        assert!(CANVAS_SHELL.contains("id=\"loora-context-menu\""));
        assert!(CANVAS_SHELL.contains("command.type === 'context-menu'"));
        assert!(CANVAS_SHELL.contains("post('context-action', { action })"));
        assert!(CANVAS_SHELL.contains("window.addEventListener('blur', hideContextMenu)"));
    }

    #[test]
    fn webview_drag_snaps_with_smart_guides() {
        assert!(CANVAS_SHELL.contains("const SNAP_PX = 5"));
        assert!(CANVAS_SHELL.contains("const snapMove"));
        assert!(CANVAS_SHELL.contains("const snapResize"));
        assert!(CANVAS_SHELL.contains("const collectSnapTargets"));
        assert!(CANVAS_SHELL.contains("drawGuides(snapped.guides, snapped.labels)"));
        assert!(CANVAS_SHELL.contains("clearGuides()"));
        assert!(CANVAS_SHELL.contains("snapTargets:collectSnapTargets(node)"));
    }

    #[test]
    fn webview_marquee_selects_intersecting_nodes() {
        assert!(CANVAS_SHELL.contains("const startMarquee"));
        assert!(CANVAS_SHELL.contains("type:'marquee'"));
        assert!(CANVAS_SHELL.contains("border:1.5px dashed #6f8cff"));
        assert!(CANVAS_SHELL.contains("const rectsIntersect"));
        assert!(CANVAS_SHELL.contains("const marqueeSelection"));
        // Root hosts would swallow every sweep started inside an artboard.
        assert!(CANVAS_SHELL.contains("if (isRootFrame(node)) continue;"));
        assert!(CANVAS_SHELL.contains("post('select', { id:ids.length ? ids[ids.length-1] : null, ids, additive:drag.additive })"));
    }

    #[test]
    fn webview_multi_selection_moves_together() {
        assert!(CANVAS_SHELL.contains("const movableDragSet"));
        assert!(CANVAS_SHELL.contains("origins:ordered"));
        assert!(CANVAS_SHELL.contains("payload.ids = dragNodes(drag).map"));
        assert!(CANVAS_SHELL.contains("payload.dx = bounds.x - drag.origin.x"));
        assert!(CANVAS_SHELL.contains("payload.dy = bounds.y - drag.origin.y"));
        // Nested selections must not be translated by both themselves and an ancestor.
        assert!(CANVAS_SHELL.contains("other.node.contains(item.node)"));
        assert!(CANVAS_SHELL.contains("for (const item of drag.origins || [{ node:drag.node }])"));
    }

    #[test]
    fn webview_drag_modifiers_constrain_duplicate_and_pan() {
        assert!(CANVAS_SHELL.contains(
            "const axis = event.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : null"
        ));
        assert!(
            CANVAS_SHELL.contains("snapMove(proposed, drag.snapTargets || [], threshold, axis)")
        );
        assert!(CANVAS_SHELL.contains("const constrain = !!event.shiftKey"));
        assert!(CANVAS_SHELL.contains("resize(drag.origin, drag.handle, point, constrain)"));
        assert!(CANVAS_SHELL.contains("drag.altDuplicate = !!event.altKey"));
        assert!(CANVAS_SHELL.contains("payload.duplicate = !!drag.altDuplicate"));
        assert!(CANVAS_SHELL.contains("shiftKey:event.shiftKey, altKey:event.altKey"));
        assert!(CANVAS_SHELL.contains("const setSpacePan"));
        assert!(CANVAS_SHELL.contains(
            "event.button === 1 || (state.spacePan && !state.preview) || state.tool === 'hand'"
        ));
        assert!(CANVAS_SHELL.contains("event.code === 'Space' && !state.preview"));
        assert!(CANVAS_SHELL.contains("loora-space-pan"));
    }

    #[test]
    fn webview_guides_label_sibling_spacing() {
        assert!(CANVAS_SHELL.contains("const spacingLabels"));
        assert!(CANVAS_SHELL.contains("const GUIDE_LABEL_MIN = 1"));
        assert!(CANVAS_SHELL.contains("const GUIDE_LABEL_MAX = 400"));
        assert!(CANVAS_SHELL.contains("loora-guide-label"));
        assert!(CANVAS_SHELL.contains("text:String(Math.round(best.gap))"));
        // Parent edges/centers must be offered before unrelated siblings.
        assert!(CANVAS_SHELL.contains("const parent = nodeForId(element.dataset.looraParent);"));
    }

    #[test]
    fn webview_supports_css_only_patch_and_png_export() {
        assert!(CANVAS_SHELL.contains("command.type === 'patch-css'"));
        assert!(CANVAS_SHELL.contains("command.type === 'export-png'"));
        assert!(CANVAS_SHELL.contains("const exportPng"));
        assert!(CANVAS_SHELL.contains("post('export-png'"));
        assert!(CANVAS_SHELL.contains("command.type === 'patch-text'"));
        assert!(CANVAS_SHELL.contains("const selectionUnionRect"));
        assert!(CANVAS_SHELL.contains("loora-group-box"));
        assert!(CANVAS_SHELL.contains("post('drop-files'"));
        assert!(CANVAS_SHELL.contains("caretRangeFromPoint"));
    }
}
