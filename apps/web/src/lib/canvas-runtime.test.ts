import { describe, expect, it } from 'bun:test'
import {
  applyCanvasActions,
  canvasInteractionActions,
  initialCanvasState,
  setCanvasVariant,
} from './canvas-runtime'

describe('Canvas declarative runtime', () => {
  it('switches text, images, and nested component variants', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-loora-node="instance" data-loora-component>
        <span data-loora-node="label">Default</span>
        <img data-loora-node="image" src="data:image/png;base64,AA==" alt="Default">
        <div data-loora-node="nested" data-loora-component></div>
      </div>
    `
    const instance = root.querySelector<HTMLElement>(
      '[data-loora-node="instance"]',
    )!
    const nested = root.querySelector<HTMLElement>(
      '[data-loora-node="nested"]',
    )!
    instance.dataset.looraVariantContent = JSON.stringify({
      active: {
        label: { html: 'Active' },
        image: {
          src: 'data:image/png;base64,AQ==',
          alt: 'Active image',
        },
        nested: { variant: 'compact' },
      },
    })

    setCanvasVariant(instance, 'active')

    expect(instance.dataset.looraVariant).toBe('active')
    expect(
      root.querySelector('[data-loora-node="label"]')?.textContent,
    ).toBe('Active')
    expect(
      root.querySelector<HTMLImageElement>('[data-loora-node="image"]')?.alt,
    ).toBe('Active image')
    expect(nested.dataset.looraVariant).toBe('compact')
  })

  it('applies visibility and overlay actions without script execution', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-loora-node="target"></div>
      <div data-loora-node="overlay"></div>
    `
    const target = root.querySelector<HTMLElement>(
      '[data-loora-node="target"]',
    )!
    const overlay = root.querySelector<HTMLElement>(
      '[data-loora-node="overlay"]',
    )!

    applyCanvasActions(root, [
      { type: 'visibility', nodeId: 'target', value: 'hide' },
      { type: 'open-overlay', pageId: 'overlay' },
    ])
    expect(target.hidden).toBe(true)
    expect(overlay.dataset.looraOverlay).toBe('open')

    applyCanvasActions(root, [
      { type: 'visibility', nodeId: 'target', value: 'toggle' },
      { type: 'close-overlay' },
    ])
    expect(target.hidden).toBe(false)
    expect(overlay.dataset.looraOverlay).toBeUndefined()
  })

  it('switches any named theme and applies its token mode values', () => {
    const root = document.createElement('main')
    root.dataset.looraTheme = 'default'
    root.dataset.looraThemeValues = JSON.stringify({
      default: {
        '--loora-token-accent': '#3b82f6',
      },
      focus: {
        '--loora-token-accent': '#f59e0b',
      },
    })

    applyCanvasActions(root, [
      { type: 'set-theme', themeId: 'focus' },
    ])

    expect(root.dataset.looraTheme).toBe('focus')
    expect(root.style.getPropertyValue('--loora-token-accent')).toBe(
      '#f59e0b',
    )
  })

  it('keeps typed state ephemeral and selects conditional state-change actions', () => {
    const state = initialCanvasState({
      menuOpen: {
        id: 'menuOpen',
        name: 'Menu open',
        type: 'boolean',
        initial: false,
      },
      count: {
        id: 'count',
        name: 'Count',
        type: 'number',
        initial: 1,
      },
    })
    const changed: string[] = []

    applyCanvasActions(
      document.createElement('div'),
      [
        { type: 'toggle-state', stateId: 'menuOpen' },
        { type: 'increment-state', stateId: 'count', amount: 2 },
      ],
      {
        state,
        onStateChange: (stateId) => changed.push(stateId),
      },
    )

    expect(state).toEqual({ menuOpen: true, count: 3 })
    expect(changed).toEqual(['menuOpen', 'count'])
    expect(
      canvasInteractionActions(
        [
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
              { type: 'visibility', nodeId: 'menu', value: 'show' },
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
              { type: 'visibility', nodeId: 'menu', value: 'hide' },
            ],
          },
        ],
        'state-change',
        state,
        'menuOpen',
      ),
    ).toEqual([
      { type: 'visibility', nodeId: 'menu', value: 'show' },
    ])
  })
})
