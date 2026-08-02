import { createFileRoute, redirect } from '@tanstack/react-router'
import { AccountGate } from '@loora/shell/account-gate'
import { CanvasApp } from '@loora/editor/app'
import { renderEditorSettings } from '@loora/shell/editor-settings-slot'
import { designValidateSearch } from '@loora/shell/lib/url-state'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/design/$id_/b/$branchId')({
  component: BranchDesignPage,
  ssr: false,
  head: () =>
    seo({
      title: 'Branch editor — Loora',
      description: 'The Loora canvas editor, on a branch.',
      noindex: true,
    }),
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
