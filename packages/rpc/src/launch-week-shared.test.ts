import { describe, expect, it } from 'vitest'
import { defaultLaunchWeekConfig, publicLaunchWeek } from './launch-week-shared'

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
})
