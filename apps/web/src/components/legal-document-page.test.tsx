import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { LegalDocumentPage } from '#/components/legal-document-page'

function renderLegal(markdown: string) {
  const rootRoute = createRootRoute({
    component: () => <LegalDocumentPage markdown={markdown} />,
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  })
  const privacyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/privacy',
    component: () => null,
  })
  const routeTree = rootRoute.addChildren([indexRoute, privacyRoute])
  const history = createMemoryHistory({ initialEntries: ['/'] })
  const router = createRouter({ routeTree, history })
  return render(<RouterProvider router={router} />)
}

describe('LegalDocumentPage', () => {
  test('renders markdown headings, lists, links, and tables as HTML', async () => {
    renderLegal(`# Terms of Service

Effective date: 24 July 2026

## 1. The Service

- Use the canvas
- Export designs

See the [Privacy Policy](./PRIVACY.md).

| Purpose | Basis |
| --- | --- |
| Provide the Service | Contract |
`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Terms of Service' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '1. The Service' })).toBeTruthy()
    expect(screen.getByText('Use the canvas')).toBeTruthy()
    expect(screen.queryByText('# Terms of Service')).toBeNull()

    const privacyLink = screen.getByRole('link', { name: 'Privacy Policy' })
    expect(privacyLink.getAttribute('href')).toBe('/privacy')

    expect(screen.getByRole('columnheader', { name: 'Purpose' })).toBeTruthy()
    expect(screen.getByText('Contract')).toBeTruthy()
  })
})
