import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createContext, useContext, type ReactNode } from 'react'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'

const TabsContext = createContext('')

mock.module('#/lib/orpc-client', () => ({
  orpc: {
    auth: { deleteAccount: mock() },
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
// `mock.module` is process-global, so this stub is what every later test file
// in the run sees too — the canvas panels render their header buttons through
// PanelShell. Keep the shape of the real thing: title, actions, close, body.
mock.module('#/components/panel-shell', () => ({
  PanelShell: ({
    title,
    actions,
    onClose,
    children,
  }: {
    title: string
    actions?: ReactNode
    onClose?: () => void
    children: ReactNode
  }) => (
    <div>
      <h2>{title}</h2>
      {actions}
      {onClose ? (
        <button type="button" aria-label={`Close ${title}`} onClick={onClose} />
      ) : null}
      {children}
    </div>
  ),
  PanelEmpty: ({ title, description }: { title?: string; description?: ReactNode }) => (
    <div>
      {title}
      {description}
    </div>
  ),
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

function renderSettings(searchParams = '?settings=account') {
  return render(
    <SettingsPanel shortcutConfig={{} as never} onShortcutConfigChange={() => {}} />,
    { wrapper: withNuqsTestingAdapter({ searchParams }) },
  )
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    window.localStorage.removeItem('loora:theme')
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    cleanup()
    window.localStorage.removeItem('loora:theme')
    document.documentElement.classList.remove('dark')
  })

  test('keeps billing and integrations out of the dialog', async () => {
    renderSettings()

    expect(await screen.findByText('Signed in to loora.')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Billing' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Integrations' })).toBeNull()
  })

  test('offers no agent tab', async () => {
    renderSettings('?settings=shortcuts')

    expect(await screen.findByRole('tab', { name: 'Shortcuts' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Agent' })).toBeNull()
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
