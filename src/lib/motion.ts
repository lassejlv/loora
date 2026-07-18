import type { Transition } from 'motion/react'

/** Matches dialog/sheet chrome (`duration-200 ease-in-out`). */
const easeUi = [0.4, 0, 0.2, 1] as const

export function uiTransition(reduce: boolean | null): Transition {
  return reduce ? { duration: 0.12 } : { duration: 0.16, ease: easeUi }
}

export function interruptTransition(reduce: boolean | null): Transition {
  return reduce ? { duration: 0.12 } : { duration: 0.2, ease: easeUi }
}

export function fadeUp(reduce: boolean | null) {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 4 },
    animate: reduce ? { opacity: 1 } : { opacity: 1, y: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: 4 },
  }
}

export function interruptIn(reduce: boolean | null) {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.97 },
    animate: reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.97 },
  }
}
