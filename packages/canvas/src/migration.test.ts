import { describe, expect, it } from 'bun:test'
import { migrateLegacyCanvas } from './migration'
import { validateDocument } from './model'

const element = {
  id: 'legacy-hero',
  name: 'Hero',
  x: 120,
  y: 80,
  w: 1200,
  h: 600,
  code: '<section>Hero</section>',
}

describe('legacy Canvas migration', () => {
  it('turns legacy elements into components, editable pages and instances', async () => {
    const result = await migrateLegacyCanvas(
      {
        id: 'design',
        name: 'Landing',
        elements: [element],
        pages: [],
      },
      {
        render: async () => ({
          root: {
            tag: 'section',
            attributes: { 'aria-label': 'Hero' },
            style: {
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'rgb(255, 255, 255)',
            },
            rect: { x: 0, y: 0, width: 1200, height: 600 },
            children: [{
              tag: 'h1',
              text: 'Welcome',
              attributes: {},
              style: { fontSize: '64px', fontWeight: '700' },
              rect: { x: 64, y: 80, width: 800, height: 90 },
              children: [],
            }],
          },
          png: 'data:image/png;base64,AAAA',
          similarity: 0.99,
        }),
        storeFallbackImage: async () => '/api/asset/fallback',
      },
    )
    expect(validateDocument(result.document).ok).toBe(true)
    expect(result.report.convertedElements).toBe(1)
    expect(result.document.nodes['legacy-hero']).toMatchObject({
      type: 'instance',
      parentId: 'legacy-page-legacy-hero',
    })
  })

  it('uses a complete raster fallback below the visual threshold', async () => {
    const result = await migrateLegacyCanvas(
      {
        id: 'design',
        name: 'Landing',
        elements: [element],
        pages: [],
      },
      {
        render: async () => ({
          root: {
            tag: 'canvas',
            attributes: {},
            style: {},
            rect: { x: 0, y: 0, width: 1200, height: 600 },
            children: [],
            unsupported: ['canvas'],
          },
          png: 'data:image/png;base64,AAAA',
          similarity: 0.7,
        }),
        storeFallbackImage: async () => '/api/asset/fallback',
      },
    )
    expect(result.report.rasterFallbacks).toBe(1)
    expect(
      Object.values(result.document.nodes).some(
        (node) => node.type === 'image' && node.metadata?.migrationFallback === true,
      ),
    ).toBe(true)
  })
})
