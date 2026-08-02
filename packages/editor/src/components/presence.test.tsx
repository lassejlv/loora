import { render } from '@testing-library/react'
import { describe, expect, vi, test } from 'vitest'
import { CanvasEngine } from '@loora/canvas/engine'
import { createCanvasDocument } from '@loora/canvas/model'
import { CanvasProvider } from '@loora/canvas/react'
import { CanvasCollaboratorPresence } from './presence'
import type { CanvasEditorController } from './editor'

describe('CanvasCollaboratorPresence', () => {
  test('coalesces pointer movement before reading scene geometry', () => {
    const callbacks: FrameRequestCallback[] = []
    const requestAnimationFrame = window.requestAnimationFrame
    const cancelAnimationFrame = window.cancelAnimationFrame
    const globalRequestAnimationFrame = globalThis.requestAnimationFrame
    const globalCancelAnimationFrame = globalThis.cancelAnimationFrame
    const scheduleFrame = (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    window.requestAnimationFrame = scheduleFrame
    window.cancelAnimationFrame = () => {}
    globalThis.requestAnimationFrame = scheduleFrame
    globalThis.cancelAnimationFrame = () => {}

    const surface = document.createElement('div')
    const scene = document.createElement('div')
    scene.dataset.looraCanvasScene = ''
    Object.defineProperty(scene, 'offsetWidth', { value: 1_000 })
    const getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 1_000,
      height: 800,
      right: 1_000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect)
    scene.getBoundingClientRect = getBoundingClientRect
    surface.append(scene)
    const publishPresence = vi.fn()
    const engine = new CanvasEngine(createCanvasDocument('Presence', 'presence'))
    const controller: CanvasEditorController = {
      engine,
      status: 'ready',
      pendingCount: 0,
      peers: [],
      publishPresence,
      subscribe: () => () => {},
      subscribePresence: () => () => {},
      enqueue: () => {},
    }

    try {
      const view = render(
        <CanvasProvider engine={engine}>
          <CanvasCollaboratorPresence
            controller={controller}
            camera={{ x: 0, y: 0, zoom: 1 }}
            surfaceRef={{ current: surface }}
          />
        </CanvasProvider>,
      )

      for (let index = 0; index < 100; index += 1) {
        surface.dispatchEvent(
          new PointerEvent('pointermove', { clientX: index, clientY: index }),
        )
      }
      expect(callbacks).toHaveLength(1)
      callbacks.shift()!(0)
      expect(getBoundingClientRect).toHaveBeenCalledTimes(1)

      for (let index = 0; index < 100; index += 1) {
        surface.dispatchEvent(
          new PointerEvent('pointermove', { clientX: index, clientY: index }),
        )
      }
      expect(callbacks).toHaveLength(0)
      expect(getBoundingClientRect).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally {
      window.requestAnimationFrame = requestAnimationFrame
      window.cancelAnimationFrame = cancelAnimationFrame
      globalThis.requestAnimationFrame = globalRequestAnimationFrame
      globalThis.cancelAnimationFrame = globalCancelAnimationFrame
    }
  })
})
