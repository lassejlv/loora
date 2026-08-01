import { createFileRoute, redirect } from '@tanstack/react-router'

/** The window has no landing page; it opens on the design files. */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/app', replace: true })
  },
})
