import { useReducedMotion } from 'motion/react'
import { motion } from 'motion/react'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { fadeUp, uiTransition } from '../lib/motion'

export const WELCOME_STORAGE_KEY = 'loora:welcome-seen'

export function hasSeenWelcome(): boolean {
  if (typeof window === 'undefined') return true
  return window.localStorage.getItem(WELCOME_STORAGE_KEY) === '1'
}

export function markWelcomeSeen() {
  window.localStorage.setItem(WELCOME_STORAGE_KEY, '1')
}

/** Clears welcome dismissal so the landing dialog shows again after sign-out. */
export function clearWelcomeSeen() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(WELCOME_STORAGE_KEY)
}

const BEATS = [
  {
    title: 'Design on an infinite canvas',
    body: 'Every element is structured, responsive UI you can select, group, and nudge.',
  },
  {
    title: 'Connect your own agent',
    body: 'Point Claude or Cursor at the Loora MCP server and it edits the same document you do.',
  },
  {
    title: 'Branch, merge, and ship',
    body: 'Fork a design, compare any two points, then export from Main.',
  },
] as const

/** Board vignette — product chrome, not a marketing card collage. */
function WelcomeHero() {
  const reduceMotion = useReducedMotion()

  return (
    <div
      aria-hidden="true"
      className="relative h-36 w-full shrink-0 overflow-hidden border-b border-border bg-cx-canvas sm:h-40"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--cx-dot) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      />

      {/* Quiet neighbor frame — unselected */}
      <motion.div
        className="absolute left-[12%] top-10 h-[4.5rem] w-28 border border-black/10 bg-background/80 dark:border-white/10"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
          <div className="h-full w-full p-2">
          <div className="h-2 w-10 bg-cx-ink/10" />
          <div className="mt-2 h-full w-full bg-cx-ink/5" />
        </div>
      </motion.div>

      {/* Selected frame with real selection chrome */}
      <motion.div
        className="absolute left-[38%] top-7 h-[5.75rem] w-40"
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: reduceMotion ? 0 : 0.05, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="relative h-full w-full border border-cx-accent bg-background shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <div className="flex h-full flex-col gap-1.5 p-2.5">
            <div className="h-2 w-14 bg-cx-ink/15" />
            <div className="h-2 w-full bg-cx-ink/8" />
            <div className="h-2 w-4/5 bg-cx-ink/8" />
            <div className="mt-auto h-7 w-full bg-cx-ink/5" />
          </div>
          {/* Corner handles */}
          {(['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1'] as const).map(
            (pos) => (
              <span
                key={pos}
                className={`absolute size-2 border border-cx-accent bg-background ${pos}`}
              />
            ),
          )}
        </div>
        {/* Element label chip — mirrors canvas chrome */}
        <div className="absolute -top-5 left-0 flex items-center gap-1">
          <span className="rounded-sm bg-cx-accent px-1.5 py-0.5 font-mono text-[9px] font-medium leading-none text-white">
            hero
          </span>
        </div>
      </motion.div>

      {/* Comment pin */}
      <motion.div
        className="absolute right-[14%] top-[3.25rem] flex size-6 items-center justify-center rounded-full border border-border bg-background text-xs font-medium text-muted-foreground shadow-sm"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: reduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
      >
        1
      </motion.div>
    </div>
  )
}

export function WelcomeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const reduceMotion = useReducedMotion()
  const enter = fadeUp(reduceMotion)
  const transition = uiTransition(reduceMotion)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-md overflow-hidden sm:max-w-lg"
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        <WelcomeHero />

        <DialogHeader className="gap-2.5 pt-4">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            loora<span className="text-cx-accent">.</span>
          </DialogTitle>
          <p className="text-sm font-medium leading-snug text-muted-foreground">
            The design harness.
          </p>
          <DialogDescription className="text-sm leading-relaxed">
            An infinite canvas of real, structured UI — open to your own agent over MCP. Design in
            the browser, drive it from your editor, ship from the board.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="flex flex-col gap-0 border-t border-border pt-0">
          {BEATS.map((beat, index) => (
            <motion.div
              key={beat.title}
              className="flex gap-4 border-b border-border py-3 last:border-b-0"
              initial={enter.initial}
              animate={enter.animate}
              transition={{ ...transition, delay: reduceMotion ? 0 : 0.03 * index }}
            >
              <span className="w-5 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{beat.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{beat.body}</p>
              </div>
            </motion.div>
          ))}
        </DialogPanel>

        <DialogFooter variant="bare" className="sm:justify-end">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Start designing
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
