import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CanvasEngine } from '@loora/canvas/engine'
import { CanvasNodeRenderer, CanvasProvider } from '@loora/canvas/react'
import type { CanvasDocument, PageNode } from '@loora/canvas/model'
import { cn } from '#/lib/utils'

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

function visiblePages(document: CanvasDocument, pageId?: string) {
  return Object.values(document.nodes)
    .filter(
      (node): node is PageNode =>
        node.type === 'page' &&
        !node.hidden &&
        (pageId === undefined || node.id === pageId),
    )
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .slice(0, MAX_PAGES)
}

/** Token values resolve through CSS variables, exactly as the editor surface does. */
function tokenVariables(document: CanvasDocument) {
  const style: Record<string, string> = {}
  for (const token of Object.values(document.tokens)) {
    const value = token.modes?.[document.activeThemeId] ?? token.value
    style[`--loora-token-${token.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`] = String(value)
  }
  return style as CSSProperties
}

/**
 * A live, read-only miniature of a document's Pages, scaled to fit whatever box
 * it is given. It renders the same nodes the editor does, so a preview and the
 * canvas cannot drift apart.
 */
export function CanvasDocumentPreview({
  document,
  pageId,
  className,
}: {
  document: CanvasDocument | null
  /** Restricts the preview to one Page instead of the whole board. */
  pageId?: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

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

  const board = useMemo(() => {
    if (!document) return null
    const pages = visiblePages(document, pageId)
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
  }, [document, pageId])

  const engine = useMemo(
    () => (document ? new CanvasEngine(document) : null),
    [document],
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
