import { createFileRoute, redirect } from '@tanstack/react-router'
import { AccountGate } from '#/components/account-gate'
import { CanvasApp } from '#/components/canvas/app'
import { designValidateSearch } from '#/lib/url-state'

export const Route = createFileRoute('/design/$id')({
  component: DesignPage,
  ssr: false,
  validateSearch: designValidateSearch,
  beforeLoad: ({ params, search }) => {
    if (!search.draft) return
    const { draft, ...editorSearch } = search
    throw redirect({
      to: '/design/$id/b/$branchId',
      params: { id: params.id, branchId: draft },
      search: editorSearch,
      replace: true,
    })
  },
})

function DesignPage() {
  const { id } = Route.useParams()

  return (
    <AccountGate designId={id}>
      {/* Remount on switch so the sync controller opens the new target cleanly. */}
      <CanvasApp key={id} designId={id} />
    </AccountGate>
  )
}
