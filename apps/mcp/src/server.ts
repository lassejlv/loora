// Tool surface of the Loora MCP server, bound to one user id. Elements are
// boxes of HTML or JSX code (see @loora/db/canvas). Element writes use
// revision-checked retries so concurrent changes on the same target are
// reconciled instead of silently replacing a stale shape array.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CanvasElement } from '@loora/db/canvas'
import {
  MAX_CODE_LENGTH,
  MAX_NAME_LENGTH,
  applyDraft,
  closeDraft,
  compareDraft,
  createDraft,
  createDesign,
  deleteDesign,
  getDesign,
  listAssets,
  listDrafts,
  listDesigns,
  listVersions,
  mutateShapes,
  newElementId,
  renameDesign,
  reopenDraft,
  proposeDraft,
  searchElements,
  summarizeElement,
} from './designs'

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

const designId = z.string().min(1).max(128).describe('Design id')
const draftId = z.string().min(1).max(128).describe('Draft id')
const elementCode = z
  .string()
  .max(MAX_CODE_LENGTH)
  .describe(
    'Element code: plain HTML/CSS/JS, or JSX/TSX defining `function App`. Rendered in an iframe with React and Tailwind available. No import/export statements.',
  )

export function createLooraServer(userId: string) {
  const server = new McpServer({ name: 'loora', version: '0.1.0' })

  // Every handler goes through this so a thrown Error becomes a tool error
  // the client can read instead of a crashed request.
  function tool<Args>(run: (args: Args) => Promise<unknown>) {
    return async (args: Args) => {
      try {
        return json(await run(args))
      } catch (error) {
        return fail(error)
      }
    }
  }

  server.registerTool(
    'list_designs',
    { description: 'List the designs (canvas documents) of the signed-in Loora user.' },
    tool(async (_args: unknown) => listDesigns(userId)),
  )

  server.registerTool(
    'get_design',
    {
      description:
        'Read one design. Returns element summaries (geometry, code length, first code line) by default; set includeCode to get full element code.',
      inputSchema: {
        id: designId,
        draftId: draftId.optional().describe('Draft target; omit for Main'),
        includeCode: z.boolean().default(false).describe('Include full code of every element'),
      },
    },
    tool(async ({ id, draftId, includeCode }: { id: string; draftId?: string; includeCode: boolean }) => {
      const found = await getDesign(userId, id, draftId)
      return {
        id: found.id,
        name: found.name,
        draftId: found.draftId,
        draftName: found.draftName,
        status: found.status,
        revision: found.revision,
        updatedAt: found.updatedAt.toISOString(),
        elements: includeCode ? found.shapes : found.shapes.map(summarizeElement),
      }
    }),
  )

  server.registerTool(
    'create_design',
    {
      description: 'Create a new empty design.',
      inputSchema: { name: z.string().trim().min(1).max(MAX_NAME_LENGTH) },
    },
    tool(async ({ name }: { name: string }) => createDesign(userId, name)),
  )

  server.registerTool(
    'list_drafts',
    {
      description: 'List active, proposed, applied, and closed drafts for a design.',
      inputSchema: { designId },
    },
    tool(async ({ designId }: { designId: string }) => listDrafts(userId, designId)),
  )

  server.registerTool(
    'create_draft',
    {
      description: 'Create an isolated draft from the current Main canvas.',
      inputSchema: {
        designId,
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
      },
    },
    tool(async ({ designId, name }: { designId: string; name: string }) =>
      createDraft(userId, designId, name),
    ),
  )

  server.registerTool(
    'propose_draft',
    {
      description: 'Freeze an active draft as a change proposal for review.',
      inputSchema: {
        designId,
        draftId,
        description: z.string().trim().max(2_000).default(''),
      },
    },
    tool(
      async (args: { designId: string; draftId: string; description: string }) =>
        proposeDraft(userId, args.designId, args.draftId, args.description),
    ),
  )

  server.registerTool(
    'reopen_draft',
    {
      description: 'Return a proposed draft to editable active status.',
      inputSchema: { designId, draftId },
    },
    tool(async (args: { designId: string; draftId: string }) =>
      reopenDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'compare_draft',
    {
      description:
        'Compare a draft with current Main. Returns revisions, change counts, and merge conflicts.',
      inputSchema: { designId, draftId },
    },
    tool(async (args: { designId: string; draftId: string }) =>
      compareDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'apply_draft',
    {
      description:
        'Apply a reviewed draft to Main atomically. Every reported conflict needs a main or draft resolution.',
      inputSchema: {
        designId,
        draftId,
        expectedMainRevision: z.number().int().nonnegative(),
        expectedDraftRevision: z.number().int().nonnegative(),
        resolutions: z.record(z.string(), z.enum(['main', 'draft'])).default({}),
      },
    },
    tool(
      async (args: {
        designId: string
        draftId: string
        expectedMainRevision: number
        expectedDraftRevision: number
        resolutions: Record<string, 'main' | 'draft'>
      }) =>
        applyDraft(
          userId,
          args.designId,
          args.draftId,
          args.expectedMainRevision,
          args.expectedDraftRevision,
          args.resolutions,
        ),
    ),
  )

  server.registerTool(
    'close_draft',
    {
      description: 'Close an active or proposed draft without applying it.',
      inputSchema: { designId, draftId },
    },
    tool(async (args: { designId: string; draftId: string }) =>
      closeDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'rename_design',
    {
      description: 'Rename a design.',
      inputSchema: { id: designId, name: z.string().trim().min(1).max(MAX_NAME_LENGTH) },
    },
    tool(async ({ id, name }: { id: string; name: string }) => renameDesign(userId, id, name)),
  )

  server.registerTool(
    'delete_design',
    {
      description: 'Permanently delete a design and its version history. Cannot be undone.',
      inputSchema: { id: designId },
    },
    tool(async ({ id }: { id: string }) => ({ deleted: await deleteDesign(userId, id) })),
  )

  server.registerTool(
    'read_element',
    {
      description: 'Read one canvas element including its full code.',
      inputSchema: {
        designId,
        draftId: draftId.optional().describe('Draft target; omit for Main'),
        elementId: z.string().min(1).max(128),
      },
    },
    tool(async (args: { designId: string; draftId?: string; elementId: string }) => {
      const found = await getDesign(userId, args.designId, args.draftId)
      const element = found.shapes.find((shape) => shape.id === args.elementId)
      if (!element) {
        throw new Error(`Element "${args.elementId}" not found in design "${args.designId}"`)
      }
      return element
    }),
  )

  server.registerTool(
    'create_element',
    {
      description:
        'Add a code element to a design canvas. x/y are canvas coordinates, w/h the box size in pixels.',
      inputSchema: {
        designId,
        draftId: draftId.optional().describe('Draft target; omit for Main'),
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
        code: elementCode,
      },
    },
    tool(
      async (args: {
        designId: string
        draftId?: string
        name: string
        x: number
        y: number
        w: number
        h: number
        code: string
      }) => {
        const element: CanvasElement = {
          id: newElementId(),
          name: args.name,
          x: args.x,
          y: args.y,
          w: args.w,
          h: args.h,
          code: args.code,
        }
        const result = await mutateShapes(
          userId,
          args.designId,
          args.draftId,
          (shapes) => [...shapes, element],
        )
        return {
          created: element.id,
          target: { designId: args.designId, draftId: args.draftId ?? null },
          revision: result.revision,
        }
      },
    ),
  )

  server.registerTool(
    'update_element',
    {
      description:
        'Update fields of an existing element. Only the provided fields change; omitted ones keep their value.',
      inputSchema: {
        designId,
        draftId: draftId.optional().describe('Draft target; omit for Main'),
        elementId: z.string().min(1).max(128),
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().positive().optional(),
        h: z.number().positive().optional(),
        code: elementCode.optional(),
      },
    },
    tool(
      async (args: {
        designId: string
        draftId?: string
        elementId: string
        name?: string
        x?: number
        y?: number
        w?: number
        h?: number
        code?: string
      }) => {
        const {
          designId: _designId,
          draftId: _draftId,
          elementId: _elementId,
          ...patch
        } = args
        const result = await mutateShapes(userId, args.designId, args.draftId, (shapes) => {
          const index = shapes.findIndex((shape) => shape.id === args.elementId)
          if (index === -1) {
            throw new Error(`Element "${args.elementId}" not found in design "${args.designId}"`)
          }
          const next = [...shapes]
          next[index] = {
            ...next[index],
            ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
          }
          return next
        })
        return {
          updated: args.elementId,
          target: { designId: args.designId, draftId: args.draftId ?? null },
          revision: result.revision,
        }
      },
    ),
  )

  server.registerTool(
    'delete_element',
    {
      description: 'Remove an element from a design canvas.',
      inputSchema: {
        designId,
        draftId: draftId.optional().describe('Draft target; omit for Main'),
        elementId: z.string().min(1).max(128),
      },
    },
    tool(async (args: { designId: string; draftId?: string; elementId: string }) => {
      const result = await mutateShapes(userId, args.designId, args.draftId, (shapes) => {
        const next = shapes.filter((shape) => shape.id !== args.elementId)
        if (next.length === shapes.length) {
          throw new Error(`Element "${args.elementId}" not found in design "${args.designId}"`)
        }
        return next
      })
      return {
        deleted: args.elementId,
        target: { designId: args.designId, draftId: args.draftId ?? null },
        revision: result.revision,
      }
    }),
  )

  server.registerTool(
    'search_design',
    {
      description:
        'Search element code in a design (case-insensitive substring, up to 50 matching lines).',
      inputSchema: {
        designId,
        draftId: draftId.optional().describe('Draft target; omit for Main'),
        query: z.string().min(1).max(200),
      },
    },
    tool(async (args: { designId: string; draftId?: string; query: string }) => {
      const found = await getDesign(userId, args.designId, args.draftId)
      return searchElements(found.shapes, args.query)
    }),
  )

  server.registerTool(
    'list_versions',
    {
      description: 'List version history commits of a design (newest first).',
      inputSchema: {
        designId,
        draftId: draftId.optional().describe('Draft target; omit for Main'),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    tool(async (args: { designId: string; draftId?: string; limit: number }) =>
      listVersions(userId, args.designId, args.limit, args.draftId),
    ),
  )

  server.registerTool(
    'list_assets',
    { description: 'List the uploaded image assets of the signed-in Loora user.' },
    tool(async (_args: unknown) => listAssets(userId)),
  )

  return server
}
