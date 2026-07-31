import { describe, expect, test } from 'bun:test'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  type CanvasDocument,
} from '@loora/canvas/model'
import {
  dragRoots,
  dropPositionFor,
  resolveDrop,
} from './layers-panel'

/**
 * page
 *   header (frame)
 *     title (text)
 *   body (frame)
 *   footer (frame)
 * second (page)
 */
function fixture(): CanvasDocument {
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
    expect(resolveDrop(document, ['footer'], 'body', 'before')).toEqual({
      parentId: 'page',
      moves: [{ id: 'footer', order: 1_536 }],
    })
    expect(resolveDrop(document, ['header'], 'footer', 'after')).toEqual({
      parentId: 'page',
      moves: [{ id: 'header', order: 4_096 }],
    })
  })

  test('drops into a container after its last child', () => {
    const document = fixture()
    expect(resolveDrop(document, ['footer'], 'header', 'inside')).toEqual({
      parentId: 'header',
      moves: [{ id: 'footer', order: 2_048 }],
    })
  })

  test('refuses a move into the dragged node or its own subtree', () => {
    const document = fixture()
    expect(resolveDrop(document, ['header'], 'header', 'inside')).toBeNull()
    expect(resolveDrop(document, ['header'], 'title', 'before')).toBeNull()
  })

  test('refuses a drop inside something that cannot hold children', () => {
    const document = fixture()
    expect(resolveDrop(document, ['body'], 'title', 'inside')).toBeNull()
  })

  test('keeps pages at the document root and everything else off it', () => {
    const document = fixture()
    expect(resolveDrop(document, ['page'], 'body', 'inside')).toBeNull()
    expect(resolveDrop(document, ['page'], 'second', 'after')).toEqual({
      parentId: null,
      moves: [{ id: 'page', order: 3_072 }],
    })
    expect(resolveDrop(document, ['body'], 'second', 'before')).toBeNull()
  })

  test('ignores a drag that lands back where it started', () => {
    const document = fixture()
    expect(resolveDrop(document, ['body'], 'header', 'after')).toBeNull()
    expect(resolveDrop(document, ['body'], 'footer', 'before')).toBeNull()
  })

  test('refuses to move a locked layer', () => {
    const document = fixture()
    document.nodes.body = { ...document.nodes.body!, locked: true }
    expect(resolveDrop(document, ['body'], 'header', 'before')).toBeNull()
  })
})

describe('multi-layer drops', () => {
  test('drops only the roots of a selection, never a child twice', () => {
    const document = fixture()
    expect(dragRoots(document, ['header', 'title', 'body'])).toEqual([
      'header',
      'body',
    ])
  })

  test('spreads the group through the gap in document order', () => {
    const document = fixture()
    const plan = resolveDrop(document, ['footer', 'header'], 'body', 'before')!

    expect(plan.parentId).toBe('page')
    // header (1024) stays ahead of footer (3072), both between header's old slot
    // and body.
    expect(plan.moves.map((move) => move.id)).toEqual(['header', 'footer'])
    expect(plan.moves[0]!.order).toBeLessThan(plan.moves[1]!.order)
    expect(plan.moves[1]!.order).toBeLessThan(document.nodes.body!.order)
  })

  test('moves a whole group into a container', () => {
    const document = fixture()
    const plan = resolveDrop(document, ['body', 'footer'], 'header', 'inside')!

    expect(plan.parentId).toBe('header')
    expect(plan.moves.map((move) => move.id)).toEqual(['body', 'footer'])
    expect(plan.moves.every((move) => move.order > document.nodes.title!.order)).toBe(true)
  })

  test('refuses a group that would land inside one of its own members', () => {
    const document = fixture()
    expect(resolveDrop(document, ['header', 'body'], 'header', 'inside')).toBeNull()
    expect(resolveDrop(document, ['header', 'body'], 'title', 'after')).toBeNull()
  })

  test('refuses a group that mixes roots with nested layers', () => {
    const document = fixture()
    // A Page belongs at the root and a frame does not, so no parent takes both.
    expect(resolveDrop(document, ['second', 'body'], 'page', 'after')).toBeNull()
    expect(resolveDrop(document, ['second', 'body'], 'header', 'inside')).toBeNull()
  })

  test('drops a selected parent without its selected child', () => {
    const document = fixture()
    const plan = resolveDrop(document, ['page', 'body'], 'second', 'after')!

    expect(plan.moves.map((move) => move.id)).toEqual(['page'])
  })

  test('ignores a contiguous group dropped back on itself', () => {
    const document = fixture()
    expect(resolveDrop(document, ['header', 'body'], 'footer', 'before')).toBeNull()
  })
})
