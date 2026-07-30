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

  it('omits the Paper Snapshot wrapper while preserving button geometry and text', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'paper-button-import',
      name: 'Paper button',
      width: 1_440,
      height: 900,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 1_440, height: 900 },
        children: [{
          tag: 'x-paper-html',
          attributes: {},
          style: { display: 'inline' },
          rect: { x: 0, y: 121, width: 1_440, height: 58 },
          children: [{
            tag: 'a',
            attributes: { href: 'https://railway.com/new' },
            style: {
              display: 'flex',
              width: '138px',
              height: '58px',
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: '12px',
              paddingRight: '24px',
              paddingBottom: '12px',
              paddingLeft: '24px',
              backgroundColor: 'rgb(94, 69, 144)',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
              borderBottomRightRadius: '8px',
              borderBottomLeftRadius: '8px',
            },
            rect: { x: 0, y: 121, width: 138, height: 58 },
            children: [{
              tag: '#text',
              text: 'Deploy →',
              attributes: {},
              style: {
                display: 'inline',
                color: 'rgb(255, 255, 255)',
                fontSize: '20px',
                fontWeight: '500',
                lineHeight: '32px',
              },
              rect: { x: 24, y: 134, width: 90, height: 32 },
              children: [],
            }],
          }],
        }],
      },
    })

    const nodes = Object.values(result.document.nodes)
    expect(
      nodes.find((node) => node.type === 'text'),
    ).toMatchObject({
      type: 'text',
      text: 'Deploy →',
    })
    expect(
      nodes.some(
        (node) => node.metadata.importedHtmlTag === 'x-paper-html',
      ),
    ).toBe(false)
    expect(
      nodes.find((node) => node.metadata.importedHtmlTag === 'a'),
    ).toMatchObject({
      parentId: result.pageId,
      layout: {
        width: { unit: 'px', value: 138 },
        height: { unit: 'px', value: 58 },
      },
      style: {
        radius: 8,
        fills: [{ type: 'solid', color: 'rgb(94, 69, 144)' }],
      },
    })
  })
})
