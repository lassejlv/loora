import { useEffect, useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasProvider, useCanvasSession } from '@loora/canvas/react'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  defaultLayout,
} from '@loora/canvas/model'

const handoffCreate = mock()
const captureCanvasPng = mock()
const captureNodePng = mock()

mock.module('#/lib/orpc-client', () => ({
  orpc: { handoff: { create: handoffCreate } },
}))
mock.module('#/lib/canvas-v2-capture', () => ({
  captureCanvasPng,
  captureNodePng,
}))

const { CanvasV2Export } = await import('./export-panel')

const PNG = 'data:image/png;base64,iVBORw0KGgo='

function fixture() {
  const document = createCanvasDocument('Export fixture', 'export')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.card = createFrameNode('Card', {
    id: 'card',
    parentId: 'page',
    order: 1_024,
    layout: { ...defaultLayout(320, 200), position: 'absolute', x: 0, y: 0 },
  })
  document.nodes.other = createFrameNode('Other', {
    id: 'other',
    parentId: 'page',
    order: 2_048,
    layout: { ...defaultLayout(120, 80), position: 'absolute', x: 400, y: 0 },
  })
  document.nodes.label = createTextNode('Hello', {
    id: 'label',
    parentId: 'card',
    order: 1_024,
  })
  return document
}

function Select({ ids }: { ids: string[] }) {
  const session = useCanvasSession()
  useEffect(() => {
    session.select(ids.map((nodeId) => ({ nodeId, instancePath: [] })))
  }, [ids.join(','), session])
  return null
}

const controller = {
  target: { designId: 'design-1', draftId: null },
  flush: mock(async () => undefined),
}

function Harness({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Select ids={ids} />
      <button type="button" onClick={() => setOpen(true)}>
        Open export
      </button>
      <CanvasV2Export
        controller={controller as never}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

/**
 * Queries are scoped to this render's own tree: other suites in the same
 * process rewrite the shared document, so `screen` would read the wrong body.
 */
async function openPanel(ids: string[] = []) {
  const engine = new CanvasEngine(fixture())
  const view = render(
    <CanvasProvider engine={engine}>
      <Harness ids={ids} />
    </CanvasProvider>,
  )
  fireEvent.click(view.getByText('Open export'))
  await view.findByText('Canvas document')
  return { view, engine }
}

const codeText = (view: Awaited<ReturnType<typeof openPanel>>['view']) =>
  view.baseElement.querySelector('pre')?.textContent ?? ''

const previewFrame = (view: Awaited<ReturnType<typeof openPanel>>['view']) =>
  view.baseElement.querySelector('iframe')

// The panel downloads through a detached anchor on the JSDOM document, so the
// prototype to intercept is that window's, not a Bun global.
const anchorPrototype = (globalThis as unknown as {
  window: { HTMLAnchorElement: { prototype: HTMLAnchorElement } }
}).window.HTMLAnchorElement.prototype
let clicked: { download: string; href: string } | null = null
const anchorClick = anchorPrototype.click
const createObjectURL = URL.createObjectURL

describe('CanvasV2Export', () => {
  beforeEach(() => {
    clicked = null
    anchorPrototype.click = function click(this: HTMLAnchorElement) {
      clicked = { download: this.download, href: this.href }
    }
    URL.createObjectURL = () => 'blob:export'
    URL.revokeObjectURL = () => undefined
    handoffCreate.mockReset().mockResolvedValue({
      token: 'handoff-token',
      expiresAt: Date.now() + 3_600_000,
    })
    captureCanvasPng.mockReset().mockResolvedValue(PNG)
    captureNodePng.mockReset().mockResolvedValue(PNG)
  })

  afterEach(() => {
    anchorPrototype.click = anchorClick
    URL.createObjectURL = createObjectURL
    cleanup()
  })

  test('previews the file it would write, not the editor', async () => {
    const { view } = await openPanel()

    const frame = previewFrame(view)
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('srcdoc')).toContain('data-loora-node="card"')
    expect(frame?.getAttribute('srcdoc')).toContain('<!doctype html>')
  })

  test('opens on the selection and exports only that subtree', async () => {
    const { view } = await openPanel(['card'])

    expect(
      view.getByRole('button', { name: 'Selection' }).getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(view.getByRole('button', { name: 'Code' }))
    expect(codeText(view)).toContain('data-loora-node="card"')
    expect(codeText(view)).not.toContain('data-loora-node="other"')
  })

  test('widens back to the whole canvas on demand', async () => {
    const { view } = await openPanel(['card'])

    fireEvent.click(view.getByRole('button', { name: 'Canvas' }))
    fireEvent.click(view.getByRole('button', { name: 'Code' }))
    expect(codeText(view)).toContain('data-loora-node="other"')
  })

  test('renders the preview at the chosen breakpoint width', async () => {
    const { view } = await openPanel()

    expect(previewFrame(view)?.style.width).toBe('1440px')
    fireEvent.click(view.getByRole('button', { name: '390' }))
    expect(previewFrame(view)?.style.width).toBe('390px')
  })

  test('names the download after what is being exported', async () => {
    const { view } = await openPanel(['card'])

    fireEvent.click(view.getByRole('button', { name: 'Download' }))
    expect(clicked?.download).toBe('card.html')
  })

  test('copies the generated code', async () => {
    const writeText = mock(async (_value: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const { view } = await openPanel()

    fireEvent.click(view.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]![0]).toContain('<!doctype html>')
  })

  test('shows the actual capture before saving a PNG', async () => {
    const { view } = await openPanel()
    fireEvent.click(view.getByText('Image'))

    const image = await view.findByAltText('Export preview')
    expect(image.getAttribute('src')).toBe(PNG)
    expect(captureCanvasPng.mock.calls[0]![2]).toBe(2)

    fireEvent.click(view.getByRole('button', { name: '3×' }))
    await waitFor(() => expect(captureCanvasPng).toHaveBeenCalledTimes(2))
    expect(captureCanvasPng.mock.calls[1]![2]).toBe(3)

    fireEvent.click(view.getByRole('button', { name: 'Download' }))
    expect(clicked?.download).toBe('export-fixture.png')
  })

  test('reports a capture that failed instead of saving nothing', async () => {
    captureCanvasPng.mockRejectedValue(new Error('The canvas has no visible Pages'))
    const { view } = await openPanel()
    fireEvent.click(view.getByText('Image'))

    expect(await view.findByText('The canvas has no visible Pages')).toBeTruthy()
    expect(
      (view.getByRole('button', { name: 'Download' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  test('says the JSON document is always whole', async () => {
    const { view } = await openPanel(['card'])
    fireEvent.click(view.getByText('Canvas document'))

    expect(await view.findByText(/always exported whole/)).toBeTruthy()
    expect(codeText(view)).toContain('"schemaVersion": 2')
    expect(
      view.getByRole('button', { name: 'Selection' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  test('creates a handoff link and shows the prompt it hands over', async () => {
    const { view } = await openPanel()
    fireEvent.click(view.getByText('Agent handoff'))
    fireEvent.click(view.getByRole('button', { name: /Create handoff link/ }))

    const prompt = (await view.findByLabelText(
      'Agent handoff prompt',
    )) as HTMLTextAreaElement
    expect(prompt.value).toContain('/api/handoff/handoff-token')
    expect(controller.flush).toHaveBeenCalled()
  })
})
