import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createStandardSchemaV1, parseAsString, useQueryStates } from 'nuqs'
import { authClient } from '@loora/auth/client'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import { ElementFrame } from '#/components/element-frame'
import { pickBlockPageElement } from '#/lib/block-page'
import { onlyCodeElements, type CanvasElement } from '#/lib/canvas'
import { hasStoredElements, loadElements } from '#/lib/docs'

// Fullscreen preview of a single canvas element ("page"), outside the editor.
// The element renders interactive at viewport size, so responsive page code
// reflows like a real site instead of the fixed frame it has on the canvas.

const blockPageSearchParams = {
  element: parseAsString,
}

export const Route = createFileRoute('/blockpage/$designId')({
  component: BlockPage,
  ssr: false,
  validateSearch: createStandardSchemaV1(blockPageSearchParams, { partialOutput: true }),
})

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; name: string | null; elements: CanvasElement[] }

type PreviewWidth = 'full' | 'desktop' | 'tablet' | 'phone'

const PREVIEW_WIDTHS: Record<PreviewWidth, number | null> = {
  full: null,
  desktop: 1280,
  tablet: 768,
  phone: 390,
}

const PREVIEW_LABELS: Record<PreviewWidth, string> = {
  full: 'Full',
  desktop: 'Desktop',
  tablet: 'Tablet',
  phone: 'Phone',
}

function BlockPage() {
  const { designId } = Route.useParams()
  const { data: session, isPending } = authClient.useSession()
  const [{ element: elementParam }, setSearch] = useQueryStates(blockPageSearchParams, {
    history: 'replace',
  })
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [renderError, setRenderError] = useState<string | null>(null)
  // Responsive preview: constrain the frame to a device width so page code
  // reflows like it would on that screen. 'full' = the browser viewport.
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>('full')

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    // Same-device tabs read the localStorage copy: the editor writes it on
    // every mutation, while the server save lags behind a 1500ms debounce.
    const cacheOwner = localStorage.getItem('loora:cache-user')
    const cacheUsable = !cacheOwner || cacheOwner === userId
    if (cacheUsable && hasStoredElements(designId)) {
      setState({ status: 'ready', name: null, elements: loadElements(designId) })
      return
    }
    let cancelled = false
    orpc.design
      .get({ id: designId })
      .then((doc) => {
        if (cancelled) return
        setState({ status: 'ready', name: doc.name, elements: onlyCodeElements(doc.shapes) })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Failed to load the design.'
        setState({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [userId, designId])

  const elements = state.status === 'ready' ? state.elements : []
  const active = useMemo(
    () => pickBlockPageElement(elements, elementParam),
    [elements, elementParam],
  )

  useEffect(() => {
    const name = state.status === 'ready' ? state.name : null
    document.title = active ? `${active.name || name || 'Page'} — loora` : 'loora'
  }, [active, state])

  if (isPending || (userId && state.status === 'loading')) {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Loading page…</p>
      </main>
    )
  }

  if (!session) {
    return (
      <CenteredNotice message="Sign in to view this page.">
        <Button variant="outline" size="sm" render={<Link to="/" />}>
          Go to loora
        </Button>
      </CenteredNotice>
    )
  }

  if (state.status === 'error') {
    return (
      <CenteredNotice message={state.message}>
        <Button variant="outline" size="sm" render={<Link to="/" search={{ d: designId }} />}>
          Open in editor
        </Button>
      </CenteredNotice>
    )
  }

  if (!active) {
    return (
      <CenteredNotice message="Nothing on this canvas yet.">
        <Button variant="outline" size="sm" render={<Link to="/" search={{ d: designId }} />}>
          Open in editor
        </Button>
      </CenteredNotice>
    )
  }

  const width = PREVIEW_WIDTHS[previewWidth]

  return (
    <main className="fixed inset-0 flex justify-center bg-white">
      <div
        className={width ? 'h-full border-x bg-white shadow-sm' : 'h-full w-full'}
        style={width ? { width, maxWidth: '100%' } : undefined}
      >
        <ElementFrame
          key={active.id}
          elementId={active.id}
          code={active.code}
          interactive
          onError={setRenderError}
        />
      </div>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-full border bg-card/85 py-1.5 pr-1.5 pl-3 shadow-sm backdrop-blur transition-opacity hover:opacity-100 sm:opacity-60">
        <div className="flex items-center gap-0.5" role="group" aria-label="Preview width">
          {(Object.keys(PREVIEW_WIDTHS) as PreviewWidth[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={previewWidth === key}
              title={
                PREVIEW_WIDTHS[key] ? `${PREVIEW_LABELS[key]} · ${PREVIEW_WIDTHS[key]}px` : PREVIEW_LABELS[key]
              }
              className={
                previewWidth === key
                  ? 'rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium'
                  : 'rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
              }
              onClick={() => setPreviewWidth(key)}
            >
              {PREVIEW_LABELS[key]}
            </button>
          ))}
        </div>
        {elements.length > 1 ? (
          <select
            aria-label="Element"
            className="max-w-40 truncate bg-transparent text-xs font-medium outline-none"
            value={active.id}
            onChange={(e) => void setSearch({ element: e.target.value })}
          >
            {elements.map((el) => (
              <option key={el.id} value={el.id}>
                {el.name || el.id}
              </option>
            ))}
          </select>
        ) : (
          <span className="max-w-40 truncate text-xs font-medium">{active.name || 'Page'}</span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-6 rounded-full px-2.5 text-xs"
          render={<Link to="/" search={{ d: designId }} />}
        >
          Editor
        </Button>
      </div>
      {renderError ? (
        <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <p
            role="alert"
            className="max-w-xl truncate rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive-foreground shadow-sm"
          >
            {renderError}
          </p>
        </div>
      ) : null}
    </main>
  )
}

function CenteredNotice({
  message,
  children,
}: {
  message: string
  children?: React.ReactNode
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-cx-canvas">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card px-5 py-4 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">{message}</p>
        {children}
      </div>
    </main>
  )
}
