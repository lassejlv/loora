import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const legalConsent = mock()
const acceptLegal = mock()
const signOut = mock()

mock.module('@loora/rpc/client', () => ({
  orpc: { auth: { legalConsent, acceptLegal } },
}))
mock.module('@loora/auth/client', () => ({
  authClient: { signOut },
}))

const { LegalConsentScreen } = await import('./legal-consent-screen')
const { markPendingLegalConsent } = await import('../lib/pending-legal-consent')

function renderScreen() {
  return render(
    <LegalConsentScreen preview={<div>Preview canvas</div>}>
      <div>Preview access gate</div>
    </LegalConsentScreen>,
  )
}

describe('LegalConsentScreen', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    legalConsent.mockReset().mockResolvedValue({ accepted: false })
    acceptLegal.mockReset().mockResolvedValue({ accepted: true })
    signOut.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  test('keeps every downstream gate unmounted until legal consent is accepted', async () => {
    renderScreen()

    expect(await screen.findByText('Before you continue')).toBeTruthy()
    expect(screen.queryByText('Preview access gate')).toBeNull()
    expect(screen.getByText('Preview canvas')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Accept and continue' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  test('accepts both documents before mounting downstream gates', async () => {
    renderScreen()

    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }))

    await waitFor(() =>
      expect(acceptLegal).toHaveBeenCalledWith({
        acceptedTerms: true,
        acceptedPrivacy: true,
      }),
    )
    expect(await screen.findByText('Preview access gate')).toBeTruthy()
    expect(screen.queryByText('Before you continue')).toBeNull()
  })

  test('mounts downstream gates immediately after a current agreement is confirmed', async () => {
    legalConsent.mockResolvedValue({ accepted: true })
    renderScreen()

    expect(await screen.findByText('Preview access gate')).toBeTruthy()
    expect(screen.queryByText('Before you continue')).toBeNull()
  })

  test('records the checkbox confirmed before a social signup redirect', async () => {
    markPendingLegalConsent()
    renderScreen()

    expect(await screen.findByText('Preview access gate')).toBeTruthy()
    expect(acceptLegal).toHaveBeenCalledWith({
      acceptedTerms: true,
      acceptedPrivacy: true,
    })
    expect(window.sessionStorage.length).toBe(0)
  })
})
