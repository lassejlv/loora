import { createFileRoute, redirect } from '@tanstack/react-router'
import { AccountGate } from '#/components/account-gate'
import { CanvasApp } from '@loora/editor/app'
import { renderEditorSettings } from '#/components/editor-settings-slot'
import { designValidateSearch } from '#/lib/url-state'

export const Route = createFileRoute('/design/$id_/b/$branchId')({
  component: BranchDesignPage,
  ssr: false,
  validateSearch: designValidateSearch,
  beforeLoad: ({ params, search }) => {
    if (!search.draft) return
    const { draft: _draft, ...editorSearch } = search
    throw redirect({
      to: '/design/$id/b/$branchId',
      params,
      search: editorSearch,
      replace: true,
    })
  },
})

function BranchDesignPage() {
  const { id, branchId } = Route.useParams()

  return (
    <AccountGate designId={id}>
      <CanvasApp
        key={`${id}:${branchId}`}
        designId={id}
        branchId={branchId}
        renderSettings={renderEditorSettings}
      />
    </AccountGate>
  )
}
