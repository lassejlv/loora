import type { ToolSet } from 'ai'
import { z } from 'zod'
import type { CanvasElement } from '@loora/db/canvas'
import {
  getGitHubRepositoryContextByName,
  GitHubIntegrationError,
  listGitHubRepositories,
  listRepositoryTree,
  readRepositoryFile,
  searchRepositoryCode,
  viewRepositoryImage,
  type GitHubRepositoryContext,
} from '@loora/auth/github'
import { boundedJson, repositoryToolNames } from './messages'
import type {
  DelegatedTask,
  SubagentBatch,
} from './internal/subagents'

const elementFields = {
  name: z.string().max(200).describe('short layer label shown to the user, e.g. "Hero section"'),
  x: z.number().describe('left edge in canvas units'),
  y: z.number().describe('top edge in canvas units'),
  w: z.number().min(1).describe('width'),
  h: z.number().min(1).describe('height'),
  r: z
    .number()
    .min(0)
    .max(359)
    .describe('rotation in degrees, clockwise about the element center; omit or 0 for none'),
  // Keep code as the LAST field so it streams last and the client can place
  // the element (from the already-parsed geometry) while code is generating.
  code: z
    .string()
    .max(200_000)
    .describe(
      'The element content: either plain HTML (Tailwind classes, <style> blocks, inline <script> all work), or JSX/TSX defining function App (React hooks like useState work; TypeScript is stripped at compile; imports/exports are stripped at runtime). Renders in a sandboxed document sized exactly w×h.',
    ),
}

const newElementSchema = z.object({
  name: elementFields.name,
  x: elementFields.x,
  y: elementFields.y,
  w: elementFields.w,
  h: elementFields.h,
  r: elementFields.r.optional(),
  code: elementFields.code,
})

export function createReadOnlyCanvasTools(shapes: CanvasElement[]): ToolSet {
  return {
    listCanvasElements: {
      description:
        'List the current canvas elements with geometry and short code previews. This is read-only.',
      inputSchema: z.object({
        query: z.string().trim().max(200).optional(),
      }),
      execute: async ({ query }: { query?: string }) => {
        const needle = query?.toLowerCase()
        const matches = needle
          ? shapes.filter((element) =>
              `${element.name}\n${element.code}`.toLowerCase().includes(needle),
            )
          : shapes
        return {
          elements: matches.slice(0, 100).map((element) => ({
            id: element.id,
            name: element.name,
            x: element.x,
            y: element.y,
            w: element.w,
            h: element.h,
            r: element.r,
            code: element.code.length <= 600
              ? element.code
              : `${element.code.slice(0, 600)}…[truncated]`,
          })),
          total: matches.length,
          truncated: matches.length > 100,
        }
      },
    },
    searchCanvasElements: {
      description:
        'Search every canvas element for a code substring and return matching lines. This is read-only.',
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }: { query: string }) => {
        const needle = query.toLowerCase()
        const matches: { id: string; name: string; line: number; text: string }[] = []
        for (const element of shapes) {
          const lines = element.code.split('\n')
          for (let index = 0; index < lines.length; index++) {
            if (!lines[index].toLowerCase().includes(needle)) continue
            matches.push({
              id: element.id,
              name: element.name,
              line: index + 1,
              text: lines[index].trim().slice(0, 300),
            })
            if (matches.length === 50) return { matches, truncated: true }
          }
        }
        return { matches, truncated: false }
      },
    },
    readCanvasElement: {
      description:
        'Read one current canvas element, including its complete code. This is read-only.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }: { id: string }) => {
        const element = shapes.find((candidate) => candidate.id === id)
        return element ?? { error: `No element with id ${id}` }
      },
    },
  }
}

