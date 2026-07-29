import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  compileJsxComponent,
  compileStandaloneHtml,
  compileTailwindComponent,
} from '@loora/canvas/export'
import {
  canvasId,
  createInstanceNode,
  defaultLayout,
  defaultStyle,
  orderedChildren,
  type CanvasDocument,
  type CanvasNode,
  type NodeRef,
} from '@loora/canvas/model'
import {
  createComponentInputSchema,
  createComponentTransaction,
  createInstanceInputSchema,
  createPageInputSchema,
  createPageTransaction,
  deleteNodesInputSchema,
  insertDescriptorOperations,
  insertNodesInputSchema,
  moveNodesInputSchema,
  normalizeDeletionNodeIds,
  patchNodesInputSchema,
  patchOperationsForChanges,
  readCanvasNodeRef,
  readNodeInputSchema,
  readTreeInputSchema,
  searchCanvasNodes,
  searchNodesInputSchema,
  semanticTree,
  setTokensInputSchema,
  sourceContainerForRef,
  tokenOperations,
  viewCanvasInputSchema,
  viewNodeInputSchema,
  viewPageInputSchema,
} from '@loora/agent/canvas-tools'
import {
  MAX_NAME_LENGTH,
  CanvasUnavailableError,
  applyCanvasTransactions,
  applyDraft,
  closeDraft,
  compareDraft,
  createDesign,
  createDraft,
  deleteDesign,
  getCanvasTarget,
  listAssets,
  listDesigns,
  listDrafts,
  listVersions,
  renameDesign,
  reopenDraft,
  proposeDraft,
} from './designs'
import { renderCanvasScreenshot } from './screenshot'

function json(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  }
}

function fail(error: unknown) {
  if (error instanceof CanvasUnavailableError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: error.message,
              code: error.code,
              designId: error.designId,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  }
}

const designId = z.string().min(1).max(128).describe('Design id')
const draftId = z.string().min(1).max(128).describe('Branch id')
const targetShape = {
  designId,
  draftId: draftId.optional().describe('Branch target; omit for Main'),
}

