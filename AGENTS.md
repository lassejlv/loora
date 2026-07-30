# Repository Guidelines

Loora is an infinite-canvas design tool. Users arrange structured UI nodes on a
canvas; remote MCP clients (and agent handoff consumers) mutate the same
document through typed transactions. Designs have version history, isolated
drafts/branches, one-way exports, and GitHub integration.
There is no in-app chat agent — bring your own agent via MCP or handoff.

**Stack:** Bun workspaces monorepo · TanStack Start / React 19 · Drizzle + Neon
Postgres · Better Auth · Polar billing (plan access) · oRPC · Railway
(Dockerfile).

---

## Project Structure

```
apps/web          TanStack Start app (UI, API route handlers, canvas editor shell)
apps/mcp          Remote MCP server (Streamable HTTP, OAuth resource server)
packages/canvas   Canvas model, engine, merge, React surface, import, export
packages/db       Drizzle schema, Neon client, migrations (`@loora/db`)
packages/rpc      oRPC `appRouter`, storage, history, handoff (`@loora/rpc`)
packages/agent    Shared canvas tools + layout repair for MCP (`@loora/agent`)
packages/auth     Better Auth, preview access, GitHub (`@loora/auth`)
packages/billing  Polar plan access / entitlements (`@loora/billing`)
```

### `apps/web`

| Path | Purpose |
|------|---------|
| `src/routes/` | File-based routes + API handlers. `routeTree.gen.ts` is generated — never hand-edit. |
| `src/components/` | App UI. Canvas editor shell: `components/canvas/`. Primitives: `components/ui/`. |
| `src/lib/` | Client helpers (oRPC client, canvas runtime/clipboard, designs, theme, URL state). |
| `src/hooks/`, `src/test/` | Hooks, JSDOM test preload. |
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
| `/api/auth/$` | Better Auth |
| `/api/asset/$id`, handoff asset routes | Asset serving |
| GitHub connect + callback routes | OAuth |

Legacy `/?design=`, `/?d=`, `/app/design?id=`, and `?draft=` links redirect into the canonical editor route.

### `packages/canvas` (`@loora/canvas`)

Dependency-light canvas core. **Must never** import db, RPC, auth, web, drafts, or branch concepts. Branches are product targets owned by web/RPC/MCP.

| Export | Role |
|--------|------|
| `@loora/canvas/model` | `CanvasDocument`, node types, IDs, validation |
| `@loora/canvas/engine` | Typed transactions, indexes, undo/redo, preconditions, rebase, subscriptions |
| `@loora/canvas/merge` | Neutral left/right semantic merge |
| `@loora/canvas/react` | DOM/SVG renderer, surface, overlays, hooks |
| `@loora/canvas/export` | One-way HTML, JSX, Tailwind, React/TSX, JSON, PNG compile |
| `@loora/canvas/import` | HTML/CSS snapshot conversion into validated structured nodes |

Web editor UI lives in `apps/web/src/components/canvas/` (branch panel, sync target, history, export, layers, properties). Keep branch/sync controllers outside the canvas package. There is no in-app agent panel.

### `packages/agent` (`@loora/agent`)

Shared canvas mutation vocabulary for MCP (and handoff consumers), not models or chat:

- `canvas-tools` — typed tool handlers over the same transaction path as the editor/RPC
- `repair-layout` — layout repair utility used by `bun run canvas:repair-layout`

### `packages/rpc` (`appRouter` namespaces)

`auth` · `preferences` · `billing` · `design` · `canvas` · `draft` · `handoff` · `history` · `asset` · `github` · `mcp` · `admin`

Most product mutations go through oRPC. External agents use MCP or handoff — there is no `/api/chat` streaming path.

### `apps/mcp`

Remote MCP at `mcp.loora.design` (local default port `4100`). OAuth 2.1 resource server; Better Auth on the web app is the authorization server. Shares DB + canvas transaction path via `@loora/agent/canvas-tools`. Stateless Streamable HTTP.

### `packages/db`

- Schema: `packages/db/src/schema.ts`
- Migrations: `packages/db/drizzle/` (commit SQL **and** `meta/` snapshots)
- Notable tables: `design`, `designDraft`, `designVersion`, `canvasTransaction`, `asset`, auth/OAuth (incl. `oauth_*` MCP tables), `billingEntitlement`, and GitHub bindings. Legacy publish tables remain for compatibility but have no product runtime.

