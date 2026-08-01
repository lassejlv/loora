interface ClosableResource {
  close: () => Promise<void>
}

export class IdleResource<Resource extends ClosableResource> {
  private current: Resource | null = null
  private launching: Promise<Resource> | null = null
  private active = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly launch: () => Promise<Resource>,
    private readonly idleTimeoutMs: number,
  ) {}

  async run<Result>(task: (resource: Resource) => Promise<Result>) {
    this.clearTimer()
    this.active += 1
    try {
      return await task(await this.get())
    } finally {
      this.active -= 1
      this.scheduleClose()
    }
  }

  invalidate(resource: Resource) {
    if (this.current !== resource) return
    this.current = null
    this.clearTimer()
  }

  async closeIfIdle() {
    if (this.active > 0) return false
    this.clearTimer()
    const resource = this.current
    this.current = null
    if (!resource) return false
    await resource.close()
    return true
  }

  private async get() {
    if (this.current) return this.current
    if (this.launching) return this.launching

    const launching = this.launch()
    this.launching = launching
    try {
      const resource = await launching
      if (this.launching === launching) {
        this.current = resource
        this.launching = null
      }
      return resource
    } catch (error) {
      if (this.launching === launching) this.launching = null
      throw error
    }
  }

  private scheduleClose() {
    if (this.active > 0 || !this.current || this.timer) return
    this.timer = setTimeout(() => {
      void this.closeIfIdle().catch((error) => {
        console.error('[mcp] idle resource close failed:', error)
      })
    }, this.idleTimeoutMs)
    this.timer.unref?.()
  }

  private clearTimer() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
