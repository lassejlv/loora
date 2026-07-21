import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { useEffect } from 'react'

import appCss from '../styles.css?url'
import { THEME_INIT_SCRIPT, watchSystemTheme } from '#/lib/theme'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'loora',
      },
      {
        name: 'theme-color',
        content: '#2440e6',
      },
      {
        name: 'application-name',
        content: 'loora',
      },
      {
        name: 'apple-mobile-web-app-title',
        content: 'loora',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      // Prefer PNG in the tab; ICO is the fallback for older clients.
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      {
        rel: 'shortcut icon',
        href: '/favicon.ico',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
    ],
    scripts: [
      {
        children: THEME_INIT_SCRIPT,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => watchSystemTheme(), [])
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <NuqsAdapter>{children}</NuqsAdapter>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
