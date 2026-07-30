import { describe, expect, it } from 'bun:test'
import { serviceReadinessResponse } from './readiness'

describe('service readiness', () => {
  it('reports a ready database without exposing internals', async () => {
    const response = await serviceReadinessResponse('web', async () => {})

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      service: 'web',
      status: 'ready',
      checks: { database: 'ready' },
    })
  })

  it('returns a retryable failure without exposing the database error', async () => {
    const response = await serviceReadinessResponse('mcp', async () => {
      throw new Error('secret connection details')
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('5')
    expect(await response.text()).not.toContain('secret connection details')
  })
})
