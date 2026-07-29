import { createEmptyCanvas } from '#/lib/canvas-fixtures'
import { orpc } from '#/lib/orpc-client'

export interface DesignSummary {
  id: string
  name: string
  revision: number
  updatedAt: number
}

export function newDesignId() {
  return `d${crypto.randomUUID().replaceAll('-', '')}`
}

/** Creates an empty Canvas document and its design row, then returns the list entry. */
export async function createDesign(name = 'Untitled'): Promise<DesignSummary> {
  const id = newDesignId()
  const document = createEmptyCanvas(id, name)
  const created = await orpc.canvas.create({ designId: id, name, document })
  return { id, name, revision: created.revision, updatedAt: Date.now() }
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/** "17 hours ago" for file cards. Sub-minute edits read as "just now". */
export function relativeTime(timestamp: number, now = Date.now()) {
  const elapsed = timestamp - now
  const magnitude = Math.abs(elapsed)
  if (magnitude < 60_000) return 'just now'
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (magnitude >= size) {
      return formatter.format(Math.round(elapsed / size), unit)
    }
  }
  return 'just now'
}
