export class ConcurrencyLimitError extends Error {}

interface Waiter {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class BoundedConcurrencyGate {
  #active = 0
  #queue: Waiter[] = []

  constructor(
    readonly limit: number,
    readonly queueLimit: number,
    readonly queueTimeoutMs: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Concurrency limit must be a positive integer')
    }
    if (!Number.isInteger(queueLimit) || queueLimit < 0) {
      throw new Error('Queue limit must be a non-negative integer')
    }
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 1) {
      throw new Error('Queue timeout must be positive')
    }
  }

  async run<T>(task: () => Promise<T>) {
    const release = await this.#acquire()
    try {
      return await task()
    } finally {
      release()
    }
  }

  #releaseHandle() {
    let released = false
    return () => {
      if (released) return
      released = true
      this.#active -= 1
      const next = this.#queue.shift()
      if (!next) return
      clearTimeout(next.timer)
      this.#active += 1
      next.resolve(this.#releaseHandle())
    }
  }

  #acquire(): Promise<() => void> {
    if (this.#active < this.limit) {
      this.#active += 1
      return Promise.resolve(this.#releaseHandle())
    }
    if (this.#queue.length >= this.queueLimit) {
      return Promise.reject(
        new ConcurrencyLimitError(
          'The screenshot renderer is busy. Try again shortly.',
        ),
      )
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.#queue.indexOf(waiter)
          if (index >= 0) this.#queue.splice(index, 1)
          reject(
            new ConcurrencyLimitError(
              'Timed out waiting for the screenshot renderer.',
            ),
          )
        }, this.queueTimeoutMs),
      }
      this.#queue.push(waiter)
    })
  }
}
