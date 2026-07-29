import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  canvasId,
  createInstanceNode,
  defaultLayout,
  defaultStyle,
  orderedChildren,
  type CanvasNode,
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

function appUrl(
  design: string,
  branch?: string,
  extra: Record<string, string | undefined> = {},
) {
  const origin = (process.env.LOORA_APP_URL?.trim() || 'https://loora.design').replace(/\/+$/, '')
  const url = new URL(origin)
  url.searchParams.set('design', design)
  if (branch) url.searchParams.set('draft', branch)
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

export function createLooraServer(userId: string) {
  const server = new McpServer({ name: 'loora', version: '0.2.0' })

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
    'listDesigns',
    { description: 'List the signed-in user’s structured Loora designs.' },
    tool(async (_args: unknown) => listDesigns(userId)),
  )

  server.registerTool(
    'readTree',
    {
      description: 'Read a compact semantic Canvas tree. No generated source is returned.',
      inputSchema: {
        ...targetShape,
        root: readTreeInputSchema.shape.root,
        depth: readTreeInputSchema.shape.depth,
      },
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
      description: 'Create an editable responsive Page with optional nested structured nodes.',
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
        'Insert nested structured nodes. Temporary refs are mapped to permanent ids. HTML, JSX, CSS, and code strings are not accepted.',
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
        'Patch structured node fields or instance overrides atomically.',
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
      description: 'Create an off-canvas reusable component definition.',
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
    'viewNode',
    {
      description:
        'Return an open-in-Loora visual URL and semantic details for one node.',
      inputSchema: { ...targetShape, ...viewNodeInputSchema.shape },
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
        'Return an open-in-Loora visual URL and semantic tree for one Page.',
      inputSchema: { ...targetShape, ...viewPageInputSchema.shape },
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
      description: 'Return an open-in-Loora visual URL and the current Page summary.',
      inputSchema: { ...targetShape, ...viewCanvasInputSchema.shape },
    },
    tool(
      async (args: z.infer<typeof viewCanvasInputSchema> & {
        designId: string
        draftId?: string
      }) => {
        const found = await getCanvasTarget(userId, args)
        return {
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
