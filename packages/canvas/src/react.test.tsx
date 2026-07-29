import { describe, expect, it } from 'bun:test'
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
