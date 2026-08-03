import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

const list = vi.fn()
const listShared = vi.fn()
const listArchived = vi.fn()
const archive = vi.fn()
const restore = vi.fn()
const deleteDesign = vi.fn()
const create = vi.fn()
const rename = vi.fn()
const getPreferences = vi.fn()

vi.doMock('@loora/rpc/client', () => ({
  orpc: {
    design: {
      list,
      listShared,
      listArchived,
      archive,
      restore,
      delete: deleteDesign,
    },
    canvas: { create, rename },
    // The dashboard renders the upgrade button, which reads billing status.
    billing: { status: vi.fn(async () => ({ required: false, plan: null })) },
    preferences: {
      get: getPreferences,
      save: vi.fn(),
    },
  },
}))
vi.doMock('@loora/auth/client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user-1', name: 'Lasse' } } }),
    signOut: vi.fn(),
  },
}))
vi.doMock('./design-thumbnail', () => ({
  DesignThumbnail: ({ designId }: { designId: string }) => (
    <div data-testid={`thumb-${designId}`} />
  ),
}))
vi.doMock('./settings-panel', () => ({
  SettingsPanel: () => <div>Settings panel</div>,
}))

const navigate = vi.fn()
const routerModule = await import('@tanstack/react-router')
vi.doMock('@tanstack/react-router', () => ({
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

/**
 * Radix opens a menu on pointerdown, and reaches for pointer-capture and
 * scroll APIs jsdom does not ship.
 */
function openMenu(name: string) {
  const element = Element.prototype as unknown as Record<string, unknown>
  element.hasPointerCapture ??= () => false
  element.setPointerCapture ??= () => {}
  element.releasePointerCapture ??= () => {}
  element.scrollIntoView ??= () => {}
  fireEvent.pointerDown(screen.getByRole('button', { name }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  })
}

describe('DesignsDashboard', () => {
  beforeEach(() => {
    window.localStorage.clear()
    navigate.mockReset().mockResolvedValue(undefined)
    getPreferences.mockReset().mockResolvedValue({ shortcuts: null })
    create.mockReset().mockResolvedValue({ revision: 1 })
    rename.mockReset()
    deleteDesign.mockReset().mockResolvedValue({ deleted: true })
    archive.mockReset().mockResolvedValue({ archivedAt: Date.now() })
    restore.mockReset().mockResolvedValue({ restored: true })
    listArchived.mockReset().mockResolvedValue([])
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

  test('archives instead of deleting, and offers no delete from Recents', async () => {
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')

    openMenu('Actions for Ideal pine')
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))
    await waitFor(() =>
      expect(archive).toHaveBeenCalledWith({ id: 'design-new' }),
    )
    expect(deleteDesign).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Ideal pine')).toBeNull())
    expect(screen.getByText('Portfolio Design')).toBeTruthy()
  })

  test('lists the archive on demand and restores a file back into Recents', async () => {
    listArchived.mockResolvedValue([
      {
        id: 'design-gone',
        name: 'Old landing',
        revision: 2,
        updatedAt: Date.now() - 72 * HOUR,
        archivedAt: Date.now() - 2 * HOUR,
      },
    ])
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')
    // The archive is only read when somebody asks for it.
    expect(listArchived).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByText('Old landing')).toBeTruthy()
    expect(screen.getByText('Archived 2 hours ago')).toBeTruthy()
    expect(screen.queryByText('Ideal pine')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith({ id: 'design-gone' }),
    )
    await waitFor(() => expect(screen.queryByText('Old landing')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Recents' }))
    expect(await screen.findByText('Old landing')).toBeTruthy()
  })

  test('permanently deletes only from the archive', async () => {
    listArchived.mockResolvedValue([
      {
        id: 'design-gone',
        name: 'Old landing',
        revision: 2,
        updatedAt: Date.now() - 72 * HOUR,
        archivedAt: Date.now() - 2 * HOUR,
      },
    ])
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    await screen.findByText('Old landing')

    openMenu('Actions for Old landing')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }))

    await waitFor(() =>
      expect(deleteDesign).toHaveBeenCalledWith({ id: 'design-gone' }),
    )
    await waitFor(() => expect(screen.queryByText('Old landing')).toBeNull())
  })
})
