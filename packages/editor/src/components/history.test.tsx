import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasProvider } from '@loora/canvas/react'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
} from '@loora/canvas/model'

const list = vi.fn()
const compareCanvas = vi.fn()
const commitCanvas = vi.fn()
const restoreCanvas = vi.fn()

vi.doMock('@loora/rpc/client', () => ({
  orpc: { history: { list, compareCanvas, commitCanvas, restoreCanvas } },
}))

const { CanvasHistory } = await import('./history')

const HOUR = 3_600_000

function fixture(name = 'Home', extra = false) {
  const document = createCanvasDocument('History fixture', 'history')
  document.nodes.page = createPageNode(name, { id: 'page' })
  if (extra) {
    document.nodes.hero = createFrameNode('Hero', { id: 'hero', parentId: 'page' })
  }
  return document
}

function version(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'v1',
    message: 'Agent edit',
    canvasVersion: 2,
    added: 2,
    removed: 0,
    changed: 1,
    at: Date.now() - 2 * HOUR,
    ...overrides,
  }
}

function setup() {
  const engine = new CanvasEngine(fixture())
  const controller = {
    target: { designId: 'design-1', draftId: null },
    revision: 7,
    flush: vi.fn(async () => undefined),
    adoptSnapshot: vi.fn(async () => undefined),
  }
  const view = render(
    <CanvasProvider engine={engine}>
      {/* The panel only needs the sync surface of a controller. */}
      <CanvasHistory controller={controller as never} readOnly={false} />
    </CanvasProvider>,
  )
  return { view, controller, engine }
}

async function openPanel() {
  const context = setup()
  fireEvent.click(context.view.getByTitle('Version history'))
  await context.view.findByText('Version history')
  return context
}

describe('CanvasHistory', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue({
      items: [version(), version({ id: 'v0', message: 'First draft', at: Date.now() - 30 * HOUR })],
      nextCursor: null,
    })
    compareCanvas.mockReset().mockResolvedValue({
      current: {
        id: 'v1',
        message: 'Agent edit',
        document: fixture('Restored', true),
        at: Date.now(),
      },
      previous: null,
    })
    commitCanvas.mockReset().mockResolvedValue({ id: 'checkpoint' })
    restoreCanvas.mockReset().mockResolvedValue({ document: fixture('Restored'), revision: 8 })
  })

  afterEach(() => cleanup())

  test('lists checkpoints and selects the newest one', async () => {
    const { view } = await openPanel()

    expect((await view.findAllByText('Agent edit')).length).toBeGreaterThan(0)
    expect(view.getByText('First draft')).toBeTruthy()
    await waitFor(() =>
      expect(compareCanvas).toHaveBeenCalledWith({
        designId: 'design-1',
        draftId: null,
        id: 'v1',
      }),
    )
  })

  test('names a checkpoint instead of saving them all as "Manual checkpoint"', async () => {
    const { view } = await openPanel()
    await view.findAllByText('Agent edit')

    fireEvent.change(view.getByLabelText('Checkpoint name'), {
      target: { value: 'Before the rewrite' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(commitCanvas).toHaveBeenCalledTimes(1))
    expect((commitCanvas.mock.calls[0]![0] as { message: string }).message).toBe(
      'Before the rewrite',
    )
  })

  test('reports what restoring would change against the document on screen', async () => {
    const { view } = await openPanel()
    // The checkpoint carries a frame the live document does not, and renames
    // the page it shares with it.
    expect(
      await view.findByText(/Restoring changes 1 added, 0 removed, 1 edited/),
    ).toBeTruthy()
  })

  test('checkpoints the current state before replacing it', async () => {
    const { view, controller } = await openPanel()
    await view.findAllByText('Agent edit')

    fireEvent.click(view.getByRole('button', { name: /Restore/ }))

    await waitFor(() => expect(restoreCanvas).toHaveBeenCalledTimes(1))
    expect(commitCanvas).toHaveBeenCalledTimes(1)
    expect((commitCanvas.mock.calls[0]![0] as { message: string }).message).toBe(
      'Before restore',
    )
    expect(controller.adoptSnapshot).toHaveBeenCalledTimes(1)
  })

  test('pages older checkpoints in', async () => {
    list.mockResolvedValueOnce({
      items: [version()],
      nextCursor: { at: Date.now() - 3 * HOUR, id: 'v1' },
    })
    const { view } = await openPanel()
    await view.findAllByText('Agent edit')

    list.mockResolvedValueOnce({
      items: [version({ id: 'v0', message: 'Older still' })],
      nextCursor: null,
    })
    fireEvent.click(view.getByRole('button', { name: 'Load older' }))

    expect(await view.findByText('Older still')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Load older' })).toBeNull()
  })

  test('marks a legacy checkpoint as unsupported', async () => {
    list.mockResolvedValue({
      items: [version({ id: 'old', message: 'Legacy', canvasVersion: 1 })],
      nextCursor: null,
    })
    const { view } = await openPanel()

    expect(await view.findByText(/unsupported legacy format/)).toBeTruthy()
    expect(
      (view.getByRole('button', { name: 'Restore' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(compareCanvas).not.toHaveBeenCalled()
  })
})
