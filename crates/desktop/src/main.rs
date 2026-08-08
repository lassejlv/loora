use gpui::{
    actions, point, prelude::*, px, size, App, Bounds, KeyBinding, Menu, MenuItem, QuitMode,
    TitlebarOptions, WindowBackgroundAppearance, WindowBounds, WindowOptions,
};
use gpui_platform::application;
use loora_ui::{Assets, CanvasWorkspace};

actions!(loora, [Quit]);

fn main() {
    application()
        .with_assets(Assets)
        .with_quit_mode(QuitMode::LastWindowClosed)
        .run(|cx: &mut App| {
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.bind_keys([
                KeyBinding::new("cmd-q", Quit, None),
                KeyBinding::new("ctrl-q", Quit, None),
            ]);
            cx.set_menus([Menu::new("Loora").items([MenuItem::action("Quit", Quit)])]);

            open_main_window(cx);
            cx.activate(true);
        });
}

fn open_main_window(cx: &mut App) {
    let bounds = Bounds::centered(None, size(px(1100.), px(720.)), cx);

    cx.open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            window_min_size: Some(size(px(800.), px(520.))),
            window_background: WindowBackgroundAppearance::Blurred,
            app_id: Some("com.loora.app".into()),
            titlebar: Some(TitlebarOptions {
                title: Some("Loora".into()),
                appears_transparent: true,
                // Align traffic lights with the 52px chrome header.
                traffic_light_position: Some(point(px(14.), px(18.))),
            }),
            ..Default::default()
        },
        |window, cx| {
            window.set_background_appearance(WindowBackgroundAppearance::Blurred);
            cx.new(|cx| CanvasWorkspace::new(window, cx))
        },
    )
    .expect("failed to open Loora window");
}
