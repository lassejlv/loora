import { afterEach, describe, expect, vi, test } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { configureRuntime } from '@loora/platform'
import { StatusBadge } from './status-badge'

const realFetch = globalThis.fetch

function mockSummary(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch
}

afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  configureRuntime({ platform: 'web' })
})

describe('StatusBadge', () => {
  test('shows the operational label when the page is up', async () => {
    mockSummary({ page: { status: 'UP' } })
    render(<StatusBadge />)
    await waitFor(() => expect(screen.getByText('All systems normal')).toBeTruthy())
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://loora.instatus.com')
  })

  test('names the active incident when there is one', async () => {
    mockSummary({
      page: { status: 'HASISSUES' },
      activeIncidents: [{ name: 'Elevated error rates' }],
    })
    render(<StatusBadge />)
    await waitFor(() => expect(screen.getByText('Elevated error rates')).toBeTruthy())
  })

  test('renders nothing when the status page cannot be read', async () => {
    mockSummary({}, false)
    const { container } = render(<StatusBadge />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  test('renders nothing in the desktop app, and never fetches', async () => {
    mockSummary({ page: { status: 'UP' } })
    configureRuntime({ platform: 'desktop' })
    const { container } = render(<StatusBadge />)
    expect(container.textContent).toBe('')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
