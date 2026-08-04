/**
 * The bridge between the AI SDK and Loora's canvas vocabulary.
 *
 * Nothing new is implemented here. Every tool goes through the same executor
 * the remote MCP transport uses, so the in-app agent, an external MCP client
 * and a handoff consumer all take the identical path: CanvasEngine validation,
 * compare-and-swap persistence, Polar usage, realtime invalidation, and the
 * agent-activity ring on the canvas.
 *
 * Two things are deliberately different from MCP:
 *
 * - The target is injected, never accepted. The model cannot name a design; it
 *   gets exactly the document the person has open.
 * - Deleting pauses for approval, which is the canvas invariant about
 *   destructive agent actions written as a tool option.
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
  animateNodesInputSchema,
  createComponentInputSchema,
  createInstanceInputSchema,
  createPageInputSchema,
  deleteNodesInputSchema,
  insertNodesInputSchema,
  moveNodesInputSchema,
  nodeRefSchema,
  patchNodesInputSchema,
  readNodeInputSchema,
  readTreeInputSchema,
  searchNodesInputSchema,
  setAnimationsInputSchema,
  setTokensInputSchema,
  viewCanvasInputSchema,
  viewNodeInputSchema,
  viewPageInputSchema,
} from '@loora/agent/canvas-tools'
import type { AssistantTarget, AssistantToolName } from './protocol'

/** What `createLooraToolExecutor` hands back: an MCP tool result. */
export type AssistantToolExecutor = (
  name: string,
  args: unknown,
) => Promise<unknown>

interface McpContentPart {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

interface McpToolResult {
  content?: McpContentPart[]
  isError?: boolean
}

interface UnwrappedResult {
  value: unknown
  image?: string
  isError: boolean
}

/**
 * MCP answers in content parts; a model wants a value. The text part is JSON
 * from `json()` on the server, so it is parsed back rather than handed over as
 * a string the model would have to parse itself.
 */
export function unwrapToolResult(result: unknown): UnwrappedResult {
  const shaped = (result ?? {}) as McpToolResult
  const parts = Array.isArray(shaped.content) ? shaped.content : []
  const text = parts.find((part) => part.type === 'text')?.text
  const image = parts.find((part) => part.type === 'image')?.data
  let value: unknown = text ?? null
  if (typeof text === 'string') {
    try {
      value = JSON.parse(text)
    } catch {
      value = text
    }
  }
  return { value, image, isError: shaped.isError === true }
}

export interface AssistantToolsOptions {
  execute: AssistantToolExecutor
  /** The open document. Injected into every call; never model-supplied. */
  target: AssistantTarget
  /**
   * Whether this model accepts images. When false, getScreenshot still runs —
   * it just reports its dimensions rather than handing over pixels.
   */
  imageInputs?: boolean
  /** Fires as each call starts, for hosts that mirror activity elsewhere. */
  onCall?: (name: AssistantToolName, input: unknown) => void
}

function withTarget(input: unknown, target: AssistantTarget) {
  const base =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    ...base,
    designId: target.designId,
    ...(target.draftId ? { draftId: target.draftId } : {}),
  }
}

/**
 * A failed tool comes back as data, not as a thrown error: the model can read
 * “that node is locked”, pick a different node and carry on, where a throw
 * would end the step and leave the person with nothing.
 */
function toolOutput(name: AssistantToolName, unwrapped: UnwrappedResult) {
  if (!unwrapped.isError) return unwrapped.value
  return {
    failed: name,
    ...(unwrapped.value && typeof unwrapped.value === 'object'
      ? (unwrapped.value as Record<string, unknown>)
      : { error: String(unwrapped.value) }),
  }
}

interface CanvasToolExtras {
  /** Merged onto the arguments after the target, before the executor sees them. */
  augment?: Record<string, unknown>
  needsApproval?: boolean
}

function canvasTool<Schema extends z.ZodType>(
  name: AssistantToolName,
  description: string,
  inputSchema: Schema,
  options: AssistantToolsOptions,
  extras: CanvasToolExtras = {},
) {
  const { augment, ...toolOptions } = extras
  return tool({
    description,
    inputSchema,
    ...toolOptions,
    execute: async (input: z.infer<Schema>) => {
      options.onCall?.(name, input)
      const unwrapped = unwrapToolResult(
        await options.execute(name, {
          ...withTarget(input, options.target),
          ...augment,
        }),
      )
      return toolOutput(name, unwrapped)
    },
  })
}

interface ScreenshotResult extends Record<string, unknown> {
  /** Base64 PNG, or null when the render produced nothing usable. */
  image: string | null
}

const screenshotInputSchema = z.object({
  pageId: z.string().min(1).max(128).optional(),
  ref: nodeRefSchema.optional(),
  width: z.number().finite().min(200).max(3_840).default(1_440),
  pixelRatio: z.number().finite().min(1).max(2).default(1),
})

/**
 * The tool set for one run against one document. Descriptions are kept in step
 * with `packages/rpc/src/mcp-server.ts` on purpose — a tool that means one
 * thing to an external agent and another to this one is a bug waiting.
 */
