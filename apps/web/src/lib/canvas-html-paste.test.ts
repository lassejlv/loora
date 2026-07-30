import { describe, expect, test } from 'bun:test'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  defaultLayout,
} from '@loora/canvas/model'
import { placeHtmlImport } from './canvas-html-paste'

describe('HTML clipboard paste', () => {
  test('places imported page contents into the current page', () => {
    const current = createCanvasDocument('Current', 'current')
    const page = createPageNode('Page', { id: 'page' })
    current.nodes[page.id] = page

    const imported = createCanvasDocument('Snapshot', 'snapshot')
    const importedPage = createPageNode('Imported', { id: 'imported-page' })
    const card = createFrameNode('Card', {
      id: 'card',
      parentId: importedPage.id,
      order: 1_024,
      layout: defaultLayout(300, 180, { x: 320, y: 240 }),
    })
    imported.nodes[importedPage.id] = importedPage
    imported.nodes[card.id] = card

    const placed = placeHtmlImport(current, imported, page.id)
    expect(placed.rootIds).toEqual(['card'])
    expect(placed.nodes[0]).toMatchObject({
      id: 'card',
      parentId: 'page',
      layout: { position: 'absolute', x: 48, y: 48 },
    })
  })
})
