import { z } from 'zod'
import type { LaunchWeekDay } from '@loora/db/schema'

export const LAUNCH_WEEK_ID = 'primary'
export const LAUNCH_WEEK_DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

const launchWeekDaySchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
  ctaLabel: z.string().trim().max(80),
  ctaUrl: z.union([
    z.literal(''),
    z.string().trim().max(2048).refine(
      (value) => (value.startsWith('/') && !value.startsWith('//')) || /^https:\/\//.test(value),
      'Use a relative path or an https:// URL.',
    ),
  ]),
}).superRefine((day, context) => {
  if (Boolean(day.ctaLabel) !== Boolean(day.ctaUrl)) {
    context.addIssue({
      code: 'custom',
      message: 'CTA label and URL must either both be set or both be empty.',
    })
  }
})

export const launchWeekConfigSchema = z.object({
  enabled: z.boolean(),
  startDate: z.string().date().refine(
    (value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 1,
    'Launch week must start on a Monday.',
  ),
  headline: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
  days: z.array(launchWeekDaySchema).refine(
    (days) => days.length === 5 || days.length === 7,
    'Launch week must have 5 or 7 days.',
  ),
})

export type LaunchWeekConfig = z.infer<typeof launchWeekConfigSchema>

export type PublicLaunchWeek =
  | { enabled: false }
  | {
      enabled: true
      startDate: string
      headline: string
      description: string
      days: Array<{
        name: (typeof LAUNCH_WEEK_DAY_NAMES)[number]
        date: string
        status: 'upcoming' | 'today' | 'released'
        offer: LaunchWeekDay | null
      }>
    }

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

export function nextMonday(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7
  date.setUTCDate(date.getUTCDate() + daysUntilMonday)
  return date.toISOString().slice(0, 10)
}

export function defaultLaunchWeekConfig(now = new Date()): LaunchWeekConfig {
  return {
    enabled: false,
    startDate: nextMonday(now),
    headline: 'Seven days. Seven releases.',
    description: 'A new Loora release lands every day. Return each morning to see what shipped.',
    days: LAUNCH_WEEK_DAY_NAMES.map((day) => ({
      title: `${day} release`,
      description: 'Describe what launches today and why it matters.',
      ctaLabel: '',
      ctaUrl: '',
    })),
  }
}

export function publicLaunchWeek(config: LaunchWeekConfig, today: string): PublicLaunchWeek {
  if (!config.enabled) return { enabled: false as const }

  return {
    enabled: true as const,
    startDate: config.startDate,
    headline: config.headline,
    description: config.description,
    days: config.days.map((offer, index) => {
      const name = LAUNCH_WEEK_DAY_NAMES[index]
      const date = addDays(config.startDate, index)
      const status: 'upcoming' | 'today' | 'released' =
        today < date ? 'upcoming' : today === date ? 'today' : 'released'
      return {
        name,
        date,
        status,
        offer: status === 'upcoming' ? null : offer as LaunchWeekDay,
      }
    }),
  }
}
