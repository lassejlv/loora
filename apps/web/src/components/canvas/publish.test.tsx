import { useEffect } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasProvider, useCanvasSession } from '@loora/canvas/react'
import { createCanvasDocument, createPageNode } from '@loora/canvas/model'

const list = mock()
const create = mock()
const remove = mock()
const egress = mock()

mock.module('#/lib/orpc-client', () => ({
  orpc: { publish: { list, create, delete: remove, egress } },
}))

const { CanvasPublish } = await import('./publish')

const HOUR = 3_600_000
const GB = 1024 ** 3

function fixture() {
  const document = createCanvasDocument('Publish fixture', 'publish')
  document.nodes.home = createPageNode('Home', { id: 'home', order: 1_024 })
  document.nodes.about = createPageNode('About', {
    id: 'about',
    order: 2_048,
    layout: { ...createPageNode().layout, x: 1_600 },
  })
  document.nodes.secret = createPageNode('Secret', {
    id: 'secret',
    order: 3_072,
    hidden: true,
  })
  return document
}

function Select({ id }: { id?: string }) {
  const session = useCanvasSession()
  useEffect(() => {
    if (id) session.select([{ nodeId: id, instancePath: [] }])
  }, [id, session])
  return null
}

const flush = mock(async () => undefined)

/**
 * Queries are scoped to this render's own tree: other suites in the same
 * process rewrite the shared document, so `screen` would read the wrong body.
 */
async function openPanel(selected?: string) {
  const engine = new CanvasEngine(fixture())
  const view = render(
    <CanvasProvider engine={engine}>
      <Select id={selected} />
      <CanvasPublish
        target={{ designId: 'design-1', draftId: null }}
        onFlush={flush}
      />
    </CanvasProvider>,
  )
  fireEvent.click(view.getByRole('button', { name: 'Publish' }))
  await view.findByText('About')
  return { view, engine }
}

const urlField = (view: Awaited<ReturnType<typeof openPanel>>['view']) =>
  view.queryByLabelText('Public URL') as HTMLInputElement | null

describe('CanvasPublish', () => {
  beforeEach(() => {
    flush.mockClear()
    list.mockReset().mockResolvedValue([])
    create
      .mockReset()
      .mockResolvedValue({ id: 'link-1', expiresAt: Date.now() + 12 * HOUR })
    remove.mockReset().mockResolvedValue({ deleted: true })
    egress.mockReset().mockResolvedValue({
      usedBytes: 2 * GB,
      limitBytes: 10 * GB,
      windowDays: 30,
      unlimited: false,
    })
  })

  afterEach(() => cleanup())

  test('shows every Page and which of them are live', async () => {
    list.mockResolvedValue([
      { id: 'link-1', pageId: 'about', elementId: null, expiresAt: Date.now() + 11 * HOUR },
    ])
    const { view } = await openPanel()

    expect(await view.findByText(/Live · 10h 5\dm left/)).toBeTruthy()
    expect(view.getByText('Not public')).toBeTruthy()
    expect(view.getByText('Hidden — cannot be published')).toBeTruthy()
    expect(await view.findByText('1 live link in this design.')).toBeTruthy()
  })

  test('opens on the Page holding the selection', async () => {
    const { view } = await openPanel('about')

    await waitFor(() =>
      expect(
        view.getByRole('button', { name: /About/ }).getAttribute('aria-pressed'),
      ).toBe('true'),
    )
  })

  test('publishes the selected Page after flushing pending edits', async () => {
    const { view } = await openPanel('about')
    await waitFor(() => expect(list).toHaveBeenCalled())

    fireEvent.click(view.getByRole('button', { name: 'Publish Page' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(flush).toHaveBeenCalled()
    expect(create.mock.calls[0]![0]).toEqual({
      designId: 'design-1',
      pageId: 'about',
    })
    await waitFor(() => expect(urlField(view)?.value).toBe('http://localhost/p/link-1'))
  })

  test('extends the link that is already out there instead of minting another', async () => {
    list.mockResolvedValue([
      { id: 'link-1', pageId: 'home', elementId: null, expiresAt: Date.now() + 2 * HOUR },
    ])
    create.mockResolvedValue({ id: 'link-1', expiresAt: Date.now() + 12 * HOUR })
    const { view } = await openPanel('home')
    await waitFor(() => expect(urlField(view)?.value).toBe('http://localhost/p/link-1'))

    fireEvent.click(view.getByRole('button', { name: 'Extend' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(urlField(view)?.value).toBe('http://localhost/p/link-1')
    expect(await view.findByText(/expires in 11h|expires in 12h/)).toBeTruthy()
  })

  test('takes a link offline', async () => {
    list.mockResolvedValue([
      { id: 'link-1', pageId: 'home', elementId: null, expiresAt: Date.now() + 2 * HOUR },
    ])
    const { view } = await openPanel('home')
    await waitFor(() => expect(urlField(view)).not.toBeNull())

    fireEvent.click(view.getByRole('button', { name: 'Unpublish' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: 'link-1' }))
    await waitFor(() => expect(urlField(view)).toBeNull())
  })

  test('will not publish a hidden Page', async () => {
    const { view } = await openPanel()
    fireEvent.click(view.getByRole('button', { name: /Secret/ }))

    expect(view.getByText(/Make this Page visible to publish it/)).toBeTruthy()
    expect(
      (view.getByRole('button', { name: 'Publish Page' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  test('reports a publish that failed', async () => {
    create.mockRejectedValue(new Error('NOT_FOUND'))
    const { view } = await openPanel('home')
    await waitFor(() => expect(list).toHaveBeenCalled())

    fireEvent.click(view.getByRole('button', { name: 'Publish Page' }))

    expect(await view.findByText(/Could not publish this Page/)).toBeTruthy()
  })

  test('warns when published pages are paused by the bandwidth cap', async () => {
    egress.mockResolvedValue({
      usedBytes: 10 * GB,
      limitBytes: 10 * GB,
      windowDays: 30,
      unlimited: false,
    })
    const { view } = await openPanel()

    expect(await view.findByText(/every published link is paused/)).toBeTruthy()
    expect(view.getByText('10 / 10 GB')).toBeTruthy()
  })
})
