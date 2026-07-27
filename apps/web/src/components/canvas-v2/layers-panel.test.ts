import { describe, expect, test } from 'bun:test'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  type CanvasDocumentV2,
} from '@loora/canvas/model'
import {
  dropPositionFor,
  resolveDrop,
} from '#/components/canvas-v2/layers-panel'

/**
 * page
 *   header (frame)
 *     title (text)
 *   body (frame)
 *   footer (frame)
 * second (page)
 */
function fixture(): CanvasDocumentV2 {
  const document = createCanvasDocument('Layers fixture', 'layers')
  document.nodes.page = createPageNode('Home', { id: 'page', order: 1_024 })
  document.nodes.second = createPageNode('About', { id: 'second', order: 2_048 })
  document.nodes.header = createFrameNode('Header', {
    id: 'header',
    parentId: 'page',
    order: 1_024,
  })
  document.nodes.title = createTextNode('Title', {
    id: 'title',
    parentId: 'header',
    order: 1_024,
  })
  document.nodes.body = createFrameNode('Body', {
    id: 'body',
    parentId: 'page',
    order: 2_048,
  })
  document.nodes.footer = createFrameNode('Footer', {
    id: 'footer',
    parentId: 'page',
    order: 3_072,
  })
  return document
}

describe('dropPositionFor', () => {
  test('gives containers a middle band that means inside', () => {
    const document = fixture()
    expect(dropPositionFor(document.nodes.body!, 0.1)).toBe('before')
    expect(dropPositionFor(document.nodes.body!, 0.5)).toBe('inside')
    expect(dropPositionFor(document.nodes.body!, 0.9)).toBe('after')
  })

  test('leaves only reorder', () => {
    const document = fixture()
    expect(dropPositionFor(document.nodes.title!, 0.4)).toBe('before')
    expect(dropPositionFor(document.nodes.title!, 0.6)).toBe('after')
  })
})

describe('resolveDrop', () => {
  test('reorders between siblings with an order in the gap', () => {
    const document = fixture()
    expect(resolveDrop(document, 'footer', 'body', 'before')).toEqual({
      parentId: 'page',
      order: 1_536,
    })
    expect(resolveDrop(document, 'header', 'footer', 'after')).toEqual({
      parentId: 'page',
      order: 4_096,
    })
  })

  test('drops into a container after its last child', () => {
    const document = fixture()
    expect(resolveDrop(document, 'footer', 'header', 'inside')).toEqual({
      parentId: 'header',
      order: 2_048,
    })
  })

  test('refuses a move into the dragged node or its own subtree', () => {
    const document = fixture()
    expect(resolveDrop(document, 'header', 'header', 'inside')).toBeNull()
    expect(resolveDrop(document, 'header', 'title', 'before')).toBeNull()
  })

  test('refuses a drop inside something that cannot hold children', () => {
    const document = fixture()
    expect(resolveDrop(document, 'body', 'title', 'inside')).toBeNull()
  })

  test('keeps pages at the document root and everything else off it', () => {
    const document = fixture()
    expect(resolveDrop(document, 'page', 'body', 'inside')).toBeNull()
    expect(resolveDrop(document, 'page', 'second', 'after')).toEqual({
      parentId: null,
      order: 3_072,
    })
    expect(resolveDrop(document, 'body', 'second', 'before')).toBeNull()
  })

  test('ignores a drag that lands back where it started', () => {
    const document = fixture()
    expect(resolveDrop(document, 'body', 'header', 'after')).toBeNull()
    expect(resolveDrop(document, 'body', 'footer', 'before')).toBeNull()
  })

  test('refuses to move a locked layer', () => {
    const document = fixture()
    document.nodes.body = { ...document.nodes.body!, locked: true }
    expect(resolveDrop(document, 'body', 'header', 'before')).toBeNull()
  })
})
