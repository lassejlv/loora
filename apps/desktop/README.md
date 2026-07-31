# Loora Desktop

Minimal [Deno Desktop](https://docs.deno.com/runtime/desktop/) shell for
<https://loora.design>.

Requires Deno 2.9 or newer.

```bash
bun run dev:desktop
bun run check:desktop
bun run build:desktop
```

Build output is written to `apps/desktop/dist/`.

## Title bar

The window is created with `transparentTitlebar` on macOS: the native traffic
lights and drag region stay, the opaque title strip goes, so the window reads as
one surface with the app. Windows and Linux keep their standard title bar —
`Deno.BrowserWindow` exposes no drag region or minimize/maximize calls, so a
frameless window there would need a hand-rolled drag implementation on top of
`onmousedown` / `onmousemove` / `setPosition`.

`transparentTitlebar` is creation-only, as are `frameless`, `transparent`, and
`noActivate`.
