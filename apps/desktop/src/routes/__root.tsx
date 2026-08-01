import { Outlet, createRootRoute } from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { useEffect } from 'react'
import { syncThemePreference } from '@loora/shell/lib/theme'
import { syncUiScale } from '@loora/shell/lib/ui-scale'

export const Route = createRootRoute({ component: RootLayout })

/**
 * The window's own chrome, which is none of it: the platform draws the title
 * bar, and everything below it is the same interface the web app renders.
 * Theme and interface scale are restored before first paint by the two scripts
 * the build injects, and kept in step here for as long as the window lives.
 */
function RootLayout() {
  useEffect(() => syncThemePreference(), [])
  useEffect(() => syncUiScale(), [])

  return (
    <NuqsAdapter>
      <Outlet />
    </NuqsAdapter>
  )
}
