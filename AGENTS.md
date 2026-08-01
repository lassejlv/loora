# Repository Guidelines

Loora is an infinite-canvas design tool. Users arrange structured UI nodes on a
canvas; remote MCP clients (and agent handoff consumers) mutate the same
document through typed transactions. Designs have version history, isolated
drafts/branches, one-way exports, and GitHub integration.
There is no in-app chat agent — bring your own agent via MCP or handoff.

It ships as a web app and as a desktop app — the same interface, from the same
packages, over a native window.

**Stack:** Bun workspaces monorepo · TanStack Start / React 19 · Vite + Tauri
(desktop) · Drizzle + Neon Postgres · Better Auth · Polar billing (plan
access) · oRPC · Railway (Dockerfile).

---

## Project Structure

```
apps/web          TanStack Start app (UI, API route handlers, canvas editor shell)
apps/desktop      Tauri host + Vite interface for the desktop app
apps/mcp          Remote MCP server (Streamable HTTP, OAuth resource server)
apps/ws           Realtime WebSocket service (rooms, presence, MCP agent events)
packages/ui       Shared design-system primitives, tokens, icon barrel, `cn` (`@loora/ui`)
packages/shell    Signed-in product surfaces shared by web and desktop (`@loora/shell`)
packages/platform Which client this is, and where its API and links point (`@loora/platform`)
packages/editor   Canvas editor shell, panels, client sync (`@loora/editor`)
packages/canvas   Canvas model, engine, merge, React surface, import, export
packages/db       Drizzle schema, Neon client, migrations (`@loora/db`)
packages/rpc      oRPC `appRouter`, storage, history, handoff (`@loora/rpc`)
packages/agent    Shared canvas tools + layout repair for MCP (`@loora/agent`)
packages/realtime Realtime wire protocol, connection tickets, ingest client (`@loora/realtime`)
packages/auth     Better Auth, preview access, GitHub (`@loora/auth`)
packages/billing  Polar plan access / entitlements (`@loora/billing`)
```

### `apps/web`

| Path | Purpose |
|------|---------|
| `src/routes/` | File-based routes + API handlers. `routeTree.gen.ts` is generated — never hand-edit. |
| `src/components/` | App shell, auth, dashboard, settings, billing, landing. The editor comes from `@loora/editor`, primitives from `@loora/ui`. |
| `src/lib/` | Client helpers (oRPC client, canvas runtime/clipboard, designs, theme, URL state). |
| `src/test/` | JSDOM test preload. |
| `src/styles.css` | Tailwind entry and design tokens. It `@source`s `packages/ui/src` and `packages/editor/src` so their classes are scanned. |
| `public/` | Static assets. |

**Key routes**

| Route | Notes |
|-------|-------|
| `/` | Public landing |
| `/app` | Design file browser (via `AccountGate`) |
| `/app/billing` | Plan and subscription management |
| `/app/integrations` | MCP sessions and connected external accounts |
| `/design/$id` | Editor on Main. Route supplies `designId` and remounts on change — the editor never picks a document itself. |
| `/design/$id/b/$branchId` | Editor on an active branch. |
| `/api/rpc/$` | oRPC |
| `/api/realtime-ticket` | Mints a signed WebSocket ticket after the usual access checks |
| `/api/canvas-events`, `/api/canvas-presence` | Server-sent-events fallback for realtime |
| `/api/auth/$` | Better Auth |
| `/api/asset/$id`, handoff asset routes | Asset serving |
| GitHub connect + callback routes | OAuth |

Legacy `/?design=`, `/?d=`, `/app/design?id=`, and `?draft=` links redirect into the canonical editor route.

### `packages/ui` (`@loora/ui`)

Presentational design-system layer. **Must never** import db, RPC, auth, billing, canvas, or anything from `apps/web` — it holds no product state and runs no data fetching.