export function createAssistantTools(options: AssistantToolsOptions): ToolSet {
  const imageInputs = options.imageInputs !== false

  const screenshot = tool({
    description:
      'Render a real PNG of one Page or node with the same engine the export uses. Call this after meaningful edits to check the visual result.',
    inputSchema: screenshotInputSchema,
    execute: async (
      input: z.infer<typeof screenshotInputSchema>,
    ): Promise<ScreenshotResult> => {
      options.onCall?.('getScreenshot', input)
      const unwrapped = unwrapToolResult(
        await options.execute('getScreenshot', withTarget(input, options.target)),
      )
      const detail =
        unwrapped.value && typeof unwrapped.value === 'object'
          ? (unwrapped.value as Record<string, unknown>)
          : { detail: unwrapped.value }
      if (unwrapped.isError) {
        return { ...detail, failed: 'getScreenshot', image: null }
      }
      return { ...detail, image: unwrapped.image ?? null }
    },
    // The pixels ride in the tool result as a file part; the metadata around
    // them stays text so the model can read the revision it just looked at.
    toModelOutput: ({ output }) => {
      const { image, ...rest } = output
      if (!imageInputs || !image) {
        return {
          type: 'text' as const,
          value: JSON.stringify(
            image === null && !rest.failed
              ? { ...rest, note: 'Image pixels are unavailable to this model.' }
              : rest,
          ),
        }
      }
      return {
        type: 'content' as const,
        value: [
          { type: 'text' as const, text: JSON.stringify(rest) },
          {
            type: 'file' as const,
            data: { type: 'data' as const, data: image },
            mediaType: 'image/png',
          },
        ],
      }
    },
  })

  return {
    getDesignContext: canvasTool(
      'getDesignContext',
      'Start here. Read the target, revision, responsive settings, tokens, Pages, components and a compact tree in one call, before editing anything.',
      z.object({
        depth: z.number().int().min(1).max(10).default(4),
      }),
      options,
    ),
    readTree: canvasTool(
      'readTree',
      'Read a compact semantic Canvas tree. Use NodeRefs from this result for precise edits.',
      readTreeInputSchema,
      options,
    ),
    readNode: canvasTool(
      'readNode',
      'Read one complete structured source node and an optional instance override.',
      readNodeInputSchema,
      options,
    ),
    searchNodes: canvasTool(
      'searchNodes',
      'Search node names and text content in this design.',
      searchNodesInputSchema,
      options,
    ),
    listAssets: canvasTool(
      'listAssets',
      'List the signed-in person’s uploaded image assets, so an image node can point at one that already exists.',
      z.object({}),
      options,
    ),
    createPage: canvasTool(
      'createPage',
      'Create an editable responsive Page with typed local state and nested structured nodes in one engine transaction. Model normal Tailwind layouts with flex/grid, gap, padding, fill and hug; use absolute positioning only intentionally.',
      createPageInputSchema,
      options,
    ),
    insertNodes: canvasTool(
      'insertNodes',
      'Insert nested structured nodes into a Page, frame, group or component. Temporary refs come back as permanent ids. Never send HTML, JSX, CSS, classes or source code.',
      insertNodesInputSchema,
      options,
    ),
    patchNodes: canvasTool(
      'patchNodes',
      'Patch structured layout, visual, text, responsive, variant, typed state and declarative event interaction fields atomically. NodeRefs can address descendants inside component instances.',
      patchNodesInputSchema,
      options,
    ),
    moveNodes: canvasTool(
      'moveNodes',
      'Move or reorder source nodes atomically. parentId is a source container id; omit order to append.',
      moveNodesInputSchema,
      options,
    ),
    deleteNodes: canvasTool(
      'deleteNodes',
      'Delete source nodes and their descendants. Destructive: the person confirms this before it runs, so say plainly what you are about to remove.',
      deleteNodesInputSchema,
      options,
      // Two locks on one door: the run pauses for the person's approval, and
      // the executor independently refuses a delete without `confirmed`.
      { needsApproval: true, augment: { confirmed: true } },
    ),
    createComponent: canvasTool(
      'createComponent',
      'Create an off-canvas reusable component definition with optional instance-local typed state and declarative event interactions.',
      createComponentInputSchema,
      options,
    ),
    createInstance: canvasTool(
      'createInstance',
      'Place an instance of an existing component into a container.',
      createInstanceInputSchema,
      options,
    ),
    setTokens: canvasTool(
      'setTokens',
      'Create or update named visual themes and structured design tokens, and set the persisted default theme. Put per-theme values in modes keyed by theme id.',
      setTokensInputSchema,
      options,
    ),
    setAnimations: canvasTool(
      'setAnimations',
      'Define named motion the design can reuse: preset names (fade-in, fade-in-up, scale-in, slide-in-left, slide-in-right, pulse, float, spin) or full keyframes. Point nodes at them with animateNodes.',
      setAnimationsInputSchema,
      options,
    ),
    animateNodes: canvasTool(
      'animateNodes',
      'Give nodes motion. `hover` takes a preset (lift, grow, shrink, fade, nudge-right) or an explicit style and transform and brings its own transition; `play` attaches animations from setAnimations with a load, in-view, always, hover or press trigger; `stagger` spaces a list out. Pass clear: true to take motion off.',
      animateNodesInputSchema,
      options,
    ),
    viewNode: canvasTool(
      'viewNode',
      'Return an open-in-Loora URL and semantic details for one node. Use getScreenshot when pixels are needed.',
      viewNodeInputSchema,
      options,
    ),
    viewPage: canvasTool(
      'viewPage',
      'Return an open-in-Loora URL and semantic tree for one Page. Use getScreenshot when pixels are needed.',
      viewPageInputSchema,
      options,
    ),
    viewCanvas: canvasTool(
      'viewCanvas',
      'Return an open-in-Loora URL and a summary of the Pages on this canvas.',
      viewCanvasInputSchema,
      options,
    ),
    getScreenshot: screenshot,
  }
}
