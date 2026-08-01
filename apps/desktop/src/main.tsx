// First, and on its own line: the auth client reads the runtime the moment it
// is imported, so the runtime has to be configured before anything else is.
import '#app/platform'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from '#app/routeTree.gen'
import '#app/styles.css'

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A desktop window is open for hours and often behind another one; a
      // refetch on focus is what keeps it from showing yesterday's list.
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('The window has no root element')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
