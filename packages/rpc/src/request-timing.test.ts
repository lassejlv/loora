import { describe, expect, it } from 'bun:test'
import {
  requestIdFromHeaders,
  serverTimingHeader,
  withRequestTimingHeaders,
} from './request-timing'

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
})
