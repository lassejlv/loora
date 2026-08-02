import { afterEach, describe, expect, it } from 'vitest'
import {
  compileCanvas,
  compileJsxComponent,
  compileReactComponent,
  compileStandaloneHtml,
  compileTailwindComponent,
  inlineBrowserImages,
  prepareCanvasExport,
  renderElementToPng,
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
import { motionPreset } from './motion'

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
    expect(first).toContain("font-src 'self' https: data:")
  })

  it('embeds @font-face rules for used vendor typefaces', () => {
    const document = fixture()
    document.nodes.headline.style.typography!.family = 'Playfair Display'
    document.nodes.sub = createTextNode('Body', {
      id: 'sub',
      parentId: 'hero',
      order: 2048,
    })
    document.nodes.sub.style.typography!.family =
      '"Space Grotesk", system-ui, sans-serif'

    const html = compileStandaloneHtml(document)
    expect(html).toContain("font-family:'Playfair Display'")
    expect(html).toContain('/vendor/fonts/playfair-display-latin.woff2')
    expect(html).toContain('/vendor/fonts/space-grotesk-latin.woff2')
    expect(html).not.toContain('/vendor/fonts/inter-latin.woff2')
    expect(html).not.toContain('/vendor/fonts/archivo-latin.woff2')

    const absolute = compileStandaloneHtml(document, {
      fontOrigin: 'https://loora.design/',
    })
    expect(absolute).toContain(
      'https://loora.design/vendor/fonts/playfair-display-latin.woff2',
    )
  })

  it('exports a directly addressed node for expiring legacy links', () => {
    const document = fixture()
    document.animations = {
      pulse: motionPreset('pulse'),
      'fade-in': motionPreset('fade-in'),
    }
    document.nodes.hero.animations = [
      { animationId: 'fade-in', trigger: 'load' },
    ]
    document.nodes.page.animations = [
      { animationId: 'pulse', trigger: 'always' },
    ]
    const compiled = compileCanvas(document, { nodeId: 'hero' })
    expect(compiled.html).toContain(
      'data-loora-node="hero" data-loora-export-root="true"',
    )
    expect(compiled.html).toContain('data-loora-node="headline"')
    expect(compiled.html).not.toContain('data-loora-node="page"')
    expect(compiled.css).toContain(
      '[data-loora-export-root="true"]{position:relative;left:0;top:0}',
    )
    expect(compiled.css).toContain('.loora-hero{')
    expect(compiled.css).toContain('.loora-headline{')
    expect(compiled.css).not.toContain('.loora-page{')
    expect(compiled.css).toContain('@keyframes loora-motion-fade-in')
    expect(compiled.css).not.toContain('@keyframes loora-motion-pulse')
  })

  it('prepares one immutable snapshot and reuses its compiled result', () => {
    const document = fixture()
    const prepared = prepareCanvasExport(document, { nodeId: 'hero' })
    const first = compileCanvas(prepared)
    const second = compileCanvas(prepared)

    expect(second).toBe(first)
    expect(compileStandaloneHtml(prepared)).toBe(
      compileStandaloneHtml(prepared),
    )
    document.nodes.headline = createTextNode('Changed later', {
      id: 'headline',
      parentId: 'hero',
      order: 1_024,
    })
    expect(compileCanvas(prepared).html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(compileCanvas(document, { nodeId: 'hero' }).html).toContain(
      'Changed later',
    )
  })

  it('keeps overlapping rich-text runs in source-order precedence', () => {
    const document = fixture()
    const headline = document.nodes.headline
    if (headline.type !== 'text') throw new Error('Fixture text is missing')
    headline.text = 'abcdef'
    headline.runs = [
      { start: 1, end: 5, color: '#ff0000' },
      { start: 0, end: 3, color: '#0000ff' },
    ]

    expect(compileCanvas(document, { nodeId: 'headline' }).html).toContain(
      '<span style="color:#0000ff">a</span>' +
        '<span style="color:#ff0000">bc</span>' +
        '<span style="color:#ff0000">de</span>f',
    )
  })

  it('includes referenced nested components but excludes unused definitions', () => {
    const document = fixture()
    document.nodes.icon = createComponentNode('Icon', {
      id: 'icon',
      order: 2_048,
    })
    document.nodes.iconLabel = createTextNode('Icon label', {
      id: 'iconLabel',
      parentId: 'icon',
      order: 1_024,
    })
    document.nodes.card = createComponentNode('Card', {
      id: 'card',
      order: 3_072,
    })
    document.nodes.nestedIcon = createInstanceNode('icon', 'Nested icon', {
      id: 'nestedIcon',
      parentId: 'card',
      order: 1_024,
    })
    document.nodes.cardInstance = createInstanceNode('card', 'Card instance', {
      id: 'cardInstance',
      parentId: 'hero',
      order: 2_048,
    })
    document.nodes.unused = createComponentNode('Unused', {
      id: 'unused',
      order: 4_096,
    })
    document.nodes.unusedLabel = createTextNode('Never rendered', {
      id: 'unusedLabel',
      parentId: 'unused',
      order: 1_024,
    })

    const compiled = compileCanvas(document, { nodeId: 'hero' })
    expect(compiled.html).toContain('data-loora-component="card"')
    expect(compiled.html).toContain('data-loora-component="icon"')
    expect(compiled.html).toContain('Icon label')
    expect(compiled.css).toContain('.loora-cardInstance-card{')
    expect(compiled.css).toContain('.loora-nestedIcon-iconLabel{')
    expect(compiled.css).not.toContain('.loora-unused{')
    expect(compiled.css).not.toContain('.loora-unusedLabel{')
  })

  it('generates one-way React and versioned JSON outputs', () => {
    const document = fixture()
    const react = compileReactComponent(document)
    expect(react).toContain('export default function LooraDesign')
    expect(react).toContain("root.addEventListener('click', click)")
    expect(react).toContain('applyActions(actionsFor(target, trigger, scope)')
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

  it('exports zero-width overrides in the base rule and orders media queries by width', () => {
    const document = fixture()
    document.breakpoints = [
      { id: 'desktop', name: 'Desktop', minWidth: 1200, previewWidth: 1440 },
      { id: 'mobile', name: 'Mobile', minWidth: 0, previewWidth: 390 },
      { id: 'tablet', name: 'Tablet', minWidth: 768, previewWidth: 768 },
    ]
    document.nodes.headline.responsive = {
      mobile: { style: { typography: { size: 32 } } },
      tablet: { style: { typography: { size: 40 } } },
      desktop: { style: { typography: { size: 48 } } },
    }
    const { css } = compileCanvas(document)
    const base = css
      .split('\n')
      .find((rule) => rule.startsWith('.loora-headline{'))

    expect(base).toContain('font-size:32px')
    expect(css.match(/@media\(min-width:\d+px\)/g)).toEqual([
      '@media(min-width:768px)',
      '@media(min-width:1200px)',
    ])
    expect(css.indexOf('font-size:40px')).toBeLessThan(
      css.indexOf('font-size:48px'),
    )
  })

  it('shows a text node again at a breakpoint that unhides it', () => {
    const document = fixture()
    document.breakpoints = [
      { id: 'mobile', name: 'Mobile', minWidth: 0, previewWidth: 390 },
      { id: 'tablet', name: 'Tablet', minWidth: 768, previewWidth: 768 },
      { id: 'desktop', name: 'Desktop', minWidth: 1200, previewWidth: 1440 },
    ]
    document.nodes.headline.responsive = {
      mobile: { hidden: true },
      tablet: { hidden: true },
      desktop: { hidden: false },
    }
    const { css } = compileCanvas(document)

    expect(css).toContain(
      '@media(max-width:1199.98px){.loora-headline{display:none}}',
    )
    // An unbounded rule would keep hiding it past the desktop breakpoint.
    expect(css).not.toContain('}.loora-headline{display:none}')
  })

  it('hides a node at one breakpoint only', () => {
    const document = fixture()
    document.breakpoints = [
      { id: 'mobile', name: 'Mobile', minWidth: 0, previewWidth: 390 },
      { id: 'tablet', name: 'Tablet', minWidth: 768, previewWidth: 768 },
      { id: 'desktop', name: 'Desktop', minWidth: 1200, previewWidth: 1440 },
    ]
    document.nodes.headline.responsive = {
      tablet: { hidden: true },
      desktop: { hidden: false },
    }
    const { css } = compileCanvas(document)

    expect(css).toContain(
      '@media(min-width:768px) and (max-width:1199.98px){.loora-headline{display:none}}',
    )
  })

  it('exports a font stack as separate families', () => {
    const document = fixture()
    document.nodes.headline.style.typography!.family =
      '"Helvetica Neue", Arial, sans-serif'
    expect(compileCanvas(document).css).toContain(
      'font-family:"Helvetica Neue", "Arial", sans-serif',
    )
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

  it('switches generic named themes from local state in every code export', () => {
    const document = fixture()
    const page = document.nodes.page
    if (page.type !== 'page') throw new Error('Fixture Page is missing')
    document.themes.focus = { id: 'focus', name: 'Focus' }
    document.tokens.accent = {
      id: 'accent',
      name: 'Accent',
      type: 'color',
      value: '#3b82f6',
      modes: { focus: '#f59e0b' },
    }
    page.states = {
      visualMode: {
        id: 'visualMode',
        name: 'Visual mode',
        type: 'string',
        initial: 'default',
      },
    }
    document.nodes.hero.interactions = [
      {
        trigger: 'click',
        actions: [
          {
            type: 'set-state',
            stateId: 'visualMode',
            value: 'focus',
          },
        ],
      },
    ]
    page.interactions = [
      {
        trigger: 'state-change',
        stateId: 'visualMode',
        when: [
          {
            stateId: 'visualMode',
            operator: 'equals',
            value: 'focus',
          },
        ],
        actions: [{ type: 'set-theme', themeId: 'focus' }],
      },
    ]

    const compiled = compileCanvas(document)
    const react = compileReactComponent(document)
    const jsx = compileJsxComponent(document)
    const tailwind = compileTailwindComponent(document)

    expect(compiled.html).toContain('data-loora-theme-values=')
    expect(compiled.runtime).toContain("action.type==='set-theme'")
    expect(react).toContain("action.type === 'set-theme'")
    expect(jsx).toContain('data-loora-theme-values=')
    expect(tailwind).toContain('data-loora-theme-values=')

    const sandbox =
      globalThis.document.implementation.createHTMLDocument('theme-runtime')
    sandbox.body.innerHTML = compiled.html
    new Function('document', 'window', 'CSS', compiled.runtime)(
      sandbox,
      { open: () => null },
      { escape: (value: string) => value },
    )
    const click = sandbox.createEvent('Event')
    click.initEvent('click', true, true)
    sandbox
      .querySelector('[data-loora-node="hero"]')!
      .dispatchEvent(click)
    const renderedPage = sandbox.querySelector<HTMLElement>(
      '[data-loora-node="page"]',
    )!
    expect(renderedPage.dataset.looraTheme).toBe('focus')
    expect(
      renderedPage.style.getPropertyValue('--loora-token-accent'),
    ).toBe('#f59e0b')
  })

  it('exports typed state, event conditions, and a bounded local runtime', () => {
    const document = fixture()
    const page = document.nodes.page
    if (page.type !== 'page') throw new Error('Fixture Page is missing')
    page.states = {
      menuOpen: {
        id: 'menuOpen',
        name: 'Menu open',
        type: 'boolean',
        initial: false,
      },
    }
    document.nodes.hero.interactions = [
      {
        trigger: 'click',
        actions: [{ type: 'toggle-state', stateId: 'menuOpen' }],
      },
    ]
    page.interactions = [
      {
        trigger: 'state-change',
        stateId: 'menuOpen',
        when: [
          {
            stateId: 'menuOpen',
            operator: 'equals',
            value: true,
          },
        ],
        actions: [
          { type: 'visibility', nodeId: 'headline', value: 'show' },
        ],
      },
      {
        trigger: 'state-change',
        stateId: 'menuOpen',
        when: [
          {
            stateId: 'menuOpen',
            operator: 'equals',
            value: false,
          },
        ],
        actions: [
          { type: 'visibility', nodeId: 'headline', value: 'hide' },
        ],
      },
    ]

    const compiled = compileCanvas(document)
    const react = compileReactComponent(document)
    const jsx = compileJsxComponent(document)
    const tailwind = compileTailwindComponent(document)

    expect(compiled.html).toContain('data-loora-states=')
    expect(compiled.html).toContain('toggle-state')
    expect(compiled.runtime).toContain("action.type==='toggle-state'")
    expect(compiled.runtime).toContain('if(depth>20)return')
    expect(react).toContain('useState(0)')
    expect(react).toContain("handle('double-click')")
    expect(jsx).toContain('data-loora-interactions=')
    expect(tailwind).toContain('data-loora-states=')
    expect(jsx).toContain('useLooraRuntime(rootRef)')
    expect(tailwind).toContain('useLooraRuntime(rootRef)')
    expect(() => new Function(compiled.runtime)).not.toThrow()
    const transpiler = new Bun.Transpiler({ loader: 'tsx' })
    expect(() => transpiler.transformSync(react)).not.toThrow()
    expect(() => transpiler.transformSync(jsx)).not.toThrow()
    expect(() => transpiler.transformSync(tailwind)).not.toThrow()

    const sandbox =
      globalThis.document.implementation.createHTMLDocument('runtime')
    sandbox.body.innerHTML = compiled.html
    new Function('document', 'window', 'CSS', compiled.runtime)(
      sandbox,
      { open: () => null },
      { escape: (value: string) => value },
    )
    const headline = sandbox.querySelector<HTMLElement>(
      '[data-loora-node="headline"]',
    )!
    expect(headline.hidden).toBe(true)
    const click = sandbox.createEvent('Event')
    click.initEvent('click', true, true)
    sandbox
      .querySelector('[data-loora-node="hero"]')!
      .dispatchEvent(click)
    expect(headline.hidden).toBe(false)
    expect(
      sandbox
        .querySelector('[data-loora-node="page"]')
        ?.getAttribute('data-loora-state-values'),
    ).toContain('"menuOpen":true')
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

  it('keeps component state local to each rendered instance', () => {
    const document = createCanvasDocument('Local state', 'local-state')
    document.nodes.page = createPageNode('Home', { id: 'page' })
    document.nodes.component = createComponentNode('Toggle', {
      id: 'component',
      order: 2_048,
      states: {
        active: {
          id: 'active',
          name: 'Active',
          type: 'boolean',
          initial: false,
        },
      },
      interactions: [
        {
          trigger: 'state-change',
          stateId: 'active',
          when: [
            { stateId: 'active', operator: 'equals', value: false },
          ],
          actions: [
            { type: 'visibility', nodeId: 'label', value: 'hide' },
          ],
        },
        {
          trigger: 'state-change',
          stateId: 'active',
          when: [
            { stateId: 'active', operator: 'equals', value: true },
          ],
          actions: [
            { type: 'visibility', nodeId: 'label', value: 'show' },
          ],
        },
      ],
    })
    document.nodes.button = createFrameNode('Toggle', {
      id: 'button',
      parentId: 'component',
      order: 1_024,
      semanticTag: 'button',
      interactions: [
        {
          trigger: 'click',
          actions: [{ type: 'toggle-state', stateId: 'active' }],
        },
      ],
    })
    document.nodes.label = createTextNode('Active', {
      id: 'label',
      parentId: 'component',
      order: 2_048,
    })
    document.nodes.first = createInstanceNode('component', 'First', {
      id: 'first',
      parentId: 'page',
      order: 1_024,
    })
    document.nodes.second = createInstanceNode('component', 'Second', {
      id: 'second',
      parentId: 'page',
      order: 2_048,
    })

    const compiled = compileCanvas(document)
    const sandbox =
      globalThis.document.implementation.createHTMLDocument('instances')
    sandbox.body.innerHTML = compiled.html
    new Function('document', 'window', 'CSS', compiled.runtime)(
      sandbox,
      { open: () => null },
      { escape: (value: string) => value },
    )

    const scopes = sandbox.querySelectorAll<HTMLElement>(
      '[data-loora-component-root]',
    )
    expect(scopes).toHaveLength(2)
    const firstLabel = scopes[0]!.querySelector<HTMLElement>(
      '[data-loora-node="label"]',
    )!
    const secondLabel = scopes[1]!.querySelector<HTMLElement>(
      '[data-loora-node="label"]',
    )!
    expect(firstLabel.hidden).toBe(true)
    expect(secondLabel.hidden).toBe(true)

    const click = sandbox.createEvent('Event')
    click.initEvent('click', true, true)
    scopes[0]!
      .querySelector('[data-loora-node="button"]')!
      .dispatchEvent(click)
    expect(firstLabel.hidden).toBe(false)
    expect(secondLabel.hidden).toBe(true)
  })

  it('keeps hidden flex frames hidden in CSS and when shown at runtime', () => {
    const document = fixture()
    document.nodes.panel = createFrameNode('Panel', {
      id: 'panel',
      parentId: 'page',
      order: 2_048,
    })
    document.nodes.panel.layout = {
      ...document.nodes.panel.layout,
      mode: 'flex',
      direction: 'row',
    }
    document.nodes.panel.hidden = true
    document.nodes.hero.interactions = [
      {
        trigger: 'click',
        actions: [{ type: 'visibility', nodeId: 'panel', value: 'show' }],
      },
    ]

    const compiled = compileCanvas(document)
    const rule = compiled.css
      .split('\n')
      .find((line) => line.startsWith('.loora-panel{'))!
    expect(rule).toContain('display:flex')
    expect(rule.lastIndexOf('display:none')).toBeGreaterThan(
      rule.indexOf('display:flex'),
    )

    const sandbox =
      globalThis.document.implementation.createHTMLDocument('visibility')
    sandbox.body.innerHTML = compiled.html
    new Function('document', 'window', 'CSS', compiled.runtime)(
      sandbox,
      { open: () => null },
      { escape: (value: string) => value },
    )
    const panel = sandbox.querySelector<HTMLElement>(
      '[data-loora-node="panel"]',
    )!
    const click = sandbox.createEvent('Event')
    click.initEvent('click', true, true)
    sandbox.querySelector('[data-loora-node="hero"]')!.dispatchEvent(click)
    expect(panel.hidden).toBe(false)
    expect(panel.style.display).toBe('')
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
    expect(images[0]!.getAttribute('src')).toMatch(/^data:image\/gif;base64,/)
    expect(images[0]!.hasAttribute('srcset')).toBe(false)
    expect(images[1]!.getAttribute('src')).toMatch(/^data:image\/png/)
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

  it('fetches a repeated image once before reusing its data URL', async () => {
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'Content-Type': 'image/png' },
      })
    }) as unknown as typeof fetch
    const host = document.createElement('div')
    host.innerHTML = '<img src="/api/asset/a1"><img src="/api/asset/a1">'

    expect(await inlineBrowserImages(host)).toEqual([])
    expect(fetches).toBe(1)
    const sources = [...host.querySelectorAll('img')].map((image) =>
      image.getAttribute('src'),
    )
    expect(sources[0]).toMatch(/^data:image\/png/)
    expect(sources[1]).toBe(sources[0])
  })

  it('bounds simultaneous image reads during a capture', async () => {
    let active = 0
    let maximum = 0
    globalThis.fetch = (async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'Content-Type': 'image/png' },
      })
    }) as unknown as typeof fetch
    const host = document.createElement('div')
    host.innerHTML = Array.from(
      { length: 12 },
      (_, index) => `<img src="/api/asset/${index}">`,
    ).join('')

    expect(await inlineBrowserImages(host)).toEqual([])
    expect(maximum).toBe(4)
  })

  it('refuses a PNG allocation large enough to exhaust browser memory', async () => {
    const host = document.createElement('div')
    await expect(
      renderElementToPng(host, {
        width: 10_000,
        height: 10_000,
        pixelRatio: 2,
      }),
    ).rejects.toThrow('too large to capture safely')
  })

  it('rewrites asset routes through assetUrl for published HTML snapshots', () => {
    const document = fixture()
    const { semanticTag: _tag, ...base } = createFrameNode('Shot', {
      id: 'shot',
      parentId: 'page',
      order: 3_072,
    })
    document.nodes.shot = {
      ...base,
      type: 'image',
      src: '/api/asset/a0123456789abcdef0123456789abcdef',
      alt: 'Shot',
      fit: 'fill',
    }
    const html = compileStandaloneHtml(document, {
      pageId: 'page',
      assetUrl: (src) =>
        src.startsWith('/api/asset/')
          ? `data:image/png;base64,aaaa`
          : src,
    })
    expect(html).toContain('data:image/png;base64,aaaa')
    expect(html).not.toContain('/api/asset/')
  })
})
