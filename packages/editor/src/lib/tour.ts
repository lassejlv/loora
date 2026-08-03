import type { TourStep } from '../components/product-tour'

/**
 * Bumping the suffix replays the tour for everyone — worth it when a step
 * describes something that has genuinely changed, not for copy edits.
 */
export const TOUR_STORAGE_KEY = 'loora:tour-seen:1'

export function hasSeenTour(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === '1'
  } catch {
    // A blocked store is not a reason to show the tour on every load.
    return true
  }
}

export function markTourSeen() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, '1')
  } catch {
    // Private browsing: the tour runs again next time, which is survivable.
  }
}

export function clearTourSeen() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TOUR_STORAGE_KEY)
  } catch {
    // Nothing to clear if it could never be written.
  }
}

/** Where an interrupted run had got to, so a reload does not start over. */
export const TOUR_PROGRESS_KEY = 'loora:tour-progress'

export function readTourProgress(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = Number(window.localStorage.getItem(TOUR_PROGRESS_KEY))
    return Number.isInteger(raw) && raw > 0 ? raw : 0
  } catch {
    return 0
  }
}

export function writeTourProgress(index: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TOUR_PROGRESS_KEY, String(index))
  } catch {
    // Losing the bookmark only costs a restart from the top.
  }
}

export function clearTourProgress() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TOUR_PROGRESS_KEY)
  } catch {
    // Nothing to clear if it could never be written.
  }
}

/** Where an agent connects. Same endpoint the integrations page hands out. */
export const MCP_ENDPOINT = 'https://mcp.loora.design/mcp'

/**
 * What somebody needs to know to use Loora, in the order they meet it. Panel
 * steps open what they point at rather than assuming it is showing; the
 * branch step drops out for anyone who cannot branch.
 */
export function editorTourSteps({
  isMobile,
  openLayers,
  openDesign,
  nodeCount,
}: {
  isMobile: boolean
  openLayers: () => void
  openDesign: () => void
  /** How many nodes the document holds right now, for the hands-on step. */
  nodeCount: () => number
}): TourStep[] {
  // Captured when the hands-on step opens, so "did something appear?" is
  // measured against the document as it was at that moment.
  let baseline = 0

  const steps: TourStep[] = [
    {
      id: 'canvas',
      title: 'This is the canvas',
      body: 'Everything on it is structured: pages, frames, text, shapes, components. Not a picture of an interface — the interface itself, which is why it can be exported as real code.',
    },
    {
      id: 'tools',
      title: 'Put something on it',
      body: 'Frames, text, rectangles, icons, and images. Whatever you drop becomes a node you can style, move, and export.',
      target: 'tools',
      side: 'top',
      padding: 10,
      ensure: () => {
        baseline = nodeCount()
      },
      waitFor: {
        hint: 'Press R and drag out a rectangle — the tour waits for you.',
        done: () => nodeCount() > baseline,
      },
    },
  ]

  if (!isMobile) {
    steps.push(
      {
        id: 'layers',
        title: 'Every node, in order',
        body: 'The document as a tree. Reorder, rename, hide, and lock from here — and drag one node inside another to nest it.',
        target: 'layers',
        side: 'right',
        padding: 0,
        ensure: openLayers,
      },
      {
        id: 'design',
        title: 'Change how it looks',
        body: 'Select anything and this fills in: layout, size, colour, stroke, shadow, motion. ⌥⌘B hides it when you want the room.',
        target: 'design',
        side: 'left',
        padding: 0,
        ensure: openDesign,
      },
    )
  }

  steps.push(
    {
      id: 'branches',
      title: 'Try things without the risk',
      body: 'Work on a branch, then propose it, compare it against Main, and apply it when it is right. Main stays exactly where you left it until you say so.',
      target: 'branches',
      side: 'bottom',
      required: true,
    },
    {
      id: 'share',
      title: 'Share it, or take the code',
      body: 'Invite someone to view or edit, or export the page as HTML, React, Tailwind, JSON, or a PNG. Exports are one-way — the canvas stays the source of truth.',
      target: 'share',
      side: 'bottom',
    },
    {
      id: 'agent',
      title: 'Bring your own agent',
      body: 'There is no chat box here on purpose. Point Claude, Cursor, or anything else that speaks MCP at this endpoint and it edits the same document, through the same validated transactions you do.',
      copy: { label: 'Copy', value: MCP_ENDPOINT },
      link: { label: 'Set up MCP →', href: '/app/integrations' },
    },
  )

  return steps
}
