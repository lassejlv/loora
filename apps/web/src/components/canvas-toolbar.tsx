import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button } from '#/components/ui/button'
import { LayoutPanelTopIcon, type LayoutPanelTopIconHandle } from '#/components/ui/layout-panel-top'
import { uiTransition } from '#/lib/motion'
import { cn } from '#/lib/utils'

/**
 * The canvas panel switches, folded into one trigger.
 *
 * Five always-on icons over the artboard is five things to read before you can
 * work; they only matter when you reach for them. The cluster collapses to a
 * single glyph and unfolds on hover, focus or tap. It stays open while any of
 * its panels is open — a switch you cannot see is a switch you cannot use to
 * close what it opened.
 */

export interface CanvasToolbarItem {
  key: string
  /** Rendered as-is so callers keep their own button/popover wiring. */
  node: ReactNode
  /** Keeps the cluster unfolded while this item's panel is open. */
  active?: boolean
}

export function CanvasToolbar({
  items,
  trailing,
  label = 'Canvas panels',
}: {
  items: CanvasToolbarItem[]
  /** Always-visible tail (the overflow menu), outside the folding group. */
  trailing?: ReactNode
  label?: string
}) {
  const reduce = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // Touch has no hover, so the trigger doubles as a toggle there.
  const [pinned, setPinned] = useState(false)
  const iconRef = useRef<LayoutPanelTopIconHandle>(null)
  const anyActive = items.some((item) => item.active)
  const expanded = hovered || focused || pinned || anyActive

  useEffect(() => {
    if (!pinned) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinned(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pinned])

  const transition = uiTransition(reduce)

  return (
    <div
      className="flex items-center gap-1"
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return
        setHovered(true)
        iconRef.current?.startAnimation()
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'touch') return
        setHovered(false)
        iconRef.current?.stopAnimation()
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <AnimatePresence initial={false}>
        {expanded
          ? items.map((item, index) => (
              <motion.div
                key={item.key}
                // Anchored top-right, so the row unfolds leftwards: each icon
                // arrives from where the trigger is, slightly after the last.
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 10, scale: 0.9 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: 10, scale: 0.9 }}
                transition={{
                  ...transition,
                  delay: reduce ? 0 : (items.length - 1 - index) * 0.03,
                }}
              >
                {item.node}
              </motion.div>
            ))
          : null}
      </AnimatePresence>

      <Button
        variant={expanded ? 'secondary' : 'ghost'}
        size="icon"
        aria-label={expanded ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        title={label}
        aria-expanded={expanded}
        onClick={() => setPinned((current) => !current)}
      >
        <LayoutPanelTopIcon
          ref={iconRef}
          size={16}
          className={cn('flex items-center justify-center', anyActive && 'text-cx-accent')}
        />
      </Button>

      {trailing}
    </div>
  )
}
