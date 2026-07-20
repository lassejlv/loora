# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev          # dev server, port 3000
bun run build        # production build (vite)
bun run start        # run the built server (apps/web/.output/server/index.mjs)
bun run test         # ALWAYS use this, never plain `bun test` — it preloads apps/web/src/test/setup.ts (jsdom globals)
bun test --preload ./apps/web/src/test/setup.ts apps/web/src/lib/canvas.test.ts   # single test file
bun run generate-routes  # tsr generate → apps/web/src/routeTree.gen.ts
bun run db:generate  # generate SQL after editing packages/db/src/schema.ts
bun run db:migrate   # apply migrations in packages/db/drizzle/
bun run db:studio
bunx tsc --noEmit    # typecheck
```

Tests are Bun's runner + `@testing-library/react` against a jsdom DOM that `apps/web/src/test/setup.ts` installs on `globalThis` (window, document, PointerEvent, ResizeObserver stub, `IS_REACT_ACT_ENVIRONMENT`). Without the preload ~12 DOM tests fail spuriously. Root scripts delegate with `bun run --cwd <pkg>`, which does NOT auto-load the root `.env`; instead per-package scripts (web `dev`/`start`, db scripts) pass `--env-file=../../.env`. A missing env file is silently ignored, so the same scripts work in Docker/Railway where env is injected.

New shadcn components: `bunx shadcn@latest add <name>` from `apps/web/` (config in `apps/web/components.json`, output `apps/web/src/components/ui/`, Base UI + Radix primitives).

## Stack

TanStack Start (file routes; `/` has `ssr: false`) + React 19 + Vite 8 on the Bun runtime; Tailwind v4; Drizzle ORM over Neon's fetch-based serverless driver; Better Auth (email + Google when `GOOGLE_CLIENT_ID`/`SECRET` are set); oRPC at `/api/rpc`; Vercel AI SDK v7. Bun workspaces monorepo (`apps/web`, `packages/db|auth|rpc` as `@loora/*`, isolated linker + `run.bun` in `bunfig.toml`, shared versions in the root catalog; packages export TS source, no build step). Import alias `#/*` → `apps/web/src/*` (web app only; packages use relative or `@loora/*` imports). Routes generate into `apps/web/src/routeTree.gen.ts`. Deploys on Railway (`railway.json`, `Dockerfile`).

Env (see README): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `REQUIRE_PREVIEW_ACCESS`, `WAFER_API_KEY`, `LWC_SECRET`, `CODEX_CLIENT_VERSION`, optional `S3_*`, optional Google OAuth pair.

## Core architecture

### Everything is code in a box

`CanvasElement` (`apps/web/src/lib/canvas.ts`) = `{ id, name, x, y, w, h, code, groupId? }`. `code` is plain HTML/CSS/JS **or** JSX/TSX defining `function App`. There are no typed shapes — legacy pre-code records are dropped by `onlyCodeElements`, never migrated. Elements sharing a `groupId` select and move as one. Helpers here: `applyElementPatches`, `reorderElements` (z-order rebuild, unknown/dup ids ignored), `elementId`.

### Render pipeline — `apps/web/src/components/element-frame.tsx`

The trickiest file in the repo. Read its header comment before touching it.

- **Compile in the parent.** JSX/TSX goes through one lazily-loaded shared Babel (`ensureBabel`) in the host document, so each iframe only boots React + Tailwind from `/public/vendor/*.js` (vendored, same-origin). `compileForFrame` runs the TypeScript+JSX transform; a failed `jsx-snippet` compile retries as html.
- **`classifyCode`** → `jsx-app` (defines `App`), `jsx-snippet` (bare JSX, wrapped in a fragment), or `html`. `hasEntryCall` decides whether the frame must supply the `createRoot` call itself (`needsEntry`).
- **Static document.** `buildElementDoc()` boots the iframe once; afterwards compiled code arrives over `postMessage` (`loora:code` with `{ code, mode, seq, needsEntry }`). Frame replies `loora:element-ready`, `loora:ok`/`loora:error` keyed by `seq`, and `loora:dirty` from a MutationObserver. Updating an element never reloads the frame or re-fetches vendor scripts.
- **Last-good rendering.** An uncompilable or crashing payload leaves the previous render intact, so pushing every streamed chunk from the agent is safe — the newest compilable one wins.
- **`stripModuleSyntax`** removes `import`/`export` (agents write them reflexively; they are SyntaxErrors under Babel's classic preset). **`REACT_GLOBALS_PRELUDE`** assigns hooks onto `globalThis` rather than lexical consts so agent code doing `const { useState } = React` doesn't collide.
- **Render registry.** `awaitRenderResult(id, timeoutMs = 1500)` resolves `ok` or `error: …` and is what the agent gets back after every mutation; it waits out a short grace period so async runtime errors after a successful mount still count. `captureElement(id)` runs the capture handshake and returns a PNG plus a revision and a `volatile` flag (set when CSS animations are running). `getElementCaptureRevision` exposes the per-element revision counter used to validate captures against the current code.
- **Asset inlining.** The sandboxed frame has no session cookie, so `/api/asset/…` would 401; the parent fetches and inlines those as data URLs before sending code.

### Snapshots

`apps/web/src/lib/snapshot.ts` composites element PNGs into one canvas image for the agent's vision. Captures cache per element keyed by djb2(code)+`w`+`h` (`snapshot-cache.ts`, 256 entries). `shouldReuseCapture` weighs the key, the frame revision, and the requested freshness (`reuse-clean` vs `fresh`); a failed fresh capture falls back to the cached image **only** if the key matches, never to a capture of different contents.

### Agent loop

Server `apps/web/src/routes/api.chat.ts` declares tools with **no execute** — `createElement`, `createElements` (≤40), `updateElement`, `readElement`, `deleteElement`, `viewCanvas`, `askQuestion`. Every one runs **client-side** in `agent-panel.tsx`'s `useChat({ onToolCall })` against live canvas state via refs, then reports back. `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` continues the loop; `stopWhen: stepCountIs(40)` caps it server-side.

What shapes this code:

- **Context explosion.** `messagesForModel` keeps only `HISTORY_TAIL_INTACT = 3` trailing messages intact. Older ones lose reasoning, lose canvas snapshots, and have tool-call `code` truncated to 200 chars with a "call readElement for the current code" hint. `viewCanvas` outputs collapse to `{ viewed: true }`. Anything that widens payloads must respect this.
- **Streaming order.** `code` is deliberately the **last** field of the tool schema so geometry arrives first; the panel places the element from parsed geometry and pushes partial code into the frame (throttled to 250ms per tool call) while the rest streams. Streaming elements are tracked by `toolCallId` (`toolCallId#index` for batches) and finalized when the call completes.
- **Render feedback.** Tool results echo geometry plus `ok`/`error: …` — never the code, which would double token cost. The system prompt requires the model to fix errors rather than claim success.
- **`forceCanvasAction`.** When the model promises a change and finishes with no tool call, the client regenerates once with this flag, which injects a "call the tool now, do not promise again" line. One retry only; a second failure surfaces a stall message.
- **Approval tools.** `deleteElement` and `askQuestion` park in an approval-requested state and are resolved by inline UI cards, so the user can decline a deletion.
- **Misc.** `sanitizeModelNames` scrubs upstream model ids out of error text; `allowLongRunningChatRequest` disables Bun's 10s inactivity timeout per chat request (reasoning models stall before the first chunk); the client aborts after 120s of no progress; `onFinish` records token usage.

The system prompt is assembled in `api.chat.ts` from the behavior rules, `DESIGN_SKILL_PROMPT` (`apps/web/src/skills/design-skills.ts` — frontend-design / apple-design / no-vibe-code guidance, plus the loora palette), the user's asset list (top 100), the current canvas JSON, and the selection.

### Editor state — `apps/web/src/routes/index.tsx`

`Editor` owns nearly all canvas state: shapes, selection, active tool, panel visibility, docs. Hot values mirror into refs (`shapesRef`, `selectedIdsRef`, `activeIdRef`) so imperative handlers and the agent read current values without re-subscribing.

- **Undo/redo**: `past`/`future` ref arrays capped at 100 entries; mutations within **800ms** coalesce into one step; history resets on doc switch.
- **Persistence**: every mutation writes localStorage immediately (`apps/web/src/lib/docs.ts`) and schedules a 1500ms-debounced `design.save` over oRPC; the active doc is flushed before switching.
- **Doc-switch races**: `documentRequest` is a monotonic fetch token, `documentMutationVersions` detects edits made while a remote load is in flight, and `mutationsBlockedRef` blocks mutations until `loadedDocId === activeId` so a stale remote payload can't clobber local edits.
- **Shortcuts**: undo/redo, zoom (`Cmd±`, `Cmd0`, `Shift1` fit, `Shift2` selection), select-all/duplicate/copy/paste/cut, group/ungroup (`CmdG`), z-order (`[`/`]`, shift for extremes), arrow nudge (1px / 10px with shift), tool keys `v i c t r m h` (select, interact, comment, text, box, image, hand). Pasted/duplicated elements get fresh `groupId`s.

### Canvas — `apps/web/src/components/canvas.tsx`

Renders and handles interaction. View is `{ x, y, scale }` persisted per doc, scale clamped 0.1–16; `toScene()` inverts the transform. Marquee selection is group-atomic. Move snapping compares the selection bounding box against other elements' edges and centers with a `6 / scale` threshold and draws SVG guides. Corner-handle resize supports alt-from-center and shift-aspect and scales multi-selections proportionally. `CanvasControls` (zoom in/out/reset/fit/to-selection) is exposed upward by ref. Interact mode (double-click, or the `i` tool) flips the frame to `pointer-events: auto` so the rendered element is usable; escape exits. The comment tool pins a `CommentTarget` (element + percentage coordinates) and `composeComment` folds that location into the message sent to the agent.

Supporting libs: `align.ts` (align/distribute within the selection's bounding box), `element-templates.ts` (default size + code per draw tool), `export.ts` (JSON export carries full code; HTML export sanitizes and inlines HTML elements into script-less iframes and replaces JSX elements with placeholders, since JSX can't run statically), `sanitize.ts` (tag/attribute/URL-scheme allowlist, plus `toXhtml` for snapshot rasterization), `motion.ts` (shared UI transitions, reduced-motion aware).

### Models

One typed catalog: `packages/auth/src/models.ts`. Providers are either `openai-compatible` (label, `baseURL`, `apiKeyEnv`) or `chatgpt`. Server-managed models run on the app's key (currently Wafer). ChatGPT-backed models proxy through the user's **own** connected ChatGPT account (`@opencoredev/loginwithchatgpt-*`, `packages/auth/src/chatgpt-auth.ts`, `/api/chatgpt/*`) and are listed only when that account reports them available — they bypass the app's spend limits because the user pays. Provider credentials never reach the browser. `supportsImageInput` per model gates snapshots and `viewCanvas` (`ai-image-inputs.ts` strips image parts for models without it). Adding a provider/model: see README.

### Persistence & access

Everything user-scoped goes through `packages/rpc/src/router.ts`. Three tiers: `protectedProcedure` (session + `canUseApp`), `signedInProcedure` (session only — preview-access request flow), `adminProcedure` (`isAdmin`). Groups: `auth`, `design`, `handoff`, `history`, `chat`, `asset`, `usage`, `admin`.

- **Schema** (`packages/db/src/schema.ts`): Better Auth tables (`user`/`session`/`account`/`verification`, with `isAdmin`, `previewAccess`, `previewAccessRequestedAt`, `usageMultiplier` added to `user`), plus `design`, `designVersion`, `designChat` (composite PKs on `(id, userId)`, JSONB payloads, indexes tuned for the cursor pagination), `asset`, `aiUsage`, `chatgptSession`.
- **Version history** is git-like commits with added/removed/changed diffs (`packages/rpc/src/history.ts` client-side, capped at 50 in localStorage; `history.commit` server-side with `skipIfUnchanged` and cursor pagination over `(createdAt, id)`).
- **Chats** are per design, saved with a 500ms debounce and on unmount; `ensureDesign` upserts to dodge FK races from debounced writes.
- **Assets**: ≤5MB images, written to Bun's S3 client at `assets/{userId}/{assetId}` when `S3_*` is configured, else base64 in the `asset.data` column. Served by `/api/asset/:id` behind auth with immutable cache headers.
- **Handoff**: `handoff-token.ts` mints `payload.HMAC-SHA256` tokens (7-day TTL, nonce, no DB record — expiry is checked on read) for read-only shared designs; `/api/handoff/:token` returns the design JSON and `/api/handoff/:token/asset/:id` serves only assets actually referenced by its shapes.
- **Gating**: `canUseApp` (`packages/auth/src/preview-access.ts`) — admins and preview-approved users only, unless `REQUIRE_PREVIEW_ACCESS=false`. Enforced in the oRPC middleware and in `api.chat`, `api.asset`, `api.chatgpt`.
- **Spend caps** (`packages/auth/src/ai-limits.ts`): rolling 24h/7d windows summed from `aiUsage`, $0.50/day and $2/week, each times the user's `usageMultiplier`. Costs are stored as integer micro-USD (`costMicroUsd = inputTokens*price.input + outputTokens*price.output`, prices are per 1M tokens). Over-limit chat requests return 429.

## Conventions

- No default exports for components; named exports, `memo` on the heavy panels (`agent-panel`, `layers-panel`, …).
- Comments explain *why* (the non-obvious constraint), not *what*. Match that density — the existing header comments in `element-frame.tsx`, `api.chat.ts`, and `storage.ts` are the model.
- Agent-facing strings (tool descriptions, system prompt, design skills) are product behavior — editing them changes output quality. Treat them like code, not copy.
- Panels are siblings driven by `Editor` state: `layers-panel`, `history-panel`, `agent-panel`, `code-editor-panel`, `assets-panel`, `settings-panel`, `export-dialog`.