| Export | Role |
|--------|------|
| `@loora/ui/<name>` | One primitive per file, e.g. `@loora/ui/button`, `@loora/ui/dialog` (`src/components/<name>.tsx`) |
| `@loora/ui/utils` | `cn` (clsx + tailwind-merge) |
| `@loora/ui/icons` | The hugeicons barrel — the only place `@hugeicons/*` is imported |
| `@loora/ui/hooks/*` | Presentational hooks, e.g. `@loora/ui/hooks/use-media-query` |

Design tokens live in `packages/ui/src/styles.css`, which both apps import —
it also carries the `@source` lines for every package outside an app that ships
classes. Each app's own entry stylesheet keeps only what is its own: the
Tailwind import, its fonts, its sources.

`apps/web/components.json` points the shadcn CLI here, so generated
primitives land in the package rather than the app.

### `packages/editor` (`@loora/editor`)

The `/design` surface: the editor shell and every panel that hangs off it, plus
the client half of canvas sync.

| Export | Role |
|--------|------|
| `@loora/editor/app` | `CanvasApp` — the whole editor, mounted by the design routes |
| `@loora/editor/<name>` | Panels and dialogs: `editor`, `branches`, `history`, `export-panel`, `layers-panel`, `properties-panel`, `share-dialog`, `assets-panel`, `canvas-preview`, … |
| `@loora/editor/lib/canvas-client` | `CanvasSyncController` — optimistic apply, batching, rebase, realtime |
| `@loora/editor/lib/*` | Clipboard, HTML paste/import, code copy, capture, shortcuts, design list helpers |

It depends on `@loora/canvas`, `@loora/ui`, `@loora/rpc` (client) and
`@loora/auth`, and **must never** import from `apps/web`. Where the editor needs
a product surface it does not own, the app passes it in: `CanvasApp` takes
`renderSettings` so the settings dialog body (account, billing, appearance)
stays in `apps/web`. Add a slot rather than an import back into the app.

### `packages/shell` (`@loora/shell`)

Every signed-in product surface that is not the canvas: the account gate, the
design browser, settings, integrations, the legal, preview, and plan screens,
and the admin panel. Both apps mount these, so a route file in either one is
a few lines that pick a surface and hand it a gate.

| Export | Role |
|--------|------|
| `@loora/shell/<name>` | A surface, e.g. `@loora/shell/account-gate`, `@loora/shell/designs-dashboard` |
| `@loora/shell/admin/*` | The staff panel |
| `@loora/shell/lib/*` | Theme, interface scale, custom themes, access cache, URL state |

It depends on `@loora/editor`, `@loora/ui`, `@loora/rpc`, `@loora/auth`, and
`@loora/platform`, and **must never** import from an app. A surface that needs
something only one client has takes a slot — `AccountGate` takes
`renderSignedOut`, which is how the desktop app sends people to a browser
instead of showing a password field.

Marketing pages (`landing/`, the legal documents) stay in `apps/web`: they are
that app's, and no window renders them.

### `packages/platform` (`@loora/platform`)

Four questions, one answer each, for code that runs in more than one client:
which platform this is, which origin serves `/api`, which origin a link handed
to a browser should name, and how to follow a link that leaves the app. It
imports **nothing** — `@loora/rpc/client`, `@loora/auth/client`, the editor,
and the shell all depend on it, so it can depend on none of them.

The defaults are the web app's (own origin, own tab), so configuring nothing
is correct there. `configureRuntime` is called once, before anything renders.

### `packages/canvas` (`@loora/canvas`)

Dependency-light canvas core. **Must never** import db, RPC, auth, web, drafts, or branch concepts. Branches are product targets owned by web/RPC/MCP.

| Export | Role |
|--------|------|
| `@loora/canvas/model` | `CanvasDocument`, node types, IDs, validation |
| `@loora/canvas/engine` | Typed transactions, indexes, undo/redo, preconditions, rebase, subscriptions |
| `@loora/canvas/merge` | Neutral left/right semantic merge |
| `@loora/canvas/react` | DOM/SVG renderer, surface, overlays, hooks |
| `@loora/canvas/motion` | Transitions, keyframe animations, easings, and the CSS they generate |
| `@loora/canvas/export` | One-way HTML, JSX, Tailwind, React/TSX, JSON, PNG compile |
| `@loora/canvas/import` | HTML/CSS snapshot conversion into validated structured nodes |

