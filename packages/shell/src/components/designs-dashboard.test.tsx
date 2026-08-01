import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const list = mock()
const listShared = mock()
const deleteDesign = mock()
const create = mock()
const rename = mock()
const getPreferences = mock()

mock.module('@loora/rpc/client', () => ({
  orpc: {
    design: { list, listShared, delete: deleteDesign },
    canvas: { create, rename },
    // The dashboard renders the upgrade button, which reads billing status.
    billing: { status: mock(async () => ({ required: false, plan: null })) },
    preferences: {
      get: getPreferences,
      save: mock(),
    },
  },
}))
mock.module('@loora/auth/client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user-1', name: 'Lasse' } } }),
    signOut: mock(),
  },
}))
mock.module('./design-thumbnail', () => ({
  DesignThumbnail: ({ designId }: { designId: string }) => (
    <div data-testid={`thumb-${designId}`} />
  ),
}))
mock.module('./settings-panel', () => ({
  SettingsPanel: () => <div>Settings panel</div>,
}))

const navigate = mock()
const routerModule = await import('@tanstack/react-router')
mock.module('@tanstack/react-router', () => ({
  ...routerModule,
  useNavigate: () => navigate,
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    search?: Record<string, unknown>
    children?: ReactNode
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (current, [key, value]) => current.replace(`$${key}`, encodeURIComponent(value)),
      to,
    )
    const query = new URLSearchParams(search as Record<string, string>).toString()
    return (
      <a href={query ? `${path}?${query}` : path} {...props}>
        {children}
      </a>
    )
  },
}))

const { DesignsDashboard } = await import('./designs-dashboard')

const HOUR = 3_600_000

describe('DesignsDashboard', () => {
  beforeEach(() => {
    window.localStorage.clear()
    navigate.mockReset().mockResolvedValue(undefined)
    getPreferences.mockReset().mockResolvedValue({ shortcuts: null })
    create.mockReset().mockResolvedValue({ revision: 1 })
    rename.mockReset()
    deleteDesign.mockReset().mockResolvedValue({ deleted: true })
    listShared.mockReset().mockResolvedValue([])
    list.mockReset().mockResolvedValue([
      { id: 'design-old', name: 'Portfolio Design', revision: 3, updatedAt: Date.now() - 48 * HOUR },
      { id: 'design-new', name: 'Ideal pine', revision: 7, updatedAt: Date.now() - 2 * HOUR },
    ])
  })

  afterEach(() => cleanup())

  test('lists files most recently edited first and links each to its canvas', async () => {
    render(<DesignsDashboard />)

    await screen.findByText('Ideal pine')
    const links = screen.getAllByRole('link', { name: /^Open / })
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Open Ideal pine',
      'Open Portfolio Design',
    ])
    expect(links[0]?.getAttribute('href')).toBe('/design/design-new')
    expect(screen.getByText('Edited 2 hours ago')).toBeTruthy()
  })

  test('filters the list by name', async () => {
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')

    fireEvent.change(screen.getByLabelText('Search files'), {
      target: { value: 'portfolio' },
    })

    expect(screen.queryByText('Ideal pine')).toBeNull()
    expect(screen.getByText('Portfolio Design')).toBeTruthy()
  })

  test('opens the new file on the canvas route after creating it', async () => {
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')

    fireEvent.click(screen.getByRole('button', { name: 'New file' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const created = create.mock.calls[0]?.[0] as { designId: string; name: string }
    expect(created.name).toBe('Untitled')
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/design/$id',
        params: { id: created.designId },
      }),
    )
  })

  test('offers to start a file when the account has none', async () => {
    list.mockResolvedValue([])
    render(<DesignsDashboard />)

    expect(await screen.findByText('No design files yet')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'New file' }).length).toBe(2)
  })

  test('surfaces a failed load without leaving the shimmer up', async () => {
    list.mockRejectedValue(new Error('offline'))
    render(<DesignsDashboard />)

    expect(await screen.findByText('offline')).toBeTruthy()
    expect(screen.queryByText('Loading your files…')).toBeNull()
  })
})
