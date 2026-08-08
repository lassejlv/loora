# Repository Guidelines

## Project Structure & Module Organization

Loora is a Rust 2021 GPUI workspace. The root `Cargo.toml` defines these crates:

- `crates/ui`: standalone component library (`Theme`, `Icon`, `Button`, `Sidebar`, `Motion`, canvas, assets).
- `crates/router`: React-Router style `gpui-router` (`Routes`, `Route`, `NavLink`, `Outlet`).
- `crates/engine`: document engine (nodes, camera, persistence).
- `crates/desktop`: native `loora` binary — composes the libraries into the app.

Keep library APIs in `ui` / `router` / `engine`; put app wiring in `desktop`.

## Build, Test, and Development Commands

- `just dev`: run the desktop app in debug mode.
- `just run`: run the optimized release build.
- `just build`: build `loora-desktop` in release mode.
- `just check`: type-check the UI and desktop crates.
- `cargo fmt --all -- --check`: verify Rust formatting.
- `cargo clippy --workspace --all-targets`: run Rust's standard lints.

## Coding Style & Naming Conventions

Use standard `rustfmt` output (four-space indentation). Follow Rust naming conventions: `snake_case` for modules, functions, and tests; `PascalCase` for types and traits; `SCREAMING_SNAKE_CASE` for constants.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects, optionally scoped (for example, `ui: refine button hover`). Keep commits focused. Pull requests should explain the motivation, summarize validation performed, and include screenshots for visible GPUI changes.
<<<<<<< Updated upstream
=======

## Cursor Cloud specific instructions

This is a native **macOS-oriented** GPUI desktop app. The following are non-obvious caveats for developing/validating it on the Linux cloud VM (dependencies are pre-installed by the environment's update/setup step, so these are just run-time notes):

- **Toolchain matters for dependency resolution.** `gpui`/`gpui_platform` come unpinned from `github.com/zed-industries/zed` (edition 2024, needs Rust ≥ 1.85), and `Cargo.lock` pins commit `101ca00a` (`gpui 0.2.2`). Old cargo (≤ ~1.83) mis-resolves the git source to a non-member test fixture `tooling/lints/test_fixture/gpui` (`gpui 0.0.0`) and fails with `failed to select a version for gpui (locked to 0.2.2) ... candidate 0.0.0`. Use a recent stable toolchain (`rustup default stable`); the default is set in the snapshot. Build/test with `--locked` to honor the pinned commit.
- **The HTML canvas webview is soft-failed on Linux.** GPUI opens a window, but the embedded WebKit canvas cannot attach: `wry`'s Linux `build_as_child` only accepts a `RawWindowHandle::Xlib`, while GPUI exposes `Xcb`/`Wayland`. The app no longer panics — it logs `loora: embedded HTML canvas unavailable: …` and shows a placeholder so chrome/settings still work. Full canvas editing still requires macOS (WKWebView). Do not expect the design canvas itself to be interactive on Linux.
- **Validate on Linux via build + lint + tests, plus Settings chrome.** `just check`, `cargo clippy --workspace --all-targets`, `cargo build -p loora-desktop --locked`, and `cargo test -p loora-engine -p gpui-router -p loora-ui --locked`. Open Settings with `Ctrl+,` (or the gear in the titlebar) to exercise General / Appearance / Shortcuts even when the canvas webview is unavailable. The `loora-ui` tests also run headless via `gpui` `test-support`.
- **No GPU in this VM** (`/dev/dri` absent). GPUI's renderer falls back to software Vulkan (mesa `lavapipe`/`llvmpipe`); `libEGL`/`ZINK`/DRI3 warnings on launch are expected and non-fatal. If you run any GUI/Vulkan tooling, set `XDG_RUNTIME_DIR` (e.g. `/tmp/xdg-runtime-$(id -u)`) since it is unset by default.
- **Pre-existing failures unrelated to setup (do not "fix" as env work):** the `loora-ui` test `webview_drag_snaps_with_smart_guides` fails on commit `5f77b12` (it asserts the embedded JS contains `snapTargets:collectSnapTargets(node)`, but the code uses `collectSnapTargets(primary)`). Also `cargo fmt --all -- --check` reports diffs (`crates/engine/src/camera.rs`, `canvas_import.rs`) under current rustfmt.
>>>>>>> Stashed changes
