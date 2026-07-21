import { useReducedMotion } from 'motion/react'
import { motion } from 'motion/react'
import { LayersIcon, MessageSquarePlusIcon, SparklesIcon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import { fadeUp, uiTransition } from '#/lib/motion'

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
    icon: SparklesIcon,
    title: 'Describe, don’t draw first',
    body: 'Tell the agent what you want. It places real HTML and React on the board.',
  },
  {
    icon: LayersIcon,
    title: 'Arrange like a design tool',
    body: 'Select, group, nudge, and peek at code when you want control.',
  },
  {
    icon: MessageSquarePlusIcon,
    title: 'Point and revise',
    body: 'Comment on a spot or keep chatting — the canvas stays the source of truth.',
  },
] as const

function WelcomeHero() {
  const reduceMotion = useReducedMotion()

  return (
    <div
      aria-hidden="true"
      className="relative h-44 w-full shrink-0 overflow-hidden bg-cx-canvas sm:h-48"
    >
      <div
        className="absolute inset-0 opacity-90"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--cx-dot) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      />
      <div className="absolute -left-10 -top-12 size-44 rounded-full bg-cx-accent/25 blur-3xl" />
      <div className="absolute -right-8 bottom-0 size-36 rounded-full bg-cx-accent/10 blur-3xl" />

      <motion.div
        className="absolute left-[8%] top-9 w-[7.5rem] -rotate-6 rounded-xl border border-black/8 bg-white p-2.5 shadow-[0_8px_24px_-12px_rgba(26,25,23,0.35)]"
        initial={reduceMotion ? false : { y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-2 h-1.5 w-8 rounded-full bg-cx-ink/15" />
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-cx-ink/10" />
          <div className="h-1.5 w-4/5 rounded-full bg-cx-ink/10" />
          <div className="h-8 rounded-lg bg-cx-accent/15" />
        </div>
      </motion.div>

      <motion.div
        className="absolute left-1/2 top-7 w-[9.5rem] -translate-x-1/2 rotate-1 rounded-xl border border-black/8 bg-white p-2.5 shadow-[0_10px_28px_-12px_rgba(26,25,23,0.4)]"
        initial={reduceMotion ? false : { y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-cx-accent" />
          <span className="h-1.5 w-12 rounded-full bg-cx-ink/15" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="h-10 rounded-lg bg-cx-canvas" />
          <div className="h-10 rounded-lg bg-cx-accent/20" />
          <div className="col-span-2 h-6 rounded-lg bg-cx-ink/8" />
        </div>
      </motion.div>

      <motion.div
        className="absolute right-[7%] top-11 w-32 rotate-[5deg] rounded-xl border border-black/8 bg-white p-2.5 shadow-[0_8px_24px_-12px_rgba(26,25,23,0.35)]"
        initial={reduceMotion ? false : { y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-2 flex gap-1">
          <span className="h-5 w-5 rounded-md bg-cx-accent/20" />
          <span className="h-5 flex-1 rounded-md bg-cx-ink/8" />
        </div>
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded-full bg-cx-ink/10" />
          <div className="h-1.5 w-3/4 rounded-full bg-cx-ink/10" />
          <div className="mt-2 h-6 rounded-md bg-cx-ink" />
        </div>
      </motion.div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-popover to-transparent" />
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
          <p className="text-lg font-semibold tracking-tight">
            loora<span className="text-cx-accent">.</span>
          </p>
          <DialogTitle className="text-2xl leading-tight tracking-tight">
            The design harness.
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Put an agent on an infinite canvas. It builds real UI in place — you steer, arrange, and
            ship from the board.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="flex flex-col gap-3 pt-1">
          {BEATS.map((beat, index) => {
            const Icon = beat.icon
            return (
              <motion.div
                key={beat.title}
                className="flex gap-3"
                initial={enter.initial}
                animate={enter.animate}
                transition={{ ...transition, delay: reduceMotion ? 0 : 0.04 * index }}
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-cx-accent/10 text-cx-accent">
                  <Icon size={16} className="size-4" data-slot="icon" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{beat.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {beat.body}
                  </p>
                </div>
              </motion.div>
            )
          })}
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
