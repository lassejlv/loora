import { describe, expect, it } from 'bun:test'
import type { CanvasElement, CanvasPage } from './canvas'
import {
  createPageFromElements,
  duplicateCanvasPage,
  hasMissingPageElements,
  onlyCanvasPages,
  pageElements,
  pageHeight,
  removeElementReferences,
  reorderCanvasPages,
} from './pages'

const element = (
  id: string,
  patch: Partial<CanvasElement> = {},
): CanvasElement => ({
  id,
  name: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  code: `<section>${id}</section>`,
  ...patch,
})

const page: CanvasPage = {
  id: 'page',
  name: 'Home',
  x: 300,
  y: 0,
  w: 200,
  items: [
    { id: 'hero-item', elementId: 'hero', height: 200 },
    { id: 'footer-item', elementId: 'footer', height: 80 },
  ],
}

describe('Page compositions', () => {
  it('creates a vertical Page in canvas order and preserves block aspect ratios', () => {
    const created = createPageFromElements(
      [
        element('footer', { x: 10, y: 300, w: 200, h: 80 }),
        element('hero', { x: 10, y: 20, w: 100, h: 120 }),
      ],
      [{ ...page, name: 'Page 1' }],
    )

    expect(created?.name).toBe('Page 2')
    expect(created?.x).toBe(330)
    expect(created?.y).toBe(20)
    expect(created?.w).toBe(200)
    expect(created?.items.map(({ elementId, height }) => ({ elementId, height }))).toEqual([
      { elementId: 'hero', height: 240 },
      { elementId: 'footer', height: 80 },
    ])
  })

  it('keeps repeated references and resolves the latest source blocks', () => {
    const repeated = {
      ...page,
      items: [...page.items, { id: 'hero-again', elementId: 'hero', height: 120 }],
    }
    const sources = [element('hero'), element('footer')]

    expect(pageElements(repeated, sources).map(({ element }) => element?.id)).toEqual([
      'hero',
      'footer',
      'hero',
    ])
    expect(pageHeight(repeated)).toBe(400)
    expect(hasMissingPageElements(repeated, sources)).toBe(false)
  })

  it('preserves explicit agent ordering when requested', () => {
    const created = createPageFromElements(
      [element('footer', { y: 300 }), element('hero', { y: 0 })],
      [],
      true,
    )
    expect(created?.items.map(({ elementId }) => elementId)).toEqual(['footer', 'hero'])
  })

  it('duplicates Pages with fresh identities and stable source references', () => {
    const duplicate = duplicateCanvasPage(page, [page, { ...page, id: 'other', name: 'Home copy' }])

    expect(duplicate.name).toBe('Home copy 2')
    expect(duplicate.id).not.toBe(page.id)
    expect(duplicate.items.map((item) => item.elementId)).toEqual(
      page.items.map((item) => item.elementId),
    )
    expect(duplicate.items.every((item, index) => item.id !== page.items[index].id)).toBe(true)
  })

  it('reorders known Pages without dropping omitted Pages', () => {
    const second = { ...page, id: 'second', name: 'Second' }
    const third = { ...page, id: 'third', name: 'Third' }

    expect(reorderCanvasPages([page, second, third], ['third', 'missing', 'third']).map((p) => p.id))
      .toEqual(['third', 'page', 'second'])
  })

  it('detects hidden or missing blocks and removes deleted references', () => {
    const sources = [element('hero'), element('footer', { hidden: true })]
    expect(hasMissingPageElements(page, sources)).toBe(true)
    expect(removeElementReferences([page], new Set(['footer']))[0].items).toEqual([
      page.items[0],
    ])
  })

  it('rejects malformed cached Page records', () => {
    expect(onlyCanvasPages([page, { ...page, w: 0 }, { ...page, items: [{ height: 0 }] }])).toEqual([
      page,
    ])
  })
})