Editor UI lives in `packages/editor` (branch panel, sync target, history, export, layers, properties). Keep branch/sync controllers outside the canvas package. There is no in-app agent panel.

### `packages/agent` (`@loora/agent`)

Shared canvas mutation vocabulary for MCP (and handoff consumers), not models or chat:

- `canvas-tools` — typed tool handlers over the same transaction path as the editor/RPC
- `repair-layout` — layout repair utility used by `bun run canvas:repair-layout`

### `packages/rpc` (`appRouter` namespaces)

`auth` · `preferences` · `billing` · `design` · `canvas` · `draft` · `handoff` · `history` · `asset` · `github` · `mcp` · `admin`

Most product mutations go through oRPC. External agents use MCP or handoff — there is no `/api/chat` streaming path.

The browser client is `@loora/rpc/client` (`orpc`). It imports `appRouter` as a
type only, so no server implementation follows it into the bundle.

### `apps/mcp`

Remote MCP at `mcp.loora.design` (local default port `4100`). OAuth 2.1 resource server; Better Auth on the web app is the authorization server. Shares DB + canvas transaction path via `@loora/agent/canvas-tools`. Stateless Streamable HTTP.

### `apps/ws`

Realtime service at `ws.loora.design` (local default port `4200`). One socket
per open document; carries canvas invalidations, agent activity from MCP tool
calls, and collaborator cursors. It never opens the database: the web app runs
the access checks and mints a short-lived signed ticket, and this service only
verifies it. See `apps/ws/README.md` for endpoints and configuration.

### `apps/desktop`

A real application, not a wrapper around a website: a Tauri window over the
same interface the web serves, built by Vite from the same packages.

- **The host** (`src-tauri/`) runs under Rust. It serves a loopback HTTP
  server, opens the window on it, and is the only thing that holds the session.
  `/api/*` is proxied to `LOORA_API_ORIGIN` with `Authorization: Bearer` — so
  the window needs no cookie, no CORS, and no credential of its own, and
  images, the event stream, and oRPC behave as they do on the web. It also
  holds the outbound realtime socket, rewriting the ticket's URL to its own
  `/realtime`.
- **The interface** (`src/`) is Vite + React on TanStack Router and Query,
  mounting `@loora/shell`. Vite serves it in development (proxying `/api`,
  `/desktop`, `/callback`, `/realtime` back to the host) and the host serves
  the built files in a packaged app.
- **Signing in** happens at loora.design, in a browser. The host opens
  `/desktop/auth?port=…&state=…`, that page mints a one-time token from the
  visitor's session, and the host trades it for a session token stored in the
  operating system credential service.
- Billing and admin are not in the desktop app, and anything that leaves it —
  a checkout, an OAuth consent screen — opens in a browser.

See `apps/desktop/README.md`.

### `packages/db`

- Schema: `packages/db/src/schema.ts`
- Migrations: `packages/db/drizzle/` (commit SQL **and** `meta/` snapshots)
- Notable tables: `design`, `designDraft`, `designVersion`, `canvasTransaction`, `asset`, auth/OAuth (incl. `oauth_*` MCP tables), `billingEntitlement`, and GitHub bindings. The `publish_link` and
  `publish_egress` tables are no longer read or written by product code. Leave
  them in place — do not write a migration that drops them.

Legacy helpers remain in `@loora/db/canvas` and `@loora/db/drafts` for rollback and expiring-link compatibility.

### `packages/billing`

