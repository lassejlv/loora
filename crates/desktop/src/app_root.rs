//! Application root: routes between the canvas and the settings page.

use gpui::{
    div, prelude::*, App, Entity, FocusHandle, KeyBinding, KeyDownEvent, Render, Window,
};
use gpui_router::{use_location, Route, Routes};
use loora_ui::{
    CanvasWorkspace, SettingsSection, SettingsSectionPage, SettingsShell, ToggleSettings,
};

pub struct AppRoot {
    canvas: Entity<CanvasWorkspace>,
    focus_handle: FocusHandle,
    _observe_canvas: gpui::Subscription,
}

impl AppRoot {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let canvas = cx.new(|cx| CanvasWorkspace::new(window, cx));
        let focus_handle = cx.focus_handle();
        focus_handle.focus(window, cx);

        // Re-render when theme / shortcut prefs change on the canvas workspace.
        let _observe_canvas = cx.observe(&canvas, |_, _, cx| cx.notify());

        cx.bind_keys([
            KeyBinding::new("cmd-,", ToggleSettings, None),
            KeyBinding::new("ctrl-,", ToggleSettings, None),
        ]);

        Self {
            canvas,
            focus_handle,
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
        let recording = canvas
            .read(cx)
            .shortcut_recording()
            .map(|s| s.to_string());
        let query = canvas.read(cx).shortcut_search().to_string();
        SettingsSectionPage::new(canvas, theme, section, overrides, recording, query)
    }
}

impl Render for AppRoot {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let canvas = self.canvas.clone();
        let pathname = if cx.has_global::<gpui_router::RouterState>() {
            use_location(cx).pathname.to_string()
        } else {
            "/".into()
        };
        let on_settings = pathname.starts_with("/settings");
        let section = SettingsSection::from_pathname(&pathname);
        let theme = canvas.read(cx).theme();

        // Sync native webview visibility with the active route.
        canvas.update(cx, |workspace, cx| {
            if on_settings {
                workspace.set_settings_route_active(true, section, cx);
            } else {
                workspace.set_canvas_route_active(true, cx);
            }
        });
        // Settings unmounts the canvas paint path; keep draining GTK so hide sticks.
        #[cfg(target_os = "linux")]
        if on_settings {
            loora_ui::pump_linux_canvas();
        }

        div()
            .size_full()
            .track_focus(&self.focus_handle)
            .key_context("AppRoot")
            .on_action(cx.listener(Self::toggle_settings))
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
                                    Self::settings_page(canvas.clone(), SettingsSection::General, cx)
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
