import { describe, expect, it } from 'bun:test'
import { FigmaIntegrationError } from '@loora/auth/figma'
import {
  convertFigmaFile,
  parseFigmaFileUrl,
  type FigmaNode,
} from './figma-import'
import { createCanvasDocument, createPageNode } from '@loora/canvas/model'

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
  it('creates editable structured text and records fonts', () => {
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
    const page = Object.values(converted.document.nodes).find(
      (node) => node.type === 'page',
    )
    const text = Object.values(converted.document.nodes).find(
      (node) => node.type === 'text',
    )
    expect(page).toMatchObject({ name: 'Hero' })
    expect(text).toMatchObject({
      name: 'Heading',
      text: '<script>alert("no")</script>',
    })
    expect(text?.style.fills).toEqual([
      { type: 'solid', color: 'rgba(26, 51, 77, 1)' },
    ])
  })

  it('places imported Figma pages side by side and prefixes names', () => {
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

    const pages = Object.values(converted.document.nodes)
      .filter((node) => node.type === 'page')
      .sort((left, right) => left.layout.x - right.layout.x)
    expect(pages.map((page) => page.name)).toEqual([
      'Desktop / Screen',
      'Mobile / Screen',
    ])
    expect(pages[1]!.layout.x).toBeGreaterThan(pages[0]!.layout.x + 300)
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

    expect(converted.fallbacks).toHaveLength(1)
    expect(converted.fallbacks[0]?.figmaNodeId).toBe('3:1')
    const fallback = converted.document.nodes[converted.fallbacks[0]!.canvasNodeId]
    expect(fallback).toMatchObject({
      type: 'image',
      metadata: {
        figmaNodeId: '3:1',
        figmaFallback: true,
      },
    })
    expect(fallback?.type === 'image' && fallback.src.startsWith('data:image/')).toBe(true)
  })

  it('rasterizes a complete root when its visual effects are unsupported', () => {
    const converted = convertFigmaFile(
      fileWithPages([
        {
          id: '0:1',
          name: 'Effects',
          type: 'CANVAS',
          children: [
            {
              id: '4:1',
              name: 'Blurred screen',
              type: 'FRAME',
              absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 240 },
              effects: [{ type: 'LAYER_BLUR', radius: 12 }],
              children: [
                {
                  id: '4:2',
                  name: 'Text',
                  type: 'TEXT',
                  characters: 'Preserved inside the fallback',
                  absoluteBoundingBox: { x: 20, y: 20, width: 200, height: 40 },
                },
              ],
            },
          ],
        },
      ]),
      null,
    )

    expect(converted.fallbacks).toHaveLength(1)
    expect(converted.fallbacks[0]?.figmaNodeId).toBe('4:1')
    expect(
      Object.values(converted.document.nodes).some(
        (node) => node.metadata?.figmaNodeId === '4:2',
      ),
    ).toBe(false)
  })

  it('maps component-set variants to one definition with field overrides', () => {
    const converted = convertFigmaFile(
      fileWithPages([
        {
          id: '0:1',
          name: 'Components',
          type: 'CANVAS',
          children: [
            {
              id: 'set:1',
              name: 'Button',
              type: 'COMPONENT_SET',
              absoluteBoundingBox: {
                x: 0,
                y: 0,
                width: 120,
                height: 40,
              },
              children: [
                {
                  id: 'component:default',
                  name: 'State=Default',
                  type: 'COMPONENT',
                  absoluteBoundingBox: {
                    x: 0,
                    y: 0,
                    width: 120,
                    height: 40,
                  },
                  fills: [
                    {
                      type: 'SOLID',
                      color: { r: 0.1, g: 0.1, b: 0.1 },
                    },
                  ],
                  children: [
                    {
                      id: 'label:default',
                      name: 'Label',
                      type: 'TEXT',
                      characters: 'Default',
                      absoluteBoundingBox: {
                        x: 20,
                        y: 10,
                        width: 80,
                        height: 20,
                      },
                    },
                  ],
                },
                {
                  id: 'component:hover',
                  name: 'State=Hover',
                  type: 'COMPONENT',
                  absoluteBoundingBox: {
                    x: 0,
                    y: 0,
                    width: 120,
                    height: 40,
                  },
                  fills: [
                    {
                      type: 'SOLID',
                      color: { r: 0.2, g: 0.3, b: 0.8 },
                    },
                  ],
                  children: [
                    {
                      id: 'label:hover',
                      name: 'Label',
                      type: 'TEXT',
                      characters: 'Hover',
                      absoluteBoundingBox: {
                        x: 20,
                        y: 10,
                        width: 80,
                        height: 20,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      null,
    )

    const components = Object.values(converted.document.nodes).filter(
      (node) => node.type === 'component',
    )
    expect(components).toHaveLength(1)
    const component = components[0]!
    expect(component.type === 'component' && component.variants).toEqual([
      'State=Default',
      'State=Hover',
    ])
    const label = Object.values(converted.document.nodes).find(
      (node) => node.metadata?.figmaNodeId === 'label:default',
    )
    expect(
      component.type === 'component' &&
        label &&
        component.variantOverrides['State=Hover']?.[label.id],
    ).toMatchObject({
      text: 'Hover',
    })
    expect(
      component.type === 'component' &&
        component.variantOverrides['State=Hover']?.[component.id]?.style,
    ).toMatchObject({
      fills: [
        {
          type: 'solid',
          color: 'rgba(51, 77, 204, 1)',
        },
      ],
    })
  })

  it('rasterizes only an unsupported component variant', () => {
    const converted = convertFigmaFile(
      fileWithPages([
        {
          id: '0:1',
          name: 'Components',
          type: 'CANVAS',
          children: [
            {
              id: 'set:1',
              name: 'Card',
              type: 'COMPONENT_SET',
              absoluteBoundingBox: {
                x: 0,
                y: 0,
                width: 160,
                height: 80,
              },
              children: [
                {
                  id: 'component:default',
                  name: 'State=Default',
                  type: 'COMPONENT',
                  absoluteBoundingBox: {
                    x: 0,
                    y: 0,
                    width: 160,
                    height: 80,
                  },
                  children: [
                    {
                      id: 'label:default',
                      name: 'Label',
                      type: 'TEXT',
                      characters: 'Default',
                      absoluteBoundingBox: {
                        x: 20,
                        y: 20,
                        width: 120,
                        height: 40,
                      },
                    },
                  ],
                },
                {
                  id: 'component:blurred',
                  name: 'State=Blurred',
                  type: 'COMPONENT',
                  absoluteBoundingBox: {
                    x: 0,
                    y: 0,
                    width: 160,
                    height: 80,
                  },
                  effects: [{ type: 'LAYER_BLUR', radius: 12 }],
                  children: [
                    {
                      id: 'label:blurred',
                      name: 'Label',
                      type: 'TEXT',
                      characters: 'Blurred',
                      absoluteBoundingBox: {
                        x: 20,
                        y: 20,
                        width: 120,
                        height: 40,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      null,
    )

    expect(converted.fallbacks).toHaveLength(1)
    expect(converted.fallbacks[0]?.figmaNodeId).toBe('component:blurred')
    const component = Object.values(converted.document.nodes).find(
      (node) => node.type === 'component',
    )
    const label = Object.values(converted.document.nodes).find(
      (node) => node.metadata?.figmaNodeId === 'label:default',
    )
    const fallback = Object.values(converted.document.nodes).find(
      (node) => node.metadata?.figmaNodeId === 'component:blurred',
    )
    expect(fallback).toMatchObject({
      type: 'image',
      hidden: true,
      metadata: {
        figmaFallback: true,
      },
    })
    expect(
      component?.type === 'component' &&
        fallback &&
        component.variantOverrides['State=Blurred']?.[fallback.id],
    ).toEqual({ hidden: false })
    expect(
      component?.type === 'component' &&
        label &&
        component.variantOverrides['State=Blurred']?.[label.id],
    ).toEqual({ hidden: true })
  })
})

describe('Figma placement', () => {
  it('places imported Pages after existing Pages', () => {
    const base = createCanvasDocument('Existing')
    const existing = createPageNode('Existing', {
      id: 'existing',
      layout: {
        ...createPageNode().layout,
        x: 20,
        y: 30,
        width: { unit: 'px', value: 100 },
        height: { unit: 'px', value: 80 },
      },
      viewport: { width: 100, minHeight: 80 },
    })
    base.nodes[existing.id] = existing
    const converted = convertFigmaFile(
      fileWithPages([
        {
          id: '0:1',
          name: 'Imported',
          type: 'CANVAS',
          children: [
            {
              id: '1:1',
              name: 'Screen',
              type: 'FRAME',
              absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 },
            },
          ],
        },
      ]),
      null,
      base,
    )
    const imported = Object.values(converted.document.nodes).find(
      (node) => node.type === 'page' && node.id !== existing.id,
    )
    expect(imported?.layout.x).toBe(280)
  })
})
