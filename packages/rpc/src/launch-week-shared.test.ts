import { describe, expect, it } from 'vitest'
import {
  defaultLaunchWeekConfig,
  launchWeekConfigSchema,
  publicLaunchWeek,
  releaseInstant,
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

  it('keeps a day locked until its own release time', () => {
    const base = defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z'))
    const config = {
      ...base,
      enabled: true,
      days: base.days.map((day, index) => ({
        ...day,
        // Wednesday at 15:00; other days at midnight
        releaseTime: index === 2 ? '15:00' : '00:00',
      })),
    }

    const before = publicLaunchWeek(config, new Date('2026-08-05T14:59:59Z'))
    if (!before.enabled) throw new Error('Expected an enabled launch week')
    expect(before.days[2].status).toBe('upcoming')
    expect(before.days[2].offer).toBeNull()
    expect(before.days[2].releaseTime).toBe('15:00')

    const after = publicLaunchWeek(config, new Date('2026-08-05T15:00:00Z'))
    if (!after.enabled) throw new Error('Expected an enabled launch week')
    expect(after.days[2].status).toBe('today')
    expect(after.days[2].offer?.title).toBe('Wednesday release')
  })

  it('allows each day to unlock at a different time', () => {
    const base = defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z'))
    const config = {
      ...base,
      enabled: true,
      days: base.days.map((day, index) => ({
        ...day,
        releaseTime: index === 0 ? '09:00' : index === 1 ? '18:00' : '00:00',
      })),
    }

    // Monday is open after 09:00; Tuesday still locked until 18:00
    const middayTuesday = publicLaunchWeek(config, new Date('2026-08-04T12:00:00Z'))
    if (!middayTuesday.enabled) throw new Error('Expected an enabled launch week')
    expect(middayTuesday.days[0].status).toBe('released')
    expect(middayTuesday.days[1].status).toBe('upcoming')
    expect(middayTuesday.days[1].offer).toBeNull()

    const eveningTuesday = publicLaunchWeek(config, new Date('2026-08-04T18:00:00Z'))
    if (!eveningTuesday.enabled) throw new Error('Expected an enabled launch week')
    expect(eveningTuesday.days[1].status).toBe('today')
    expect(eveningTuesday.days[1].offer?.title).toBe('Tuesday release')
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

  it('backfills missing day times from the campaign default', () => {
    const config = defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z'))
    const withoutDayTimes = {
      ...config,
      releaseTime: '12:30',
      days: config.days.map(({ releaseTime: _ignored, ...day }) => day),
    }

    const parsed = launchWeekConfigSchema.parse(withoutDayTimes)
    expect(parsed.days.every((day) => day.releaseTime === '12:30')).toBe(true)
  })

  it('rejects invalid release times', () => {
    const config = defaultLaunchWeekConfig(new Date('2026-08-02T12:00:00Z'))

    expect(launchWeekConfigSchema.safeParse({ ...config, releaseTime: '9:00' }).success).toBe(false)
    expect(launchWeekConfigSchema.safeParse({
      ...config,
      days: config.days.map((day, index) => (
        index === 0 ? { ...day, releaseTime: '24:00' } : day
      )),
    }).success).toBe(false)
    expect(launchWeekConfigSchema.safeParse({
      ...config,
      days: config.days.map((day, index) => (
        index === 0 ? { ...day, releaseTime: '15:00' } : day
      )),
    }).success).toBe(true)
  })
})

describe('releaseInstant', () => {
  it('builds a UTC instant from a date and HH:mm', () => {
    expect(releaseInstant('2026-08-05', '15:30').toISOString()).toBe('2026-08-05T15:30:00.000Z')
  })
})
