import { describe, expect, it } from 'vitest'
import {
  BoundedConcurrencyGate,
  ConcurrencyLimitError,
} from './mcp-concurrency'

describe('BoundedConcurrencyGate', () => {
  it('runs only the configured number of tasks at once', async () => {
    const gate = new BoundedConcurrencyGate(2, 4, 1_000)
    let active = 0
    let maximum = 0
    const task = () =>
      gate.run(async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await Promise.resolve()
        active -= 1
      })

    await Promise.all([task(), task(), task(), task()])

    expect(maximum).toBe(2)
  })

  it('rejects work once the bounded queue is full', async () => {
    const gate = new BoundedConcurrencyGate(1, 0, 1_000)
    let release!: () => void
    const active = gate.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    await Promise.resolve()

    await expect(gate.run(async () => {})).rejects.toBeInstanceOf(
      ConcurrencyLimitError,
    )
    release()
    await active
  })
})
