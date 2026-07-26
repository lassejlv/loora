import { useEffect, useState, type SyntheticEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ElementFrame } from '#/components/element-frame'
import type { CanvasInteraction } from '@loora/canvas/model'
import { applyCanvasActions } from '#/lib/canvas-v2-runtime'

// Public viewer for a published element. No auth: the link id is the
// capability. The payload arrives with asset URLs already rewritten to the
// link-scoped public asset route, so the anonymous frame can load them.

export const Route = createFileRoute('/p/$linkId')({
  component: PublishedPage,
  ssr: false,
})

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      payload:
        | { kind: 'element'; name: string; code: string }
        | {
            kind: 'canvas-v2'
            name: string
            html: string
            css: string
          }
        | {
            kind: 'page'
            name: string
            width: number
            items: Array<{
              id: string
              elementId: string
              name: string
              height: number
              code: string
            }>
          }
    }

function PublishedPage() {
  const { linkId } = Route.useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch(`/api/p/${encodeURIComponent(linkId)}`)
      .then(async (response) => {
        const body = (await response.json()) as {
          kind?: 'element' | 'page' | 'canvas-v2'
          name?: string
          code?: string
          html?: string
          css?: string
          width?: number
          items?: Array<{
            id: string
            elementId: string
            name: string
            height: number
            code: string
          }>
          error?: string
        }
        if (cancelled) return
        const payload =
          body.kind === 'canvas-v2' &&
          typeof body.html === 'string' &&
          typeof body.css === 'string'
            ? {
                kind: 'canvas-v2' as const,
                name: body.name ?? 'Page',
                html: body.html,
                css: body.css,
              }
            : body.kind === 'page' && Array.isArray(body.items) && typeof body.width === 'number'
            ? {
                kind: 'page' as const,
                name: body.name ?? 'Page',
                width: body.width,
                items: body.items,
              }
            : typeof body.code === 'string'
              ? { kind: 'element' as const, name: body.name ?? 'Page', code: body.code }
              : null
        if (!response.ok || !payload) {
          setState({ status: 'error', message: body.error ?? 'This link has expired or was removed.' })
          return
        }
        setState({ status: 'ready', payload })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', message: 'Could not load this page.' })
      })
    return () => {
      cancelled = true
    }
  }, [linkId])

  useEffect(() => {
    document.title = state.status === 'ready' ? state.payload.name : 'loora'
  }, [state])

  if (state.status === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Loading page…</p>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card px-5 py-4 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Link to="/" className="text-xs font-medium underline underline-offset-2">
            Made with loora
          </Link>
        </div>
      </main>
    )
  }

  const payload = state.payload

  if (payload.kind === 'canvas-v2') {
    return <PublishedCanvasV2 payload={payload} />
  }

  return (
    <main className="min-h-screen bg-white">
      {payload.kind === 'element' ? (
        <div className="fixed inset-0">
          <ElementFrame
            elementId={`published:${linkId}`}
            code={payload.code}
            interactive
          />
        </div>
      ) : (
        <div className="w-full">
          {payload.items.map((item) => (
            <section
              key={item.id}
              aria-label={item.name}
              className="w-full overflow-hidden"
              style={{ height: item.height }}
            >
              <ElementFrame
                elementId={item.elementId}
                frameId={`published:${linkId}:${item.id}`}
                code={item.code}
                interactive
              />
            </section>
          ))}
        </div>
      )}
      <Link
        to="/"
        target="_blank"
        rel="noreferrer"
        className="fixed right-3 bottom-3 z-10 rounded-full border bg-card/85 px-2.5 py-1 text-[11px] text-muted-foreground opacity-60 shadow-sm backdrop-blur transition-opacity hover:opacity-100"
      >
        Made with loora
      </Link>
    </main>
  )
}

function interactionsFor(
  event: SyntheticEvent<HTMLElement>,
  trigger: CanvasInteraction['trigger'],
) {
  const target =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-loora-interactions]')
      : null
  if (!target) return []
  try {
    const interactions = JSON.parse(
      target.dataset.looraInteractions ?? '[]',
    ) as CanvasInteraction[]
    return interactions
      .filter((interaction) => interaction.trigger === trigger)
      .flatMap((interaction) => interaction.actions)
  } catch {
    return []
  }
}

function PublishedCanvasV2({
  payload,
}: {
  payload: Extract<
    Extract<LoadState, { status: 'ready' }>['payload'],
    { kind: 'canvas-v2' }
  >
}) {
  const invoke = (
    event: SyntheticEvent<HTMLElement>,
    trigger: CanvasInteraction['trigger'],
  ) => {
    const actions = interactionsFor(event, trigger)
    if (actions.length > 0) applyCanvasActions(event.currentTarget, actions)
  }
  return (
    <main
      className="min-h-screen bg-white"
      onClick={(event) => invoke(event, 'click')}
      onPointerOver={(event) => invoke(event, 'hover')}
      onSubmit={(event) => {
        const actions = interactionsFor(event, 'submit')
        if (actions.length === 0) return
        event.preventDefault()
        applyCanvasActions(event.currentTarget, actions)
      }}
    >
      <style>{`html,body{margin:0;min-height:100%}${payload.css}`}</style>
      <div dangerouslySetInnerHTML={{ __html: payload.html }} />
      <Link
        to="/"
        target="_blank"
        rel="noreferrer"
        className="fixed right-3 bottom-3 z-10 rounded-full border bg-card/85 px-2.5 py-1 text-[11px] text-muted-foreground opacity-60 shadow-sm backdrop-blur transition-opacity hover:opacity-100"
      >
        Made with loora
      </Link>
    </main>
  )
}
