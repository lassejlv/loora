import { describe, expect, test } from 'vitest'
import { app } from './index'

describe('API routing', () => {
  test('allows credentialed requests from the web app', async () => {
    const response = await app.request('/api/rpc/design.list', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000',
    )
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  test('keeps handoff capability URLs available to arbitrary origins', async () => {
    const response = await app.request('/api/handoff/token', {
      method: 'OPTIONS',
      headers: { Origin: 'https://agent.example' },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('does not proxy unknown API routes to the web service', async () => {
    const response = await app.request('/api/not-a-route')

    expect(response.status).toBe(404)
  })
})
