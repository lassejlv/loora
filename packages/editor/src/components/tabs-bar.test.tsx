import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

const navigate = vi.fn()
const createDesign = vi.fn()

vi.doMock('../lib/designs', () => ({ createDesign }))

const routerModule = await import('@tanstack/react-router')
vi.doMock('@tanstack/react-router', () => ({
  ...routerModule,
  useNavigate: () => navigate,
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children?: ReactNode
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (current, [key, value]) => current.replace(`$${key}`, encodeURIComponent(value)),
      to,
    )
    return (
      <a href={path} {...props}>
        {children}
      </a>
    )
  },
}))

const { OpenTabsBar } = await import('./tabs-bar')
const { forgetOpenDesign, getOpenDesigns, rememberOpenDesign } =
  await import('../lib/open-designs')

beforeEach(() => {
  for (const tab of [...getOpenDesigns()]) forgetOpenDesign(tab.id)
  window.localStorage.clear()
  navigate.mockClear()
  createDesign.mockClear()
})

afterEach(() => cleanup())

describe('OpenTabsBar', () => {
  test('shows the dashboard and every open design, marking the active one', () => {
    rememberOpenDesign('d1', 'Daring fern')
    rememberOpenDesign('d2', 'Young horizon')

    render(<OpenTabsBar activeId="d2" />)

    const dashboard = screen.getByRole('link', { name: 'Dashboard' })
    expect(dashboard.getAttribute('aria-current')).toBeNull()
    const active = screen.getByRole('link', { name: 'Young horizon' })
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(
      screen.getByRole('link', { name: 'Daring fern' }).getAttribute('aria-current'),
    ).toBeNull()
  })

  test('closing an inactive tab removes it without navigating', () => {
    rememberOpenDesign('d1', 'Daring fern')
    rememberOpenDesign('d2', 'Young horizon')

    render(<OpenTabsBar activeId="d2" />)
    fireEvent.click(screen.getByLabelText('Close Daring fern'))

    expect(screen.queryByRole('link', { name: 'Daring fern' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Young horizon' })).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('closing the active tab falls back to a neighbour', () => {
    rememberOpenDesign('d1', 'Daring fern')
    rememberOpenDesign('d2', 'Young horizon')

    render(<OpenTabsBar activeId="d1" />)
    fireEvent.click(screen.getByLabelText('Close Daring fern'))

    expect(navigate).toHaveBeenCalledWith({
      to: '/design/$id',
      params: { id: 'd2' },
    })
  })

  test('closing the only tab returns to the dashboard', () => {
    rememberOpenDesign('d1', 'Daring fern')

    render(<OpenTabsBar activeId="d1" />)
    fireEvent.click(screen.getByLabelText('Close Daring fern'))

    expect(navigate).toHaveBeenCalledWith({ to: '/app' })
  })

  test('the plus button creates and opens a new file', async () => {
    createDesign.mockResolvedValue({ id: 'd3', name: 'Untitled', revision: 1, updatedAt: 0 })

    render(<OpenTabsBar />)
    fireEvent.click(screen.getByLabelText('New tab'))

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/design/$id',
        params: { id: 'd3' },
      }),
    )
    expect(createDesign).toHaveBeenCalled()
  })
})