Polar grants plan access (Free / Pro / Studio). Capacity limits are enforced in product code (`@loora/billing/plan-limits`): Free has 50 design files, 1 open branch per design (`active` or `proposed`), 1 GB asset storage, and 2 days of version history; Pro/Studio have unlimited files/branches, 50 GB asset storage, and 90 days of version history. MCP tool calls are metered weekly via Polar (`mcp-usage`); Free includes 100/week and Pro/Studio 1,000,000/week. There are no prepaid AI credits or top-ups. `billingEntitlement` may still carry unused legacy `meterBalance` / `creditedUnits` / `consumedUnits` columns as zeros.

---

## Build, Test, and Development Commands

Root scripts (from repo root; env loaded from `.env` where needed):

| Command | Purpose |
|---------|---------|
| `bun install` | Install pinned Bun workspace deps |
| `bun run dev` | Web app on `http://localhost:3000` |
| `bun run dev:desktop` | Desktop app: Vite on `:1421`, host on `:4300`, window opens |
| `bun run dev:ws` | Realtime WebSocket service on `:4200` |
| `bun run dev:mcp` | Remote MCP server on `:4100` |
| `bun run build` | Production bundle → `apps/web/.output/` |
| `bun run start` | Serve production build |
| `bun run build:desktop` | Desktop interface → `apps/desktop/dist/app`, then the app bundle |
| `bun run check:desktop` | `cargo check` on the desktop host + `tsc` on its interface |
| `bun run test` | All `bun:test` suites with JSDOM preload |
| `bun run generate-routes` | Regenerate TanStack route tree after route file changes |
| `bun run db:generate` | Create migration from `schema.ts` changes |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:studio` | Drizzle Studio |
| `bunx tsc --noEmit` | Strict TypeScript check |
| `bun run canvas:repair-layout` | Layout repair utility (`packages/rpc`) |
| `bun run assets:backfill-urls` | Rewrite `/api/asset/…` references to the public bucket URL (dry run without `--apply`) |
| `bun run polar:provision` | Provision Polar products |

MCP local: `bun run --cwd apps/mcp dev` (or `start` / `stdio`).

**Always** use `bun run test`, not plain `bun test` — the root script preloads `apps/web/src/test/setup.ts` for DOM globals.

Copy `.env.example` → `.env` before dev. Required pieces typically include `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; optional billing/OAuth/storage keys as needed.

Deploy: Railway via root `Dockerfile` / `railway.json`, with `apps/mcp` and
`apps/ws` carrying their own `Dockerfile` + `railway.json` for the MCP and
realtime services.

A **new workspace package** has to be added to all three Dockerfiles. Each
copies workspace manifests one at a time before `bun install
--frozen-lockfile`, and a member the image never copies cannot resolve — the
build fails at install, before any app code compiles. Local installs succeed
either way, so this only ever shows up on Railway.

---

## Canvas Invariants

These are easy to break and expensive to fix. Treat them as hard rules.

1. **`CanvasDocument` is the only writable source of truth.** Normalized by node ID. Roots are Pages and Components; children are frames, groups, text, shapes, vectors, images, instances. Layout, styles, breakpoints, tokens, themes, instance overrides, and interactions are structured values.
2. **No code-node escape hatch.** Never add arbitrary code nodes, freeform CSS/class strings as the authoring model, or two-way source sync with exported code.
3. **All mutations are validated `CanvasTransaction`s.** Same ops and engine for React UI, oRPC, MCP tools, and handoff consumers. Transactions need stable idempotency IDs and touched-field preconditions.
4. **Do not full-document replace on every move.** Pointer previews may use temporary DOM transforms; commit one transaction on pointer-up.
5. **Render is real DOM/SVG** with `data-loora-node` and instance-path metadata. One camera transform + viewport-space SVG overlay. Document state lives in the engine; camera, selection, hover, tool, and isolation are ephemeral. Subscribe nodes to their own revision/parent order — avoid full-tree rerenders.
6. **External agent input is structured node descriptors**, not source code. Temporary client refs must resolve to permanent IDs. Destructive MCP actions still require confirmation in product UX where applicable.
7. **Exports are one-way** (HTML/CSS/JS, React/TSX, JSON, PNG, preview). They never round-trip into the editor.
8. **Pull requests are not a Loora feature.** Drafts are the branch/merge model (`active` → `proposed` → `applied` | `closed`).

