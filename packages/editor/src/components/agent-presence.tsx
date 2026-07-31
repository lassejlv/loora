import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useCanvasDomRegistry } from '@loora/canvas/react'
import { BotIcon } from '@loora/ui/icons'
import { cn } from '@loora/ui/utils'
import type { CanvasEditorController } from './editor'

/**
 * Agent activity arrives on the presence channel, not the document one: it
 * changes on every tool call and has no business rerendering the panels.
 */
function useAgentActivity(controller: CanvasEditorController) {
  const subscribe = controller.subscribePresence ?? controller.subscribe
  return useSyncExternalStore(
    subscribe,
    () => controller.agentActivity ?? null,
    () => null,
  )
}

function useRemoteChange(controller: CanvasEditorController) {
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.remoteChange ?? null,
    () => null,
  )
}

/** Keeps clear of the top chrome and the panel edges. */
const BADGE_HEIGHT = 20
const BADGE_MARGIN = 10
const BADGE_MIN_Y = 44
/**
 * Who the agent is and what it is doing, in the same face-pile cluster as the
 * human collaborators. This is the live region for the whole feature; the
 * canvas overlay below is decoration.
 */
export function CanvasAgentAvatar({
  controller,
  className,
}: {
  controller: CanvasEditorController
  className?: string
}) {
  const activity = useAgentActivity(controller)
  if (!activity) return null
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={activity.label}
      title={activity.label}
      className={cn('flex min-w-0 items-center gap-1.5', className)}
    >
      <span
        data-phase={activity.phase}
        className="cx-agent-avatar relative grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-background"
      >
        <BotIcon size={13} aria-hidden="true" />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'max-w-36 truncate text-xs max-lg:hidden',
          activity.phase === 'working'
            ? 'cx-shimmer'
            : 'text-muted-foreground',
        )}
      >
        {activity.label}
      </span>
    </div>
  )
}

/**
 * The agent's place on the canvas: a ring around the node it named and a badge
 * that follows it. The badge is positioned imperatively so a camera move costs
 * one transform write instead of a React render.
 */
export function CanvasAgentOverlay({
  controller,
}: {
  controller: CanvasEditorController
}) {
  const registry = useCanvasDomRegistry()
  const overlayRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const activity = useAgentActivity(controller)
  const remoteChange = useRemoteChange(controller)
  const nodeKey = activity?.nodeIds.join('\0') ?? ''

  useLayoutEffect(() => {
    if (
      !remoteChange ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }
    const ids = new Set(remoteChange.nodeIds)
    const elements = [
      ...new Set(
        registry
          .entries()
          .filter((entry) => ids.has(entry.ref.nodeId))
          .map((entry) => entry.element),
      ),
    ].slice(0, 40)
    const animations = elements.flatMap((element, index) => {
      if (!element.isConnected || typeof element.animate !== 'function') {
        return []
      }
      const styles = window.getComputedStyle(element)
      return [
        element.animate(
          [
            { opacity: 0, filter: 'blur(2px)' },
            { opacity: styles.opacity, filter: styles.filter },
          ],
          {
            duration: 520,
            delay: Math.min(index * 38, 280),
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'backwards',
          },
        ),
      ]
    })
    return () => {
      for (const animation of animations) animation.cancel()
    }
  }, [registry, remoteChange])

  useEffect(() => {
    if (!activity) return
    const overlay = overlayRef.current
    const badge = badgeRef.current
    const ring = ringRef.current
    if (!overlay || !badge || !ring) return

    const wanted = nodeKey ? nodeKey.split('\0') : []
    let element: Element | null = null
    let frame: number | null = null
    let observedElement: Element | null = null
    let resizeObserver: ResizeObserver | null = null

    const usable = (candidate: Element | null | undefined) =>
      !!candidate &&
      candidate.isConnected &&
      candidate.getClientRects().length > 0

    const resolve = () => {
      if (usable(element)) return element
      element = null
      if (wanted.length === 0) return null
      for (const nodeId of wanted) {
        const direct = registry.get({ nodeId, instancePath: [] })
        if (usable(direct)) {
          element = direct
          return element
        }
      }
      const ids = new Set(wanted)
      element =
        registry
          .entries()
          .find(
            (entry) => ids.has(entry.ref.nodeId) && usable(entry.element),
          )?.element ?? null
      return element
    }

    const draw = () => {
      frame = null
      const host = overlay.getBoundingClientRect()
      const target = resolve()
      if (target !== observedElement) {
        if (observedElement) resizeObserver?.unobserve(observedElement)
        if (target) resizeObserver?.observe(target)
        observedElement = target
      }
      const rect = target?.getBoundingClientRect() ?? null
      const width = badge.offsetWidth || 120
      // Above the node when there is room for it, tucked just inside its top
      // edge when there is not.
      const above = rect ? rect.top - host.top - BADGE_HEIGHT - 6 : 0
      const rawX = rect ? rect.left - host.left : host.width / 2 - width / 2
      const rawY = rect
        ? above >= BADGE_MIN_Y
          ? above
          : rect.top - host.top + 6
        : BADGE_MIN_Y + 8
      const x = Math.min(
        Math.max(BADGE_MARGIN, rawX),
        Math.max(BADGE_MARGIN, host.width - width - BADGE_MARGIN),
      )
      const y = Math.min(
        Math.max(BADGE_MIN_Y, rawY),
        Math.max(BADGE_MIN_Y, host.height - BADGE_HEIGHT - BADGE_MARGIN),
      )
      badge.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      badge.dataset.visible = 'true'

      const visible =
        rect &&
        rect.right > host.left &&
        rect.left < host.right &&
        rect.bottom > host.top + BADGE_MIN_Y &&
        rect.top < host.bottom
      if (visible && rect) {
        ring.hidden = false
        ring.style.transform = `translate3d(${Math.round(rect.left - host.left)}px, ${Math.round(rect.top - host.top)}px, 0)`
        ring.style.width = `${Math.round(rect.width)}px`
        ring.style.height = `${Math.round(rect.height)}px`
      } else {
        ring.hidden = true
      }
    }

    // Camera transforms, registry changes, and actual size changes are the
    // events that can move this decoration. Coalescing those events into one
    // frame avoids a permanent layout-reading animation loop while idle.
    const schedule = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(draw)
    }
    const unsubscribe = registry.subscribe(schedule)
    resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule)
    resizeObserver?.observe(overlay)
    const scene = overlay.parentElement?.querySelector(
      '[data-loora-canvas-scene]',
    )
    const cameraObserver =
      scene && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(schedule)
        : null
    if (scene && cameraObserver) {
      cameraObserver.observe(scene, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
        childList: true,
        characterData: true,
        subtree: true,
      })
    }
    window.addEventListener('resize', schedule)
    overlay.parentElement?.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      unsubscribe()
      resizeObserver?.disconnect()
      cameraObserver?.disconnect()
      window.removeEventListener('resize', schedule)
      overlay.parentElement?.removeEventListener('scroll', schedule, true)
    }
  }, [activity, nodeKey, registry])

  if (!activity) return null
  return (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      aria-hidden="true"
    >
      <div ref={ringRef} className="cx-agent-ring" data-phase={activity.phase} hidden />
      <div ref={badgeRef} className="cx-agent-badge" data-phase={activity.phase}>
        <BotIcon size={11} className="shrink-0" />
        <span className="truncate">{activity.label}</span>
        <span className="cx-agent-typing">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  )
}
