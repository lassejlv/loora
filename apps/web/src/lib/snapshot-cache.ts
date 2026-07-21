export interface CaptureReuseEntry {
  key: string
  revision: number
  volatile: boolean
  // When the capture was taken; lets animated elements reuse a recent frame.
  at?: number
}

export class CaptureCache<T extends CaptureReuseEntry> {
  readonly #entries = new Map<string, T>()

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Capture cache capacity must be a positive integer')
    }
  }

  get(elementId: string): T | undefined {
    const entry = this.#entries.get(elementId)
    if (!entry) return undefined
    this.#entries.delete(elementId)
    this.#entries.set(elementId, entry)
    return entry
  }

  set(elementId: string, entry: T) {
    this.#entries.delete(elementId)
    this.#entries.set(elementId, entry)
    while (this.#entries.size > this.capacity) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined) break
      this.#entries.delete(oldest)
    }
  }

  has(elementId: string) {
    return this.#entries.has(elementId)
  }

  get size() {
    return this.#entries.size
  }
}

// An animated element bumps its revision on every animation tick and its
// captures are marked volatile, so revision equality would force a fresh
// html-to-image pass on every snapshot. A recent volatile capture of the same
// code is just a different frame of the same animation — reuse it briefly.
export const VOLATILE_REUSE_MS = 10_000

export function shouldReuseCapture(
  entry: CaptureReuseEntry | undefined,
  key: string,
  revision: number,
  freshness: 'reuse-clean' | 'fresh',
  now = Date.now(),
) {
  if (freshness !== 'reuse-clean' || entry?.key !== key) return false
  if (entry.revision === revision && !entry.volatile) return true
  return entry.volatile && entry.at !== undefined && now - entry.at < VOLATILE_REUSE_MS
}
