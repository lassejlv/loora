import { describe, expect, it } from 'bun:test'
import { IdleResource } from './mcp-idle-resource'

describe('IdleResource', () => {
  it('shares one launch and relaunches after an idle close', async () => {
    let launches = 0
    let closes = 0
    const resource = new IdleResource(
      async () => {
        launches += 1
        return {
          close: async () => {
            closes += 1
          },
        }
      },
      60_000,
    )

    await Promise.all([
      resource.run(async () => 'first'),
      resource.run(async () => 'second'),
    ])
    expect(launches).toBe(1)
    expect(await resource.closeIfIdle()).toBe(true)
    expect(closes).toBe(1)

    await resource.run(async () => 'third')
    expect(launches).toBe(2)
    expect(await resource.closeIfIdle()).toBe(true)
    expect(closes).toBe(2)
  })

  it('does not close a resource while work is active', async () => {
    let release!: () => void
    let started!: () => void
    let closes = 0
    const active = new Promise<void>((resolve) => {
      started = resolve
    })
    const resource = new IdleResource(
      async () => ({
        close: async () => {
          closes += 1
        },
      }),
      60_000,
    )
    const running = resource.run(async () => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    await active

    expect(await resource.closeIfIdle()).toBe(false)
    expect(closes).toBe(0)

    release()
    await running
    expect(await resource.closeIfIdle()).toBe(true)
    expect(closes).toBe(1)
  })
})