### Shared MCP / handoff tool vocabulary

Keep MCP tools and handoff consumers aligned on the shared `@loora/agent` vocabulary:

`createPage` · `insertNodes` · `patchNodes` · `moveNodes` · `deleteNodes` · `readNode` · `readTree` · `searchNodes` · `createComponent` · `createInstance` · `setTokens` · `setAnimations` · `animateNodes` · `viewNode` · `viewPage` · `viewCanvas`

Implementation: `packages/agent/src/canvas-tools.ts` (and MCP server wiring in `apps/mcp/src/`).

### Realtime

One protocol, two transports, and one gate in front of both.

- `@loora/realtime` holds the wire protocol (`canvas.changed`, `agent.activity`,
  `presence.peer`, `presence.state`), the HMAC connection tickets, and the
  ingest client. It imports nothing from db, auth, or canvas.
- Browsers prefer a WebSocket to `apps/ws`. `/api/realtime-ticket` runs the
  same checks as the editor (session, legal consent, design access, preview
  access, plan) and signs a 60-second ticket; the socket service verifies it and
  stamps presence identity from those claims. Tickets are single use (`jti`
  claimed on the bus), travel in the `Sec-WebSocket-Protocol` header rather than
  the URL, and a socket is closed with `4001` after 15 minutes so the client
  re-tickets. One account may hold 20 sockets; the oldest gives way with `4002`,
  and an account may ask for 30 tickets a minute before it is turned away.
  The key a peer holds in a room is minted server-side — from the ticket route
  for a socket, scoped under the account for the SSE fallback — so nobody can
  claim a peer's key and overwrite or clear their cursor.
- `/api/canvas-events` (SSE) plus `/api/canvas-presence` remain the fallback,
  used when no socket service is configured or a socket cannot be established.
  Both transports carry identical events. Presence uses one of them at a time:
  the HTTP post is only for the SSE path, never while a socket is connecting.
- Server-side publishers (oRPC, MCP tools) call the same
  `@loora/db/canvas-realtime` functions as before. Those now post to the socket
  service's `/publish` when `REALTIME_INGEST_URL` is set and fall back to
  publishing on Redis, so a service missing one of the two still works.
- Redis carries events between instances and holds room state (presence hash,
  agent-activity key). Without it, `apps/ws` runs as a single instance with
  rooms in memory — enough for local development.

Env: `REALTIME_WS_URL` and `REALTIME_TICKET_SECRET` on web; `REALTIME_INGEST_URL`
and `REALTIME_INTERNAL_TOKEN` on web and MCP; `REALTIME_TICKET_SECRET`,
`REALTIME_INTERNAL_TOKEN`, and optional `REDIS_URL` /
`REALTIME_ALLOWED_ORIGINS` on `apps/ws`.

### Rate limiting

`@loora/rpc/rate-limit` is the one limiter, used by the web API routes and the
MCP server. `rateLimit(bucket, identity, rule)` counts a fixed window in Redis
(`REDIS_RATELIMIT_URL`, separate from the realtime one) with a single `EVAL`
per check, and falls back to counting in this process's memory when that Redis
is unset or unreachable — with a cooldown, so an outage never adds a connect
timeout to a request. Every limit lives in the `rateLimits` table in that
module; add a new one there rather than inlining numbers at a call site.

Count a signed-in caller as `user:<id>` and everyone else by address
(`callerIdentity`). **Never key a limit on the left-most `x-forwarded-for`
entry.** Proxies append to that header rather than replace it, so the front of
the chain is whatever the caller sent, and a caller who varies it gets a fresh
bucket per request. Cloudflare fronts `loora.design` and `mcp.loora.design` and
overwrites `cf-connecting-ip`, so `clientAddress` counts that, accepts a
single-entry `x-forwarded-for` as a fallback, and calls everything else
`unknown`. Better Auth resolves the caller through the same header
(`advanced.ipAddress.ipAddressHeaders` in `packages/auth/src/auth.ts`) — keep
the two in step.

