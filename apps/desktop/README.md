# Loora for desktop

A real desktop application: a [Deno Desktop](https://docs.deno.com/runtime/desktop/)
window over the same interface the web app serves, built by Vite from the same
packages (`@loora/shell`, `@loora/editor`, `@loora/ui`, `@loora/canvas`).

Requires Deno 2.9 or newer, and Bun for the interface build.

```bash
bun run dev:desktop     # Vite on :1421, host on :4300, window opens
bun run check:desktop   # deno check on the host + tsc on the interface
bun run build:desktop   # dist/app (interface), then dist/Loora.app
```

## Two halves

**The host** (`main.ts`, `host/`) runs under Deno. It serves a loopback HTTP
server, opens the window on it, and is the only thing that ever holds the
session. Everything the window asks for under `/api/*` is forwarded to
loora.design with `Authorization: Bearer <session token>` attached, which is
why the window needs no cookie, no CORS, and no credential of its own:
`/api/asset/…` images, the server-sent event stream, and oRPC all behave
exactly as they do on the web.

**The interface** (`src/`, `index.html`, `vite.config.ts`) is a Vite + React
single-page app on TanStack Router and Query, mounting the shared shell. In
development it is served by Vite, which proxies `/api`, `/desktop`,
`/callback`, and `/realtime` back to the host; in a packaged app it is built
into `dist/app`, embedded in the executable, and served by the host.

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

That token is written to the user's application data directory with mode
`0600` — `~/Library/Application Support/Loora/session.json` on macOS,
`%APPDATA%\Loora` on Windows, `$XDG_DATA_HOME/loora` elsewhere. Signing out
ends the session on the server and deletes the file.

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

The window keeps the platform's own title bar. macOS can drop the opaque strip
and keep the traffic lights (`transparentTitlebar`), but they then float over
the top-left of the canvas — where the editor puts its own controls — and
`Deno.BrowserWindow` exposes no drag region to reserve space with.
`transparentTitlebar` is creation-only, as are `frameless`, `transparent`, and
`noActivate`.

## Configuration

| Variable | Meaning |
|----------|---------|
| `LOORA_API_ORIGIN` | Deployment to talk to (default `https://loora.design`) |
| `LOORA_DESKTOP_PORT` | Loopback port for the host (default: one the OS picks; `4300` in development) |
| `LOORA_DESKTOP_DEV_SERVER` | Vite dev server the window is handed to |
| `LOORA_DESKTOP_APP_PORT` | Port for that dev server (default `1421`) |
| `VITE_LOORA_APP_ORIGIN` | Origin for links meant for a browser (default `https://loora.design`) |
