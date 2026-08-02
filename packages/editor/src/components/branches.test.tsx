import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
} from '@loora/canvas/model'

const list = vi.fn()
const create = vi.fn()
const compare = vi.fn()
const apply = vi.fn()
const propose = vi.fn()
const reopen = vi.fn()
const close = vi.fn()
const rename = vi.fn()

vi.doMock('@loora/rpc/client', () => ({
  orpc: {
    draft: { list, create, compare, apply, propose, reopen, close, rename },
  },
}))

import type { CanvasBranchSummary } from './branches'

const { CanvasBranches } = await import('./branches')

const HOUR = 3_600_000

function branch(overrides: Partial<CanvasBranchSummary> = {}): CanvasBranchSummary {
  return {
    id: 'b1',
    name: 'Redesign',
    description: '',
    status: 'active',
    baseRevision: 3,
    revision: 9,
    proposedAt: null,
    appliedAt: null,
    closedAt: null,
    createdAt: Date.now() - 4 * HOUR,
    updatedAt: Date.now() - HOUR,
    ...overrides,
  }
}

function baseDocument() {
  const document = createCanvasDocument('Branch fixture', 'branch')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  return document
}

function mainDocument() {
  const document = baseDocument()
  document.nodes.banner = createFrameNode('Banner', {
    id: 'banner',
    parentId: 'page',
    order: 1_024,
  })
  return document
}

function draftDocument() {
  const document = baseDocument()
  document.nodes.card = createFrameNode('Card', {
    id: 'card',
    parentId: 'page',
    order: 1_024,
  })
  return document
}

function comparison(conflicts: unknown[] = []) {
  return {
    draft: {
      id: 'b1',
      name: 'Redesign',
      description: '',
      status: 'active',
      baseRevision: 3,
      revision: 9,
      proposedAt: null,
      appliedAt: null,
      closedAt: null,
    },
    mainRevision: 5,
    canvasVersion: 2,
    baseDocument: baseDocument(),
    mainDocument: mainDocument(),
    draftDocument: draftDocument(),
    summary: { added: 2, removed: 0, changed: 1 },
    conflicts,
    unresolved: conflicts.map((conflict) => (conflict as { id: string }).id),
  }
}

const styleConflict = {
  id: 'node:card:style.fills',
  scope: 'node' as const,
  targetId: 'card',
  path: 'style.fills',
  base: [{ type: 'solid', color: '#ffffff' }],
  main: [{ type: 'solid', color: '#111111' }],
  draft: [{ type: 'solid', color: '#ff0000' }],
}

const flush = vi.fn(async () => undefined)
const onSwitch = vi.fn(async () => undefined)
const onBranchesChange = vi.fn()

/**
 * Queries are scoped to this render's own tree: other suites in the same
 * process rewrite the shared document, so `screen` would read the wrong body.
 */
function setup(branches: CanvasBranchSummary[], activeDraftId: string | null = null) {
  return render(
    <CanvasBranches
      designId="design-1"
      activeDraftId={activeDraftId}
      controller={{ flush } as never}
      branches={branches}
      onBranchesChange={onBranchesChange}
      onSwitch={onSwitch}
    />,
  )
}

