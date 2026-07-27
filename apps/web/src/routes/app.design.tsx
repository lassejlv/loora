import { createFileRoute, redirect } from '@tanstack/react-router'
import { AccountGate } from '#/components/account-gate'
import { CanvasV2App } from '#/components/canvas-v2/app'
import { designValidateSearch } from '#/lib/url-state'

export const Route = createFileRoute('/app/design')({
  component: DesignPage,
  ssr: false,
  validateSearch: designValidateSearch,
  beforeLoad: ({ search }) => {
    if (!search.id) throw redirect({ to: '/app' })
  },
})

function DesignPage() {
  const { id } = Route.useSearch()

  return (
    <AccountGate>
      {/* Remount on switch so the sync controller opens the new target cleanly. */}
      <CanvasV2App key={id ?? ''} designId={id ?? ''} />
    </AccountGate>
  )
}
