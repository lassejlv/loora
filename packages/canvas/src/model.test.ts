import { describe, expect, it } from 'bun:test'
import {
  assertDocument,
  canvasDocumentSchema,
  canvasCommentPinSchema,
  createCanvasDocument,
  createComponentNode,
  createFrameNode,
  createInstanceNode,
  createPageNode,
  createTextNode,
  validateDocument,
  validateNodeRef,
} from './model'

function documentFixture() {
  const document = createCanvasDocument('Fixture', 'doc')
  const page = createPageNode('Home', { id: 'page', order: 1024 })
  const frame = createFrameNode('Hero', {
    id: 'hero',
    parentId: page.id,
    order: 1024,
  })
  const text = createTextNode('Hello', {
    id: 'headline',
    parentId: frame.id,
    order: 1024,
  })
  document.nodes = {
    [page.id]: page,
    [frame.id]: frame,
    [text.id]: text,
  }
  return document
}

describe('CanvasDocument', () => {
  it('accepts a normalized editable page tree', () => {
    const document = documentFixture()
    expect(assertDocument(document)).toBe(document)
    expect(canvasDocumentSchema.safeParse(document).success).toBe(true)
  })

  it('validates typed local state and declarative event transitions', () => {
    const document = documentFixture()
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
    ]

    expect(validateDocument(document).ok).toBe(true)

    document.nodes.hero.interactions = [
      {
        trigger: 'click',
        actions: [
          { type: 'increment-state', stateId: 'menuOpen', amount: 1 },
        ],
      },
    ]
    expect(
      validateDocument(document).issues.some(
        (issue) => issue.path === 'nodes.hero.interactions',
      ),
    ).toBe(true)
  })

  it('rejects content roots and hierarchy cycles', () => {
    const document = documentFixture()
    document.nodes.hero.parentId = null
    let result = validateDocument(document)
    expect(result.issues.some((issue) => issue.path === 'nodes.hero.parentId')).toBe(true)

    document.nodes.hero.parentId = 'headline'
    result = validateDocument(document)
    expect(result.issues.some((issue) => issue.message.includes('cycle'))).toBe(true)
  })

  it('rejects unsafe image and SVG payloads', () => {
    const document = documentFixture()
    document.nodes.image = {
      ...createFrameNode('Image', {
        id: 'image',
        parentId: 'page',
        order: 2048,
      }),
      type: 'image',
      src: 'data:image/svg+xml,<svg onload=alert(1)>',
      alt: '',
      fit: 'cover',
    }
    document.nodes.vector = {
      ...createFrameNode('Vector', {
        id: 'vector',
        parentId: 'page',
        order: 3072,
      }),
      type: 'vector',
      viewBox: '0 0 100 100',
      paths: [{ d: '<script>alert(1)</script>' }],
    }
    const result = validateDocument(document)
    expect(result.issues.some((issue) => issue.path === 'nodes.image.src')).toBe(true)
    expect(result.issues.some((issue) => issue.path === 'nodes.vector')).toBe(true)
  })

  it('validates instance paths without duplicating component descendants', () => {
    const document = documentFixture()
    document.nodes.component = createComponentNode('Button', {
      id: 'component',
      parentId: null,
      order: 2048,
      variants: ['default', 'hover'],
      defaultVariant: 'default',
      variantOverrides: {
        hover: {
          label: {
            text: 'Buy now',
          },
        },
      },
    })
    document.nodes.label = createTextNode('Buy', {
      id: 'label',
      parentId: 'component',
      order: 1024,
    })
    document.nodes.button = createInstanceNode(
      'component',
      'Button instance',
      {
        id: 'button',
        parentId: 'hero',
        order: 2048,
        overrides: { label: { text: 'Start' } },
      },
    )
    expect(validateDocument(document).ok).toBe(true)
    expect(
      validateNodeRef(document, {
        nodeId: 'label',
        instancePath: ['button'],
      }).ok,
    ).toBe(true)
    expect(
      validateNodeRef(document, {
        nodeId: 'headline',
        instancePath: ['button'],
      }).ok,
    ).toBe(false)
    document.nodes.button.variant = 'missing'
    expect(
      validateDocument(document).issues.some(
        (issue) => issue.path === 'nodes.button.variant',
      ),
    ).toBe(true)
  })

  it('resolves responsive overrides from the largest matching minimum width', async () => {
    const { resolveNodeAtWidth } = await import('./model')
    const document = documentFixture()
    document.nodes.hero.responsive = {
      mobile: { layout: { gap: 8 } },
      tablet: { layout: { gap: 16 } },
      desktop: { layout: { gap: 24 } },
    }
    expect(resolveNodeAtWidth(document, document.nodes.hero, 400).layout.gap).toBe(8)
    expect(resolveNodeAtWidth(document, document.nodes.hero, 900).layout.gap).toBe(16)
    expect(resolveNodeAtWidth(document, document.nodes.hero, 1600).layout.gap).toBe(24)
  })

  it('accepts a partial typography override while still requiring a complete node style', () => {
    const document = documentFixture()
    document.nodes.headline.responsive = {
      mobile: { style: { typography: { size: 32 } } },
    }
    expect(validateDocument(document).ok).toBe(true)

    document.nodes.headline.style.typography = { size: 32 } as never
    expect(
      validateDocument(document).issues.some(
        (issue) => issue.path === 'nodes.headline.style',
      ),
    ).toBe(true)
  })

  it('rejects CSS and interaction injection at the model boundary', () => {
    const document = documentFixture()
    document.nodes.hero.style.fills = [
      {
        type: 'solid',
        color: 'red;background-image:url(https://evil.example/x)',
      },
    ]
    document.nodes.headline.style.typography!.family =
      'Archivo;position:fixed'
    document.nodes.headline.interactions = [
      {
        trigger: 'click',
        actions: [
          {
            type: 'open-url',
            url: 'javascript:alert(1)',
          },
        ],
      },
    ]
    const result = validateDocument(document)
    expect(
      result.issues.some((issue) => issue.path === 'nodes.hero.style'),
    ).toBe(true)
    expect(
      result.issues.some((issue) => issue.path === 'nodes.headline.style'),
    ).toBe(true)
    expect(
      result.issues.some(
        (issue) => issue.path === 'nodes.headline.interactions',
      ),
    ).toBe(true)
  })

  it('validates theme modes, dictionary ids, and exact root fields', () => {
    const document = documentFixture()
    document.themes.dark = { id: 'dark', name: 'Dark' }
    document.tokens.accent = {
      id: 'accent',
      name: 'Accent',
      type: 'color',
      value: '#ff00aa',
      modes: { dark: '#00aaff' },
    }
    document.activeThemeId = 'dark'
    expect(validateDocument(document).ok).toBe(true)

    document.breakpoints[0]!.id = 'mobile.width'
    ;(document as unknown as Record<string, unknown>).source = '<script />'
    const result = validateDocument(document)
    expect(
      result.issues.some((issue) => issue.path === 'breakpoints.0.id'),
    ).toBe(true)
    expect(
      result.issues.some(
        (issue) => issue.message === 'Canvas document contains unknown fields',
      ),
    ).toBe(true)
  })

  it('validates generic theme actions against named document themes', () => {
    const document = documentFixture()
    document.themes.focus = { id: 'focus', name: 'Focus' }
    document.nodes.hero.interactions = [
      {
        trigger: 'click',
        actions: [{ type: 'set-theme', themeId: 'focus' }],
      },
    ]
    expect(validateDocument(document).ok).toBe(true)

    document.nodes.hero.interactions = [
      {
        trigger: 'click',
        actions: [{ type: 'set-theme', themeId: 'missing' }],
      },
    ]
    expect(
      validateDocument(document).issues.some(
        (issue) => issue.path === 'nodes.hero.interactions',
      ),
    ).toBe(true)
  })

  it('rejects values that cannot survive a JSON round trip', () => {
    const document = documentFixture()
    ;(document.nodes.hero.metadata as Record<string, unknown>) = {
      missing: undefined,
    }
    expect(validateDocument(document).issues[0]).toMatchObject({
      message: 'Canvas document must be finite and serializable',
    })
  })

  it('validates comment pins against exact node references', () => {
    const document = documentFixture()
    const schema = canvasCommentPinSchema(document)
    expect(
      schema.safeParse({
        target: { nodeId: 'headline', instancePath: [] },
        x: 24,
        y: 12,
      }).success,
    ).toBe(true)
    expect(
      schema.safeParse({
        target: { nodeId: 'missing', instancePath: [] },
        x: Number.NaN,
        y: 12,
      }).success,
    ).toBe(false)
  })
})
