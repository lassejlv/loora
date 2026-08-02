import { describe, expect, test } from 'vitest'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  type CanvasDocument,
} from '@loora/canvas/model'
import {
  CLIPBOARD_KIND,
  buildClipboardPayload,
  parseClipboardPayload,
  pasteNodes,
  validatePaste,
} from './canvas-clipboard'

function fixture(): CanvasDocument {
  const document = createCanvasDocument('Clipboard fixture', 'clipboard')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.card = createFrameNode('Card', {
    id: 'card',
    parentId: 'page',
    order: 1_024,
    layout: { ...defaultLayout(320, 200), position: 'absolute', x: 40, y: 60 },
  })
  document.nodes.label = createTextNode('Hello', {
    id: 'label',
    parentId: 'card',
    order: 1_024,
  })
  document.nodes.other = createFrameNode('Other', {
    id: 'other',
    parentId: 'page',
    order: 2_048,
  })
  return document
}

describe('canvas clipboard', () => {
  test('copies a whole subtree and skips ids already inside it', () => {
    const document = fixture()
    const payload = buildClipboardPayload(document, ['card', 'label'])!

    expect(payload.kind).toBe(CLIPBOARD_KIND)
    expect(payload.roots).toEqual(['card'])
    expect(Object.keys(payload.nodes).sort()).toEqual(['card', 'label'])
  })

  test('round-trips through the clipboard text', () => {
    const document = fixture()
    const payload = buildClipboardPayload(document, ['card'])!
    expect(parseClipboardPayload(JSON.stringify(payload))).toEqual(payload)
  })

  test('rejects text that is not a canvas payload', () => {
    expect(parseClipboardPayload('Just some copy')).toBeNull()
    expect(parseClipboardPayload('{"kind":"evil","roots":["a"]}')).toBeNull()
    expect(
      parseClipboardPayload(
        JSON.stringify({ kind: CLIPBOARD_KIND, schemaVersion: 2, roots: ['a'], nodes: {} }),
      ),
    ).toBeNull()
    expect(
      parseClipboardPayload(
        JSON.stringify({
          kind: CLIPBOARD_KIND,
          schemaVersion: 2,
          roots: ['a'],
          nodes: { a: { id: 'a', type: 'frame' } },
        }),
      ),
    ).toBeNull()
  })

  test('pastes with fresh ids, a nudge, and the target parent', () => {
    const document = fixture()
    const payload = buildClipboardPayload(document, ['card'])!
    const pasted = pasteNodes(document, payload, 'other')

    expect(pasted.nodes).toHaveLength(2)
    const [root, child] = pasted.nodes
    expect(root!.id).not.toBe('card')
    expect(root!.parentId).toBe('other')
    expect(root!.layout).toMatchObject({ x: 56, y: 76 })
    expect(child!.parentId).toBe(root!.id)
    expect(child!.id).not.toBe('label')
    // The original is untouched.
    expect(document.nodes.card!.layout.x).toBe(40)
    expect(validatePaste(document, pasted.nodes)).toBe(true)
  })

  test('refuses a paste that would break the document', () => {
    const document = fixture()
    const payload = buildClipboardPayload(document, ['card'])!
    const pasted = pasteNodes(document, payload, 'other')
    const broken = pasted.nodes.map((node, index) =>
      index === 0 ? { ...node, parentId: 'missing-parent' } : node,
    )

    expect(validatePaste(document, broken)).toBe(false)
  })

  test('keeps flow roots in flow rather than nudging them', () => {
    const document = fixture()
    document.nodes.flowed = createFrameNode('Flowed', {
      id: 'flowed',
      parentId: 'page',
      order: 3_072,
      layout: { ...defaultLayout(), position: 'flow' },
    })
    const payload = buildClipboardPayload(document, ['flowed'])!
    const [root] = pasteNodes(document, payload, 'page').nodes

    expect(root!.layout).toMatchObject({ position: 'flow', x: 0, y: 0 })
  })
})
