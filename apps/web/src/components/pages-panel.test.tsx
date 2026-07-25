import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { PagesPanel } from './pages-panel'
import type { CanvasElement, CanvasPage } from '#/lib/canvas'

const elements: CanvasElement[] = [
  {
    id: 'hero',
    name: 'Hero',
    x: 0,
    y: 0,
    w: 400,
    h: 240,
    code: '<section>Hero</section>',
  },
  {
    id: 'footer',
    name: 'Footer',
    x: 0,
    y: 300,
    w: 400,
    h: 100,
    code: '<footer>Footer</footer>',
  },
]

const page: CanvasPage = {
  id: 'home',
  name: 'Home',
  x: 600,
  y: 0,
  w: 400,
  items: [{ id: 'hero-item', elementId: 'hero', height: 240 }],
}

function renderPanel({
  selectedElementIds = [],
  onUpdatePage = mock(),
}: {
  selectedElementIds?: string[]
  onUpdatePage?: ReturnType<typeof mock>
} = {}) {
  render(
    <PagesPanel
      pages={[page]}
      elements={elements}
      selectedPageId={page.id}
      selectedElementIds={selectedElementIds}
      designId="design"
      draftId="draft"
      onSelectPage={mock()}
      onCreatePage={mock()}
      onUpdatePage={onUpdatePage}
      onDeletePage={mock()}
      onDuplicatePage={mock()}
      onOpenPage={mock()}
    />,
  )
  return onUpdatePage
}

describe('PagesPanel', () => {
  afterEach(() => cleanup())

  it('adds selected reusable blocks at an aspect-ratio height', () => {
    const onUpdatePage = renderPanel({ selectedElementIds: ['footer'] })
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }))

    const [, patch] = onUpdatePage.mock.calls[0] as [string, Partial<CanvasPage>]
    expect(patch.items?.map(({ elementId, height }) => ({ elementId, height }))).toEqual([
      { elementId: 'hero', height: 240 },
      { elementId: 'footer', height: 100 },
    ])
  })

  it('commits a valid Page name on blur and restores an empty name', () => {
    const onUpdatePage = renderPanel()
    const input = screen.getByLabelText('Page name')

    fireEvent.change(input, { target: { value: '  Landing  ' } })
    fireEvent.blur(input)
    expect(onUpdatePage).toHaveBeenCalledWith('home', { name: 'Landing' })

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect((input as HTMLInputElement).value).toBe('Home')
    expect(onUpdatePage).toHaveBeenCalledTimes(1)
  })

  it('updates a section height without copying its source block', () => {
    const onUpdatePage = renderPanel()
    fireEvent.change(screen.getByLabelText('Hero height'), { target: { value: '320' } })

    expect(onUpdatePage).toHaveBeenCalledWith('home', {
      items: [{ ...page.items[0], height: 320 }],
    })
  })
})
