import { describe, expect, test } from 'vitest'
import {
  createCanvasDocument,
  createComponentNode,
  createFrameNode,
  createInstanceNode,
  createPageNode,
  defaultLayout,
} from '@loora/canvas/model'
import { containingPageForRef, placeHtmlImport } from './canvas-html-paste'

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

  test('only treats selections within a page as an active page', () => {
    const document = createCanvasDocument('Current', 'current')
    const page = createPageNode('Page', { id: 'page' })
    const pageChild = createFrameNode('Page child', {
      id: 'page-child',
      parentId: page.id,
    })
    const component = createComponentNode('Component', { id: 'component' })
    const componentChild = createFrameNode('Component child', {
      id: 'component-child',
      parentId: component.id,
    })
    const instance = createInstanceNode(component.id, 'Instance', {
      id: 'instance',
      parentId: page.id,
    })
    document.nodes[page.id] = page
    document.nodes[pageChild.id] = pageChild
    document.nodes[component.id] = component
    document.nodes[componentChild.id] = componentChild
    document.nodes[instance.id] = instance

    expect(
      containingPageForRef(document, {
        nodeId: pageChild.id,
        instancePath: [],
      })?.id,
    ).toBe(page.id)
    expect(
      containingPageForRef(document, {
        nodeId: componentChild.id,
        instancePath: [instance.id],
      })?.id,
    ).toBe(page.id)
    expect(
      containingPageForRef(document, {
        nodeId: componentChild.id,
        instancePath: [],
      }),
    ).toBeNull()
    expect(containingPageForRef(document)).toBeNull()
  })
})
