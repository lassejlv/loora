import { describe, expect, it } from 'bun:test'
import {
  applyCanvasActions,
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
})