Check before the expensive work — session lookups, design access, bucket
reads — not after.
Limits are sized from what the editor actually sends at its busiest; a limit
that trips during ordinary work is worse than none.

### Persistence & legacy compatibility

- Designs, drafts, draft bases, and versions keep legacy payload columns for rollback and expiring-link compatibility alongside nullable Canvas documents and `canvasVersion`.
- `canvasTransaction` provides idempotency, stale-revision recovery, and audit. Server writes use compare-and-swap revisions; apply + log a batch atomically.
- Browser: optimistic apply, queue unacked batches in IndexedDB, flush after ~250ms or before target change. Rebase independent fields; surface only same-field, move-vs-move, or edit-vs-delete conflicts.
- Legacy designs without a Canvas document are unsupported in the editor; there is no automatic first-open conversion flow.
- The old public-link renderer (`element-frame.tsx`, an iframe/Babel/Tailwind
  per-element React-root pipeline) is gone. Do not bring that shape back.

### Motion

Two ideas, kept apart.

- A **transition** is how a node travels between looks. It lives on the node
  (`transition`), and it applies to whatever its **visual states**
  (`visualStates`: `hover`, `press`, `focus`) change. A visual state carries a
  style patch and a transform — narrower than a node patch on purpose: a hover
  may restyle and move a node, it may not rewrite its text.
- An **animation** is a named keyframe sequence held once on the document
  (`document.animations`), like a token, and referenced by any number of nodes
  (`animations: [{ animationId, trigger }]`). Triggers are `load`, `in-view`,
  `always`, `hover`, `press`.

Keyframes move opacity and transform only. Both composite without touching
layout, which is what keeps an animated canvas smooth and the exported CSS
honest about what a browser can run.

`@loora/canvas/motion-css` generates the CSS, and both the editor renderer and
the exporter read from it — a hover that lifts a card on the canvas is the same
rule in the download. Every motion stylesheet ends with a
`prefers-reduced-motion` block that turns it all off. The canvas surface takes a
`motion` prop so the editor can stop motion while somebody is working, without
the document knowing.

Presets carry the common asks: `@loora/canvas/motion` has `fade-in`,
`fade-in-up`, `fade-in-down`, `slide-in-left`, `slide-in-right`, `scale-in`,
`pulse`, `float`, `spin`; `@loora/canvas/motion-presets` has hover looks —
`lift`, `grow`, `shrink`, `fade`, `nudge-right` — each bringing its own
transition. Agents reach them through `setAnimations` (define, by preset name or
full keyframes) and `animateNodes` (apply, with an optional `stagger` so a list
arrives one item at a time).

### HTML/CSS import

HTML/CSS import computes a sandboxed DOM snapshot and converts supported layout and visual properties to structured nodes. Rasterize unsupported visual blocks entirely rather than inventing half-editable approximations.

---

## Coding Style & Naming

