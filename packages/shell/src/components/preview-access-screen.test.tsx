import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

const previewAccess = vi.fn()
const requestPreviewAccess = vi.fn()
const signOut = vi.fn()

vi.doMock('@loora/rpc/client', () => ({
  orpc: { auth: { previewAccess, requestPreviewAccess } },
}))
vi.doMock('@loora/auth/client', () => ({
  authClient: { signOut },
}))

const { PreviewAccessScreen } = await import('./preview-access-screen')

const CACHE_KEY = 'loora:access:preview:user-1'

function renderScreen() {
  return render(
    <PreviewAccessScreen userId="user-1" preview={<div>Preview canvas</div>}>
      <div>Billing gate</div>
    </PreviewAccessScreen>,
  )
}

describe('PreviewAccessScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    previewAccess.mockReset().mockResolvedValue({ granted: false, requested: false })
    requestPreviewAccess.mockReset().mockResolvedValue({ granted: false, requested: true })
    signOut.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('keeps billing and the editor unmounted until preview access is granted', async () => {
    renderScreen()

    expect(await screen.findByRole('button', { name: 'Request Access to Preview' })).toBeTruthy()
    expect(screen.queryByText('Billing gate')).toBeNull()
    expect(screen.getByText('Preview canvas')).toBeTruthy()
  })

  test('shows the loading shimmer, not the dialog, while the first check runs', () => {
    previewAccess.mockReturnValue(new Promise(() => {}))
    renderScreen()

    expect(screen.getByText('Opening your canvas…')).toBeTruthy()
    expect(screen.queryByText('Request access to Loora Preview')).toBeNull()
    expect(screen.queryByText('Billing gate')).toBeNull()
  })

  test('mounts billing after preview access is granted', async () => {
    previewAccess.mockResolvedValue({ granted: true, requested: false })
    renderScreen()

    expect(await screen.findByText('Billing gate')).toBeTruthy()
    expect(screen.queryByText('Request access to Loora Preview')).toBeNull()
    expect(window.localStorage.getItem(CACHE_KEY)).toBe('1')
  })

  test('mounts billing immediately from a cached verdict while the check re-runs', () => {
    window.localStorage.setItem(CACHE_KEY, '1')
    previewAccess.mockReturnValue(new Promise(() => {}))
    renderScreen()

    expect(screen.getByText('Billing gate')).toBeTruthy()
  })

  test('drops the cached verdict when the live check says access was revoked', async () => {
    window.localStorage.setItem(CACHE_KEY, '1')
    renderScreen()

    expect(screen.getByText('Billing gate')).toBeTruthy()
    expect(await screen.findByText('Request access to Loora Preview')).toBeTruthy()
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  test('submits an access request without exposing billing', async () => {
    renderScreen()

    fireEvent.click(await screen.findByRole('button', { name: 'Request Access to Preview' }))
    expect(await screen.findByText('Your request has been received.')).toBeTruthy()
    expect(requestPreviewAccess).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('Billing gate')).toBeNull())
  })
})
