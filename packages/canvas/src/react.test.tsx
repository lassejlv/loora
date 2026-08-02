import { describe, expect, it } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { CanvasEngine } from './engine'
import {
  createCanvasDocument,
  createComponentNode,
  createFrameNode,
  createInstanceNode,
  createPageNode,
  createTextNode,
  defaultLayout,
} from './model'
import {
  CanvasProvider,
  CanvasSession,
  CanvasSurface,
  useCanvasHistory,
  useCanvasSelection,
  useCanvasSession,
  useCanvasTransaction,
  type CanvasSurfaceControls,
} from './react'

function fixture() {
  const document = createCanvasDocument('React fixture', 'doc')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.frame = createFrameNode('Card', {
    id: 'frame',
    parentId: 'page',
    order: 1_024,
  })
  document.nodes.text = createTextNode('Hello', {
    id: 'text',
    parentId: 'frame',
    order: 1_024,
  })
  return document
}

/** jsdom has no layout, so drag tests describe the boxes themselves. */
function stubRect(
  element: HTMLElement,
  box: { left?: number; top?: number; width?: number; height?: number },
) {
  const left = box.left ?? 0
  const top = box.top ?? 0
  const width = box.width ?? 0
  const height = box.height ?? 0
  const rect = {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => rect,
  } as DOMRect
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
}

/** jsdom's DragEvent drops the pointer coordinates, so drops are hand-built. */
function dropAt(target: Element, clientX: number, clientY: number) {
  const event = new MouseEvent('drop', { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: [], files: [], getData: () => '', dropEffect: 'none' },
  })
  target.dispatchEvent(event)
}

/** Runs `body` with hit testing pinned to the given stack, topmost first. */
function withHits(stack: Element[], body: () => void) {
  const original = document.elementsFromPoint
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => stack,
  })
  try {
    body()
  } finally {
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: original,
    })
  }
}

function SelectNode({ id }: { id: string }) {
  const session = useCanvasSession()
  useEffect(() => {
    session.select([{ nodeId: id, instancePath: [] }])
  }, [id, session])
  return null
}

function SelectionProbe() {
  const selection = useCanvasSelection()
  return (
    <output data-testid="selection">
      {selection
        .map((ref) => `${ref.instancePath.join('/')}:${ref.nodeId}`)
        .join(',')}
    </output>
  )
}

function InsertUndoProbe() {
  const session = useCanvasSession()
  const transact = useCanvasTransaction()
  const history = useCanvasHistory()
  return (
    <>
      <button
        onClick={() => {
          transact({
            id: 'insert-temporary',
            label: 'Insert temporary node',
            operations: [
              {
                type: 'node.insert',
                node: createFrameNode('Temporary', {
                  id: 'temporary',
                  parentId: 'page',
                }),
              },
            ],
          })
          session.select([{ nodeId: 'temporary', instancePath: [] }])
        }}
      >
        Insert temporary
      </button>
      <button onClick={() => history.undo()}>Undo temporary</button>
    </>
  )
}

