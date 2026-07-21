# Agent package extraction

## Goal

Move Loora's reusable agent domain and server runtime from `apps/web` and
`packages/auth` into a dedicated `@loora/agent` workspace package without
changing user-visible behavior, HTTP contracts, billing rules, or canvas tool
semantics.

The web app will continue to own the React agent interface and execution of
browser-only canvas tools. The new package will own model policy, prompts,
tool definitions, message preparation, usage accounting, and server-side agent
stream orchestration.

## Current state

Agent responsibilities are currently spread across several owners:

- `apps/web/src/routes/api.chat.ts` contains the chat request handler, model
  setup, message compaction, prompt construction, tool schemas, repository
  tools, billing coordination, and streaming lifecycle.
- `apps/web/src/components/agent-panel.tsx` contains the React interface,
  conversation state, retry policy, and client-side canvas tool execution.
- `apps/web/src/lib/ai-image-inputs.ts` contains shared model-message policy.
- `apps/web/src/skills/design-skills.ts` contains the agent's design prompt.
- `packages/auth/src/models.ts` contains agent provider and model metadata.
- `packages/auth/src/ai-limits.ts` contains AI usage accounting.

This makes the route a large implementation module and gives the auth package
ownership of agent-specific policy.

## Chosen architecture

Create one package with client-safe subpath exports and a server-only runtime:

```text
packages/agent/
├── package.json
├── tsconfig.json
└── src/
    ├── models.ts
    ├── messages.ts
    ├── prompts.ts
    ├── tools.ts
    ├── usage.ts
    └── server.ts
```

The package will be private and expose explicit subpaths through `exports`.
Consumers must import the narrow entrypoint they need rather than importing a
single barrel that risks bundling server code into the browser.

### `@loora/agent/models`

This client-safe entrypoint owns:

- provider definitions;
- stable Loora model keys and upstream model IDs;
- labels, pricing, and image-input capabilities;
- ChatGPT reasoning-effort definitions and normalization;
- default model selection and model/provider lookup helpers.

The model catalog moves from `@loora/auth/models`. Both the React panel and the
server runtime import it from its new owner.

### `@loora/agent/messages`

This client-safe entrypoint owns:

- image-input capability lookup;
- removal of unsupported image parts;
- old-message and tool-output compaction;
- canvas summarization for prompts;
- provider model-name sanitization.

Message transforms remain pure functions so they can be tested without a
server, database, or browser.

### `@loora/agent/prompts`

This server-safe entrypoint owns the design skill prompt and system-prompt
construction. Prompt construction accepts the already-authorized request
context, canvas summary, selected element IDs, asset list, repository state,
and forced-action flag. It does not perform database or network operations.

### `@loora/agent/tools`

This server entrypoint owns the Zod schemas and AI SDK tool definitions. Canvas
mutation tools continue to omit an `execute` function because they run in the
browser through `AgentPanel`. Repository and asset tools keep their current
server-side execution behavior and limits.

### `@loora/agent/usage`

AI usage limits and recording move from `@loora/auth/ai-limits`. This module
may depend on auth billing policy, Polar, top-up helpers, and the database, but
the auth package must not import from the agent package. Keeping that direction
avoids a package dependency cycle.

Existing RPC consumers will import usage functions from `@loora/agent/usage`.

### `@loora/agent/server`

This server-only entrypoint exports:

```ts
handleAgentChatRequest(request: Request): Promise<Response>
```

It owns the current chat lifecycle:

1. Authenticate and authorize preview and billing access.
2. Parse and validate the design, chat, model, messages, and canvas context.
3. Resolve the configured provider and enforce ChatGPT availability.
4. Acquire billing leases and check available credits or rolling limits.
5. Load user assets and optional GitHub repository context.
6. Prepare compact model messages, prompts, and tools.
7. Start the AI SDK stream.
8. Record usage and release the generation lease on completion or failure.
9. Return the existing UI-message stream response.

The implementation may use smaller internal functions, but only the request
handler and intentionally reusable helpers become public exports.

## Web application boundary

`apps/web` retains responsibilities tied to TanStack or the browser:

- `AgentPanel` and its visual components;
- `useChat` state and transport wiring;
- empty-response and promised-mutation recovery;
- client-side canvas mutation, rendering, screenshots, and render feedback;
- TanStack file-route registration;
- Bun request timeout configuration.

The chat route becomes a thin adapter:

```ts
POST: async ({ request }) => {
  allowLongRunningChatRequest(request)
  return handleAgentChatRequest(request)
}
```

The stream protocol, request body, tool names, and tool outputs remain
unchanged, so `AgentPanel` does not need a behavioral rewrite.

## Dependency direction

```text
apps/web ────────> @loora/agent/models
    │              @loora/agent/messages
    └────────────> @loora/agent/server

packages/rpc ───> @loora/agent/usage

@loora/agent ───> @loora/auth
              └─> @loora/db

@loora/auth ────> @loora/db
```

`@loora/auth` will no longer own or import model metadata or AI usage
accounting. Client-safe agent entrypoints must not import database, auth,
provider SDK, or environment-dependent modules.

## Error handling and compatibility

The extraction preserves:

- existing HTTP status codes and JSON error codes;
- preview, subscription, trial, and credit gates;
- ChatGPT connection and model-availability errors;
- generation lease acquisition and release behavior;
- five-minute stream timeout and provider error sanitization;
- repository call and output-size limits;
- image stripping for models without image support;
- current tool schemas, descriptions, names, and streaming behavior.

Moving code must not introduce fallback provider behavior, expose environment
variables, or move secret-bearing code into a browser-safe entrypoint.

## Migration steps

1. Add the package manifest, TypeScript configuration, workspace dependency,
   and root TypeScript path aliases.
2. Move model policy and update all imports.
3. Move usage accounting and update RPC/server imports.
4. Move message/image helpers and their tests.
5. Move prompts and tool construction.
6. Move the server handler and reduce the web route to its adapter.
7. Remove superseded files only after all consumers use the package.

No database migration or environment-variable change is required.

## Testing and validation

Focused package tests will cover:

- model fallback and capability lookup;
- reasoning-effort normalization;
- image removal and message compaction;
- code and image payload truncation;
- canvas prompt summarization;
- provider model-name sanitization;
- existing usage-cost calculations where practical.

The existing `AgentPanel` tests continue to protect browser tool execution and
retry behavior. Final validation is:

```sh
bun run test
bunx tsc --noEmit
bun run build
git diff --check
```

## Non-goals

- Redesigning or splitting `AgentPanel`.
- Changing prompts, model prices, provider configuration, or reasoning options.
- Changing billing rules or database schemas.
- Renaming tools or changing their client/server execution ownership.
- Creating a framework-agnostic public SDK.
- Splitting the work into separate `agent-core` and `agent-runtime` packages.
