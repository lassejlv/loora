//! Application root: routes between the canvas and the settings page.

use gpui::{div, prelude::*, App, Entity, FocusHandle, KeyBinding, KeyDownEvent, Render, Window};
use gpui_router::{use_location, Route, Routes};
use loora_ui::{
    CanvasWorkspace, NewDesign, SaveDesign, SettingsSection, SettingsSectionPage, SettingsShell,
    ToggleFiles, ToggleSettings,
};

pub struct AppRoot {
    canvas: Entity<CanvasWorkspace>,
    _mcp_server: Option<loora_mcp::McpServer>,
    focus_handle: FocusHandle,
    route_state: Option<(bool, SettingsSection)>,
    _observe_canvas: gpui::Subscription,
}

impl AppRoot {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (mcp_server, mcp_receiver) = match loora_mcp::start() {
            Ok((server, receiver)) => {
                eprintln!("loora-mcp: listening at {}", server.endpoint());
                (Some(server), Some(receiver))
            }
            Err(error) => {
                eprintln!("loora-mcp: built-in server unavailable: {error}");
                (None, None)
            }
        };
        let mcp_endpoint = mcp_server.as_ref().map(loora_mcp::McpServer::endpoint);
        let canvas = cx.new(|cx| {
            CanvasWorkspace::new_with_mcp_endpoint(window, cx, mcp_receiver, mcp_endpoint)
        });
        let inspector_canvas = canvas.clone();
        loora_inspector::on_visibility_change(cx, move |open, cx| {
            inspector_canvas.update(cx, |workspace, cx| {
                workspace.set_developer_inspector_open(open, cx);
            });
        });
        let focus_handle = cx.focus_handle();

        // Re-render when theme / shortcut prefs change on the canvas workspace.
        let _observe_canvas = cx.observe(&canvas, |_, _, cx| cx.notify());

        cx.bind_keys([
            KeyBinding::new("cmd-,", ToggleSettings, None),
            KeyBinding::new("ctrl-,", ToggleSettings, None),
            KeyBinding::new("cmd-n", NewDesign, None),
            KeyBinding::new("ctrl-n", NewDesign, None),
            KeyBinding::new("secondary-n", NewDesign, None),
            KeyBinding::new("cmd-o", ToggleFiles, None),
            KeyBinding::new("ctrl-o", ToggleFiles, None),
            KeyBinding::new("secondary-o", ToggleFiles, None),
            KeyBinding::new("cmd-s", SaveDesign, None),
            KeyBinding::new("ctrl-s", SaveDesign, None),
            KeyBinding::new("secondary-s", SaveDesign, None),
        ]);

