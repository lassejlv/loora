import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  logRequestTiming,
  requestIdFromHeaders,
  serverTimingHeader,
  withRequestTimingHeaders,
} from './request-timing'

const originalLogRequestTiming = process.env.LOG_REQUEST_TIMING

afterEach(() => {
  if (originalLogRequestTiming == null) delete process.env.LOG_REQUEST_TIMING
  else process.env.LOG_REQUEST_TIMING = originalLogRequestTiming
})

describe('request timing', () => {
  it('keeps safe upstream request ids and replaces unsafe ones', () => {
    expect(
      requestIdFromHeaders(new Headers({ 'x-request-id': 'edge:request-12' })),
    ).toBe('edge:request-12')

    expect(
      requestIdFromHeaders(new Headers({ 'x-request-id': 'bad request id' })),
    ).not.toBe('bad request id')
  })

  it('serializes bounded timing values into response headers', async () => {
    expect(
      serverTimingHeader([
        { name: 'session', durationMs: 12.34 },
        { name: 'bad token', durationMs: 5 },
        { name: 'negative', durationMs: -1 },
      ]),
    ).toBe('session;dur=12.3')

    const response = withRequestTimingHeaders(
      new Response('ok', { status: 201 }),
      'request-1',
      [{ name: 'total', durationMs: 8.88 }],
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('x-request-id')).toBe('request-1')
    expect(response.headers.get('server-timing')).toBe('total;dur=8.9')
    expect(await response.text()).toBe('ok')
  })

  it('skips console request logs unless LOG_REQUEST_TIMING is enabled', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    delete process.env.LOG_REQUEST_TIMING
    logRequestTiming({
      service: 'web',
      requestId: 'request-1',
      method: 'POST',
      path: '/api/rpc/design.list',
      status: 200,
      durationMs: 12.3,
    })
    expect(info).not.toHaveBeenCalled()

    process.env.LOG_REQUEST_TIMING = 'true'
    logRequestTiming({
      service: 'web',
      requestId: 'request-1',
      method: 'POST',
      path: '/api/rpc/design.list',
      status: 200,
      durationMs: 12.3,
      phases: { session: 1.23, handler: 10.45 },
    })
    expect(info).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      event: 'api.request',
      service: 'web',
      requestId: 'request-1',
      method: 'POST',
      path: '/api/rpc/design.list',
      status: 200,
      durationMs: 12.3,
      phases: { session: 1.2, handler: 10.5 },
    })

    info.mockRestore()
  })
})
