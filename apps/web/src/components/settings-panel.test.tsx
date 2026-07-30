import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createContext, useContext, type ReactNode } from 'react'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'

const billingStatus = mock()

const TabsContext = createContext('')

mock.module('#/lib/orpc-client', () => ({
  orpc: {
    billing: { status: billingStatus },
  },
}))
mock.module('@loora/auth/client', () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          id: 'user-1',
          name: 'Test User',
          email: 'test@example.com',
          isAdmin: false,
        },
      },
    }),
    signOut: mock(),
    customer: { portal: mock() },
  },
}))
mock.module('#/components/ui/tabs', () => ({
  Tabs: ({ value, children }: { value: string; children: ReactNode }) => (
    <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
  ),
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTab: ({ value, children }: { value: string; children: ReactNode }) => (
    <button role="tab" data-value={value}>{children}</button>
  ),
  TabsPanel: ({ value, children }: { value: string; children: ReactNode }) => (
    useContext(TabsContext) === value ? <div>{children}</div> : null
  ),
}))
mock.module('#/components/panel-shell', () => ({
  PanelShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PanelLoading: ({ label }: { label: string }) => <div>{label}</div>,
}))
mock.module('#/components/shortcuts-settings', () => ({
  ShortcutsSettings: () => <div>Keyboard shortcuts</div>,
}))
mock.module('#/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: () => null,
  AlertDialogClose: ({ children }: { children?: ReactNode }) => <>{children}</>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
// theme.ts is deliberately NOT mocked. mock.module is process-global, so
// stubbing it here would hand every other test file in the run the stub — which
// is exactly how theme.test.ts started reading the wrong default. The real
// module tolerates a missing `localStorage`, so it is safe to let it run.

const { SettingsPanel } = await import('./settings-panel')

const disabledBilling = {
  required: false,
  access: true,
  plan: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trial: null,
  stale: false,
  source: 'disabled' as const,
}

function renderSettings(searchParams = '?settings=billing') {
  return render(
    <SettingsPanel shortcutConfig={{} as never} onShortcutConfigChange={() => {}} />,
    { wrapper: withNuqsTestingAdapter({ searchParams }) },
  )
}

describe('SettingsPanel billing visibility', () => {
  beforeEach(() => {
    billingStatus.mockReset().mockResolvedValue(disabledBilling)
    window.localStorage.removeItem('loora:theme')
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    cleanup()
    window.localStorage.removeItem('loora:theme')
    document.documentElement.classList.remove('dark')
  })

  test('removes billing UI and falls back from a billing URL when billing is disabled', async () => {
    renderSettings()

    expect(await screen.findByText('Signed in to loora.')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Billing' })).toBeNull()
    expect(screen.queryByText(/Manage the plan/)).toBeNull()
  })

  test('shows the billing tab when billing is required', async () => {
    billingStatus.mockResolvedValue({ ...disabledBilling, required: true, source: 'cache' as const })
    renderSettings('?settings=shortcuts')

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Billing' })).toBeTruthy())
  })

  // Children of the integrations panel are deliberately left unmocked: this file
  // renders before their own suites, and `mock.module` is process-global, so a
  // stub here would leak into `mcp-sessions.test.tsx` and friends.
  test('offers no agent tab', async () => {
    renderSettings('?settings=shortcuts')

    expect(await screen.findByRole('tab', { name: 'Shortcuts' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Agent' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Integrations' })).toBeTruthy()
  })

  test('applies and persists the selected appearance', async () => {
    renderSettings('?settings=account')

    const dark = await screen.findByRole('button', { name: 'Dark' })
    fireEvent.click(dark)

    expect(dark.getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem('loora:theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
