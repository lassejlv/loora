import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { appUrl, isDesktop, openExternal } from '@loora/platform'
import { Button } from '@loora/ui/button'
import { CheckIcon, CopyIcon } from '@loora/ui/icons'
import { cn } from '@loora/ui/utils'
import { copyText } from '../lib/copy-text'

export type TourSide = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  id: string
  title: string
  body: string
  /**
   * The `data-tour` value of the element to spotlight. A step without one — or
   * whose element is not on screen — shows its card in the middle instead, so
   * a hidden panel costs a highlight rather than breaking the tour.
   */
  target?: string
  /** Preferred side for the card; the tour moves it if there is no room. */
  side?: TourSide
  /** Breathing room around the spotlight, in pixels. */
  padding?: number
  /** Runs as the step opens — use it to reveal what the step points at. */
  ensure?: () => void
  /**
   * Drop the step when its element is missing as the tour opens. For things no
   * `ensure` can conjure — a branch picker only owners get — where a card
   * pointing at nothing would be worse than one step fewer.
   */
  required?: boolean
  /**
   * Hands the editor back while the step is up and advances once the reader
   * has actually done the thing. `done` is polled on every frame, so keep it
   * to a cheap read.
   */
  waitFor?: { hint: string; done: () => boolean }
  link?: { label: string; href: string }
  copy?: { label: string; value: string }
}

interface Box {
  top: number
  left: number
  width: number
  height: number
}

interface Placement {
  top: number
  left: number
  side: TourSide
  /** False until the card has been measured, so it never flashes misplaced. */
  ready: boolean
}

/** Narrow windows get the width they have, minus the edge margin on each side. */
const CARD_WIDTH = 'min(300px, calc(100vw - 24px))'
/** Space between the spotlight and the card. */
const GAP = 14
/** Closest the card comes to the edge of the window. */
const EDGE = 12

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function readTarget(target: string | undefined, padding: number): Box | null {
  if (!target || typeof document === 'undefined') return null
  const element = document.querySelector(`[data-tour="${target}"]`)
  if (!(element instanceof HTMLElement)) return null
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  }
}

function sameBox(left: Box | null, right: Box | null) {
  if (left === right) return true
  if (!left || !right) return false
  return (
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  )
}

/**
 * Put the card on the first side of the spotlight that has room for it,
 * preferring the step's own choice, and keep it inside the window.
 */
function place(
  box: Box | null,
  card: { width: number; height: number },
  preferred: TourSide | undefined,
): Omit<Placement, 'ready'> {
  const viewWidth = window.innerWidth
  const viewHeight = window.innerHeight
  if (!box) {
    return {
      side: 'bottom',
      top: Math.max(EDGE, (viewHeight - card.height) / 2),
      left: Math.max(EDGE, (viewWidth - card.width) / 2),
    }
  }

  const room: Record<TourSide, number> = {
    top: box.top,
    bottom: viewHeight - (box.top + box.height),
    left: box.left,
    right: viewWidth - (box.left + box.width),
  }
  const needed: Record<TourSide, number> = {
    top: card.height + GAP + EDGE,
    bottom: card.height + GAP + EDGE,
    left: card.width + GAP + EDGE,
    right: card.width + GAP + EDGE,
  }
  const order: TourSide[] = ['bottom', 'top', 'right', 'left']
  const candidates = preferred ? [preferred, ...order] : order
  const side =
    candidates.find((candidate) => room[candidate] >= needed[candidate]) ??
    order.sort((a, b) => room[b] - needed[b] - (room[a] - needed[a]))[0]!

  const centreX = box.left + box.width / 2 - card.width / 2
  const centreY = box.top + box.height / 2 - card.height / 2
  const raw =
    side === 'top'
      ? { top: box.top - card.height - GAP, left: centreX }
      : side === 'bottom'
        ? { top: box.top + box.height + GAP, left: centreX }
        : side === 'left'
          ? { top: centreY, left: box.left - card.width - GAP }
          : { top: centreY, left: box.left + box.width + GAP }

  return {
    side,
    top: clamp(raw.top, EDGE, Math.max(EDGE, viewHeight - card.height - EDGE)),
    left: clamp(raw.left, EDGE, Math.max(EDGE, viewWidth - card.width - EDGE)),
  }
}

/**
 * A spotlight tour over the real interface. Steps name an element by its
 * `data-tour` attribute; the tour measures it every frame, so a panel that
 * opens, a window that resizes, or a drawer mid-animation all stay lit
 * correctly without the steps knowing anything about layout.
 */
