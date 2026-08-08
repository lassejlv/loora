use gpui::{
    actions, point, prelude::*, px, size, App, Bounds, KeyBinding, Menu, MenuItem, QuitMode,
    TitlebarOptions, WindowBackgroundAppearance, WindowBounds, WindowOptions,
};
use gpui_platform::application;
use loora_ui::{
    Assets, CanvasWorkspace, FitAll, FitSelection, GroupSelection, NewDesign, Redo, SaveDesign,
    ToggleFiles, ToolFrame, ToolHand, ToolImage, ToolRectangle, ToolSelect, ToolText, Undo,
    UngroupSelection, ZoomIn, ZoomOut, ZoomReset,
};
use std::sync::Arc;

actions!(loora, [Quit]);

fn main() {
    application()
        .with_assets(Assets)
        .with_quit_mode(QuitMode::LastWindowClosed)
        .run(|cx: &mut App| {
            cx.set_app_identity("com.loora.app", "Loora");
            set_app_icon();
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.bind_keys([
                KeyBinding::new("cmd-q", Quit, None),
                KeyBinding::new("ctrl-q", Quit, None),
            ]);
            cx.set_menus([
                Menu::new("Loora").items([MenuItem::action("Quit Loora", Quit)]),
                Menu::new("File").items([
                    MenuItem::action("New Design", NewDesign),
                    MenuItem::action("Open Designs…", ToggleFiles),
                    MenuItem::separator(),
                    MenuItem::action("Save", SaveDesign),
                ]),
                Menu::new("Edit").items([
                    MenuItem::action("Undo", Undo),
                    MenuItem::action("Redo", Redo),
                ]),
                Menu::new("View").items([
                    MenuItem::action("Zoom In", ZoomIn),
                    MenuItem::action("Zoom Out", ZoomOut),
                    MenuItem::action("Actual Size", ZoomReset),
                    MenuItem::separator(),
                    MenuItem::action("Fit Selection", FitSelection),
                    MenuItem::action("Fit All Pages", FitAll),
                ]),
                Menu::new("Arrange").items([
                    MenuItem::action("Group", GroupSelection),
                    MenuItem::action("Ungroup", UngroupSelection),
                ]),
                Menu::new("Tools").items([
                    MenuItem::action("Select", ToolSelect),
                    MenuItem::action("Hand", ToolHand),
                    MenuItem::action("Rectangle", ToolRectangle),
                    MenuItem::action("Frame", ToolFrame),
                    MenuItem::action("Text", ToolText),
                    MenuItem::action("Image", ToolImage),
                ]),
            ]);

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
            icon: window_icon(),
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

#[cfg(target_os = "macos")]
fn set_app_icon() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let main_thread = MainThreadMarker::new().expect("Loora must start on the main thread");
    let data = NSData::with_bytes(include_bytes!("../assets/app-icon.png"));
    let image = NSImage::initWithData(NSImage::alloc(), &data)
        .expect("app-icon.png must be a valid macOS application icon");
    let application = NSApplication::sharedApplication(main_thread);

    // SAFETY: AppKit is initialized and this runs on the main thread before windows open.
    unsafe { application.setApplicationIconImage(Some(&image)) };
}

#[cfg(not(target_os = "macos"))]
fn set_app_icon() {}

fn window_icon() -> Option<Arc<image::RgbaImage>> {
    let image = image::load_from_memory_with_format(
        include_bytes!("../assets/app-icon.png"),
        image::ImageFormat::Png,
    )
    .expect("app-icon.png must be a valid application icon")
    .into_rgba8();
    Some(Arc::new(image))
}
