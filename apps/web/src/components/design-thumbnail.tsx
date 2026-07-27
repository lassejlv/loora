import { useEffect, useRef, useState } from 'react'
import type { CanvasDocumentV2 } from '@loora/canvas/model'
import { CanvasDocumentPreview } from '#/components/canvas-preview'
import { orpc } from '#/lib/orpc-client'

/** Documents are fetched once per revision and shared across remounts. */
const documentCache = new Map<string, CanvasDocumentV2 | null>()

/**
 * A design's board, fetched only once the card scrolls into view so a long file
 * list does not pull every document down at once. Designs still on V1 render a
 * neutral tile — migration only runs when the file is opened.
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
  const [document, setDocument] = useState<CanvasDocumentV2 | null>(
    () => documentCache.get(cacheKey) ?? null,
  )

  useEffect(() => {
    const cached = documentCache.get(cacheKey)
    if (cached !== undefined) {
      setDocument(cached)
      return
    }
    setDocument(null)
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    const load = async () => {
      try {
        const found = await orpc.canvas.get({ designId, draftId: null })
        if (cancelled) return
        const next = found.status === 'ready' ? found.document ?? null : null
        documentCache.set(cacheKey, next)
        setDocument(next)
      } catch {
        if (!cancelled) documentCache.set(cacheKey, null)
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

  return (
    <div ref={hostRef} className="size-full">
      <CanvasDocumentPreview document={document} className={className} />
    </div>
  )
}