        Self {
            canvas,
            _mcp_server: mcp_server,
            focus_handle,
            route_state: None,
            _observe_canvas,
        }
    }

    fn toggle_settings(&mut self, _: &ToggleSettings, window: &mut Window, cx: &mut Context<Self>) {
        let path = if cx.has_global::<gpui_router::RouterState>() {
            use_location(cx).pathname.to_string()
        } else {
            "/".into()
        };
        let next = if path.starts_with("/settings") {
            "/"
        } else {
            SettingsSection::General.path()
        };
        gpui_router::RouterState::global_mut(cx).with_path(next.into());
        window.refresh();
        cx.notify();
    }

    fn new_design(&mut self, _: &NewDesign, _: &mut Window, cx: &mut Context<Self>) {
        // Ensure we're on the canvas route, then create.
        if cx.has_global::<gpui_router::RouterState>() {
            let path = use_location(cx).pathname.to_string();
            if path.starts_with("/settings") {
                gpui_router::RouterState::global_mut(cx).with_path("/".into());
            }
        }
        self.canvas.update(cx, |workspace, cx| {
            workspace.create_design(cx);
        });
        cx.notify();
    }

    fn toggle_files(&mut self, _: &ToggleFiles, window: &mut Window, cx: &mut Context<Self>) {
        if cx.has_global::<gpui_router::RouterState>() {
            let path = use_location(cx).pathname.to_string();
            if path.starts_with("/settings") {
                gpui_router::RouterState::global_mut(cx).with_path("/".into());
                window.refresh();
            }
        }
        self.canvas.update(cx, |workspace, cx| {
            workspace.toggle_files_panel(cx);
        });
    }

    fn save_design(&mut self, _: &SaveDesign, _: &mut Window, cx: &mut Context<Self>) {
        self.canvas.update(cx, |workspace, cx| {
            workspace.save_now(cx);
        });
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let on_settings = cx
            .has_global::<gpui_router::RouterState>()
            .then(|| use_location(cx).pathname.to_string())
            .is_some_and(|path| path.starts_with("/settings"));
        if on_settings {
            self.canvas.update(cx, |workspace, cx| {
                workspace.handle_settings_key_down(event, window, cx);
            });
        }
    }

    fn settings_page(
        canvas: Entity<CanvasWorkspace>,
        section: SettingsSection,
        cx: &App,
    ) -> SettingsSectionPage {
        let theme = canvas.read(cx).theme();
        let overrides = canvas.read(cx).shortcut_overrides().clone();
        let recording = canvas.read(cx).shortcut_recording().map(|s| s.to_string());
        let query = canvas.read(cx).shortcut_search().to_string();
        let search_focused = canvas.read(cx).shortcut_search_focused();
        SettingsSectionPage::new(
            canvas,
            theme,
            section,
            overrides,
            recording,
            query,
            search_focused,
        )
    }
}

impl Render for AppRoot {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let canvas = self.canvas.clone();
        let pathname = if cx.has_global::<gpui_router::RouterState>() {
            use_location(cx).pathname.to_string()
        } else {
            "/".into()
        };
        let on_settings = pathname.starts_with("/settings");
        let section = SettingsSection::from_pathname(&pathname);
        let theme = canvas.read(cx).theme();
        loora_inspector::set_theme(theme, cx);

        // Keep the canvas runtime in sync only when the route actually changes.
        let route_state = (on_settings, section);
        if self.route_state != Some(route_state) {
            self.route_state = Some(route_state);
            canvas.update(cx, |workspace, cx| {
                if on_settings {
                    workspace.set_settings_route_active(true, section, cx);
                } else {
                    workspace.set_canvas_route_active(true, cx);
                    workspace.focus_canvas(window, cx);
                }
            });
            if on_settings {
                self.focus_handle.focus(window, cx);
            }
        }
        div()
            .size_full()
            .track_focus(&self.focus_handle)
            .key_context("AppRoot")
            .on_action(cx.listener(Self::toggle_settings))
            .on_action(cx.listener(Self::new_design))
            .on_action(cx.listener(Self::toggle_files))
            .on_action(cx.listener(Self::save_design))
            .on_key_down(cx.listener(Self::on_key_down))
            .child(
                Routes::new().children([
                    Route::new().index().element({
                        let canvas = canvas.clone();
                        move |_, _| canvas.clone()
                    }),
                    Route::new()
                        .path("settings")
                        .layout(SettingsShell::new(canvas.clone(), theme, section))
                        .children([
                            Route::new().index().element({
                                let canvas = canvas.clone();
                                move |_, cx| {
                                    Self::settings_page(
                                        canvas.clone(),
                                        SettingsSection::General,
                                        cx,
                                    )
                                }
                            }),
                            Route::new().path("appearance").element({
                                let canvas = canvas.clone();
                                move |_, cx| {
                                    Self::settings_page(
                                        canvas.clone(),
                                        SettingsSection::Appearance,
                                        cx,
                                    )
                                }
                            }),
                            Route::new().path("shortcuts").element({
                                let canvas = canvas.clone();
                                move |_, cx| {
                                    Self::settings_page(
                                        canvas.clone(),
                                        SettingsSection::Shortcuts,
                                        cx,
                                    )
                                }
                            }),
                        ]),
                ]),
            )
            // Keep the window chrome fill in sync with theme.
            .bg(theme.window_fill())
    }
}
