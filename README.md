# Loora

Native design canvas built with [GPUI](https://www.gpui.rs/).

## Workspace

```
crates/
  ui/        # Component library + canvas (`loora-ui`)
  router/    # React-Router style routing (`gpui-router`)
  engine/    # Document model, camera, local save (`loora-engine`)
  mcp/       # Built-in local MCP server (`loora-mcp`)
  desktop/   # App binary (`loora`)
```

`loora-ui` exports reusable primitives (`Theme`, `Icon`, `Button`,
`Sidebar`, `Motion`, canvas workspace, …). The desktop crate owns window
chrome and app startup.

## Routing

```rust
gpui_router::init(cx);

Routes::new().child(
    Route::new().path("/").layout(AppShell::new(theme)).children([
        Route::new().index().element(|_, _| home()),
        Route::new().path("about").element(|_, _| about()),
        Route::new().path("{*rest}").element(|_, _| not_found()),
    ]),
)
```

Navigate with `NavLink::new().to("/about")` or `use_navigate(cx)`. Nested layouts use `Outlet`.

## Sidebar (library)

```rust
Sidebar::new(theme)
    .title("Loora")
    .subtitle("Workspace")
    .selected("home")
    .items([
        SidebarEntry::new("home", "Home", IconName::Home),
        SidebarEntry::new("search", "Search", IconName::Search),
    ])
    .on_select(|id, window, cx| { /* navigate */ })
```

## Motion

```rust
loora_ui::init_motion(cx);

Motion::new()
    .id("page")
    .variants(Variants::new()
        .set("hidden", MotionStyle::new().opacity(0.).y(px(16.)))
        .set("visible", MotionStyle::new().opacity(1.).y(px(0.))))
    .initial_variant("hidden")
    .animate_variant("visible")
    .exit(MotionStyle::new().opacity(0.).y(px(-12.)))
    .while_hover(MotionStyle::new().scale(1.02))
    .while_tap(MotionStyle::new().scale(0.97))
    .transition(Transition::spring().stiffness(280.).damping(24.))
    .child(content)

AnimatePresence::new("main")
    .mode(PresenceMode::Wait)
    .child(pathname, |_, _| page)

Stagger::new()
    .transition(Transition::spring().stagger_children(Duration::from_millis(60)))
    .motion(Motion::new().id("a").fade_up().child(...))

let v = use_motion_value(cx, "scroll");
v.set_with_notify(0.5, cx);
Motion::new().id("x").opacity_from(v).fade_in()
```

## Run

```sh
just run          # release
just dev          # debug
just check        # typecheck
```

Or:

```sh
cargo run --release -p loora-desktop
```

While the desktop app is running, its no-auth MCP endpoint is available only
on loopback at `http://127.0.0.1:6767/mcp`. Set `LOORA_MCP_PORT` to another
valid local port before launch if needed. MCP mutations execute against the
same live canvas engine and are persisted to the local design store.
Open the command palette from the document title to copy the MCP URL or add
Loora directly to Claude, Codex, Cursor, or OpenCode.

Quit with **⌘Q** / **Ctrl+Q**.

## Stack

- GPUI + `gpui_platform` from [Zed](https://github.com/zed-industries/zed)
- Dark / light theme colors (`crates/ui/themes/dark.json`, `crates/ui/themes/light.json`)