describe('Canvas React surface', () => {
  it('routes text-edit signals only to the requested node', () => {
    const session = new CanvasSession()
    let titleEdits = 0
    let captionEdits = 0
    session.onEditText({ nodeId: 'title', instancePath: [] }, () => {
      titleEdits += 1
    })
    session.onEditText({ nodeId: 'caption', instancePath: [] }, () => {
      captionEdits += 1
    })

    session.editText({ nodeId: 'title', instancePath: [] })

    expect(titleEdits).toBe(1)
    expect(captionEdits).toBe(0)
  })

  it('does not subscribe ordinary nodes to an empty instance id', () => {
    const engine = new CanvasEngine(fixture())
    const subscriptions: string[] = []
    const subscribeNode = engine.subscribeNode.bind(engine)
    engine.subscribeNode = (id, listener) => {
      subscriptions.push(id)
      return subscribeNode(id, listener)
    }

    render(
      <CanvasProvider engine={engine}>
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )

    expect(subscriptions).not.toContain('')
  })

  it('releases the camera compositing hint when movement becomes idle', async () => {
    const view = render(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    const scene = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-scene]',
    )!
    expect(scene.style.willChange).toBe('transform')
    await waitFor(() => expect(scene.style.willChange).toBe('auto'), {
      timeout: 500,
    })
  })

  it('uses host theme tokens for the workspace and grid', () => {
    const view = render(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )
    expect(surface?.style.backgroundColor).toBe(
      'var(--cx-canvas, #f3f3f5)',
    )
    // Flat surface: the artboard should read on its own, without a dot grid.
    expect(surface?.style.backgroundImage).toBe('')
  })

  it('recovers a collapsed page and keeps repeated resizes aligned', async () => {
    const document = createCanvasDocument('Page resize fixture', 'page-resize')
    document.nodes.page = createPageNode('Home', {
      id: 'page',
      // An older resize bug could persist the 1px clamp while leaving the
      // Page's actual viewport intact.
      layout: { ...defaultLayout(1, 900), x: 0, y: 0 },
      viewport: { width: 800, minHeight: 900 },
    })
    const engine = new CanvasEngine(document)
    const view = render(
      <CanvasProvider engine={engine}>
        <SelectNode id="page" />
        <CanvasSurface
          pageWidth={1_440}
          initialCamera={{ x: 0, y: 0, zoom: 1 }}
        />
      </CanvasProvider>,
    )
    const page = view.container.querySelector<HTMLElement>(
      '[data-loora-node="page"]',
    )!
    expect(page.style.width).toBe('800px')

    const resizeEast = async (
      renderedWidth: number,
      nextPointerX: number,
      expectedWidth: number,
    ) => {
      stubRect(page, { width: renderedWidth, height: 900 })
      const handle = await waitFor(() =>
        view.getByRole('button', { name: 'Resize e' }),
      )
      handle.setPointerCapture = () => undefined
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        clientX: renderedWidth,
        clientY: 450,
      })
      fireEvent.pointerMove(window, {
        pointerId: 1,
        clientX: nextPointerX,
        clientY: 450,
      })
      fireEvent.pointerUp(window, {
        pointerId: 1,
        clientX: nextPointerX,
        clientY: 450,
      })
      await waitFor(() => expect(page.style.width).toBe(`${expectedWidth}px`))
      expect(engine.getNode('page')?.layout.width).toEqual({
        unit: 'px',
        value: expectedWidth,
      })
      expect(engine.getNode('page')).toMatchObject({
        viewport: { width: expectedWidth, minHeight: 900 },
      })
    }

    await resizeEast(800, 600, 600)
    await resizeEast(600, 500, 500)
  })

  it('selects top-level layers, drills into frames, and deep-selects descendants', async () => {
    const view = render(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <SelectionProbe />
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    surface.setPointerCapture = () => undefined
    const page = view.container.querySelector<HTMLElement>(
      '[data-loora-node="page"]',
    )!
    const frame = view.container.querySelector<HTMLElement>(
      '[data-loora-node="frame"]',
    )!
    const text = view.container.querySelector<HTMLElement>(
      '[data-loora-node="text"]',
    )!
    const originalElementsFromPoint = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [text, frame, page],
    })
    try {
      // A first click picks the Page's top-level layer, not the Page. Returning
      // the Page here left everything inside it unclickable.
      fireEvent.pointerDown(surface, { button: 0, clientX: 40, clientY: 40 })
      expect(view.getByTestId('selection').textContent).toBe(':frame')
      expect(
        view.container.querySelectorAll('[data-loora-viewport-overlay]'),
      ).toHaveLength(1)
      expect(
        view.container.querySelector(
          '[data-loora-viewport-overlay] [data-loora-marquee]',
        ),
      ).not.toBeNull()
      expect(
        view.container.querySelectorAll(
          '[data-loora-viewport-overlay] [data-loora-guide]',
        ),
      ).toHaveLength(2)

      // Pressing again inside the current selection keeps it, so a drag moves
      // the frame; releasing without moving drills one level in.
      fireEvent.pointerDown(surface, { button: 0, clientX: 40, clientY: 40 })
      expect(view.getByTestId('selection').textContent).toBe(':frame')
      fireEvent.pointerUp(surface, { button: 0, clientX: 40, clientY: 40 })
      expect(view.getByTestId('selection').textContent).toBe(':text')

      // A press that turns into a drag leaves the selection where it was.
      fireEvent.pointerDown(surface, { button: 0, clientX: 40, clientY: 40 })
      fireEvent.pointerUp(surface, { button: 0, clientX: 140, clientY: 40 })
      expect(view.getByTestId('selection').textContent).toBe(':text')

      fireEvent.doubleClick(page)
      fireEvent.pointerDown(surface, { button: 0, clientX: 40, clientY: 40 })
      expect(view.getByTestId('selection').textContent).toBe(':frame')

      // Only a hit whose whole ancestry is the Page itself selects the Page.
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: () => [page],
      })
      fireEvent.keyDown(window, { key: 'Escape' })
      fireEvent.pointerDown(surface, { button: 0, clientX: 40, clientY: 40 })
      expect(view.getByTestId('selection').textContent).toBe(':page')
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: () => [text, frame, page],
      })

      fireEvent.doubleClick(frame)
      fireEvent.pointerDown(surface, { button: 0, clientX: 40, clientY: 40 })
      expect(view.getByTestId('selection').textContent).toBe(':text')

      fireEvent.keyDown(window, { key: 'Escape' })
      fireEvent.pointerDown(surface, {
        button: 0,
        clientX: 40,
        clientY: 40,
        metaKey: true,
      })
      expect(view.getByTestId('selection').textContent).toBe(':text')
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      })
    }
  })

  it('renders nested real DOM and nudges the selected node transactionally', async () => {
    const engine = new CanvasEngine(fixture())
    const view = render(
      <CanvasProvider engine={engine}>
        <SelectNode id="frame" />
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    await waitFor(() =>
      expect(view.container.querySelector('[data-loora-node="text"]')).not.toBeNull(),
    )
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(engine.getNode('frame')?.layout.x).toBe(1)
    fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true })
    expect(engine.getNode('frame')?.layout.y).toBe(10)
  })

  it('draws where a reorder would land, and refuses the slot it came from', async () => {
    const document = createCanvasDocument('Drop line fixture', 'drop-line')
    document.nodes.page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(1_440, 900), mode: 'flex', direction: 'column' },
    })
    for (const [index, id] of ['first', 'second', 'third'].entries()) {
      document.nodes[id] = createFrameNode(id, {
        id,
        parentId: 'page',
        order: (index + 1) * 1_024,
        layout: { ...defaultLayout(), position: 'flow' },
      })
    }
    const engine = new CanvasEngine(document)
    const view = render(
      <CanvasProvider engine={engine}>
        <CanvasSurface pageWidth={1_440} initialCamera={{ x: 0, y: 0, zoom: 1 }} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    surface.setPointerCapture = () => undefined
    const element = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-loora-node="${id}"]`)!
    stubRect(element('page'), { left: 0, top: 0, width: 400, height: 300 })
    stubRect(element('first'), { left: 0, top: 0, width: 400, height: 100 })
    stubRect(element('second'), { left: 0, top: 100, width: 400, height: 100 })
    stubRect(element('third'), { left: 0, top: 200, width: 400, height: 100 })
    const dropLine = view.container.querySelector<SVGLineElement>(
      '[data-loora-drop-line]',
    )!

    withHits([element('first'), element('page')], () => {
      fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 50 })
      fireEvent.pointerMove(surface, { button: 0, clientX: 20, clientY: 260 })
    })
    // Past the middle of the last sibling, so the line sits under it.
    await waitFor(() => expect(dropLine.style.display).toBe('block'))
    expect(dropLine.getAttribute('y1')).toBe('300')

    withHits([element('first'), element('page')], () => {
      fireEvent.pointerMove(surface, { button: 0, clientX: 20, clientY: 40 })
    })
    // Back in its own slot: nothing would change, and the drag says so.
    await waitFor(() => expect(dropLine.style.display).toBe('none'))
    expect(surface.style.cursor).toBe('not-allowed')

    withHits([element('first'), element('page')], () => {
      fireEvent.pointerUp(surface, { button: 0, clientX: 20, clientY: 40 })
    })
    expect(surface.style.cursor).toBe('')
  })

  it('detaches a flow child from its arranging parent when the drop is modified', () => {
    const document = createCanvasDocument('Detach fixture', 'detach')
    document.nodes.page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(400, 600), mode: 'flex', direction: 'column' },
    })
    // The only child of an arranging parent: a plain drag can only reorder it,
    // and there is nothing to reorder it against.
    document.nodes.card = createFrameNode('Card', {
      id: 'card',
      parentId: 'page',
      order: 1_024,
      layout: { ...defaultLayout(), position: 'flow' },
    })
    const engine = new CanvasEngine(document)
    const view = render(
      <CanvasProvider engine={engine}>
        <CanvasSurface pageWidth={400} initialCamera={{ x: 0, y: 0, zoom: 1 }} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    surface.setPointerCapture = () => undefined
    const element = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-loora-node="${id}"]`)!
    stubRect(element('page'), { left: 100, top: 100, width: 400, height: 600 })
    stubRect(element('card'), { left: 100, top: 100, width: 400, height: 200 })

    withHits([element('card'), element('page')], () => {
      fireEvent.pointerDown(surface, { button: 0, clientX: 150, clientY: 150 })
      fireEvent.pointerMove(surface, { button: 0, clientX: 200, clientY: 190 })
      fireEvent.pointerUp(surface, { button: 0, clientX: 200, clientY: 190 })
    })
    expect(engine.getNode('card')?.layout.position).toBe('flow')

    withHits([element('card'), element('page')], () => {
      fireEvent.pointerDown(surface, { button: 0, clientX: 150, clientY: 150 })
      fireEvent.pointerMove(surface, {
        button: 0,
        clientX: 200,
        clientY: 190,
        metaKey: true,
      })
      fireEvent.pointerUp(surface, {
        button: 0,
        clientX: 200,
        clientY: 190,
        metaKey: true,
      })
    })
    expect(engine.getNode('card')?.layout).toMatchObject({
      position: 'absolute',
      x: 50,
      y: 40,
    })
  })

  it('reorders a flow child inside an arranging parent instead of ejecting it', () => {
    const document = createCanvasDocument('Drag fixture', 'drag')
    document.nodes.page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(1_440, 900), mode: 'flex', direction: 'column' },
    })
    for (const [index, id] of ['first', 'second', 'third'].entries()) {
      document.nodes[id] = createFrameNode(id, {
        id,
        parentId: 'page',
        order: (index + 1) * 1_024,
        layout: { ...defaultLayout(), position: 'flow' },
      })
    }
    const engine = new CanvasEngine(document)
    const view = render(
      <CanvasProvider engine={engine}>
        <CanvasSurface pageWidth={1_440} initialCamera={{ x: 0, y: 0, zoom: 1 }} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    surface.setPointerCapture = () => undefined
    const element = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-loora-node="${id}"]`)!
    stubRect(element('first'), { top: 0, height: 100 })
    stubRect(element('second'), { top: 100, height: 100 })
    stubRect(element('third'), { top: 200, height: 100 })

    withHits([element('first'), element('page')], () => {
      fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 50 })
      fireEvent.pointerMove(surface, { button: 0, clientX: 20, clientY: 260 })
      fireEvent.pointerUp(surface, { button: 0, clientX: 20, clientY: 260 })
    })

    // Dropped past the middle of the last sibling, so it sorts to the end and
    // stays in flow rather than being pinned to the parent's origin.
    expect(engine.getNode('first')?.layout.position).toBe('flow')
    expect(engine.getNode('first')!.order).toBeGreaterThan(engine.getNode('third')!.order)
  })

  it('places a flow child dropped in a free parent at the box it was rendered in', () => {
    const document = createCanvasDocument('Drag fixture', 'drag-free')
    document.nodes.page = createPageNode('Home', { id: 'page' })
    document.nodes.card = createFrameNode('Card', {
      id: 'card',
      parentId: 'page',
      order: 1_024,
      layout: { ...defaultLayout(), position: 'flow' },
    })
    const engine = new CanvasEngine(document)
    const view = render(
      <CanvasProvider engine={engine}>
        <CanvasSurface pageWidth={1_440} initialCamera={{ x: 0, y: 0, zoom: 1 }} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    surface.setPointerCapture = () => undefined
    const element = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-loora-node="${id}"]`)!
    stubRect(element('page'), { left: 100, top: 100, width: 1_440, height: 900 })
    stubRect(element('card'), { left: 140, top: 260, width: 320, height: 200 })

    withHits([element('card'), element('page')], () => {
      fireEvent.pointerDown(surface, { button: 0, clientX: 150, clientY: 270 })
      fireEvent.pointerMove(surface, { button: 0, clientX: 200, clientY: 300 })
      fireEvent.pointerUp(surface, { button: 0, clientX: 200, clientY: 300 })
    })

    // Rendered at (40, 160) inside the page, dragged by (50, 30). Reading the
    // stored x/y instead teleported it to the parent's corner.
    expect(engine.getNode('card')?.layout).toMatchObject({
      position: 'absolute',
      x: 90,
      y: 190,
    })
  })

  it('keeps an absolute child inside a clipped parent and guides it to the walls', async () => {
    const document = createCanvasDocument('Contained drag fixture', 'contained-drag')
    document.nodes.page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(800, 600), x: 0, y: 0 },
      viewport: { width: 800, minHeight: 600 },
    })
    document.nodes.card = createFrameNode('Card', {
      id: 'card',
      parentId: 'page',
      order: 1_024,
      layout: {
        ...defaultLayout(200, 100),
        position: 'absolute',
        x: 100,
        y: 100,
      },
    })
    const engine = new CanvasEngine(document)
    const view = render(
      <CanvasProvider engine={engine}>
        <CanvasSurface
          pageWidth={800}
          initialCamera={{ x: 0, y: 0, zoom: 1 }}
        />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    surface.setPointerCapture = () => undefined
    const page = view.container.querySelector<HTMLElement>(
      '[data-loora-node="page"]',
    )!
    const card = view.container.querySelector<HTMLElement>(
      '[data-loora-node="card"]',
    )!
    stubRect(page, { left: 100, top: 100, width: 800, height: 600 })
    stubRect(card, { left: 200, top: 200, width: 200, height: 100 })

    withHits([card, page], () => {
      fireEvent.pointerDown(surface, {
        button: 0,
        clientX: 250,
        clientY: 250,
      })
      fireEvent.pointerMove(surface, {
        button: 0,
        clientX: 2_000,
        clientY: 2_000,
      })
    })

    const verticalGuide = view.container.querySelector<SVGLineElement>(
      '[data-loora-guide="vertical"]',
    )!
    const horizontalGuide = view.container.querySelector<SVGLineElement>(
      '[data-loora-guide="horizontal"]',
    )!
    await waitFor(() => {
      expect(verticalGuide.style.display).toBe('block')
      expect(horizontalGuide.style.display).toBe('block')
    })
    expect(verticalGuide.getAttribute('x1')).toBe('900')
    expect(horizontalGuide.getAttribute('y1')).toBe('700')

    withHits([card, page], () => {
      fireEvent.pointerUp(surface, {
        button: 0,
        clientX: 2_000,
        clientY: 2_000,
      })
    })
    expect(engine.getNode('card')?.layout).toMatchObject({
      position: 'absolute',
      x: 600,
      y: 500,
    })
    expect(verticalGuide.style.display).toBe('none')
    expect(horizontalGuide.style.display).toBe('none')
  })

  it('still moves a child that is larger than its clipped parent', () => {
    const document = createCanvasDocument('Oversized drag fixture', 'oversized-drag')
    document.nodes.page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(800, 600), x: 0, y: 0 },
      viewport: { width: 800, minHeight: 600 },
    })
    // Wider and taller than the page, which is what a full-bleed section or an
    // imported snapshot usually looks like.
    document.nodes.card = createFrameNode('Card', {
      id: 'card',
      parentId: 'page',
      order: 1_024,
      layout: {
        ...defaultLayout(900, 700),
        position: 'absolute',
        x: 0,
        y: 0,
      },
    })
    const engine = new CanvasEngine(document)
    const view = render(
      <CanvasProvider engine={engine}>
        <CanvasSurface pageWidth={800} initialCamera={{ x: 0, y: 0, zoom: 1 }} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    surface.setPointerCapture = () => undefined
    const page = view.container.querySelector<HTMLElement>(
      '[data-loora-node="page"]',
    )!
    const card = view.container.querySelector<HTMLElement>(
      '[data-loora-node="card"]',
    )!
    stubRect(page, { left: 100, top: 100, width: 800, height: 600 })
    stubRect(card, { left: 100, top: 100, width: 900, height: 700 })

    withHits([card, page], () => {
      fireEvent.pointerDown(surface, { button: 0, clientX: 150, clientY: 150 })
      fireEvent.pointerMove(surface, { button: 0, clientX: 200, clientY: 190 })
      fireEvent.pointerUp(surface, { button: 0, clientX: 200, clientY: 190 })
    })

    // Containment used to invert here and clamp the drag to zero, so the node
    // sprang back to where it was picked up.
    expect(engine.getNode('card')?.layout).toMatchObject({
      position: 'absolute',
      x: 50,
      y: 40,
    })
  })

  it('resolves where an outside drop lands, in flow and in free space', () => {
    const document = createCanvasDocument('Drop fixture', 'drop')
    document.nodes.page = createPageNode('Home', {
      id: 'page',
      layout: { ...defaultLayout(1_440, 900), x: 0, y: 0 },
    })
    document.nodes.stack = createFrameNode('Stack', {
      id: 'stack',
      parentId: 'page',
      order: 1_024,
      layout: {
        ...defaultLayout(),
        position: 'flow',
        mode: 'flex',
        direction: 'column',
      },
    })
    document.nodes.first = createFrameNode('First', {
      id: 'first',
      parentId: 'stack',
      order: 1_024,
      layout: { ...defaultLayout(), position: 'flow' },
    })
    document.nodes.second = createFrameNode('Second', {
      id: 'second',
      parentId: 'stack',
      order: 2_048,
      layout: { ...defaultLayout(), position: 'flow' },
    })
    const engine = new CanvasEngine(document)
    const drops: unknown[] = []
    const view = render(
      <CanvasProvider engine={engine}>
        <CanvasSurface
          pageWidth={1_440}
          initialCamera={{ x: 0, y: 0, zoom: 1 }}
          acceptsDrop={() => true}
          onDrop={(_event, placement) => drops.push(placement)}
        />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    const element = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-loora-node="${id}"]`)!
    stubRect(element('page'), { left: 0, top: 0, width: 1_440, height: 900 })
    stubRect(element('first'), { top: 0, height: 100 })
    stubRect(element('second'), { top: 100, height: 100 })

    // Between the children of an arranging parent: an order in that gap.
    withHits([element('stack'), element('page')], () => {
      dropAt(surface, 20, 150)
    })
    expect(drops.at(-1)).toMatchObject({
      parentId: 'stack',
      position: 'flow',
      order: 1_536,
    })

    // Onto a child that can hold children: inside it, at the point it landed.
    withHits([element('second'), element('stack'), element('page')], () => {
      dropAt(surface, 20, 150)
    })
    expect(drops.at(-1)).toMatchObject({
      parentId: 'second',
      position: 'absolute',
      x: 20,
      y: 50,
    })

    // Over a free parent: the point inside it, in document units.
    withHits([element('page')], () => {
      dropAt(surface, 240, 320)
    })
    expect(drops.at(-1)).toMatchObject({
      parentId: 'page',
      position: 'absolute',
      x: 240,
      y: 320,
    })
  })

  it('commits plaintext editing once on blur and keeps undo available', async () => {
    const engine = new CanvasEngine(fixture())
    const view = render(
      <CanvasProvider engine={engine}>
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    const text = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        '[data-loora-node="text"]',
      )
      expect(element).not.toBeNull()
      return element!
    })
    fireEvent.doubleClick(text)
    expect(text.getAttribute('contenteditable')).toBe('plaintext-only')
    text.innerText = 'Edited'
    fireEvent.blur(text)
    expect(engine.getNode('text')).toMatchObject({
      type: 'text',
      text: 'Edited',
      runs: [],
    })
    expect(engine.canUndo).toBe(true)
  })

  it('renames a layer from its selection label', async () => {
    const engine = new CanvasEngine(fixture())
    const view = render(
      <CanvasProvider engine={engine}>
        <SelectNode id="frame" />
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    const label = await waitFor(() => {
      const element = view.container.querySelector<SVGGElement>(
        '[data-loora-selection-label]',
      )
      expect(element).not.toBeNull()
      return element!
    })

    fireEvent.doubleClick(label)
    const field = view.getByLabelText('Layer name') as HTMLInputElement
    expect(field.value).toBe('Card')

    fireEvent.change(field, { target: { value: 'Deployment card' } })
    fireEvent.blur(field)
    expect(engine.getNode('frame')?.name).toBe('Deployment card')

    // Escape leaves the name alone.
    fireEvent.doubleClick(label)
    const reopened = view.getByLabelText('Layer name') as HTMLInputElement
    fireEvent.change(reopened, { target: { value: 'Discarded' } })
    fireEvent.keyDown(reopened, { key: 'Escape' })
    expect(engine.getNode('frame')?.name).toBe('Deployment card')
  })

  it('edits text when pointer capture retargets the double click to the surface', () => {
    const engine = new CanvasEngine(fixture())
    const view = render(
      <CanvasProvider engine={engine}>
        <SelectionProbe />
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    const text = view.container.querySelector<HTMLElement>(
      '[data-loora-node="text"]',
    )!

    withHits([text], () => {
      fireEvent.doubleClick(surface, { clientX: 40, clientY: 40 })
    })

    expect(text.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(view.getByTestId('selection').textContent).toBe(':text')
  })

  it('owns ctrl-wheel so browser zoom cannot take over', async () => {
    const view = render(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    const surface = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-surface]',
    )!
    const scene = view.container.querySelector<HTMLElement>(
      '[data-loora-canvas-scene]',
    )!
    stubRect(surface, { left: 0, top: 0, width: 1_000, height: 700 })
    const before = scene.style.transform
    const event = new MouseEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 500,
      clientY: 350,
      ctrlKey: true,
    })
    Object.defineProperties(event, {
      deltaX: { value: 0 },
      deltaY: { value: -120 },
    })

    expect(surface.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(scene.style.transform).not.toBe(before))
  })

  it('clears stale selection when undo removes the selected node', () => {
    const view = render(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <SelectionProbe />
        <InsertUndoProbe />
      </CanvasProvider>,
    )
    fireEvent.click(view.getByRole('button', { name: 'Insert temporary' }))
    expect(view.getByTestId('selection').textContent).toBe(':temporary')
    fireEvent.click(view.getByRole('button', { name: 'Undo temporary' }))
    expect(view.getByTestId('selection').textContent).toBe('')
  })

  it('resolves a named component variant inside an instance', async () => {
    const document = fixture()
    document.nodes.component = createComponentNode('Button', {
      id: 'component',
      order: 2_048,
      variants: ['default', 'hover'],
      defaultVariant: 'default',
      variantOverrides: {
        hover: {
          component: {
            style: {
              fills: [{ type: 'solid', color: '#ff0000' }],
            },
          },
          label: { text: 'Hovered' },
        },
      },
    })
    document.nodes.label = createTextNode('Default', {
      id: 'label',
      parentId: 'component',
      order: 1_024,
    })
    document.nodes.instance = createInstanceNode(
      'component',
      'Button instance',
      {
        id: 'instance',
        parentId: 'frame',
        order: 2_048,
        variant: 'hover',
      },
    )
    const view = render(
      <CanvasProvider engine={new CanvasEngine(document)}>
        <CanvasSurface pageWidth={1_440} />
      </CanvasProvider>,
    )
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-loora-node="label"]')?.textContent,
      ).toBe('Hovered'),
    )
    const componentRoot = view.container.querySelector<HTMLElement>(
      '[data-loora-node="component"][data-loora-instance-path="instance"]',
    )
    expect(componentRoot?.style.background).toBe('rgb(255, 0, 0)')
  })
  it('repositions the selection overlay when the camera moves', async () => {
    const controls = { current: null as CanvasSurfaceControls | null }
    const view = render(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <SelectNode id="frame" />
        <CanvasSurface controlsRef={controls} />
      </CanvasProvider>,
    )
    const outline = await waitFor(() => {
      const node = view.container.querySelector<SVGRectElement>(
        '[data-loora-selection-overlay] rect',
      )
      if (!node) throw new Error('No selection overlay')
      return node
    })
    // JSDOM reports zero-sized rects, so the overlay sits exactly on the
    // camera origin. That makes the camera offset the thing under test.
    expect(outline.getAttribute('x')).toBe('80')

    controls.current?.zoomIn()
    const camera = controls.current?.getCamera()
    expect(camera?.x).not.toBe(80)
    expect(outline.getAttribute('x')).toBe(String(camera?.x))
  })
})
