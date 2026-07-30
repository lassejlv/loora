import { describe, expect, it } from 'bun:test'
import { convertHtmlSnapshotToCanvas } from './import'
import { validateDocument } from './model'

describe('HTML snapshot import', () => {
  it('converts computed layout and styles into a valid editable Canvas tree', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'imported-document',
      name: 'Imported landing page',
      width: 1200,
      height: 800,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 1200, height: 800 },
        children: [{
          tag: 'section',
          attributes: { 'aria-label': 'Hero' },
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            paddingTop: '64px',
            paddingRight: '64px',
            paddingBottom: '64px',
            paddingLeft: '64px',
            backgroundColor: 'rgb(20, 20, 24)',
            borderTopLeftRadius: '24px',
            borderTopRightRadius: '24px',
            borderBottomRightRadius: '24px',
            borderBottomLeftRadius: '24px',
            opacity: '1',
          },
          rect: { x: 40, y: 40, width: 1120, height: 560 },
          children: [{
            tag: 'h1',
            text: 'Design without source strings',
            attributes: {},
            style: {
              display: 'block',
              color: 'rgb(255, 255, 255)',
              fontFamily: 'Archivo',
              fontSize: '64px',
              fontWeight: '700',
              lineHeight: '70.4px',
              letterSpacing: '-2px',
              textAlign: 'left',
              opacity: '1',
            },
            rect: { x: 104, y: 104, width: 780, height: 80 },
            children: [],
          }],
        }],
      },
    })

    expect(validateDocument(result.document)).toEqual({ ok: true, issues: [] })
    const page = result.document.nodes[result.pageId]
    expect(page?.type).toBe('page')
    const hero = Object.values(result.document.nodes).find(
      (node) => node.name === 'Hero',
    )
    expect(hero?.layout).toMatchObject({
      mode: 'flex',
      direction: 'column',
      gap: 24,
    })
    const heading = Object.values(result.document.nodes).find(
      (node) => node.type === 'text',
    )
    expect(heading?.style.typography).toMatchObject({
      size: 64,
      weight: 700,
      lineHeight: 1.1,
    })
  })

  it('drops executable and relative URLs instead of persisting invalid nodes', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'safe-import',
      name: 'Safe import',
      width: 400,
      height: 300,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 400, height: 300 },
        children: [{
          tag: 'img',
          attributes: { src: 'javascript:alert(1)', alt: 'Unsafe' },
          style: { display: 'block' },
          rect: { x: 0, y: 0, width: 200, height: 100 },
          children: [],
        }],
      },
    })

    expect(validateDocument(result.document).ok).toBe(true)
    expect(
      Object.values(result.document.nodes).some((node) => node.type === 'image'),
    ).toBe(false)
    expect(result.warnings[0]).toContain('unsupported')
  })

  it('preserves a CSS background image as an image layer for later asset upload', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'background-import',
      name: 'Snapshot',
      width: 400,
      height: 300,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 400, height: 300 },
        children: [{
          tag: 'section',
          attributes: { 'aria-label': 'Hero' },
          style: {
            display: 'block',
            backgroundImage: 'url("https://cdn.example.com/hero.webp")',
          },
          rect: { x: 0, y: 0, width: 400, height: 300 },
          children: [],
        }],
      },
    })

    const image = Object.values(result.document.nodes).find(
      (node) => node.type === 'image',
    )
    expect(image).toMatchObject({
      type: 'image',
      src: 'https://cdn.example.com/hero.webp',
      parentId: expect.any(String),
    })
  })
})
