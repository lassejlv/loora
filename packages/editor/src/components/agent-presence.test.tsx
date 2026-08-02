import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { CanvasEngine } from '@loora/canvas/engine'
import { createCanvasDocument } from '@loora/canvas/model'
import { CanvasProvider } from '@loora/canvas/react'
import { CanvasAgentOverlay } from './agent-presence'
import type { CanvasEditorController } from './editor'

describe('CanvasAgentOverlay', () => {
  test('draws once per event instead of keeping an idle animation loop alive', () => {
    const callbacks: FrameRequestCallback[] = []
    const requestAnimationFrame = window.requestAnimationFrame
    const cancelAnimationFrame = window.cancelAnimationFrame
    window.requestAnimationFrame = (callback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    window.cancelAnimationFrame = () => {}

    const engine = new CanvasEngine(createCanvasDocument('Agent', 'agent'))
    const controller: CanvasEditorController = {
      engine,
      status: 'ready',
      pendingCount: 0,
      agentActivity: {
        id: 'activity',
        label: 'Agent is working',
        nodeIds: [],
        phase: 'working',
        updatedAt: 1,
      },
      subscribe: () => () => {},
      subscribePresence: () => () => {},
      enqueue: () => {},
    }

    try {
      const view = render(
        <CanvasProvider engine={engine}>
          <CanvasAgentOverlay controller={controller} />
        </CanvasProvider>,
      )

      expect(callbacks).toHaveLength(1)
      callbacks.shift()!(0)
      expect(callbacks).toHaveLength(0)
      view.unmount()
    } finally {
      window.requestAnimationFrame = requestAnimationFrame
      window.cancelAnimationFrame = cancelAnimationFrame
    }
  })
})
