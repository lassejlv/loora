import { afterEach, describe, expect, it } from 'bun:test'
import {
  compileCanvas,
  compileJsxComponent,
  compileReactComponent,
  compileStandaloneHtml,
  compileTailwindComponent,
  inlineBrowserImages,
  serializeCanvasDocument,
} from './export'
import {
  createCanvasDocument,
  createComponentNode,
  createFrameNode,
  createInstanceNode,
  createPageNode,
  createTextNode,
} from './model'

function fixture() {
  const document = createCanvasDocument('Landing', 'doc')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.hero = createFrameNode('Hero', {
    id: 'hero',
    parentId: 'page',
    order: 1024,
    semanticTag: 'section',
  })
  document.nodes.headline = createTextNode('<script>alert(1)</script>', {
    id: 'headline',
    parentId: 'hero',
    order: 1024,
  })
  return document
}

describe('Canvas exports', () => {
  it('generates deterministic, escaped standalone HTML', () => {
    const document = fixture()
    const first = compileStandaloneHtml(document)
    const second = compileStandaloneHtml(document)
    expect(first).toBe(second)
    expect(first).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(first).not.toContain('<script>alert(1)</script>')
    expect(first).toContain('Content-Security-Policy')
  })

  it('exports a directly addressed node for expiring legacy links', () => {
    const document = fixture()
    const compiled = compileCanvas(document, { nodeId: 'hero' })
    expect(compiled.html).toContain(
      'data-loora-node="hero" data-loora-export-root="true"',
    )
    expect(compiled.html).toContain('data-loora-node="headline"')
    expect(compiled.html).not.toContain('data-loora-node="page"')
    expect(compiled.css).toContain(
      '[data-loora-export-root="true"]{position:relative;left:0;top:0}',
    )
  })

  it('generates one-way React and versioned JSON outputs', () => {
    const document = fixture()
    const react = compileReactComponent(document)
    expect(react).toContain('export default function LooraDesign')
    expect(react).toContain("document.addEventListener('click', click)")
    expect(react).toContain('applyActions(actionsFor(target, trigger))')
    expect(JSON.parse(serializeCanvasDocument(document))).toMatchObject({
      schema: 'loora.canvas',
      version: 2,
      document: { schemaVersion: 2, id: 'doc' },
    })
  })

  it('generates copyable JSX and Tailwind components for a selection', () => {
    const document = fixture()
    const jsx = compileJsxComponent(document, { nodeId: 'hero' })
    const tailwind = compileTailwindComponent(document, { nodeId: 'hero' })

    expect(jsx).toContain('export default function LooraDesign')
    expect(jsx).toContain('style={{')
    expect(jsx).toContain('{"<script>alert(1)</script>"}')
    expect(jsx).not.toContain('dangerouslySetInnerHTML')
    expect(tailwind).toContain('className=')
    expect(tailwind).toContain('[position:relative]')
    expect(tailwind).toContain('[box-sizing:border-box]')
    expect(tailwind).not.toContain('<style')
  })

  it('exports declarative actions and active theme token values', () => {
    const document = fixture()
    document.themes.dark = { id: 'dark', name: 'Dark' }
    document.activeThemeId = 'dark'
    document.tokens.accent = {
      id: 'accent',
      name: 'Accent',
      type: 'color',
      value: '#ffffff',
      modes: { dark: '#111111' },
    }
    document.nodes.headline.interactions = [
      {
        trigger: 'click',
        actions: [
          {
            type: 'open-url',
            url: 'https://loora.design',
            target: '_blank',
          },
        ],
      },
    ]
    const html = compileStandaloneHtml(document)
    const tailwind = compileTailwindComponent(document)
    expect(html).toContain('data-loora-interactions=')
    expect(html).toContain('--loora-token-accent:#111111')
    expect(html).toContain("action.type==='open-url'")
    expect(tailwind).toContain('[--loora-token-accent:#111111]')
    expect(tailwind).not.toContain('style={{')
  })

  it('renders component variant overrides and exports switching rules', () => {
    const document = fixture()
    document.nodes.button = createComponentNode('Button', {
      id: 'button',
      order: 2_048,
      variants: ['default', 'hover'],
      defaultVariant: 'default',
      variantOverrides: {
        hover: {
          button: {
            style: {
              fills: [{ type: 'solid', color: '#0000ff' }],
            },
          },
          buttonLabel: {
            text: 'Hovered',
            style: {
              fills: [{ type: 'solid', color: '#ff0000' }],
            },
          },
        },
      },
    })
    document.nodes.buttonLabel = createTextNode('Default', {
      id: 'buttonLabel',
      parentId: 'button',
      order: 1_024,
    })
    document.nodes.buttonInstance = createInstanceNode(
      'button',
      'Button instance',
      {
        id: 'buttonInstance',
        parentId: 'hero',
        order: 2_048,
        variant: 'hover',
      },
    )
    const html = compileStandaloneHtml(document)
    expect(html).toContain('data-loora-variant="hover"')
    expect(html).toContain('data-loora-component-root="buttonInstance"')
    expect(html).toContain('Hovered')
    expect(html).toContain('background:#0000ff')
    expect(html).toContain(
      '[data-loora-node="buttonInstance"][data-loora-variant="hover"]',
    )
    expect(html).toContain('setVariant(instance,variant)')
  })
})

describe('inlineBrowserImages', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('blanks an image it cannot read rather than tainting the capture', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('cdn.example.com')) throw new Error('CORS')
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'Content-Type': 'image/png' },
      })
    }) as typeof fetch

    const host = document.createElement('div')
    host.innerHTML =
      '<img src="https://cdn.example.com/hero.png" srcset="https://cdn.example.com/hero@2x.png 2x">' +
      '<img src="/api/asset/a1">'

    const skipped = await inlineBrowserImages(host)

    expect(skipped).toEqual(['https://cdn.example.com/hero.png'])
    const images = [...host.querySelectorAll('img')]
    // A remote reference left in place is what makes `toDataURL` throw.
    expect(images[0]!.getAttribute('src')).toStartWith('data:image/gif;base64,')
    expect(images[0]!.hasAttribute('srcset')).toBe(false)
    expect(images[1]!.getAttribute('src')).toStartWith('data:image/png')
  })

  it('leaves an image that is already inline alone', async () => {
    globalThis.fetch = (async () => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch
    const host = document.createElement('div')
    const inline = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    host.innerHTML = `<img src="${inline}">`

    expect(await inlineBrowserImages(host)).toEqual([])
    expect(host.querySelector('img')!.getAttribute('src')).toBe(inline)
  })
})
