import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ProductTour, type TourStep } from './product-tour'

function anchor(name: string, rect: Partial<DOMRect>) {
  const element = document.createElement('div')
  element.dataset.tour = name
  element.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      width: 120,
      height: 40,
      right: 120,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect
  document.body.append(element)
  return element
}

/** The tour measures on animation frames; let a few pass. */
async function settle() {
  for (let index = 0; index < 3; index += 1) {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
  }
}

const steps: TourStep[] = [
  { id: 'canvas', title: 'The canvas', body: 'Everything is a node.' },
  { id: 'tools', title: 'Add something', body: 'Frames and text.', target: 'tools' },
  {
    id: 'branches',
    title: 'Branch it',
    body: 'Main stays put.',
    target: 'branches',
    required: true,
  },
]

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('ProductTour', () => {
  test('walks the steps and reports the run as finished on the last one', async () => {
    anchor('tools', { top: 200, left: 300, width: 200, height: 44 })
    anchor('branches', { top: 8, left: 400, width: 90, height: 24 })
    const onFinish = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ProductTour
        steps={steps}
        open
        onOpenChange={onOpenChange}
        onFinish={onFinish}
      />,
    )
    await settle()

    expect(screen.getByText('The canvas')).toBeTruthy()
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    // Nothing to go back to yet.
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()
    expect(screen.getByText('Add something')).toBeTruthy()
    expect(screen.getByText('Step 2 of 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await settle()
    expect(screen.getByText('The canvas')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()
    expect(screen.getByText('Branch it')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  test('drops a required step whose anchor is not on screen', async () => {
    anchor('tools', { top: 200, left: 300, width: 200, height: 44 })
    render(
      <ProductTour steps={steps} open onOpenChange={() => {}} />,
    )
    await settle()

    // The branch step needs an anchor that does not exist here.
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()
    expect(screen.getByText('Add something')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  })

  test('runs a step opener as the step arrives', async () => {
    const ensure = vi.fn()
    render(
      <ProductTour
        steps={[
          steps[0]!,
          { id: 'panel', title: 'Panel', body: 'Opens itself.', ensure },
        ]}
        open
        onOpenChange={() => {}}
      />,
    )
    await settle()
    expect(ensure).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()
    expect(ensure).toHaveBeenCalled()
  })

  test('escape leaves the tour, and the editor never sees the key', async () => {
    const onOpenChange = vi.fn()
    const editorShortcut = vi.fn()
    window.addEventListener('keydown', editorShortcut)
    render(<ProductTour steps={steps} open onOpenChange={onOpenChange} />)
    await settle()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(editorShortcut).not.toHaveBeenCalled()
    window.removeEventListener('keydown', editorShortcut)
  })

  test('renders nothing while closed', () => {
    render(<ProductTour steps={steps} open={false} onOpenChange={() => {}} />)
    expect(screen.queryByText('The canvas')).toBeNull()
  })

  test('resumes at the step it was left on', async () => {
    render(
      <ProductTour
        steps={[steps[0]!, steps[1]!]}
        open
        initialIndex={1}
        onOpenChange={() => {}}
      />,
    )
    await settle()
    expect(screen.getByText('Add something')).toBeTruthy()
    expect(screen.getByText('Step 2 of 2')).toBeTruthy()
  })

  test('clamps a resume index past the end of the run', async () => {
    render(
      <ProductTour
        steps={[steps[0]!, steps[1]!]}
        open
        initialIndex={9}
        onOpenChange={() => {}}
      />,
    )
    await settle()
    expect(screen.getByText('Step 2 of 2')).toBeTruthy()
  })

  test('reports each step so the run can be picked up later', async () => {
    const onIndexChange = vi.fn()
    render(
      <ProductTour
        steps={[steps[0]!, steps[1]!]}
        open
        onOpenChange={() => {}}
        onIndexChange={onIndexChange}
      />,
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onIndexChange).toHaveBeenCalledWith(1)
  })
})

describe('ProductTour interactive steps', () => {
  const hands: TourStep[] = [
    { id: 'canvas', title: 'The canvas', body: 'Everything is a node.' },
    {
      id: 'tools',
      title: 'Add something',
      body: 'Draw a rectangle.',
      target: 'tools',
      waitFor: { hint: 'Press R and drag.', done: () => done },
    },
    { id: 'done', title: 'Nice', body: 'That is a node.' },
  ]
  let done = false

  afterEach(() => {
    done = false
  })

  test('waits for the reader, then advances on its own', async () => {
    anchor('tools', { top: 400, left: 300, width: 200, height: 44 })
    render(<ProductTour steps={hands} open onOpenChange={() => {}} />)
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()
    expect(screen.getByText('Press R and drag.')).toBeTruthy()
    // Nothing has happened yet, so the step is still up.
    expect(screen.getByText('Add something')).toBeTruthy()
    // The way forward is doing it, not clicking through it.
    expect(screen.getByRole('button', { name: 'Skip this' })).toBeTruthy()

    done = true
    await settle()
    expect(screen.getByText('Nice')).toBeTruthy()
  })

  test('lets the editor keep its keys while a step waits', async () => {
    anchor('tools', { top: 400, left: 300, width: 200, height: 44 })
    const editorShortcut = vi.fn()
    window.addEventListener('keydown', editorShortcut)
    render(<ProductTour steps={hands} open onOpenChange={() => {}} />)
    await settle()

    // On a normal step the tour swallows the key.
    fireEvent.keyDown(document.body, { key: 'r' })
    expect(editorShortcut).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()
    fireEvent.keyDown(document.body, { key: 'r' })
    expect(editorShortcut).toHaveBeenCalledTimes(1)

    window.removeEventListener('keydown', editorShortcut)
  })

  test('a waiting step can still be stepped past by hand', async () => {
    anchor('tools', { top: 400, left: 300, width: 200, height: 44 })
    render(<ProductTour steps={hands} open onOpenChange={() => {}} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Skip this' }))
    await settle()
    expect(screen.getByText('Nice')).toBeTruthy()
  })
})
