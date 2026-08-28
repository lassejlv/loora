import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/shutdown')({
  beforeLoad: () => {
    throw redirect({ to: '/cloud', replace: true })
  },
})
