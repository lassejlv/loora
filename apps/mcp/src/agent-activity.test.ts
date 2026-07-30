import { describe, expect, test } from 'bun:test'
import {
  agentActivityNodeIds,
  agentActivityTarget,
  trackAgentActivity,
} from './agent-activity'

describe('Agent activity', () => {
  test('rings the nodes a call names, edited ones first', () => {
    expect(
      agentActivityNodeIds({
        designId: 'design-1',
        changes: [
          { ref: { nodeId: 'text-title', instancePath: [] }, patch: {} },
          { ref: { nodeId: 'text-body', instancePath: [] }, patch: {} },
        ],
      }),
    ).toEqual(['text-title', 'text-body'])
    expect(
      agentActivityNodeIds({
        designId: 'design-1',
        parent: { nodeId: 'page-home', instancePath: [] },
        nodes: [{ type: 'text', text: 'Hello' }],
      }),
    ).toEqual(['page-home'])
    expect(
      agentActivityNodeIds({ designId: 'design-1', nodeIds: ['a', 'a', 'b'] }),
    ).toEqual(['a', 'b'])
    expect(agentActivityNodeIds({ designId: 'design-1' })).toEqual([])
  })

  test('reads the target and skips calls without a design', () => {
    expect(
      agentActivityTarget({ designId: ' design-1 ', draftId: ' branch-1 ' }),
    ).toEqual({ designId: 'design-1', draftId: 'branch-1' })
    expect(agentActivityTarget({ designId: 'design-1' })).toEqual({
      designId: 'design-1',
      draftId: null,
    })
    expect(agentActivityTarget({ name: 'New design' })).toBeNull()
    expect(agentActivityTarget('design-1')).toBeNull()
  })

  test('tracks nothing for tools without a design or a label', () => {
    expect(trackAgentActivity('user-1', 'createDesign', { name: 'X' })).toBeNull()
    expect(
      trackAgentActivity('user-1', 'getUsage', { designId: 'design-1' }),
    ).toBeNull()
  })

  test('shares one run across overlapping calls on the same document', async () => {
    const published: { id: string; phase: string; label: string }[] = []
    const publish = async (
      _userId: string,
      _target: unknown,
      activity: { id: string; phase: string; label: string } | null,
    ) => {
      if (activity) published.push(activity)
      return true
    }
    const args = { designId: 'design-overlap' }
    const first = trackAgentActivity('user-1', 'readTree', args, publish)
    const second = trackAgentActivity(
      'user-1',
      'patchNodes',
      {
        ...args,
        changes: [
          { ref: { nodeId: 'text-title', instancePath: [] }, patch: {} },
        ],
      },
      publish,
    )
    first?.end()
    // Ending twice must not settle a run that another call still holds.
    first?.end()
    expect(published.map((entry) => entry.phase)).toEqual([
      'working',
      'working',
    ])
    second?.end()
    expect(published).toHaveLength(3)
    expect(published[2]).toMatchObject({
      phase: 'settled',
      label: 'Editing elements',
    })
    expect(new Set(published.map((entry) => entry.id)).size).toBe(1)
  })
})