- TypeScript/TSX, strict types, **two-space indent**, **single quotes**, **no semicolons** (match handwritten code).
- `PascalCase` components · `camelCase` functions/vars · **kebab-case** filenames (`preview-access-screen.tsx`).
- Prefer **named exports**.
- Imports: `#/` for `apps/web/src/*`; `@loora/ui|canvas|db|rpc|agent|auth|billing` (and subpath exports) across packages.
- Keep server credentials, DB access, and provider secrets out of client components.
- No repo-wide formatter/linter — match neighbors; run `bunx tsc --noEmit` before submitting.
- Do not hand-edit generated files (`routeTree.gen.ts`, Drizzle snapshots you didn't intend to regenerate).

---

## Testing Guidelines

- Import from `bun:test`. Colocate as `*.test.ts` / `*.test.tsx`.
- Use Testing Library for DOM behavior.
- Cover important success **and** failure paths for new behavior and bug fixes.
- Prefer package-local or file-adjacent tests when changing engine/model/merge/RPC.
- Run `bun run test` (preload required). Narrow with path args when iterating:  
  `bun test --preload ./apps/web/src/test/setup.ts path/to/file.test.ts`

---

## Commit & Pull Request Guidelines

History uses Conventional Commits with scopes when useful:

`feat(canvas): ...` · `fix(railway): ...` · `chore(...): ...`

- Imperative, concise subjects.
- PRs: user-visible change, schema/env callouts, linked issues, screenshots/recordings for UI.
- Report commands run and any validation skipped.
- Do not commit secrets or `.env`.
- After `db:generate`, commit both SQL and `packages/db/drizzle/meta/`.

---

## Security & Configuration

- Copy `.env.example` → `.env`; never commit secrets.
- Server-only: `DATABASE_URL`, `BETTER_AUTH_*`, Polar tokens, OAuth client secrets, encryption keys, storage credentials.
- User-scoped data only through protected oRPC/MCP paths.
- Validate image/interaction URLs, SVG paths, CSS-like values, metadata, geometry, overrides, and document size at the **canvas model** boundary.
- Capability URLs must not leak into analytics. Handoff payloads use token-scoped asset routes.
- A session token belongs to a server or to a process, never to a page. The
  desktop app's host holds it (`Authorization: Bearer`, Better Auth's `bearer`
  plugin) and hands the window only proxied responses; the one-time code that
  starts a desktop session is single use, hashed at rest, and only ever posted
  to loopback.
- Review generated SQL before migrating shared environments.

---

## Where to Change What

| Goal | Start here |
|------|------------|
| Node types, validation, document shape | `packages/canvas/src/model.ts` |
| Transitions, animations, hover states | `packages/canvas/src/motion.ts` (+ `motion-css.ts`, `motion-presets.ts`) |
| Transactions, undo, conflict preconditions | `packages/canvas/src/engine.ts` |
| Draft merge semantics | `packages/canvas/src/merge.ts` (+ RPC draft procedures) |
| Editor chrome / tools / panels | `packages/editor/src/components/` |
| Dashboard, settings, gates, admin | `packages/shell/src/components/` |
| Which client this is, API and link origins | `packages/platform/src/runtime.ts` |
| Desktop window, session, API proxy | `apps/desktop/src-tauri/` |
| Desktop routes and sign-in screen | `apps/desktop/src/` |
| Shared primitives, icons, `cn` | `packages/ui/src/` |
| Client sync / runtime | `packages/editor/src/lib/canvas-*.ts` |
| API procedures | One module per namespace in `packages/rpc/src/` (`canvas-procedures.ts`, `branches.ts`, `versions.ts`, `admin.ts`, …); `router.ts` only assembles them, and shared gates live in `procedures.ts` |
| Shared MCP canvas tools / layout repair | `packages/agent/src/` |
| MCP tools / transport | `apps/mcp/src/` |
| Realtime transport, rooms, presence | `apps/ws/src/` (protocol in `packages/realtime/src/`) |
| Schema / migrations | `packages/db/src/schema.ts` → `db:generate` |
| Auth / OAuth integrations | `packages/auth/src/` |
| Plans / entitlements | `packages/billing/src/` |
| Landing / marketing page | `apps/web/src/routes/index.tsx` |

---

## Agent Working Rules

- Prefer the smallest change that solves the request; do not drive-by refactor.
- Preserve unrelated dirty work in the tree.
- After behavior changes: focused tests + `bunx tsc --noEmit` when types are involved; `bun run test` before claiming done on non-trivial work.
- Route file add/rename/delete → `bun run generate-routes`.
- Schema change → `db:generate`, read the SQL, then migrate locally.
- When touching canvas mutations, keep UI, RPC, MCP tools, and handoff on the **same** transaction vocabulary.
