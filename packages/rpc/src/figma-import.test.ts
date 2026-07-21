import { describe, expect, it } from 'bun:test'
import { FigmaIntegrationError } from '@loora/auth/figma'
import {
  convertFigmaFile,
  parseFigmaFileUrl,
  type FigmaNode,
} from './figma-import'

function fileWithPages(pages: FigmaNode[]) {
  return {
    name: 'Marketing site',
    editorType: 'figma',
    document: {
      id: '0:0',
      name: 'Document',
      type: 'DOCUMENT',
      children: pages,
    },
  }
}

describe('Figma URL parsing', () => {
  it('accepts file and frame links', () => {
    expect(parseFigmaFileUrl('https://www.figma.com/design/abcdef123/My-file')).toEqual({
      key: 'abcdef123',
      nodeId: null,
    })
    expect(
      parseFigmaFileUrl('https://figma.com/file/abcdef123/My-file?node-id=12-34'),
    ).toEqual({ key: 'abcdef123', nodeId: '12:34' })
    expect(
      parseFigmaFileUrl('https://www.figma.com/proto/abcdef123/Prototype?node-id=12%3A34'),
    ).toEqual({ key: 'abcdef123', nodeId: '12:34' })
  })

  it('rejects lookalike hosts and non-file links', () => {
    expect(() => parseFigmaFileUrl('https://figma.com.evil.test/design/abcdef123/x')).toThrow(
      FigmaIntegrationError,
    )
    expect(() => parseFigmaFileUrl('https://www.figma.com/community/file/abcdef123')).toThrow(
      'not a Figma Design file',
    )
  })
})

describe('Figma conversion', () => {
  it('creates editable HTML, escapes text, and records fonts', () => {
    const payload = fileWithPages([
      {
        id: '0:1',
        name: 'Landing',
        type: 'CANVAS',
        children: [
          {
            id: '1:1',
            name: 'Hero',
            type: 'FRAME',
            absoluteBoundingBox: { x: 100, y: 200, width: 1200, height: 700 },
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
            children: [
              {
                id: '1:2',
                name: 'Heading',
                type: 'TEXT',
                absoluteBoundingBox: { x: 180, y: 260, width: 500, height: 80 },
                fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 } }],
                characters: '<script>alert("no")</script>',
                style: { fontFamily: 'Acme Sans', fontSize: 48, fontWeight: 700 },
              },
            ],
          },
        ],
      },
    ])

    const converted = convertFigmaFile(payload, null)

    expect(converted.pages).toBe(1)
    expect(converted.fonts).toEqual(['Acme Sans'])
    expect(converted.drafts).toHaveLength(1)
    expect(converted.drafts[0]).toMatchObject({ name: 'Hero', x: 40, y: 40, w: 1200, h: 700 })
    expect(converted.drafts[0].code).toContain('&lt;script&gt;')
    expect(converted.drafts[0].code).not.toContain('<script>')
    expect(converted.drafts[0].code).toContain('color:rgba(26, 51, 77, 1)')
  })

  it('keeps pages in separate vertical bands and prefixes names', () => {
    const page = (id: string, name: string, y: number): FigmaNode => ({
      id,
      name,
      type: 'CANVAS',
      children: [
        {
          id: `${id}:1`,
          name: 'Screen',
          type: 'FRAME',
          absoluteBoundingBox: { x: 20, y, width: 300, height: 200 },
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
        },
      ],
    })
    const converted = convertFigmaFile(
      fileWithPages([page('1', 'Desktop', 10), page('2', 'Mobile', 500)]),
      null,
    )

    expect(converted.drafts.map((draft) => draft.name)).toEqual([
      'Desktop / Screen',
      'Mobile / Screen',
    ])
    expect(converted.drafts[1].y).toBeGreaterThan(converted.drafts[0].y + 200)
  })

  it('marks unsupported vector nodes for a visual fallback', () => {
    const payload = fileWithPages([
      {
        id: '0:1',
        name: 'Icons',
        type: 'CANVAS',
        children: [
          {
            id: '3:1',
            name: 'Logo',
            type: 'VECTOR',
            absoluteBoundingBox: { x: 0, y: 0, width: 64, height: 64 },
          },
        ],
      },
    ])
    const converted = convertFigmaFile(payload, '3:1')

    expect(converted.drafts[0].fallbackNodeIds).toEqual(['3:1'])
    expect(converted.drafts[0].code).toContain('__FIGMA_ASSET_3:1__')
  })
})