export function ProductTour({
  steps,
  open,
  onOpenChange,
  onFinish,
  initialIndex = 0,
  onIndexChange,
}: {
  steps: TourStep[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when the tour is completed or skipped, never when it re-opens. */
  onFinish?: () => void
  /** Where to pick the tour up, for someone who reloaded part way through. */
  initialIndex?: number
  onIndexChange?: (index: number) => void
}) {
  const reduceMotion = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [active, setActive] = useState<TourStep[]>([])
  const [box, setBox] = useState<Box | null>(null)
  const [placement, setPlacement] = useState<Placement>({
    top: 0,
    left: 0,
    side: 'bottom',
    ready: false,
  })
  const cardRef = useRef<HTMLDivElement | null>(null)

  const [copied, setCopied] = useState(false)
  const step = open ? active[index] : undefined
  const isLast = index >= active.length - 1
  // An interactive step hands the editor back: the overlay stops swallowing
  // pointers and keys so the reader can do what it just asked for.
  const waiting = step?.waitFor !== undefined

  const close = useCallback(() => {
    onOpenChange(false)
    onFinish?.()
  }, [onOpenChange, onFinish])

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) return
      if (next >= active.length) {
        close()
        return
      }
      // Hide the card until the new step has been measured.
      setPlacement((current) => ({ ...current, ready: false }))
      setCopied(false)
      setIndex(next)
      onIndexChange?.(next)
    },
    [close, active.length, onIndexChange],
  )

  // Settle the step list once, as the tour opens: what is on screen now is
  // what this run is about.
  useEffect(() => {
    if (!open) return
    const runnable = steps.filter(
      (entry) => !entry.required || readTarget(entry.target, 0) !== null,
    )
    setActive(runnable)
    setIndex(clamp(initialIndex, 0, Math.max(0, runnable.length - 1)))
    setPlacement((current) => ({ ...current, ready: false }))
    setCopied(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    active[index]?.ensure?.()
    // `active` is rebuilt when the tour opens; the index is the identity that
    // matters between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, active])

  // One measurement per frame, for as long as the tour is up. Cheaper than it
  // looks, and it is the only thing that survives panels animating open.
  useEffect(() => {
    if (!open) return
    const target = active[index]?.target
    const padding = active[index]?.padding ?? 8
    const side = active[index]?.side
    const waitFor = active[index]?.waitFor
    let frame = 0
    let lastBox: Box | null = null
    let lastPlacement: Omit<Placement, 'ready'> | null = null
    let advanced = false

    const tick = () => {
      // The reader did the thing — move on without them reaching for Next.
      if (waitFor && !advanced && waitFor.done()) {
        advanced = true
        goTo(index + 1)
        return
      }
      const nextBox = readTarget(target, padding)
      if (!sameBox(lastBox, nextBox)) {
        lastBox = nextBox
        setBox(nextBox)
      }
      const node = cardRef.current
      if (node) {
        const next = place(
          nextBox,
          { width: node.offsetWidth, height: node.offsetHeight },
          side,
        )
        if (
          !lastPlacement ||
          lastPlacement.side !== next.side ||
          Math.abs(lastPlacement.top - next.top) > 0.5 ||
          Math.abs(lastPlacement.left - next.left) > 0.5
        ) {
          lastPlacement = next
          setPlacement({ ...next, ready: true })
        } else {
          setPlacement((current) =>
            current.ready ? current : { ...next, ready: true },
          )
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, active, goTo])

  // The tour is modal, so the editor's own shortcuts stay quiet under it.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      // While a step waits on the reader, the editor's own keys are the point
      // — R for a rectangle has to reach it. Only Escape stays the tour's.
      if (waiting) {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        event.preventDefault()
        close()
        return
      }
      event.stopPropagation()
      // Enter on a focused button belongs to that button, not to "next".
      const onControl =
        event.target instanceof HTMLElement &&
        event.target.closest('button, a[href]') !== null
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (
        event.key === 'ArrowRight' ||
        (event.key === 'Enter' && !onControl)
      ) {
        event.preventDefault()
        goTo(index + 1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goTo(index - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, index, waiting, goTo, close])

  useEffect(() => {
    // Taking focus during a waiting step would steal the keystroke it asks for.
    if (open && !waiting) cardRef.current?.focus()
  }, [open, index, waiting])

  if (!open || !step || typeof document === 'undefined') return null

  const glide = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.7 }
  // A waiting step keeps the room lit enough to work in.
  const dim = waiting ? 'rgb(9 9 11 / 0.34)' : 'rgb(9 9 11 / 0.64)'
  // The card leans in from the spotlight it belongs to.
  const lean = { top: { y: 8 }, bottom: { y: -8 }, left: { x: 8 }, right: { x: -8 } }[
    placement.side
  ] as { x?: number; y?: number }

  return createPortal(
    <motion.div
      // Above the editor chrome (z-20) and every portalled surface (z-50);
      // the tour is the only thing on screen while it runs.
      className={cn('fixed inset-0 z-[60]', waiting && 'pointer-events-none')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
    >
      {/* Swallows every click so the tour is the only thing you can drive —
          except while a step is waiting on the reader to act. */}
      {waiting ? null : (
        <div
          className="absolute inset-0"
          onPointerDown={(event) => event.preventDefault()}
        />
      )}

      {box ? (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-lg"
          style={{ boxShadow: `0 0 0 9999px ${dim}` }}
          initial={false}
          animate={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
          }}
          transition={glide}
        >
          <div className="absolute -inset-px rounded-lg ring-2 ring-ring/70" />
          {/* One ripple as the spotlight lands, rather than a ring that never
              stops asking for attention. */}
          {reduceMotion ? null : (
            <motion.div
              key={step.id}
              className="absolute -inset-px rounded-lg ring-2 ring-ring"
              initial={{ opacity: 0.85, scale: 1 }}
              animate={{ opacity: 0, scale: 1.06 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          )}
        </motion.div>
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: dim }}
        />
      )}

      <motion.div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`tour-title-${step.id}`}
        aria-describedby={`tour-body-${step.id}`}
        className="pointer-events-auto absolute rounded-lg border border-line bg-surface p-3 shadow-panel-lg outline-none"
        style={{ width: CARD_WIDTH, top: placement.top, left: placement.left }}
        animate={{
          opacity: placement.ready ? 1 : 0,
          scale: placement.ready || reduceMotion ? 1 : 0.98,
          x: placement.ready || reduceMotion ? 0 : (lean.x ?? 0),
          y: placement.ready || reduceMotion ? 0 : (lean.y ?? 0),
        }}
        transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.4, 0, 0.2, 1] }}
      >
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {index + 1} of {active.length}
        </p>
        <h2
          id={`tour-title-${step.id}`}
          className="mt-1 text-sm font-semibold tracking-tight"
        >
          {step.title}
        </h2>
        <p
          id={`tour-body-${step.id}`}
          className="mt-1 text-xs leading-relaxed text-muted-foreground"
        >
          {step.body}
        </p>
        {step.link ? (
          // A new tab on the web, a browser on the desktop: either way the
          // canvas behind stays open with its pending edits intact.
          <a
            href={step.link.href}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-medium underline underline-offset-2 hover:text-foreground"
            onClick={(event) => {
              if (!isDesktop()) return
              event.preventDefault()
              openExternal(appUrl(step.link!.href))
            }}
          >
            {step.link.label}
          </a>
        ) : null}
        {step.copy ? (
          <div className="mt-2 flex items-center gap-1 rounded-md border border-line bg-surface-2 ps-2">
            <code className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
              {step.copy.value}
            </code>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                void copyText(step.copy!.value).then(() => setCopied(true))
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? 'Copied' : step.copy.label}
            </Button>
          </div>
        ) : null}
        {step.waitFor ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
            <motion.span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-ring"
              animate={reduceMotion ? undefined : { opacity: [1, 0.25, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            {step.waitFor.hint}
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1" aria-hidden="true">
            {active.map((entry, position) => (
              <span
                key={entry.id}
                className={cn(
                  'size-1 rounded-full transition-colors',
                  position === index ? 'bg-foreground' : 'bg-foreground/24',
                )}
              />
            ))}
          </div>
          {index === 0 ? (
            <Button size="xs" variant="ghost" onClick={close}>
              Skip
            </Button>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => goTo(index - 1)}>
              Back
            </Button>
          )}
          {/* A waiting step advances itself. The button stays as a way past it
              for anyone who would rather not, never as the way through it. */}
          <Button
            size="xs"
            variant={waiting ? 'ghost' : 'default'}
            onClick={() => goTo(index + 1)}
          >
            {waiting ? 'Skip this' : isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
