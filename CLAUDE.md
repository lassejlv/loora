# CLAUDE.md

This file gives coding agents the repository-specific constraints that are easy
to miss.

## Commands

```bash
bun run dev
bun run build
bun run start
bun run test
bun run generate-routes
bun run db:generate
bun run db:migrate
bunx tsc --noEmit
```

Always run `bun run test`, rather than plain `bun test`, for the complete suite.
The root command preloads `apps/web/src/test/setup.ts`, which installs the JSDOM
globals used by component tests. Route changes require
`bun run generate-routes`; never hand-edit `apps/web/src/routeTree.gen.ts`.
After schema changes, use Drizzle's `bun run db:generate` and commit both the
generated SQL and metadata.

## Stack and layout

Loora is a Bun workspaces monorepo. The product is a TanStack Start/React 19 app
under `apps/web`; oRPC lives in `packages/rpc`, Drizzle/Postgres in
`packages/db`, authentication in `packages/auth`, shared MCP canvas tools in
`packages/agent`, and the MCP server in `apps/mcp`. There is no in-app chat
agent — external agents use MCP or handoff.

Canvas is the dependency-light `@loora/canvas` package:

- `@loora/canvas/model`: normalized document and node contracts, IDs, validation
- `@loora/canvas/engine`: typed transactions, indexes, undo/redo, preconditions,
  rebase, and granular subscriptions
- `@loora/canvas/merge`: neutral left/right semantic merge
- `@loora/canvas/react`: real DOM/SVG renderer, surface, overlays, and hooks
- `@loora/canvas/export`: deterministic HTML, JSX, Tailwind, React/TSX, and JSON output
- `@loora/canvas/import`: validated HTML/CSS snapshot conversion

The canvas package must never import the database, RPC, auth, web app, drafts,
or branch concepts. Branches are product targets owned by the web/RPC/MCP
layers. Pull requests are not a Loora feature.

## Canvas invariants

`CanvasDocument` is the only writable source of truth. It is normalized by
node ID and contains root Pages and Components plus frames, groups, text,
shapes, vectors, images, and instances. Layout, styles, breakpoints, tokens,
themes, instance overrides, and interactions are structured values. Never add
an arbitrary code node, CSS/class string escape hatch, or two-way source sync.

All mutations are validated `CanvasTransaction`s. Use the same operations and
engine through React, oRPC, MCP tools, and handoff. Transactions need stable
idempotency IDs and touched-field preconditions. Pointer previews may update
temporary DOM transforms, but commit one transaction on pointer-up; never
replace or serialize the full document on every move.

Rendered nodes are real DOM/SVG with `data-loora-node` and instance-path
metadata. The scene owns one camera transform and a viewport-space SVG overlay.
Keep document state in the engine; camera, selection, hover, active tool, and
isolation are ephemeral. Subscribe nodes to their own revision and parent order
instead of rerendering the full tree.

The web editor is under `apps/web/src/components/canvas`. Its branch UI and
sync target controller deliberately live outside the canvas package. External
agents accept structured node descriptors only and return permanent IDs for
temporary refs. Destructive MCP actions still require confirmation where
applicable. There is no in-app agent panel.

`/` is the public landing page, `/app` is the file browser, and
`/design/$id` opens Main. Active branches use `/design/$id/b/$branchId`.
Legacy `/?design=`, `/?d=`, `/app/design?id=`, and `?draft=` links redirect to
the canonical editor route. Both app routes mount through `AccountGate`, and
the editor never picks a document for itself — the route supplies `designId`
and optional `branchId`, then remounts when either changes.

## Persistence and legacy compatibility

Designs, drafts, draft bases, and versions retain their legacy payload columns
for rollback and expiring public-link compatibility, alongside nullable Canvas
documents and `canvasVersion`. The bounded
`canvasTransaction` table provides idempotency, stale-revision recovery, and an
audit trail. Server writes use compare-and-swap revisions and apply/log a batch
atomically.

The browser applies transactions optimistically, queues unacknowledged batches
in IndexedDB, and flushes after 250 ms or before target changes. Rebase
independent fields automatically; surface only actual same-field,
move-vs-move, or edit-vs-delete conflicts.

`apps/web/src/components/element-frame.tsx` is legacy-only. It remains solely
for temporary legacy public-link compatibility. Do not reuse its iframe, Babel,
Tailwind, source editing, or per-element React-root pipeline in the normal
editor. Legacy designs without a Canvas document are unsupported in the editor.

## Export, publish, and integrations

HTML/CSS/JS, React/TSX, JSON, published pages, previews, and PNG captures all
derive one-way from the Canvas document. HTML/CSS import is a separate, lossy
conversion into validated structured nodes; exported code never round-trips
automatically.
Published behavior comes from the declarative interaction runtime under a
restrictive CSP; do not execute document-authored script.

Figma import maps frames, auto-layout, text, paints, vectors, components, and
instances directly to Canvas. Rasterize complete unsupported visual blocks instead
of inventing a partially editable approximation.

Keep the MCP / handoff tool vocabulary aligned via `@loora/agent/canvas-tools`:
`createPage`, `insertNodes`, `patchNodes`, `moveNodes`, `deleteNodes`,
`readNode`, `readTree`, `searchNodes`, `createComponent`, `createInstance`,
`setTokens`, `viewNode`, `viewPage`, and `viewCanvas`.

Billing is Polar plan access only (no AI credits or top-ups).

## Security and access

Credentials stay server-only. Everything user-scoped is checked through
protected oRPC/MCP paths. Image and interaction URLs, SVG path data, CSS-like
values, metadata, geometry, responsive overrides, and document size are
validated at the canvas model boundary.

Capability URLs must not leak into automatic analytics. Public pages use
no-referrer behavior and link-scoped asset routes. Main is the only publishable
target; branch/draft documents are never published directly.

## Style

Use strict TypeScript, two spaces, single quotes, and no semicolons. Prefer
named exports and `#/` for imports rooted at `apps/web/src`; cross-package
imports use `@loora/*`. Keep generated files generated. Preserve unrelated
dirty changes and add focused tests beside the behavior they protect.
