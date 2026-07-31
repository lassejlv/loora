import { describe, expect, test } from 'bun:test'
import { render, waitFor } from '@testing-library/react'
import { CanvasEngine, type CanvasTransaction } from '@loora/canvas/engine'
import { createStarterCanvas } from '../lib/canvas-fixtures'
import { CanvasEditor, type CanvasEditorController } from './editor'

function controllerFixture(
  activity: CanvasEditorController['agentActivity'],
): CanvasEditorController {
  return {
    engine: new CanvasEngine(createStarterCanvas('activity', 'Activity')),
    status: 'ready',
    pendingCount: 0,
    agentActivity: activity,
    subscribe: () => () => {},
    enqueue: (_transaction: CanvasTransaction) => {},
  }
}

describe('Canvas agent activity', () => {
  test('names the agent in the collaborator cluster and marks its target', async () => {
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
    const controller = controllerFixture({
      id: 'activity-1',
      label: 'Editing elements',
      nodeIds: ['activity-title'],
      phase: 'working',
      updatedAt: Date.now(),
    })
    const view = render(
      <div style={{ width: 1_200, height: 800 }}>
        <CanvasEditor controller={controller} name="Activity" />
      </div>,
    )

    expect(
      view.getByRole('status', { name: 'Editing elements' }),
    ).toBeTruthy()
    const badge = view.container.querySelector<HTMLElement>('.cx-agent-badge')
    expect(badge?.textContent).toContain('Editing elements')
    expect(badge?.dataset.phase).toBe('working')
    await waitFor(() => expect(badge?.dataset.visible).toBe('true'))
  })

  test('shows nothing while no agent is working', () => {
    const view = render(
      <div style={{ width: 1_200, height: 800 }}>
        <CanvasEditor controller={controllerFixture(null)} name="Activity" />
      </div>,
    )

    expect(view.container.querySelector('.cx-agent-badge')).toBeNull()
    expect(view.container.querySelector('.cx-agent-avatar')).toBeNull()
  })
})
