import { describe, expect, it } from 'bun:test'
import {
  CanvasConflictError,
  CanvasEngine,
  applyTransaction,
  canvasTransactionSchema,
  orderBetween,
  preconditionsForNodePatch,
  rebaseTransactions,
} from './engine'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
} from './model'

function engineFixture() {
  const document = createCanvasDocument('Fixture', 'doc')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.hero = createFrameNode('Hero', {
    id: 'hero',
    parentId: 'page',
    order: 1024,
  })
  return new CanvasEngine(document)
}

describe('Canvas transactions', () => {
  it('applies operations atomically and returns a working inverse', () => {
    const engine = engineFixture()
    const before = structuredClone(engine.document)
    const text = createTextNode('Hello', {
      id: 'headline',
      parentId: 'hero',
      order: 1024,
    })
    const result = engine.apply({
      id: 'insert',
      label: 'Insert headline',
      operations: [
        { type: 'node.insert', node: text },
        { type: 'node.patch', id: 'hero', patch: { name: 'Hero section' } },
      ],
    })
    expect(result.changedNodeIds.has('headline')).toBe(true)
    expect(engine.getNode('headline')?.type).toBe('text')
    expect(engine.getNode('hero')?.name).toBe('Hero section')

    engine.undo()
    expect(engine.document).toEqual(before)
    engine.redo()
    expect(engine.getNode('headline')?.type).toBe('text')
  })

  it('keeps state declarations on the existing node transaction path', () => {
    const engine = engineFixture()
    engine.apply({
      id: 'add-page-state',
      label: 'Add Page state',
      operations: [
        {
          type: 'node.patch',
          id: 'page',
          patch: {
            states: {
              menuOpen: {
                id: 'menuOpen',
                name: 'Menu open',
                type: 'boolean',
                initial: false,
              },
            },
          },
        },
      ],
    })

    const page = engine.getNode('page')
    expect(page?.type === 'page' ? page.states?.menuOpen?.initial : null).toBe(
      false,
    )
    engine.undo()
    const restored = engine.getNode('page')
    expect(
      restored?.type === 'page' ? restored.states?.menuOpen : undefined,
    ).toBeUndefined()
  })

  it('restores node metadata exactly when a merging patch is undone', () => {
    const engine = engineFixture()
    engine.apply({
      id: 'seed-metadata',
      label: 'Seed metadata',
      operations: [
        { type: 'node.patch', id: 'hero', patch: { metadata: { origin: 'html' } } },
      ],
    })
    engine.apply({
      id: 'add-metadata',
      label: 'Add metadata',
      operations: [
        { type: 'node.patch', id: 'hero', patch: { metadata: { note: 'temp' } } },
      ],
    })
    expect(engine.getNode('hero')?.metadata).toEqual({
      origin: 'html',
      note: 'temp',
    })

    engine.undo()
    expect(engine.getNode('hero')?.metadata).toEqual({ origin: 'html' })
  })

  it('validates a whole-object replace without a full document pass', () => {
    const engine = engineFixture()
    const before = structuredClone(engine.getNode('hero')!.style)
    const complete = { ...before, opacity: 0.4, overflow: 'hidden' as const }

    engine.apply({
      id: 'replace-style',
      label: 'Restyle',
      operations: [
        { type: 'node.patch', id: 'hero', patch: { style: complete }, replace: ['style'] },
      ],
    })
    expect(engine.getNode('hero')?.style.opacity).toBe(0.4)
    engine.undo()
    expect(engine.getNode('hero')?.style).toEqual(before)

    // A replaced field stands alone, so a partial one is not a valid node.
    const { fills: _fills, ...partial } = complete
    expect(() =>
      engine.apply({
        id: 'replace-partial-style',
        label: 'Restyle',
        operations: [
          {
            type: 'node.patch',
            id: 'hero',
            patch: { style: partial as never },
            replace: ['style'],
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      engine.apply({
        id: 'replace-partial-layout',
        label: 'Relayout',
        operations: [
          {
            type: 'node.patch',
            id: 'hero',
            patch: { layout: { x: 4, y: 4 } },
            replace: ['layout'],
          },
        ],
      }),
    ).toThrow()
    expect(engine.getNode('hero')?.style).toEqual(before)
  })

  it('deletes a subtree that the same transaction just added to', () => {
    const engine = engineFixture()
    const before = structuredClone(engine.document)
    engine.apply({
      id: 'insert-then-delete',
      label: 'Insert then delete',
      operations: [
        {
          type: 'node.insert',
          node: createTextNode('Late', { id: 'late', parentId: 'hero', order: 2048 }),
        },
        { type: 'node.delete', id: 'hero' },
      ],
    })
    expect(engine.getNode('late')).toBeNull()
    expect(engine.getNode('hero')).toBeNull()
    engine.undo()
    expect(engine.document).toEqual(before)
  })

  it('rejects a fast-path patch whose interaction names an undeclared state', () => {
    const engine = engineFixture()
    const before = structuredClone(engine.document)
    expect(() =>
      engine.apply({
        id: 'unknown-state',
        label: 'Toggle nothing',
        operations: [
          {
            type: 'node.patch',
            id: 'hero',
            patch: {
              interactions: [
                {
                  trigger: 'click',
                  actions: [
                    { type: 'set-state', stateId: 'missing', value: true },
                  ],
                },
              ],
            },
          },
        ],
      }),
    ).toThrow()
    expect(engine.document).toEqual(before)
  })

  it('updates named themes and their token modes atomically', () => {
    const engine = engineFixture()
    const before = structuredClone(engine.document)
    const result = engine.apply({
      id: 'add-focus-theme',
      label: 'Add focus theme',
      operations: [
        {
          type: 'theme.upsert',
          theme: { id: 'focus', name: 'Focus' },
        },
        {
          type: 'token.upsert',
          token: {
            id: 'accent',
            name: 'Accent',
            type: 'color',
            value: '#3b82f6',
            modes: { focus: '#f59e0b' },
          },
        },
      ],
    })

    expect(result.changedThemeIds.has('focus')).toBe(true)
    expect(engine.document.themes.focus?.name).toBe('Focus')
    expect(engine.document.tokens.accent?.modes?.focus).toBe('#f59e0b')
    engine.undo()
    expect(engine.document).toEqual(before)
  })

  it('leaves the source untouched when final validation fails', () => {
    const engine = engineFixture()
    const before = structuredClone(engine.document)
    expect(() =>
      engine.apply({
        id: 'cycle',
        label: 'Create cycle',
        operations: [{ type: 'node.move', id: 'hero', parentId: 'hero', order: 1 }],
      }),
    ).toThrow()
    expect(engine.document).toEqual(before)
  })

  it('makes transaction retries idempotent', () => {
    const engine = engineFixture()
    const transaction = {
      id: 'rename-once',
      label: 'Rename',
      operations: [{ type: 'node.patch' as const, id: 'hero', patch: { name: 'Renamed' } }],
    }
    expect(engine.apply(transaction).idempotent).toBe(false)
    const retry = engine.apply(transaction)
    expect(retry.idempotent).toBe(true)
    expect(retry.changedNodeIds.size).toBe(0)
  })

  it('coalesces adjacent edits with the same history key', () => {
    const engine = engineFixture()
    engine.apply({
      id: 'move-1',
      label: 'Move Hero',
      coalesceKey: 'move:hero',
      createdAt: 100,
      operations: [{ type: 'node.patch', id: 'hero', patch: { layout: { x: 10 } } }],
    })
    engine.apply({
      id: 'move-2',
      label: 'Move Hero',
      coalesceKey: 'move:hero',
      createdAt: 200,
      operations: [{ type: 'node.patch', id: 'hero', patch: { layout: { x: 20 } } }],
    })
    expect(engine.getNode('hero')?.layout.x).toBe(20)
    engine.undo()
    expect(engine.getNode('hero')?.layout.x).toBe(0)
  })

  it('checks touched fields and rebases independent edits', () => {
    const engine = engineFixture()
    const rename = {
      id: 'rename',
      label: 'Rename',
      preconditions: preconditionsForNodePatch(engine.document, 'hero', { name: 'New name' }),
      operations: [{ type: 'node.patch' as const, id: 'hero', patch: { name: 'New name' } }],
    }
    const remote = applyTransaction(engine.document, {
      id: 'remote-move',
      label: 'Move',
      operations: [{ type: 'node.patch', id: 'hero', patch: { layout: { x: 40 } } }],
    }).document
    const rebased = rebaseTransactions(remote, [rename])
    expect(rebased.ok).toBe(true)
    expect(rebased.document.nodes.hero.name).toBe('New name')
    expect(rebased.document.nodes.hero.layout.x).toBe(40)

    const conflicting = applyTransaction(engine.document, {
      id: 'remote-rename',
      label: 'Rename remotely',
      operations: [{ type: 'node.patch', id: 'hero', patch: { name: 'Remote' } }],
    }).document
    expect(() => applyTransaction(conflicting, rename)).toThrow(CanvasConflictError)
  })

  it('uses midpoint ordering and signals unsafe gaps', () => {
    expect(orderBetween(1024, 2048)).toBe(1536)
    expect(orderBetween(undefined, undefined)).toBe(1024)
    expect(orderBetween(1, 1 + 1e-9)).toBeNull()
  })

  it('rejects malformed, non-serializable transactions', () => {
    expect(canvasTransactionSchema.safeParse({
      id: 'bad',
      label: 'Bad',
      operations: [{ type: 'node.patch', id: 'hero', patch: { x: Number.NaN } }],
    }).success).toBe(false)
  })

  it('rejects unknown operation fields and malformed preconditions', () => {
    expect(() =>
      canvasTransactionSchema.parse({
        id: 'tx',
        label: 'Move',
        operations: [
          {
            type: 'node.move',
            id: 'hero',
            parentId: 'page',
            order: 1,
            source: '<script />',
          },
        ],
      }),
    ).toThrow('unknown fields')
    expect(() =>
      canvasTransactionSchema.parse({
        id: 'tx',
        label: 'Patch',
        operations: [
          { type: 'node.patch', id: 'hero', patch: { name: 'Hero' } },
        ],
        preconditions: [
          {
            scope: 'node',
            id: 'hero',
            path: 'responsive.mobile.width',
            hash: '<invalid>',
          },
        ],
      }),
    ).toThrow('preconditions')
  })

  it('keeps a 100-node transaction on a 5,000-node document within the engine gate', () => {
    const document = createCanvasDocument('Performance', 'perf')
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const pageId = `page-${pageIndex}`
      document.nodes[pageId] = createPageNode(`Page ${pageIndex}`, {
        id: pageId,
        order: (pageIndex + 1) * 1024,
        layout: {
          ...createPageNode().layout,
          x: pageIndex * 1600,
        },
      })
      for (let nodeIndex = 0; nodeIndex < 249; nodeIndex += 1) {
        const id = `node-${pageIndex}-${nodeIndex}`
        document.nodes[id] = createFrameNode(id, {
          id,
          parentId: pageId,
          order: (nodeIndex + 1) * 1024,
        })
      }
    }
    const engine = new CanvasEngine(document)
    const operations = Array.from({ length: 100 }, (_, index) => ({
      type: 'node.patch' as const,
      id: `node-0-${index}`,
      patch: { name: `Changed ${index}` },
    }))
    const started = performance.now()
    engine.apply({ id: 'bulk', label: 'Bulk edit', operations })
    const duration = performance.now() - started
    expect(duration).toBeLessThan(8)
  })
})