export function createAgentBaseTools({
  userId,
  shapes,
  githubConnected,
  imageInputsEnabled,
}: {
  userId: string
  shapes: CanvasElement[]
  githubConnected: boolean
  imageInputsEnabled: boolean
}) {
  const imageToolOutput =
    (emptyMessage: string) =>
    ({ output }: { output: { image?: string; error?: string } }) => {
      if (!imageInputsEnabled) {
        return {
          type: 'text' as const,
          value: 'Canvas image viewing is temporarily disabled. Use the current canvas elements JSON.',
        }
      }
      if (typeof output?.error === 'string') {
        return { type: 'text' as const, value: output.error }
      }
      if (!output?.image) {
        return { type: 'text' as const, value: emptyMessage }
      }
      return {
        type: 'content' as const,
        value: [
          {
            type: 'file' as const,
            data: { type: 'data' as const, data: output.image.split(',')[1] },
            mediaType: 'image/png',
          },
        ],
      }
    }

  let repositoryToolCalls = 0
  let repositoryTextBytes = 0
  const repositoryContexts = new Map<string, GitHubRepositoryContext>()
  const resolveRepositoryContext = async (repository: string) => {
    const key = repository.trim().toLowerCase()
    const cached = repositoryContexts.get(key)
    if (cached) return cached
    const context = await getGitHubRepositoryContextByName(userId, repository)
    repositoryContexts.set(key, context)
    return context
  }
  const runRepositoryTool = async <T,>(operation: () => Promise<T>): Promise<T | { error: string; code?: string }> => {
    if (repositoryToolCalls >= 12) {
      return { error: 'Repository exploration limit reached for this turn.' }
    }
    repositoryToolCalls += 1
    try {
      const output = await operation()
      const record = output as Record<string, unknown>
      const textOutput = { ...record }
      if ('data' in textOutput) delete textOutput.data
      repositoryTextBytes += new TextEncoder().encode(JSON.stringify(textOutput)).length
      if (repositoryTextBytes > 1024 * 1024) {
        return { error: 'Repository text limit reached for this turn.' }
      }
      return output
    } catch (error) {
      if (error instanceof GitHubIntegrationError) {
        return { error: error.message, code: error.code }
      }
      return { error: 'The repository request failed.' }
    }
  }

  const baseTools = {
      // Canvas mutations execute on the client; repository reads execute here on the server.
      createElement: {
        description:
          'Add one element to the canvas. An element is a positioned box of code — a heading, an image, a card, a full page section, or an interactive React widget. Returns the created element id plus a render result: "ok", or "error: …" when the code failed to compile or crashed — fix the code with updateElement when that happens.',
        inputSchema: newElementSchema,
      },
      createElements: {
        description:
          'Add several elements in one call. Prefer this over repeated createElement when adding more than one element. Returns the created ids with per-element render results ("ok" or "error: …" — fix errors with updateElement).',
        inputSchema: z.object({ elements: z.array(newElementSchema).min(1).max(40) }),
      },
      updateElement: {
        description:
          'Update an existing element by id. When changing code, send the complete new code, not a diff — and only when you have the element\'s full current code (from this conversation or readElement). For small targeted code changes prefer editElement instead of resending everything. Returns a render result: "ok", or "error: …" you must fix.',
        inputSchema: z.object({
          id: z.string(),
          name: elementFields.name.optional(),
          x: elementFields.x.optional(),
          y: elementFields.y.optional(),
          w: elementFields.w.optional(),
          h: elementFields.h.optional(),
          r: elementFields.r.optional(),
          code: elementFields.code.optional(),
        }),
      },
      editElement: {
        description:
          'Edit an element\'s code in place with exact search/replace edits — the cheap way to make small, targeted changes without resending the whole code. Each edit replaces oldCode (an exact substring of the current code, unique unless replaceAll) with newCode. Edits apply in order and atomically: if any oldCode is missing or ambiguous, the whole call fails and nothing changes. Only use when you have the element\'s full current code (from this conversation or readElement) — never guess oldCode from a truncated preview. For rewrites or large changes use updateElement. The result echoes a few surrounding lines per applied edit so you can confirm placement, plus a render result: "ok", or "error: …" you must fix.',
        inputSchema: z.object({
          id: z.string(),
          edits: z
            .array(
              z.object({
                oldCode: z
                  .string()
                  .min(1)
                  .describe('exact substring of the current code; include surrounding lines to make it unique'),
                newCode: z.string().describe('replacement text; empty string deletes oldCode'),
                replaceAll: z
                  .boolean()
                  .optional()
                  .describe('replace every occurrence of oldCode instead of requiring a unique match'),
              }),
            )
            .min(1)
            .max(20),
        }),
      },
      searchCanvas: {
        description:
          'Search the code of every canvas element for a substring (case-insensitive). Returns matching lines with element id, name, and line number. Use to locate which element contains some text, class, or logic before reading or editing — cheaper than calling readElement on every element.',
        inputSchema: z.object({
          query: z.string().min(1).max(200),
        }),
      },
      reorderElements: {
        description:
          'Change the stacking (z) order of elements. Pass ids bottom-to-top: later ids render on top. Ids you omit keep their current relative order and stack ABOVE the listed ones. Returns the resulting full order.',
        inputSchema: z.object({
          orderedIds: z.array(z.string()).min(1).max(100),
        }),
      },
      groupElements: {
        description:
          'Group two or more elements so they select and move as one on the canvas. Assigns a fresh shared group; elements already in another group move to the new one.',
        inputSchema: z.object({ ids: z.array(z.string()).min(2).max(40) }),
      },
      ungroupElements: {
        description: 'Remove the given elements from their groups so they move independently again.',
        inputSchema: z.object({ ids: z.array(z.string()).min(1).max(40) }),
      },
      readElement: {
        description:
          'Read the full current code of one element. Call this before updateElement whenever you do not already have that element\'s complete code in this conversation — canvas listings truncate long code.',
        inputSchema: z.object({ id: z.string() }),
      },
      deleteElement: {
        description:
          'Remove an element from the canvas by id. The user is asked to confirm each deletion and may decline.',
        inputSchema: z.object({ id: z.string() }),
      },
      viewCanvas: {
        description: imageInputsEnabled
          ? 'Render the current canvas to an image and look at it. Call this after finishing edits for a design task to verify the result, then fix any problems you see.'
          : 'Canvas image viewing is temporarily unavailable. Use the current canvas elements JSON instead.',
        // Non-empty schema: some providers reject function declarations with zero properties.
        inputSchema: z.object({
          focus: z.string().optional().describe('what you are checking, e.g. "spacing of the header"'),
        }),
        toModelOutput: imageToolOutput('The canvas is empty.'),
      },
      viewElement: {
        description: imageInputsEnabled
          ? 'Render ONE element to an image at its native size and look at it — much sharper than viewCanvas for judging text, spacing, or detail inside a single element. Prefer this over viewCanvas when checking one element.'
          : 'Element image viewing is temporarily unavailable. Use readElement and the canvas JSON instead.',
        inputSchema: z.object({
          id: z.string(),
          focus: z.string().optional().describe('what you are checking, e.g. "button alignment"'),
        }),
        toModelOutput: imageToolOutput('The element produced no image.'),
      },
      readElementLogs: {
        description:
          "Read recent console output (console.error/console.warn) and uncaught runtime errors from an element's live frame, collected since its code last mounted. Use when an interactive element misbehaves, when the user reports broken behavior, or when a render error message lacks detail.",
        inputSchema: z.object({ id: z.string() }),
      },
      arrangeElements: {
        description:
          'Move or resize several existing elements in one call — geometry only, code untouched. Use this instead of repeated updateElement calls for layout work: aligning, distributing, restacking sections, closing gaps. Returns the new geometry per element; unknown ids are reported back.',
        inputSchema: z.object({
          changes: z
            .array(
              z.object({
                id: z.string(),
                x: elementFields.x.optional(),
                y: elementFields.y.optional(),
                w: elementFields.w.optional(),
                h: elementFields.h.optional(),
                r: elementFields.r.optional(),
              }),
            )
            .min(1)
            .max(40),
        }),
      },
      askQuestion: {
        description:
          'Ask the user a question when a request is ambiguous or a design decision is theirs to make. Provide 2-4 short options. When a sensible default exists, include "Decide for me" as the last option and pick the default yourself if chosen.',
        inputSchema: z.object({
          question: z.string(),
          options: z.array(z.string()).min(2).max(4),
        }),
      },
      ...(githubConnected
        ? {
            listGitHubRepositories: {
              description:
                'List the GitHub repositories this user has given Loora permission to read. Call this when the user asks what repositories are available or when you need to resolve an unclear repository name. Never invent repository names.',
              inputSchema: z.object({
                query: z.string().trim().max(100).optional(),
              }),
              execute: (input: { query?: string }) =>
                runRepositoryTool(async () => {
                  const repositories = await listGitHubRepositories(userId)
                  const query = input.query?.toLowerCase()
                  const matches = query
                    ? repositories.filter((repository) =>
                        repository.fullName.toLowerCase().includes(query),
                      )
                    : repositories
                  return {
                    repositories: matches.slice(0, 200).map((repository) => ({
                      fullName: repository.fullName,
                      private: repository.private,
                      archived: repository.archived,
                      defaultBranch: repository.defaultBranch,
                    })),
                    total: matches.length,
                    truncated: matches.length > 200,
                  }
                }),
            },
            listRepositoryTree: {
              description:
                'List an accessible GitHub repository tree at a commit pinned for this turn. Use this first to find relevant app, component, style, token, and asset files. Generated and vendor directories are hidden unless explicitly requested.',
              inputSchema: z.object({
                repository: z.string().trim().min(1).max(200).describe('owner/repository'),
                pathPrefix: z.string().max(500).optional(),
                depth: z.number().int().min(1).max(6).optional(),
                includeGenerated: z.boolean().optional(),
              }),
              execute: (input: { repository: string; pathPrefix?: string; depth?: number; includeGenerated?: boolean }) =>
                runRepositoryTool(async () =>
                  listRepositoryTree(await resolveRepositoryContext(input.repository), input),
                ),
            },
            searchRepositoryCode: {
              description:
                'Search code only inside one accessible GitHub repository. Use it to locate components, design tokens, CSS classes, copy, or framework entrypoints before reading exact files.',
              inputSchema: z.object({
                repository: z.string().trim().min(1).max(200).describe('owner/repository'),
                query: z.string().trim().min(1).max(200),
                pathPrefix: z.string().max(500).optional(),
                extension: z.string().max(16).optional(),
                limit: z.number().int().min(1).max(20).optional(),
              }),
              execute: (input: { repository: string; query: string; pathPrefix?: string; extension?: string; limit?: number }) =>
                runRepositoryTool(async () =>
                  searchRepositoryCode(await resolveRepositoryContext(input.repository), input),
                ),
            },
            readRepositoryFile: {
              description:
                'Read a bounded range from one UTF-8 text file in an accessible repository. Credential files are blocked and detected secrets are redacted. Read only files relevant to the user request.',
              inputSchema: z.object({
                repository: z.string().trim().min(1).max(200).describe('owner/repository'),
                path: z.string().min(1).max(500),
                startLine: z.number().int().min(1).optional(),
                endLine: z.number().int().min(1).optional(),
              }),
              execute: (input: { repository: string; path: string; startLine?: number; endLine?: number }) =>
                runRepositoryTool(async () =>
                  readRepositoryFile(await resolveRepositoryContext(input.repository), input),
                ),
            },
            ...(imageInputsEnabled
              ? {
                  viewRepositoryImage: {
                    description:
                      'View a PNG, JPEG, WebP, or GIF from an accessible repository. Use for logos, screenshots, mockups, and visual assets that materially inform the requested design.',
                    inputSchema: z.object({
                      repository: z.string().trim().min(1).max(200).describe('owner/repository'),
                      path: z.string().min(1).max(500),
                    }),
                    execute: (input: { repository: string; path: string }) =>
                      runRepositoryTool(async () =>
                        viewRepositoryImage(await resolveRepositoryContext(input.repository), input),
                      ),
                    toModelOutput: ({ output }: { output: { data?: string; mediaType?: string; error?: string } }) => {
                      if (output.error || !output.data || !output.mediaType) {
                        return {
                          type: 'text' as const,
                          value: output.error ?? 'The repository image could not be read.',
                        }
                      }
                      return {
                        type: 'content' as const,
                        value: [
                          {
                            type: 'file' as const,
                            data: { type: 'data' as const, data: output.data },
                            mediaType: output.mediaType,
                          },
                        ],
                      }
                    },
                  },
                }
              : {}),
          }
        : {}),
  }

  const workerTools: ToolSet = createReadOnlyCanvasTools(shapes ?? [])
  for (const name of repositoryToolNames) {
    const repositoryTool = (baseTools as ToolSet)[name]
    if (repositoryTool) workerTools[name] = repositoryTool
  }

  return { baseTools, workerTools }
}