export function appUrl(
  design: string,
  branch?: string,
  extra: Record<string, string | undefined> = {},
) {
  const origin = (process.env.LOORA_APP_URL?.trim() || 'https://loora.design').replace(/\/+$/, '')
  const path = branch
    ? `/design/${encodeURIComponent(design)}/b/${encodeURIComponent(branch)}`
    : `/design/${encodeURIComponent(design)}`
  const url = new URL(path, `${origin}/`)
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

export function exportCanvasCode(
  document: CanvasDocument,
  input: {
    format: 'tailwind' | 'html' | 'jsx'
    pageId?: string
    ref?: NodeRef
    width: number
  },
) {
  if (input.pageId && input.ref) {
    throw new Error('Choose either pageId or ref, not both')
  }
  if (input.ref) readCanvasNodeRef(document, input.ref, input.width)
  const defaultPage = orderedChildren(document, null).find(
    (node) => node.type === 'page' && !node.hidden,
  )
  const pageId =
    input.ref
      ? undefined
      : input.pageId ??
        (defaultPage?.type === 'page' ? defaultPage.id : undefined)
  if (!input.ref && !pageId) {
    throw new Error('The Canvas has no visible Page to export')
  }
  const nodeId = input.ref
    ? input.ref.instancePath[0] ?? input.ref.nodeId
    : undefined
  const options = { pageId, nodeId, width: input.width }
  const code =
    input.format === 'tailwind'
      ? compileTailwindComponent(document, options)
      : input.format === 'jsx'
        ? compileJsxComponent(document, options)
        : compileStandaloneHtml(document, options)
  return { code, pageId, nodeId }
}

export function createLooraServer(userId: string) {
  const server = new McpServer({ name: 'loora', version: '0.3.0' })

  function tool<Args>(run: (args: Args) => Promise<unknown>) {
    return async (args: Args) => {
      try {
        return json(await run(args))
      } catch (error) {
        return fail(error)
      }
    }
  }

  function pngTool<Args>(
    run: (args: Args) => Promise<{
      png: Uint8Array
      metadata: unknown
    }>,
  ) {
    return async (args: Args) => {
      try {
        const result = await run(args)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result.metadata, null, 2),
            },
            {
              type: 'image' as const,
              data: Buffer.from(result.png).toString('base64'),
              mimeType: 'image/png',
            },
          ],
        }
      } catch (error) {
        return fail(error)
      }
    }
  }

  server.registerTool(
    'listDesigns',
    {
      description:
        'Start here. List the signed-in user’s structured Loora designs and canonical editor URLs.',
      annotations: { readOnlyHint: true },
    },
    tool(async (_args: unknown) =>
      (await listDesigns(userId)).map((design) => ({
        ...design,
        openUrl: appUrl(design.id),
      })),
    ),
  )

  server.registerTool(
    'getDesignContext',
    {
      description:
        'Read the target, revision, responsive settings, tokens, Pages, components, and a compact tree in one call. Use this before editing.',
      inputSchema: {
        ...targetShape,
        depth: z.number().int().min(1).max(10).default(4),
      },
      annotations: { readOnlyHint: true },
    },
    tool(
      async (args: {
        designId: string
        draftId?: string
        depth: number
      }) => {
        const found = await getCanvasTarget(userId, args)
        const roots = orderedChildren(found.document, null)
        return {
          target: {
            designId: args.designId,
            designName: found.name,
            draftId: found.draftId,
            draftName: found.draftName,
            status: found.status,
          },
          revision: found.revision,
          updatedAt: found.updatedAt.toISOString(),
          openUrl: appUrl(args.designId, args.draftId),
          breakpoints: found.document.breakpoints,
          activeThemeId: found.document.activeThemeId,
          themes: Object.values(found.document.themes),
          tokens: Object.values(found.document.tokens),
          pages: roots
            .filter((node) => node.type === 'page')
            .map((page) => ({
              id: page.id,
              name: page.name,
              hidden: page.hidden,
              x: page.layout.x,
              y: page.layout.y,
              width:
                page.layout.width.unit === 'px'
                  ? page.layout.width.value
                  : page.viewport.width,
              minHeight: page.viewport.minHeight,
              states: page.states ?? {},
            })),
          components: roots
            .filter((node) => node.type === 'component')
            .map((component) => ({
              id: component.id,
              name: component.name,
              variants: component.variants,
              defaultVariant: component.defaultVariant,
              states: component.states ?? {},
            })),
          tree: semanticTree(found.document, null, args.depth),
        }
      },
    ),
  )

  server.registerTool(
    'readTree',
    {
      description:
        'Read a compact semantic Canvas tree. Use NodeRefs from this result for precise edits.',
      inputSchema: {
        ...targetShape,
        root: readTreeInputSchema.shape.root,
        depth: readTreeInputSchema.shape.depth,
      },
      annotations: { readOnlyHint: true },
    },
    tool(
      async (args: {
        designId: string
        draftId?: string
        root?: { nodeId: string; instancePath: string[] }
        depth: number
      }) => {
        const found = await getCanvasTarget(userId, args)
        return {
          target: { designId: args.designId, draftId: args.draftId ?? null },
          revision: found.revision,
          tree: semanticTree(
            found.document,
            args.root ?? null,
            args.depth,
          ),
        }
      },
    ),
  )

  server.registerTool(
    'readNode',
    {
      description: 'Read one complete structured source node and an optional instance override.',
      inputSchema: { ...targetShape, ref: readNodeInputSchema.shape.ref },
      annotations: { readOnlyHint: true },
    },
    tool(
      async (args: {
        designId: string
        draftId?: string
        ref: { nodeId: string; instancePath: string[] }
      }) => {
        const found = await getCanvasTarget(userId, args)
        return {
          ...readCanvasNodeRef(found.document, args.ref),
          revision: found.revision,
        }
      },
    ),
  )

  server.registerTool(
    'searchNodes',
    {
      description: 'Search node names and text content in a structured design.',
      inputSchema: {
        ...targetShape,
        query: searchNodesInputSchema.shape.query,
        types: searchNodesInputSchema.shape.types,
      },
      annotations: { readOnlyHint: true },
    },
    tool(
      async (args: {
        designId: string
        draftId?: string
        query: string
        types?: Array<CanvasNode['type']>
      }) => {
        const found = await getCanvasTarget(userId, args)
        return {
          matches: searchCanvasNodes(found.document, args.query, args.types),
          revision: found.revision,
        }
      },
    ),
  )

  server.registerTool(
    'createPage',
    {
      description:
        'Create an editable responsive Page with typed local state and nested structured nodes in one engine transaction. Event interactions can set, toggle, or increment state and react through conditional state-change rules. Model normal Tailwind layouts with flex/grid, gap, padding, fill, and hug; use absolute positioning only intentionally.',
      inputSchema: { ...targetShape, ...createPageInputSchema.shape },
    },
    tool(
      async (args: z.infer<typeof createPageInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        const created = createPageTransaction(found.document, args)
        const result = await applyCanvasTransactions(userId, args, [
          created.transaction,
        ])
        return {
          pageId: created.pageId,
          refs: created.refs,
          revision: result.revision,
          changedNodeIds: result.changedNodeIds,
        }
      },
    ),
  )

  server.registerTool(
    'insertNodes',
    {
      description:
        'Insert nested structured nodes through the Canvas engine. Think in Tailwind layout terms, then express them as validated layout/style fields. Temporary refs are mapped to permanent ids; source code is export-only.',
      inputSchema: { ...targetShape, ...insertNodesInputSchema.shape },
    },
    tool(
      async (args: z.infer<typeof insertNodesInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        const parent = sourceContainerForRef(found.document, args.parent)
        const built = insertDescriptorOperations(
          found.document,
          parent.id,
          args.nodes,
        )
        const result = await applyCanvasTransactions(userId, args, [
          {
            id: canvasId('tx'),
            label: 'MCP inserted nodes',
            operations: built.operations,
          },
        ])
        return {
          refs: built.refs,
          nodeIds: built.nodeIds,
          revision: result.revision,
          changedNodeIds: result.changedNodeIds,
        }
      },
    ),
  )

  server.registerTool(
    'patchNodes',
    {
      description:
        'Patch structured layout, visual, text, responsive, variant, typed Page/component state, and declarative event interaction fields atomically through the Canvas engine. Runtime state stays ephemeral and never replaces the Canvas document.',
      inputSchema: { ...targetShape, ...patchNodesInputSchema.shape },
    },
    tool(
      async (args: z.infer<typeof patchNodesInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        const result = await applyCanvasTransactions(userId, args, [
          {
            id: canvasId('tx'),
            label: 'MCP updated nodes',
            operations: patchOperationsForChanges(
              found.document,
              args.changes,
            ),
          },
        ])
        return {
          revision: result.revision,
          changedNodeIds: result.changedNodeIds,
        }
      },
    ),
  )

  server.registerTool(
    'moveNodes',
    {
      description: 'Move or reorder source nodes atomically.',
      inputSchema: { ...targetShape, ...moveNodesInputSchema.shape },
    },
    tool(
      async (args: z.infer<typeof moveNodesInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        const offsets = new Map<string, number>()
        const operations = args.changes.map((change) => {
          const node = found.document.nodes[change.nodeId]
          if (!node) throw new Error(`Node "${change.nodeId}" not found`)
          if (node.locked) throw new Error(`Node "${node.name}" is locked`)
          const key = change.parentId ?? '$root'
          const offset = offsets.get(key) ?? 0
          offsets.set(key, offset + 1)
          return {
            type: 'node.move' as const,
            id: change.nodeId,
            parentId: change.parentId,
            order:
              change.order ??
              (orderedChildren(found.document, change.parentId).at(-1)?.order ?? 0) +
                (offset + 1) * 1024,
          }
        })
        const result = await applyCanvasTransactions(userId, args, [
          { id: canvasId('tx'), label: 'MCP moved nodes', operations },
        ])
        return {
          revision: result.revision,
          changedNodeIds: result.changedNodeIds,
        }
      },
    ),
  )

  server.registerTool(
    'deleteNodes',
    {
      description:
        'Delete source nodes and descendants. Set confirmed only after the user approves this destructive action.',
      inputSchema: {
        ...targetShape,
        ...deleteNodesInputSchema.shape,
        confirmed: z.literal(true),
      },
      annotations: { destructiveHint: true },
    },
    tool(
      async (args: z.infer<typeof deleteNodesInputSchema> & {
        designId: string
        draftId?: string
        confirmed: true
      }) => {
        const found = await getCanvasTarget(userId, args)
        const nodeIds = normalizeDeletionNodeIds(
          found.document,
          args.nodeIds,
        )
        for (const id of nodeIds) {
          const node = found.document.nodes[id]
          if (!node) throw new Error(`Node "${id}" not found`)
          if (node.locked) throw new Error(`Node "${node.name}" is locked`)
        }
        const result = await applyCanvasTransactions(userId, args, [
          {
            id: canvasId('tx'),
            label: 'MCP deleted nodes',
            operations: nodeIds.map((id) => ({
              type: 'node.delete' as const,
              id,
            })),
          },
        ])
        return {
          deletedNodeIds: nodeIds,
          revision: result.revision,
          changedNodeIds: result.changedNodeIds,
        }
      },
    ),
  )

  server.registerTool(
    'createComponent',
    {
      description:
        'Create an off-canvas reusable component definition with optional instance-local typed state and declarative event interactions.',
      inputSchema: { ...targetShape, ...createComponentInputSchema.shape },
    },
    tool(
      async (args: z.infer<typeof createComponentInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        const created = createComponentTransaction(found.document, args)
        const result = await applyCanvasTransactions(userId, args, [
          created.transaction,
        ])
        return {
          componentId: created.componentId,
          refs: created.refs,
          revision: result.revision,
          changedNodeIds: result.changedNodeIds,
        }
      },
    ),
  )

  server.registerTool(
    'createInstance',
    {
      description: 'Create an instance of an existing component.',
      inputSchema: { ...targetShape, ...createInstanceInputSchema.shape },
    },
    tool(
      async (args: z.infer<typeof createInstanceInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        const parent = sourceContainerForRef(found.document, args.parent)
        const component = found.document.nodes[args.componentId]
        if (component?.type !== 'component') throw new Error('Component does not exist')
        const variant = args.variant ?? component.defaultVariant
        const node: CanvasNode = createInstanceNode(
          component.id,
          args.name ?? `${component.name} instance`,
          {
            parentId: parent.id,
            order:
              (orderedChildren(found.document, parent.id).at(-1)?.order ?? 0) +
              1024,
            layout: {
              ...defaultLayout(320, 200, {
                position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
              }),
              ...args.layout,
            },
            style: { ...defaultStyle(), ...args.style },
            ...(variant ? { variant } : {}),
            overrides: {},
          },
        )
        const result = await applyCanvasTransactions(userId, args, [
          {
            id: canvasId('tx'),
            label: `MCP created ${component.name} instance`,
            operations: [{ type: 'node.insert', node }],
          },
        ])
        return {
          instanceId: node.id,
          revision: result.revision,
          changedNodeIds: result.changedNodeIds,
        }
      },
    ),
  )

  server.registerTool(
    'setTokens',
    {
      description: 'Create or update structured design tokens.',
      inputSchema: { ...targetShape, ...setTokensInputSchema.shape },
    },
    tool(
      async (args: z.infer<typeof setTokensInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const result = await applyCanvasTransactions(userId, args, [
          {
            id: canvasId('tx'),
            label: 'MCP updated tokens',
            operations: tokenOperations(args.tokens),
          },
        ])
        return {
          tokenIds: args.tokens.map((token) => token.id),
          revision: result.revision,
        }
      },
    ),
  )

  server.registerTool(
    'exportCode',
    {
      description:
        'Generate implementation-ready code for one Page or node. Tailwind returns readable JSX with literal utilities; HTML and JSX are also available. Export is one-way—continue editing through structured Canvas tools.',
      inputSchema: {
        ...targetShape,
        format: z.enum(['tailwind', 'html', 'jsx']).default('tailwind'),
        pageId: z.string().min(1).max(128).optional(),
        ref: readNodeInputSchema.shape.ref.optional(),
        width: z.number().finite().min(200).max(3_840).default(1_440),
      },
      annotations: { readOnlyHint: true },
    },
    tool(
      async (args: {
        designId: string
        draftId?: string
        format: 'tailwind' | 'html' | 'jsx'
        pageId?: string
        ref?: { nodeId: string; instancePath: string[] }
        width: number
      }) => {
        const found = await getCanvasTarget(userId, args)
        const { code, pageId, nodeId } = exportCanvasCode(
          found.document,
          args,
        )
        if (Buffer.byteLength(code, 'utf8') > 2_000_000) {
          throw new Error(
            'The generated code is too large for one MCP response. Export a Page or node instead.',
          )
        }
        const extension = args.format === 'html' ? 'html' : 'tsx'
        return {
          format: args.format,
          code,
          extension,
          mediaType:
            args.format === 'html'
              ? 'text/html'
              : 'text/typescript',
          revision: found.revision,
          target: {
            pageId: pageId ?? null,
            ref: args.ref ?? null,
            exportedRootNodeId: nodeId ?? pageId,
          },
          openUrl: appUrl(args.designId, args.draftId, {
            page: pageId,
            node: args.ref?.nodeId,
            instancePath: args.ref?.instancePath.join('/'),
          }),
        }
      },
    ),
  )

  server.registerTool(
    'getScreenshot',
    {
      description:
        'Render a real PNG of one Page or NodeRef with the same DOM/CSS export engine. Call this after meaningful edits to verify the visual result.',
      inputSchema: {
        ...targetShape,
        pageId: z.string().min(1).max(128).optional(),
        ref: readNodeInputSchema.shape.ref.optional(),
        width: z.number().finite().min(200).max(3_840).default(1_440),
        pixelRatio: z.number().finite().min(1).max(2).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    pngTool(
      async (args: {
        designId: string
        draftId?: string
        pageId?: string
        ref?: { nodeId: string; instancePath: string[] }
        width: number
        pixelRatio: number
      }) => {
        if (args.pageId && args.ref) {
          throw new Error('Choose either pageId or ref, not both')
        }
        const found = await getCanvasTarget(userId, args)
        const screenshot = await renderCanvasScreenshot(
          userId,
          found.document,
          args,
        )
        return {
          png: screenshot.png,
          metadata: {
            mimeType: 'image/png',
            width: screenshot.width,
            height: screenshot.height,
            revision: found.revision,
            target: {
              designId: args.designId,
              draftId: args.draftId ?? null,
              pageId: screenshot.pageId,
              ref: screenshot.ref,
            },
            skippedImages: screenshot.skippedImages,
            openUrl: appUrl(args.designId, args.draftId, {
              page: screenshot.pageId ?? undefined,
              node: screenshot.ref?.nodeId,
              instancePath: screenshot.ref?.instancePath.join('/'),
            }),
          },
        }
      },
    ),
  )

  server.registerTool(
    'viewNode',
    {
      description:
        'Return a canonical open-in-Loora URL and semantic details for one node. Use getScreenshot when image pixels are needed.',
      inputSchema: { ...targetShape, ...viewNodeInputSchema.shape },
      annotations: { readOnlyHint: true },
    },
    tool(
      async (args: z.infer<typeof viewNodeInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        const node = readCanvasNodeRef(found.document, args.ref)
        return {
          node,
          revision: found.revision,
          openUrl: appUrl(args.designId, args.draftId, {
            node: args.ref.nodeId,
            instancePath: args.ref.instancePath.join('/'),
          }),
        }
      },
    ),
  )

  server.registerTool(
    'viewPage',
    {
      description:
        'Return a canonical open-in-Loora URL and semantic tree for one Page. Use getScreenshot when image pixels are needed.',
      inputSchema: { ...targetShape, ...viewPageInputSchema.shape },
      annotations: { readOnlyHint: true },
    },
    tool(
      async (args: z.infer<typeof viewPageInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        if (found.document.nodes[args.pageId]?.type !== 'page') {
          throw new Error(`Page "${args.pageId}" not found`)
        }
        return {
          tree: semanticTree(found.document, args.pageId, 20),
          revision: found.revision,
          openUrl: appUrl(args.designId, args.draftId, {
            page: args.pageId,
            width: args.width ? String(args.width) : undefined,
          }),
        }
      },
    ),
  )

  server.registerTool(
    'viewCanvas',
    {
      description:
        'Return a canonical open-in-Loora URL and Page summary. Use getScreenshot to inspect pixels.',
      inputSchema: { ...targetShape, ...viewCanvasInputSchema.shape },
      annotations: { readOnlyHint: true },
    },
    tool(
      async (args: z.infer<typeof viewCanvasInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        return {
          name: found.name,
          revision: found.revision,
          pages: orderedChildren(found.document, null)
            .filter((node) => node.type === 'page')
            .map((page) => ({ id: page.id, name: page.name })),
          openUrl: appUrl(args.designId, args.draftId),
        }
      },
    ),
  )

  server.registerTool(
    'createDesign',
    {
      description: 'Create a new empty Canvas design.',
      inputSchema: {
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
      },
    },
    tool(async ({ name }: { name: string }) => createDesign(userId, name)),
  )

  server.registerTool(
    'renameDesign',
    {
      description: 'Rename a design.',
      inputSchema: {
        designId,
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
      },
    },
    tool((args: { designId: string; name: string }) =>
      renameDesign(userId, args.designId, args.name),
    ),
  )

  server.registerTool(
    'deleteDesign',
    {
      description: 'Permanently delete a design after explicit confirmation.',
      inputSchema: { designId, confirmed: z.literal(true) },
      annotations: { destructiveHint: true },
    },
    tool(async ({ designId }: { designId: string; confirmed: true }) => ({
      deleted: await deleteDesign(userId, designId),
    })),
  )

  server.registerTool(
    'listBranches',
    {
      description: 'List branches. Branch state is separate from the canvas package.',
      inputSchema: { designId },
    },
    tool(({ designId }: { designId: string }) => listDrafts(userId, designId)),
  )

  server.registerTool(
    'createBranch',
    {
      description: 'Create an isolated app-level branch from current Main.',
      inputSchema: {
        designId,
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
      },
    },
    tool((args: { designId: string; name: string }) =>
      createDraft(userId, args.designId, args.name),
    ),
  )

  server.registerTool(
    'proposeBranch',
    {
      description: 'Freeze an active branch for review.',
      inputSchema: {
        designId,
        draftId,
        description: z.string().trim().max(2_000).default(''),
      },
    },
    tool((args: { designId: string; draftId: string; description: string }) =>
      proposeDraft(userId, args.designId, args.draftId, args.description),
    ),
  )

  server.registerTool(
    'reopenBranch',
    {
      description: 'Return a proposed branch to editable status.',
      inputSchema: { designId, draftId },
    },
    tool((args: { designId: string; draftId: string }) =>
      reopenDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'compareBranch',
    {
      description: 'Compare a branch with Main using field-level semantic merge.',
      inputSchema: { designId, draftId },
    },
    tool((args: { designId: string; draftId: string }) =>
      compareDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'applyBranch',
    {
      description:
        'Apply a branch to Main. Supply a main or draft choice for every reported conflict.',
      inputSchema: {
        designId,
        draftId,
        expectedMainRevision: z.number().int().nonnegative(),
        expectedDraftRevision: z.number().int().nonnegative(),
        resolutions: z
          .record(z.string(), z.enum(['main', 'draft']))
          .default({}),
      },
    },
    tool(
      (args: {
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
    'closeBranch',
    {
      description: 'Close an active or proposed branch without applying it.',
      inputSchema: { designId, draftId, confirmed: z.literal(true) },
      annotations: { destructiveHint: true },
    },
    tool((args: { designId: string; draftId: string; confirmed: true }) =>
      closeDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'listVersions',
    {
      description: 'List version history for Main or one branch.',
      inputSchema: {
        ...targetShape,
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    tool((args: { designId: string; draftId?: string; limit: number }) =>
      listVersions(userId, args.designId, args.limit, args.draftId),
    ),
  )

  server.registerTool(
    'listAssets',
    { description: 'List the signed-in user’s uploaded image assets.' },
    tool(async (_args: unknown) => listAssets(userId)),
  )

  return server
}