/** Base UI menus open on press, not on a bare click. */
function press(element: HTMLElement) {
  fireEvent.pointerDown(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(element, { button: 0 })
  fireEvent.pointerUp(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseUp(element, { button: 0 })
  fireEvent.click(element, { button: 0 })
}

async function openMenu(view: ReturnType<typeof setup>) {
  press(view.getByRole('button', { name: /Branch/ }))
  await view.findByText('New branch')
}

async function openManage(branches: CanvasBranchSummary[], activeDraftId: string | null = null) {
  const view = setup(branches, activeDraftId)
  await openMenu(view)
  press(view.getByText('Manage branches'))
  await view.findByText('The shared source of truth.')
  return view
}

describe('CanvasBranches', () => {
  beforeEach(() => {
    flush.mockClear()
    onSwitch.mockClear()
    onBranchesChange.mockClear()
    list.mockReset().mockResolvedValue([])
    create.mockReset().mockResolvedValue(branch({ id: 'b2', name: 'New' }))
    compare.mockReset().mockResolvedValue(comparison())
    apply.mockReset().mockResolvedValue({ applied: true })
    propose.mockReset().mockResolvedValue({ id: 'b1', status: 'proposed' })
    reopen.mockReset().mockResolvedValue({ id: 'b1', status: 'active' })
    close.mockReset().mockResolvedValue({ id: 'b1', status: 'closed' })
    rename.mockReset().mockResolvedValue({ id: 'b1', name: 'Renamed' })
  })

  afterEach(() => cleanup())

  test('keeps discarded branches reachable instead of losing them', async () => {
    const view = await openManage([
      branch(),
      branch({ id: 'b2', name: 'Old idea', status: 'closed', closedAt: Date.now() - 2 * HOUR }),
    ])

    expect(view.getByText('Archived')).toBeTruthy()
    expect(view.getByText('Old idea')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Restore' }))

    await waitFor(() =>
      expect(reopen).toHaveBeenCalledWith({ designId: 'design-1', id: 'b2' }),
    )
    expect(list).toHaveBeenCalled()
  })

  test('asks before discarding a branch', async () => {
    const view = await openManage([branch()])

    press(view.getByRole('button', { name: 'More for Redesign' }))
    press(await view.findByText('Discard'))

    expect(await view.findByText(/Discard it\?/)).toBeTruthy()
    expect(close).not.toHaveBeenCalled()

    fireEvent.click(view.getByRole('button', { name: 'Discard' }))
    await waitFor(() =>
      expect(close).toHaveBeenCalledWith({ designId: 'design-1', id: 'b1' }),
    )
  })

  test('renames a branch in place', async () => {
    const view = await openManage([branch()])

    press(view.getByRole('button', { name: 'More for Redesign' }))
    press(await view.findByText('Rename'))

    const field = await view.findByLabelText('Branch name')
    fireEvent.change(field, { target: { value: 'Nav rework' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith({
        designId: 'design-1',
        id: 'b1',
        name: 'Nav rework',
      }),
    )
  })

  test('reviews a branch that is not the one currently open', async () => {
    const view = await openManage([branch()], null)

    fireEvent.click(view.getByRole('button', { name: 'Review' }))

    await waitFor(() =>
      expect(compare).toHaveBeenCalledWith({ designId: 'design-1', id: 'b1' }),
    )
    // The branch added two nodes and edited one; zero counts are left out.
    expect(await view.findByText('+2')).toBeTruthy()
    expect(view.getByText('~1')).toBeTruthy()
    // Main gained a frame while the branch was open, which the old review
    // never surfaced at all.
    expect(view.getByText('+1')).toBeTruthy()
  })

  test('names the layer a conflict is on and blocks Apply until it is settled', async () => {
    compare.mockResolvedValue(comparison([styleConflict]))
    const view = await openManage([branch()])
    fireEvent.click(view.getByRole('button', { name: 'Review' }))

    expect(await view.findByText('Card · style.fills')).toBeTruthy()
    expect(
      (view.getByRole('button', { name: /1 to resolve/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    fireEvent.click(
      view.getByRole('button', { name: 'Use this branch for Card · style.fills' }),
    )

    const applyButton = await view.findByRole('button', { name: 'Apply to Main' })
    fireEvent.click(applyButton)
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    expect(apply.mock.calls[0]![0]).toMatchObject({
      expectedMainRevision: 5,
      expectedDraftRevision: 9,
      resolutions: { 'node:card:style.fills': 'draft' },
    })
  })

  test('resolves every conflict at once', async () => {
    compare.mockResolvedValue(
      comparison([styleConflict, { ...styleConflict, id: 'node:page:name', targetId: 'page', path: 'name' }]),
    )
    const view = await openManage([branch()])
    fireEvent.click(view.getByRole('button', { name: 'Review' }))
    await view.findByText('Card · style.fills')

    fireEvent.click(view.getByRole('button', { name: 'All Main' }))

    expect(await view.findByRole('button', { name: 'Apply to Main' })).toBeTruthy()
    expect(view.getByText('2 resolved')).toBeTruthy()
  })

  test('carries the description into a new branch', async () => {
    const view = setup([])
    await openMenu(view)
    press(view.getByText('New branch'))

    fireEvent.change(await view.findByLabelText('Branch name'), {
      target: { value: 'Nav rework' },
    })
    fireEvent.change(view.getByLabelText('What this branch is for'), {
      target: { value: 'Trying a condensed header' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Create branch' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![0]).toMatchObject({
      name: 'Nav rework',
      description: 'Trying a condensed header',
      empty: false,
    })
    expect(flush).toHaveBeenCalled()
  })
})
