import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createContext, useContext, type ReactNode } from 'react'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'

const billingStatus = mock()
const listPublished = mock()
const publishedEgress = mock()
const openRouterStatus = mock()
const connectOpenRouter = mock()
const disconnectOpenRouter = mock()
const aiProviderStatus = mock()
const connectAiProvider = mock()
const disconnectAiProvider = mock()

const TabsContext = createContext('')

mock.module('#/lib/orpc-client', () => ({
  orpc: {
    billing: { status: billingStatus },
    publish: {
      listAll: listPublished,
      egress: publishedEgress,
    },
    openrouter: {
      status: openRouterStatus,
      connect: connectOpenRouter,
      disconnect: disconnectOpenRouter,
    },
    aiProvider: {
      status: aiProviderStatus,
      connect: connectAiProvider,
      disconnect: disconnectAiProvider,
    },
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
// mock.module is process-global, so a partial stub here would strip the rest of
// theme.ts for every other test file in the run — spread the real module.
const themeModule = await import('#/lib/theme')
mock.module('#/lib/theme', () => ({
  ...themeModule,
  getThemePreference: () => 'system',
  setThemePreference: mock(),
}))

const { SettingsPanel } = await import('./settings-panel')

const disabledBilling = {
  required: false,
  access: true,
  plan: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trial: null,
  credits: null,
  stale: false,
  source: 'disabled' as const,
}

function renderSettings(searchParams = '?settings=billing') {
  return render(
    <SettingsPanel
      shortcutConfig={{} as never}
      onShortcutConfigChange={() => {}}
      agentSystemPrompt=""
      onSaveAgentSystemPrompt={async () => {}}
    />,
    { wrapper: withNuqsTestingAdapter({ searchParams }) },
  )
}

describe('SettingsPanel billing visibility', () => {
  beforeEach(() => {
    billingStatus.mockReset().mockResolvedValue(disabledBilling)
    listPublished.mockReset().mockResolvedValue([])
    publishedEgress.mockReset().mockResolvedValue({
      usedBytes: 0,
      limitBytes: 1,
      windowDays: 30,
      unlimited: true,
    })
    openRouterStatus.mockReset().mockResolvedValue({
      connected: false,
      label: null,
      updatedAt: null,
    })
    connectOpenRouter.mockReset().mockResolvedValue({
      connected: true,
      label: 'Loora key',
    })
    disconnectOpenRouter.mockReset().mockResolvedValue({ disconnected: true })
    aiProviderStatus.mockReset().mockResolvedValue({
      connected: false,
      updatedAt: null,
    })
    connectAiProvider.mockReset().mockResolvedValue({ connected: true })
    disconnectAiProvider.mockReset().mockResolvedValue({ disconnected: true })
  })

  afterEach(() => cleanup())

  test('removes billing UI and falls back from a billing URL when billing is disabled', async () => {
    renderSettings()

    expect(await screen.findByText('Signed in to loora.')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Billing' })).toBeNull()
    expect(screen.queryByText('Manage your plan and monthly AI credits.')).toBeNull()
  })

  test('shows the billing tab when billing is required', async () => {
    billingStatus.mockResolvedValue({ ...disabledBilling, required: true, source: 'cache' as const })
    renderSettings('?settings=shortcuts')

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Billing' })).toBeTruthy())
  })

  test('keeps every AI provider under one integration tab', async () => {
    renderSettings('?settings=integrations&integration=providers')

    expect(await screen.findByRole('tab', { name: 'AI providers' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'ChatGPT' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'OpenRouter' })).toBeNull()
    expect(await screen.findByText('Google Gemini')).toBeTruthy()
    expect(await screen.findByText('OpenAI')).toBeTruthy()
    expect(await screen.findByText('Anthropic')).toBeTruthy()
  })

  test('connects OpenRouter with a masked custom API key', async () => {
    openRouterStatus
      .mockResolvedValueOnce({ connected: false, label: null, updatedAt: null })
      .mockResolvedValue({
        connected: true,
        label: 'Loora key',
        updatedAt: new Date(),
      })
    renderSettings('?settings=integrations&integration=providers')

    const input = await screen.findByPlaceholderText('sk-or-v1-…')
    expect((input as HTMLInputElement).type).toBe('password')
    fireEvent.change(input, { target: { value: 'sk-or-v1-user-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect OpenRouter' }))

    await waitFor(() =>
      expect(connectOpenRouter).toHaveBeenCalledWith({
        apiKey: 'sk-or-v1-user-secret',
      }),
    )
    expect(await screen.findByText(/OpenRouter Auto is available/)).toBeTruthy()
  })

  test('connects Google Gemini with a masked custom API key', async () => {
    aiProviderStatus
      .mockResolvedValueOnce({ connected: false, updatedAt: null })
      .mockResolvedValue({ connected: true, updatedAt: new Date() })
    renderSettings('?settings=integrations&integration=providers')

    const input = await screen.findByPlaceholderText('AIza…')
    expect((input as HTMLInputElement).type).toBe('password')
    fireEvent.change(input, { target: { value: 'AIza-user-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Gemini' }))

    await waitFor(() =>
      expect(connectAiProvider).toHaveBeenCalledWith({
        provider: 'google',
        apiKey: 'AIza-user-secret',
      }),
    )
    expect(await screen.findByText(/Gemini 3.5 Flash.*agent model picker/)).toBeTruthy()
  })
})
