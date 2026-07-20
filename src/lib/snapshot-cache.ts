export interface CaptureReuseEntry {
  key: string
  revision: number
  volatile: boolean
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

export function shouldReuseCapture(
  entry: CaptureReuseEntry | undefined,
  key: string,
  revision: number,
  freshness: 'reuse-clean' | 'fresh',
) {
  return (
    freshness === 'reuse-clean' &&
    entry?.key === key &&
    entry.revision === revision &&
    !entry.volatile
  )
}
