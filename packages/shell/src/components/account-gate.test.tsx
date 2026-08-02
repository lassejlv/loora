import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

let sessionState: {
  data: { user: { id: string } } | null
  isPending: boolean
} = {
  data: null,
  isPending: false,
}

const getShare = vi.fn()

function StatefulAuthScreen() {
  const [notice, setNotice] = useState('')

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNotice('Check your inbox to verify your email and finish signing up.')
        }}
      >
        Complete sign up
      </button>
      {notice ? <p>{notice}</p> : null}
    </>
  )
}

vi.doMock('@loora/auth/client', () => ({
  authClient: {
    useSession: () => sessionState,
  },
}))
vi.doMock('@loora/rpc/client', () => ({
  orpc: { share: { get: getShare } },
}))
vi.doMock('@loora/editor/app', () => ({
  CanvasApp: () => <div>Canvas preview</div>,
}))
vi.doMock('./auth-screen', () => ({
  AuthScreen: StatefulAuthScreen,
}))
vi.doMock('./preview-access-screen', () => ({
  PreviewAccessScreen: ({ children }: { children: React.ReactNode }) => children,
}))
vi.doMock('./subscription-screen', () => ({
  SubscriptionScreen: ({ children }: { children: React.ReactNode }) => children,
}))
vi.doMock('./legal-consent-screen', () => ({
  LegalConsentScreen: ({ children }: { children: React.ReactNode }) => children,
}))
vi.doMock('./welcome-dialog', () => ({
  WelcomeDialog: () => null,
  hasSeenWelcome: () => true,
  markWelcomeSeen: () => {},
}))

const { AccountGate } = await import('./account-gate')

describe('AccountGate', () => {
  beforeEach(() => {
    sessionState = { data: null, isPending: false }
    getShare.mockReset()
  })

  afterEach(() => cleanup())

  test('keeps the verification notice mounted during the post-sign-up session refetch', () => {
    const view = render(
      <AccountGate>
        <div>Editor</div>
      </AccountGate>,
    )

    const notice = 'Check your inbox to verify your email and finish signing up.'
    fireEvent.click(screen.getByRole('button', { name: 'Complete sign up' }))
    expect(screen.getByText(notice)).toBeTruthy()

    sessionState = { data: null, isPending: true }
    view.rerender(
      <AccountGate>
        <div>Editor</div>
      </AccountGate>,
    )

    expect(screen.getByText(notice)).toBeTruthy()
    expect(screen.queryByText('Opening your canvas…')).toBeNull()
  })

  test('a client that signs in elsewhere renders its own screen instead', () => {
    render(
      <AccountGate renderSignedOut={() => <p>Sign in at loora.design</p>}>
        <div>Editor</div>
      </AccountGate>,
    )

    expect(screen.getByText('Sign in at loora.design')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete sign up' })).toBeNull()
  })

  test('shows the loading state during the initial session lookup', () => {
    sessionState = { data: null, isPending: true }

    render(
      <AccountGate>
        <div>Editor</div>
      </AccountGate>,
    )

    expect(screen.getByText('Opening your canvas…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete sign up' })).toBeNull()
  })
})
