# Repository Guidelines

## Project Structure & Module Organization

Loora is a Bun/TanStack Start application. Route modules and API handlers live in `src/routes/`; `src/routeTree.gen.ts` is generated and must not be edited manually. Reusable UI belongs in `src/components/`, with primitives under `src/components/ui/`. Put shared logic in `src/lib/`, database code in `src/db/`, and authenticated RPC procedures in `src/orpc/`. Static files live in `public/`; Drizzle migrations live in `drizzle/`. Tests are colocated as `*.test.ts` or `*.test.tsx`, with browser setup in `src/test/setup.ts`.

## Build, Test, and Development Commands

- `bun install` installs the pinned Bun dependencies.
- `bun run dev` starts Vite on `http://localhost:3000`.
- `bun run test` runs all `bun:test` suites with the required JSDOM preload.
- `bun run build` creates the production bundle in `.output/`.
- `bun run generate-routes` regenerates the TanStack route tree after route changes.
- `bun run db:generate` creates a migration from `src/db/schema.ts` changes.
- `bun run db:migrate` applies pending migrations using `.env`.
- `bunx tsc --noEmit` runs strict TypeScript validation.

## Coding Style & Naming Conventions

Use TypeScript/TSX with strict types, two-space indentation, single quotes, and no semicolons, matching the existing handwritten code. Use `PascalCase` for React components, `camelCase` for functions and variables, and kebab-case filenames such as `preview-access-screen.tsx`. Prefer the `#/` alias for imports rooted at `src/`. Keep server credentials and database operations out of client components. No formatter or linter is configured, so keep changes consistent and run TypeScript checks before submitting.

## Testing Guidelines

Import helpers from `bun:test`. Add focused regression tests beside the implementation and use Testing Library for DOM behavior. New behavior and bug fixes should exercise important success and failure paths. Run `bun run test`, not plain `bun test`, because DOM-heavy suites require `src/test/setup.ts`.

## Commit & Pull Request Guidelines

Recent history mostly follows Conventional Commit subjects: `feat(canvas): ...`, `fix(railway): ...`, and `chore(vscode): ...`. Keep subjects imperative, concise, and scoped when useful. Pull requests should explain the user-visible change, call out schema or environment changes, link relevant issues, and include screenshots or recordings for UI work. Report the commands you ran and any validation you could not complete.

## Security & Configuration

Copy `.env.example` to `.env`; never commit secrets. Provider keys, auth secrets, storage credentials, and `DATABASE_URL` must remain server-only. Review generated SQL before running migrations against shared environments.
