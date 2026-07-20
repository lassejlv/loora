import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const previewAccess = mock()
const requestPreviewAccess = mock()
const signOut = mock()

mock.module('#/lib/orpc-client', () => ({
  orpc: { auth: { previewAccess, requestPreviewAccess } },
}))
mock.module('@loora/auth/client', () => ({
  authClient: { signOut },
}))

const { PreviewAccessScreen } = await import('./preview-access-screen')

describe('PreviewAccessScreen', () => {
  beforeEach(() => {
    previewAccess.mockReset().mockResolvedValue({ granted: false, requested: false })
    requestPreviewAccess.mockReset().mockResolvedValue({ granted: false, requested: true })
    signOut.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('keeps billing and the editor unmounted until preview access is granted', async () => {
    render(
      <PreviewAccessScreen preview={<div>Preview canvas</div>}>
        <div>Billing gate</div>
      </PreviewAccessScreen>,
    )

    expect(await screen.findByRole('button', { name: 'Request Access to Preview' })).toBeTruthy()
    expect(screen.queryByText('Billing gate')).toBeNull()
    expect(screen.getByText('Preview canvas')).toBeTruthy()
  })

  test('mounts billing after preview access is granted', async () => {
    previewAccess.mockResolvedValue({ granted: true, requested: false })
    render(
      <PreviewAccessScreen preview={<div>Preview canvas</div>}>
        <div>Billing gate</div>
      </PreviewAccessScreen>,
    )

    expect(await screen.findByText('Billing gate')).toBeTruthy()
    expect(screen.queryByText('Request access to Loora Preview')).toBeNull()
  })

  test('submits an access request without exposing billing', async () => {
    render(
      <PreviewAccessScreen preview={<div>Preview canvas</div>}>
        <div>Billing gate</div>
      </PreviewAccessScreen>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Request Access to Preview' }))
    expect(await screen.findByText('Your request has been received.')).toBeTruthy()
    expect(requestPreviewAccess).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('Billing gate')).toBeNull())
  })
})
