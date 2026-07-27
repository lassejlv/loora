import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The editor moved to `/app/design?id=…` and the file browser now owns `/`.
 * Legacy links (`/?design=…`, `/?d=…`) keep working by carrying their document
 * and draft over to the new route.
 */
export const Route = createFileRoute('/')({
  ssr: false,
  beforeLoad: ({ search }) => {
    const params = search as Record<string, unknown>
    const id =
      typeof params.design === 'string'
        ? params.design
        : typeof params.d === 'string'
          ? params.d
          : null
    if (!id) throw redirect({ to: '/app' })
    throw redirect({
      to: '/app/design',
      search: {
        id,
        draft: typeof params.draft === 'string' ? params.draft : undefined,
      },
    })
  },
})
