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
