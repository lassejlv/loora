// Tool surface of the Loora MCP server, bound to one user id. Elements are
// boxes of HTML or JSX code (see @loora/db/canvas). Beware concurrent web
// sessions: the app's debounced design.save writes whole shape arrays, so
// edits made here while the design is open in a browser can be overwritten.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CanvasElement } from '@loora/db/canvas'
import {
  MAX_CODE_LENGTH,
  MAX_NAME_LENGTH,
  createDesign,
  deleteDesign,
  getDesign,
  listAssets,
  listDesigns,
  listVersions,
  newElementId,
  renameDesign,
  saveShapes,
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
        includeCode: z.boolean().default(false).describe('Include full code of every element'),
      },
    },
    tool(async ({ id, includeCode }: { id: string; includeCode: boolean }) => {
      const found = await getDesign(userId, id)
      return {
        id: found.id,
        name: found.name,
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
      inputSchema: { designId, elementId: z.string().min(1).max(128) },
    },
    tool(async (args: { designId: string; elementId: string }) => {
      const found = await getDesign(userId, args.designId)
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
        name: string
        x: number
        y: number
        w: number
        h: number
        code: string
      }) => {
        const found = await getDesign(userId, args.designId)
        const element: CanvasElement = {
          id: newElementId(),
          name: args.name,
          x: args.x,
          y: args.y,
          w: args.w,
          h: args.h,
          code: args.code,
        }
        await saveShapes(userId, args.designId, [...found.shapes, element])
        return { created: element.id }
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
        elementId: string
        name?: string
        x?: number
        y?: number
        w?: number
        h?: number
        code?: string
      }) => {
        const found = await getDesign(userId, args.designId)
        const index = found.shapes.findIndex((shape) => shape.id === args.elementId)
        if (index === -1) {
          throw new Error(`Element "${args.elementId}" not found in design "${args.designId}"`)
        }
        const { designId: _designId, elementId: _elementId, ...patch } = args
        const next = [...found.shapes]
        next[index] = {
          ...next[index],
          ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
        }
        await saveShapes(userId, args.designId, next)
        return { updated: args.elementId }
      },
    ),
  )

  server.registerTool(
    'delete_element',
    {
      description: 'Remove an element from a design canvas.',
      inputSchema: { designId, elementId: z.string().min(1).max(128) },
    },
    tool(async (args: { designId: string; elementId: string }) => {
      const found = await getDesign(userId, args.designId)
      const next = found.shapes.filter((shape) => shape.id !== args.elementId)
      if (next.length === found.shapes.length) {
        throw new Error(`Element "${args.elementId}" not found in design "${args.designId}"`)
      }
      await saveShapes(userId, args.designId, next)
      return { deleted: args.elementId }
    }),
  )

  server.registerTool(
    'search_design',
    {
      description:
        'Search element code in a design (case-insensitive substring, up to 50 matching lines).',
      inputSchema: { designId, query: z.string().min(1).max(200) },
    },
    tool(async (args: { designId: string; query: string }) => {
      const found = await getDesign(userId, args.designId)
      return searchElements(found.shapes, args.query)
    }),
  )

  server.registerTool(
    'list_versions',
    {
      description: 'List version history commits of a design (newest first).',
      inputSchema: { designId, limit: z.number().int().min(1).max(50).default(20) },
    },
    tool(async (args: { designId: string; limit: number }) =>
      listVersions(userId, args.designId, args.limit),
    ),
  )

  server.registerTool(
    'list_assets',
    { description: 'List the uploaded image assets of the signed-in Loora user.' },
    tool(async (_args: unknown) => listAssets(userId)),
  )

  return server
}
