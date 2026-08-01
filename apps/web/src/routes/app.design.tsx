import { createFileRoute, redirect } from '@tanstack/react-router'
import { legacyDesignValidateSearch } from '@loora/shell/lib/url-state'

export const Route = createFileRoute('/app/design')({
  ssr: false,
  validateSearch: legacyDesignValidateSearch,
  beforeLoad: ({ search }) => {
    if (!search.id) throw redirect({ to: '/app' })
    const { id, draft, ...editorSearch } = search
    if (draft) {
      throw redirect({
        to: '/design/$id/b/$branchId',
        params: { id, branchId: draft },
        search: editorSearch,
        replace: true,
      })
    }
    throw redirect({
      to: '/design/$id',
      params: { id },
      search: editorSearch,
      replace: true,
    })
  },
})
