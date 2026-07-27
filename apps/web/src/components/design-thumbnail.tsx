import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasNodeRenderer, CanvasProvider } from '@loora/canvas/react'
import type { CanvasDocumentV2, PageNode } from '@loora/canvas/model'
import { orpc } from '#/lib/orpc-client'
import { cn } from '#/lib/utils'

/** Documents are fetched once per revision and shared across remounts. */
const documentCache = new Map<string, CanvasDocumentV2 | null>()

const MAX_PAGES = 8
const PADDING = 10

function pageWidth(page: PageNode) {
  return page.layout.width.unit === 'px'
    ? page.layout.width.value
    : page.viewport.width
}

function pageHeight(page: PageNode) {
  return page.layout.height.unit === 'px'
    ? page.layout.height.value
    : page.viewport.minHeight
}

function visiblePages(document: CanvasDocumentV2) {
  return Object.values(document.nodes)
    .filter((node): node is PageNode => node.type === 'page' && !node.hidden)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .slice(0, MAX_PAGES)
}

/** Token values resolve through CSS variables, exactly as the editor surface does. */
function tokenVariables(document: CanvasDocumentV2) {
  const style: Record<string, string> = {}
  for (const token of Object.values(document.tokens)) {
    const value = token.modes?.[document.activeThemeId] ?? token.value
    style[`--loora-token-${token.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`] = String(value)
  }
  return style as CSSProperties
}

type ThumbnailState =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | { status: 'ready'; document: CanvasDocumentV2 }

/**
 * A live, read-only miniature of a design's Pages. The document is only
 * requested once the card scrolls into view, so a long file list does not pull
 * every document down at once. Designs still on V1 render a neutral tile —
 * migration only runs when the file is opened.
 */
export function DesignThumbnail({
  designId,
  revision,
  className,
}: {
  designId: string
  revision: number
  className?: string
}) {
  const cacheKey = `${designId}:${revision}`
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [state, setState] = useState<ThumbnailState>(() => {
    const cached = documentCache.get(cacheKey)
    if (cached === undefined) return { status: 'pending' }
    return cached ? { status: 'ready', document: cached } : { status: 'unavailable' }
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => {
      const rect = host.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const cached = documentCache.get(cacheKey)
    if (cached !== undefined) {
      setState(cached ? { status: 'ready', document: cached } : { status: 'unavailable' })
      return
    }
    setState({ status: 'pending' })
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    const load = async () => {
      try {
        const found = await orpc.canvas.get({ designId, draftId: null })
        if (cancelled) return
        const document = found.status === 'ready' ? found.document ?? null : null
        documentCache.set(cacheKey, document)
        setState(document ? { status: 'ready', document } : { status: 'unavailable' })
      } catch {
        if (!cancelled) setState({ status: 'unavailable' })
      }
    }

    if (typeof IntersectionObserver === 'undefined') {
      void load()
      return () => {
        cancelled = true
      }
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        observer.disconnect()
        void load()
      },
      { rootMargin: '200px' },
    )
    observer.observe(host)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [cacheKey, designId])

  const board = useMemo(() => {
    if (state.status !== 'ready') return null
    const pages = visiblePages(state.document)
    if (pages.length === 0) return null
    const minX = Math.min(...pages.map((page) => page.layout.x))
    const minY = Math.min(...pages.map((page) => page.layout.y))
    const maxX = Math.max(...pages.map((page) => page.layout.x + pageWidth(page)))
    const maxY = Math.max(...pages.map((page) => page.layout.y + pageHeight(page)))
    return {
      pages,
      minX,
      minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }
  }, [state])

  const engine = useMemo(
    () => (state.status === 'ready' ? new CanvasEngine(state.document) : null),
    [state],
  )

  const scale =
    board && size.width > 0 && size.height > 0
      ? Math.min(
          (size.width - PADDING * 2) / board.width,
          (size.height - PADDING * 2) / board.height,
          1,
        )
      : 0

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none relative size-full overflow-hidden bg-cx-canvas',
        className,
      )}
    >
      {board && engine && scale > 0 ? (
        <CanvasProvider engine={engine} readOnly>
          <div
            style={{
              ...tokenVariables(engine.document),
              position: 'absolute',
              left: Math.max(PADDING, (size.width - board.width * scale) / 2),
              top: PADDING,
              width: board.width,
              height: board.height,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: -board.minX,
                top: -board.minY,
                width: board.width + board.minX,
                height: board.height + board.minY,
              }}
            >
              {board.pages.map((page) => (
                <CanvasNodeRenderer
                  key={page.id}
                  id={page.id}
                  width={pageWidth(page)}
                  topLevel
                />
              ))}
            </div>
          </div>
        </CanvasProvider>
      ) : null}
    </div>
  )
}
