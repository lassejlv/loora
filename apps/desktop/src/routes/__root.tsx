import { Outlet, createRootRoute } from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { useEffect } from 'react'
import { ShutdownBanner } from '@loora/shell/shutdown-banner'
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
      <div className="flex h-dvh flex-col overflow-hidden">
        <ShutdownBanner />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </NuqsAdapter>
  )
}
