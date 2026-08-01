import { createFileRoute, redirect } from '@tanstack/react-router'
import { CanvasApp } from '@loora/editor/app'
import { renderEditorSettings } from '@loora/shell/editor-settings-slot'
import { designValidateSearch } from '@loora/shell/lib/url-state'
import { DesktopGate } from '#app/components/desktop-gate'

export const Route = createFileRoute('/design/$id_/b/$branchId')({
  component: BranchDesignPage,
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
    <DesktopGate designId={id}>
      <CanvasApp
        key={`${id}:${branchId}`}
        designId={id}
        branchId={branchId}
        renderSettings={renderEditorSettings}
      />
    </DesktopGate>
  )
}
