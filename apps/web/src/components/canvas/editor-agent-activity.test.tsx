import { describe, expect, test } from 'bun:test'
import { render, waitFor } from '@testing-library/react'
import { CanvasEngine, type CanvasTransaction } from '@loora/canvas/engine'
import { createStarterCanvas } from '#/lib/canvas-fixtures'
import { CanvasEditor, type CanvasEditorController } from './editor'

describe('Canvas agent activity', () => {
  test('shows the quiet dot marker at the active agent target', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
    const controller: CanvasEditorController = {
      engine: new CanvasEngine(createStarterCanvas('activity', 'Activity')),
      status: 'ready',
      pendingCount: 0,
      agentActivity: {
        id: 'activity-1',
        label: 'Agent is updating the hero',
        nodeIds: ['activity-title'],
        phase: 'working',
        updatedAt: Date.now(),
      },
      subscribe: () => () => {},
      enqueue: (_transaction: CanvasTransaction) => {},
    }
    const view = render(
      <div style={{ width: 1_200, height: 800 }}>
        <CanvasEditor controller={controller} name="Activity" />
      </div>,
    )

    expect(
      view.getByRole('status', { name: 'Agent is updating the hero' }),
    ).toBeTruthy()
    expect(view.container.querySelectorAll('.cx-agent-dot')).toHaveLength(24)
    await waitFor(() =>
      expect(
        view.container.querySelector<HTMLElement>('.cx-agent-dots')?.style
          .opacity,
      ).toBe('1'),
    )
  })
})
