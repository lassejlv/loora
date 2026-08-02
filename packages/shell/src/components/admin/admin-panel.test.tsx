import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'

const overview = {
  generatedAt: '2026-07-30T12:00:00.000Z',
  users: {
    total: 12,
    newLast7Days: 3,
    admins: 1,
    previewGranted: 8,
    pendingPreviewRequests: 2,
    activeLast24Hours: 5,
  },
  designs: {
    total: 40,
    newLast7Days: 6,
    openBranches: 2,
    versionsLast7Days: 9,
  },
  storage: { assets: 20, bytes: 5 * 1024 * 1024 },
  mcp: { connectedClients: 3, connectedUsers: 2 },
}

const users = [
  {
    id: 'user-2',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    isAdmin: false,
    previewAccess: false,
    previewAccessRequestedAt: new Date('2026-07-29T10:00:00.000Z'),
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    designs: 4,
    lastDesignAt: new Date('2026-07-29T10:00:00.000Z'),
    assets: 2,
    storageBytes: 2048,
    openBranches: 1,
    lastSeenAt: new Date('2026-07-30T11:00:00.000Z'),
    mcpClients: 1,
    mcpWeeklyLimit: null,
    mcpUsageResetAt: null,
    plan: 'free',
    subscriptionStatus: 'active',
    billingAccess: true,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
  },
]

const designs = [
  {
    id: 'design-1',
    name: 'Marketing site',
    userId: 'user-2',
    ownerName: 'Ada Lovelace',
    ownerEmail: 'ada@example.com',
    linkAccess: 'view' as const,
    revision: 12,
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    shares: 0,
  },
]

const setPreviewAccess = mock(async () => ({ userId: 'user-2', previewAccess: true }))
const approvePendingPreviewAccess = mock(async () => ({ granted: 2 }))
const revokeDesignLinks = mock(async () => ({ revokedLinks: 1 }))

mock.module('@loora/rpc/client', () => ({
  orpc: {
    admin: {
      overview: mock(async () => overview),
      listUsers: mock(async () => users),
      listDesigns: mock(async () => designs),
      setPreviewAccess,
      approvePendingPreviewAccess,
      revokeDesignLinks,
      setAdmin: mock(),
      refreshBilling: mock(),
      setMcpLimit: mock(),
      resetMcpUsage: mock(),
      revokeSessions: mock(),
      revokeMcpAccess: mock(),
      deleteUser: mock(),
    },
  },
}))
mock.module('@loora/auth/client', () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: 'user-1', name: 'Admin', email: 'admin@example.com', isAdmin: true } },
      isPending: false,
    }),
  },
}))

const { AdminPanel } = await import('./admin-panel')

// Queries go through the rendered container rather than `screen`: in a full
// suite run the global `document` these files share is not always the one this
// render landed in, and a body-scoped query then finds nothing.
describe('AdminPanel', () => {
  afterEach(cleanup)

  test('shows the workspace snapshot and the accounts behind it', async () => {
    const screen = within(render(<AdminPanel />).container)

    expect(await screen.findByText('Users')).toBeTruthy()
    expect(await screen.findByText('12')).toBeTruthy()
    expect(await screen.findByText('5 MB')).toBeTruthy()
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    expect(await screen.findByText(/joined/)).toBeTruthy()
  })

  test('grants preview access from the row action', async () => {
    const screen = within(render(<AdminPanel />).container)

    const grant = await screen.findByRole('button', { name: 'Grant access' })
    fireEvent.click(grant)

    await waitFor(() =>
      expect(setPreviewAccess).toHaveBeenCalledWith({ userId: 'user-2', granted: true }),
    )
  })

  test('approves every pending preview request at once', async () => {
    const screen = within(render(<AdminPanel />).container)

    const approve = await screen.findByRole('button', {
      name: 'Approve 2 pending requests',
    })
    fireEvent.click(approve)

    await waitFor(() => expect(approvePendingPreviewAccess).toHaveBeenCalled())
  })

  test('restricts a design that is shared by link', async () => {
    const confirm = mock(() => true)
    window.confirm = confirm as unknown as typeof window.confirm
    const screen = within(render(<AdminPanel />).container)

    const revoke = await screen.findByRole('button', { name: 'Restrict link' })
    fireEvent.click(revoke)

    await waitFor(() =>
      expect(revokeDesignLinks).toHaveBeenCalledWith({
        designId: 'design-1',
        userId: 'user-2',
      }),
    )
  })
})