Legacy helpers remain in `@loora/db/canvas` and `@loora/db/drafts` for rollback and expiring-link compatibility.

### `packages/billing`

Polar grants plan access (Free / Pro / Studio). MCP tool calls are metered weekly via Polar (`packages/billing` mcp-usage); Free includes 200/week and Pro/Studio 1,000,000/week. There are no prepaid AI credits or top-ups. `billingEntitlement` may still carry unused legacy `meterBalance` / `creditedUnits` / `consumedUnits` columns as zeros.

---

## Build, Test, and Development Commands

Root scripts (from repo root; env loaded from `.env` where needed):

| Command | Purpose |
|---------|---------|
| `bun install` | Install pinned Bun workspace deps |
| `bun run dev` | Web app on `http://localhost:3000` |
| `bun run build` | Production bundle → `apps/web/.output/` |
| `bun run start` | Serve production build |
| `bun run test` | All `bun:test` suites with JSDOM preload |
| `bun run generate-routes` | Regenerate TanStack route tree after route file changes |
| `bun run db:generate` | Create migration from `schema.ts` changes |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:studio` | Drizzle Studio |
| `bunx tsc --noEmit` | Strict TypeScript check |
| `bun run canvas:repair-layout` | Layout repair utility (`packages/rpc`) |
| `bun run polar:provision` | Provision Polar products |

MCP local: `bun run --cwd apps/mcp dev` (or `start` / `stdio`).

**Always** use `bun run test`, not plain `bun test` — the root script preloads `apps/web/src/test/setup.ts` for DOM globals.

Copy `.env.example` → `.env` before dev. Required pieces typically include `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; optional billing/OAuth/storage keys as needed.

Deploy: Railway via root `Dockerfile` / `railway.json` (and `apps/mcp` for the MCP service).

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

`createPage` · `insertNodes` · `patchNodes` · `moveNodes` · `deleteNodes` · `readNode` · `readTree` · `searchNodes` · `createComponent` · `createInstance` · `setTokens` · `viewNode` · `viewPage` · `viewCanvas`

Implementation: `packages/agent/src/canvas-tools.ts` (and MCP server wiring in `apps/mcp/src/`).

### Persistence & legacy compatibility

- Designs, drafts, draft bases, and versions keep legacy payload columns for rollback and expiring-link compatibility alongside nullable Canvas documents and `canvasVersion`.
- `canvasTransaction` provides idempotency, stale-revision recovery, and audit. Server writes use compare-and-swap revisions; apply + log a batch atomically.
- Browser: optimistic apply, queue unacked batches in IndexedDB, flush after ~250ms or before target change. Rebase independent fields; surface only same-field, move-vs-move, or edit-vs-delete conflicts.
- Legacy designs without a Canvas document are unsupported in the editor; there is no automatic first-open conversion flow.
- `apps/web/src/components/element-frame.tsx` is **legacy-only** (temporary public-link compatibility). Do not reuse its iframe/Babel/Tailwind/per-element React-root pipeline in the normal editor.

### HTML/CSS import

HTML/CSS import computes a sandboxed DOM snapshot and converts supported layout and visual properties to structured nodes. Rasterize unsupported visual blocks entirely rather than inventing half-editable approximations.

---

## Coding Style & Naming

- TypeScript/TSX, strict types, **two-space indent**, **single quotes**, **no semicolons** (match handwritten code).
- `PascalCase` components · `camelCase` functions/vars · **kebab-case** filenames (`preview-access-screen.tsx`).
- Prefer **named exports**.
- Imports: `#/` for `apps/web/src/*`; `@loora/canvas|db|rpc|agent|auth|billing` (and subpath exports) across packages.
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
- Review generated SQL before migrating shared environments.

---

## Where to Change What

| Goal | Start here |
|------|------------|
| Node types, validation, document shape | `packages/canvas/src/model.ts` |
| Transactions, undo, conflict preconditions | `packages/canvas/src/engine.ts` |
| Draft merge semantics | `packages/canvas/src/merge.ts` (+ RPC draft procedures) |
| Editor chrome / tools / panels | `apps/web/src/components/canvas/` |
| Client sync / runtime | `apps/web/src/lib/canvas-*.ts` |
| API procedures | `packages/rpc/src/router.ts` (+ focused modules beside it) |
| Shared MCP canvas tools / layout repair | `packages/agent/src/` |
| MCP tools / transport | `apps/mcp/src/` |
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
