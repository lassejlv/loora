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
        (node) => node.metadata?.importedHtmlTag === 'x-paper-html',
      ),
    ).toBe(false)
    expect(
      nodes.find((node) => node.metadata?.importedHtmlTag === 'a'),
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

  it('places a whole container absolutely when one child cannot be arranged', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'paper-pricing-card',
      name: 'Pricing card',
      width: 480,
      height: 640,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 480, height: 640 },
        children: [{
          tag: 'div',
          attributes: { 'aria-label': 'Pro plan' },
          style: {
            display: 'flex',
            flexDirection: 'column',
            paddingTop: '20px',
            paddingRight: '20px',
            paddingBottom: '20px',
            paddingLeft: '20px',
          },
          rect: { x: 20, y: 20, width: 440, height: 600 },
          children: [{
            tag: 'h2',
            text: 'Pro',
            attributes: {},
            style: {
              display: 'block',
              marginTop: '0px',
              color: 'rgb(30, 61, 234)',
              fontSize: '15px',
            },
            rect: { x: 40, y: 40, width: 28, height: 20 },
            children: [],
          }, {
            tag: 'p',
            attributes: {},
            style: {
              display: 'block',
              marginTop: 'auto',
            },
            rect: { x: 40, y: 554, width: 400, height: 42 },
            children: [{
              tag: 'a',
              attributes: { href: 'https://loora.design/app' },
              style: {
                display: 'inline-block',
                whiteSpace: 'nowrap',
                paddingTop: '4px',
                paddingRight: '10px',
                paddingBottom: '4px',
                paddingLeft: '10px',
                backgroundColor: 'rgb(30, 61, 234)',
              },
              rect: { x: 40, y: 554, width: 84, height: 34 },
              children: [{
                tag: '#text',
                text: 'Go Pro',
                attributes: {},
                style: {
                  display: 'inline',
                  whiteSpace: 'nowrap',
                  color: 'rgb(255, 255, 255)',
                  fontSize: '13px',
                  lineHeight: '18px',
                },
                rect: { x: 50, y: 562, width: 64, height: 18 },
                children: [],
              }],
            }],
          }],
        }],
      },
    })

    const nodes = Object.values(result.document.nodes)
    const card = nodes.find((node) => node.name === 'Pro plan')
    const heading = nodes.find(
      (node) => node.metadata?.importedHtmlTag === 'h2',
    )
    const ctaRow = nodes.find(
      (node) => node.metadata?.importedHtmlTag === 'p',
    )

    // The auto margin cannot be arranged, so no sibling is arranged either —
    // one flow child among absolute ones repacks and lands nowhere near where
    // it was captured.
    expect(card?.layout.mode).toBe('absolute')
    expect(heading?.layout).toMatchObject({ position: 'absolute', x: 0, y: 0 })
    // Offsets are measured from the card's content box: its 20px padding is
    // re-applied by the renderer and must not be counted twice.
    expect(ctaRow?.layout).toMatchObject({
      position: 'absolute',
      x: 0,
      y: 514,
    })
  })

  it('keeps the box a styled label is painted in', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'paper-status-pill',
      name: 'Status pill',
      width: 200,
      height: 80,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 200, height: 80 },
        children: [{
          tag: 'span',
          text: 'ACTIVE',
          attributes: {},
          style: {
            display: 'inline-flex',
            backgroundColor: 'rgb(20, 62, 33)',
            borderTopLeftRadius: '6px',
            borderTopRightRadius: '6px',
            borderBottomRightRadius: '6px',
            borderBottomLeftRadius: '6px',
            paddingTop: '4px',
            paddingRight: '8px',
            paddingBottom: '4px',
            paddingLeft: '8px',
            color: 'rgb(126, 231, 135)',
            fontSize: '13px',
            lineHeight: '20px',
          },
          rect: { x: 16, y: 16, width: 88, height: 28 },
          children: [],
        }],
      },
    })

    const nodes = Object.values(result.document.nodes)
    const pill = nodes.find((node) => node.metadata?.importedHtmlTag === 'span')
    const label = nodes.find((node) => node.type === 'text')

    expect(pill).toMatchObject({
      type: 'frame',
      style: {
        radius: 6,
        fills: [{ type: 'solid', color: 'rgb(20, 62, 33)' }],
      },
      layout: { padding: { top: 4, right: 8, bottom: 4, left: 8 } },
    })
    expect(label).toMatchObject({
      type: 'text',
      text: 'ACTIVE',
      parentId: pill?.id,
      // Measured as one line, so a substituted font must not rewrap it.
      style: { typography: { wrap: false } },
    })
  })

  it('preserves no-wrap text used by inline Paper Snapshot buttons', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'paper-nowrap-button',
      name: 'No-wrap button',
      width: 160,
      height: 80,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 160, height: 80 },
        children: [{
          tag: 'a',
          attributes: { href: 'https://loora.design/app' },
          style: {
            display: 'inline-block',
            whiteSpace: 'nowrap',
            paddingTop: '4px',
            paddingRight: '10px',
            paddingBottom: '4px',
            paddingLeft: '10px',
            backgroundColor: 'rgb(30, 61, 234)',
          },
          rect: { x: 20, y: 20, width: 84, height: 34 },
          children: [{
            tag: '#text',
            text: 'Go Pro',
            attributes: {},
            style: {
              display: 'inline',
              whiteSpace: 'nowrap',
              color: 'rgb(255, 255, 255)',
              fontSize: '13px',
              lineHeight: '18px',
            },
            rect: { x: 30, y: 28, width: 64, height: 18 },
            children: [],
          }],
        }],
      },
    })

    const ctaLabel = Object.values(result.document.nodes).find(
      (node) => node.type === 'text' && node.text === 'Go Pro',
    )
    expect(ctaLabel?.style.typography).toMatchObject({
      wrap: false,
    })
  })

  it('does not turn an invisible CSS border into a solid Canvas stroke', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'paper-invisible-border',
      name: 'Invisible border',
      width: 320,
      height: 200,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 320, height: 200 },
        children: [{
          tag: 'div',
          attributes: { 'aria-label': 'Borderless row' },
          style: {
            display: 'block',
            borderTopWidth: '3px',
            borderRightWidth: '3px',
            borderBottomWidth: '3px',
            borderLeftWidth: '3px',
            borderTopColor: 'rgb(57, 56, 52)',
            borderRightColor: 'rgb(57, 56, 52)',
            borderBottomColor: 'rgb(57, 56, 52)',
            borderLeftColor: 'rgb(57, 56, 52)',
            borderTopStyle: 'none',
            borderRightStyle: 'none',
            borderBottomStyle: 'none',
            borderLeftStyle: 'none',
          },
          rect: { x: 20, y: 20, width: 280, height: 60 },
          children: [],
        }],
      },
    })

    const row = Object.values(result.document.nodes).find(
      (node) => node.name === 'Borderless row',
    )
    expect(row?.style.stroke).toBeUndefined()
  })

  it('inherits presentation attributes for editable SVG paths', () => {
    const result = convertHtmlSnapshotToCanvas({
      id: 'paper-svg',
      name: 'SVG icon',
      width: 64,
      height: 64,
      root: {
        tag: 'body',
        attributes: {},
        style: { display: 'block' },
        rect: { x: 0, y: 0, width: 64, height: 64 },
        children: [{
          tag: 'svg',
          attributes: {
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'rgb(255, 255, 255)',
            'stroke-width': '2',
          },
          style: { display: 'block' },
          rect: { x: 20, y: 20, width: 24, height: 24 },
          children: [{
            tag: 'path',
            attributes: { d: 'M5 12h14m-6-6 6 6-6 6' },
            style: { display: 'block' },
            rect: { x: 25, y: 26, width: 14, height: 12 },
            children: [],
          }],
        }],
      },
    })

    const vector = Object.values(result.document.nodes).find(
      (node) => node.type === 'vector',
    )
    expect(vector).toMatchObject({
      type: 'vector',
      paths: [{
        d: 'M5 12h14m-6-6 6 6-6 6',
        stroke: 'rgb(255, 255, 255)',
        strokeWidth: 2,
      }],
    })
  })
})