export function createDelegateTasksTool({
  delegationUsed,
  run,
}: {
  delegationUsed: boolean
  run: (
    tasks: DelegatedTask[],
    abortSignal: AbortSignal | undefined,
  ) => AsyncGenerator<SubagentBatch>
}) {
  let used = delegationUsed

  return {
    description:
      'Delegate 2-3 independent, substantial research or implementation-drafting tasks to read-only sub-agents that run in parallel. Use at most once per user turn. Each task must be self-contained. Sub-agents cannot change the canvas; after they return, synthesize their results and make the requested canvas changes yourself.',
    inputSchema: z.object({
      tasks: z
        .array(z.object({
          name: z.string().trim().min(1).max(80),
          task: z.string().trim().min(1).max(2_000),
        }))
        .min(2)
        .max(3),
    }),
    execute: async function* (
      { tasks }: { tasks: DelegatedTask[] },
      { abortSignal }: { abortSignal?: AbortSignal },
    ) {
      if (used) {
        yield {
          workers: tasks.map((task, index) => ({
            id: `worker-${index + 1}`,
            ...task,
            status: 'failed' as const,
            error: 'Only one parallel delegation is allowed per user turn.',
          })),
        }
        return
      }
      used = true
      yield* run(tasks, abortSignal)
    },
    toModelOutput: ({ output }: { output: unknown }) => ({
      type: 'text' as const,
      value: boundedJson(output, 80_000),
    }),
  }
}
