# Loora for desktop

A real [Tauri](https://v2.tauri.app/) application over the same interface the
web app serves, built by Vite from the same packages (`@loora/shell`,
`@loora/editor`, `@loora/ui`, `@loora/canvas`).

Requires Rust, the platform prerequisites for Tauri, and Bun.

```bash
bun run dev:desktop     # Tauri starts Vite and opens the native window
bun run check:desktop   # tsc on the interface + cargo check on the host
bun run build:desktop   # Vite interface + native Tauri bundle
```

## Two halves

**The host** (`src-tauri/`) runs under Rust. It serves a loopback HTTP
server, opens the window on it, and is the only thing that ever holds the
session. Everything the window asks for under `/api/*` is forwarded to
api.loora.design with `Authorization: Bearer <session token>` attached, which is
why the window needs no cookie, no CORS, and no credential of its own:
`/api/asset/…` images, the server-sent event stream, and oRPC all behave
exactly as they do on the web.

**The interface** (`src/`, `index.html`, `vite.config.ts`) is a Vite + React
single-page app on TanStack Router and Query, mounting the shared shell. In
development Tauri starts Vite on `:1421` and the Rust host on `:4300`; the
window stays on the host, which reverse-proxies the interface from Vite so
sign-in and `/api` share one origin. In a packaged app the interface is built
into `dist/app`, embedded in the bundle, and served by the host.

## Signing in

1. The window asks the host to start (`POST /desktop/sign-in`).
2. The host opens `https://loora.design/desktop/auth?port=…&state=…` in the
   default browser and listens on loopback for one answer.
3. The visitor signs in at loora.design as usual and presses Connect, which
   mints a single-use code (Better Auth's one-time-token plugin: two minutes,
   stored hashed) and sends it to `http://127.0.0.1:<port>/callback`.
4. The host checks the state it generated, trades the code for a session at
   `/api/auth/one-time-token/verify`, and keeps the token that comes back in
   `set-auth-token`.

That token is stored in the operating system credential service: Keychain on
macOS, Credential Manager on Windows, or Secret Service on Linux. An existing
protected `session.json` from the Deno build is imported once and removed.
Signing out ends the session on the server and deletes the credential.

The `/desktop/*` endpoints are bound to `127.0.0.1`, so only this machine can
reach them, and the hand-off additionally has to match the state string the
host generated for that one attempt.

## Realtime

The editor asks for a ticket as usual. The host rewrites the socket URL in that
response to its own `/realtime` and holds the outbound socket itself, so
`ws.loora.design` only ever sees Loora's own origins and the desktop app needs
no configuration on that side.

## What is not here

Billing and the admin panel are browser errands: a plan is bought and cancelled
at loora.design, where a card form belongs, and moderation lives with the rest
of the staff tooling. Anything else that leaves the app — a checkout, an OAuth
consent screen — is opened in a browser rather than followed in the window.

## Title bar

The window keeps the platform's own opaque title bar so traffic lights and
window controls never overlap the editor's top-left canvas controls.

## Configuration

| Variable | Meaning |
|----------|---------|
| `LOORA_API_ORIGIN` | API deployment to talk to (default `https://api.loora.design`) |
| `LOORA_APP_ORIGIN` | Public app origin used for browser sign-in and trusted-origin headers (default `https://loora.design`) |
| `LOORA_DESKTOP_PORT` | Loopback port for the host (default: one the OS picks; `4300` in development) |
| `LOORA_DESKTOP_DEV_SERVER` | Vite dev server the window is handed to |
| `LOORA_DESKTOP_APP_PORT` | Port for that dev server (default `1421`) |
| `VITE_LOORA_APP_ORIGIN` | Origin for links meant for a browser (default `https://loora.design`) |
