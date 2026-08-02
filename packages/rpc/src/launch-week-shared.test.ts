import { describe, expect, it } from 'vitest'
import {
  defaultLaunchWeekConfig,
  launchWeekConfigSchema,
  publicLaunchWeek,
} from './launch-week-shared'

describe('publicLaunchWeek', () => {
  it('does not expose configuration while the campaign is disabled', () => {
    const result = publicLaunchWeek(
      defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z')),
      '2026-08-05',
    )

    expect(result).toEqual({ enabled: false })
  })

  it('does not expose offers before their release date', () => {
    const config = {
      ...defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z')),
      enabled: true,
    }
    const result = publicLaunchWeek(config, '2026-08-05')
    if (!result.enabled) throw new Error('Expected an enabled launch week')

    expect(result.days.map((day) => day.status)).toEqual([
      'released',
      'released',
      'today',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ])
    expect(result.days[2].offer?.title).toBe('Wednesday release')
    expect(result.days[3].offer).toBeNull()
  })

  it('supports a five-day campaign without exposing weekend offers', () => {
    const config = {
      ...defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z')),
      enabled: true,
      days: defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z')).days.slice(0, 5),
    }
    const result = publicLaunchWeek(config, '2026-08-03')
    if (!result.enabled) throw new Error('Expected an enabled launch week')

    expect(result.days).toHaveLength(5)
    expect(result.days.map((day) => day.name)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
    ])
    expect(result.days[1].offer).toBeNull()
  })

  it('accepts only five-day or seven-day campaigns', () => {
    const config = defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z'))

    expect(launchWeekConfigSchema.safeParse({ ...config, days: config.days.slice(0, 5) }).success).toBe(true)
    expect(launchWeekConfigSchema.safeParse({ ...config, days: config.days.slice(0, 6) }).success).toBe(false)
  })
})
