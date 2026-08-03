import { z } from 'zod'
import type { LaunchWeekDay } from '@loora/db/schema'

export const LAUNCH_WEEK_ID = 'primary'
export const DEFAULT_RELEASE_TIME = '00:00'
export const LAUNCH_WEEK_DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/** UTC clock time as HH:mm, e.g. "09:30". */
export const releaseTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm in 24-hour UTC.')

const launchWeekDayInputSchema = z.object({
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
  /** Optional so older stored days without a time still parse; filled from the campaign default. */
  releaseTime: releaseTimeSchema.optional(),
}).superRefine((day, context) => {
  if (Boolean(day.ctaLabel) !== Boolean(day.ctaUrl)) {
    context.addIssue({
      code: 'custom',
      message: 'CTA label and URL must either both be set or both be empty.',
    })
  }
})

const launchWeekConfigInputSchema = z.object({
  enabled: z.boolean(),
  startDate: z.string().date().refine(
    (value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 1,
    'Launch week must start on a Monday.',
  ),
  /** Default unlock time for new days and for days that omit their own time. */
  releaseTime: releaseTimeSchema.default(DEFAULT_RELEASE_TIME),
  headline: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
  days: z.array(launchWeekDayInputSchema).refine(
    (days) => days.length === 5 || days.length === 7,
    'Launch week must have 5 or 7 days.',
  ),
})

export const launchWeekConfigSchema = launchWeekConfigInputSchema.transform((config) => ({
  ...config,
  days: config.days.map((day) => ({
    title: day.title,
    description: day.description,
    ctaLabel: day.ctaLabel,
    ctaUrl: day.ctaUrl,
    releaseTime: day.releaseTime ?? config.releaseTime,
  })),
}))

export type LaunchWeekConfig = z.output<typeof launchWeekConfigSchema>

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
        releaseTime: string
        status: 'upcoming' | 'today' | 'released'
        offer: LaunchWeekDay | null
      }>
    }

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

/** Instant a day's offer unlocks (UTC). */
export function releaseInstant(date: string, releaseTime: string) {
  return new Date(`${date}T${releaseTime}:00Z`)
}

function dayStatus(
  date: string,
  releaseTime: string,
  now: Date,
): 'upcoming' | 'today' | 'released' {
  if (now.getTime() < releaseInstant(date, releaseTime).getTime()) return 'upcoming'
  const todayUtc = now.toISOString().slice(0, 10)
  return todayUtc === date ? 'today' : 'released'
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
    releaseTime: DEFAULT_RELEASE_TIME,
    headline: 'Seven days. Seven releases.',
    description: 'A new Loora release lands every day. Return each morning to see what shipped.',
    days: LAUNCH_WEEK_DAY_NAMES.map((day) => ({
      title: `${day} release`,
      description: 'Describe what launches today and why it matters.',
      ctaLabel: '',
      ctaUrl: '',
      releaseTime: DEFAULT_RELEASE_TIME,
    })),
  }
}

export function publicLaunchWeek(config: LaunchWeekConfig, now: Date | string): PublicLaunchWeek {
  if (!config.enabled) return { enabled: false as const }

  const instant = typeof now === 'string'
    ? new Date(`${now}T00:00:00Z`)
    : now

  return {
    enabled: true as const,
    startDate: config.startDate,
    headline: config.headline,
    description: config.description,
    days: config.days.map((offer, index) => {
      const name = LAUNCH_WEEK_DAY_NAMES[index]
      const date = addDays(config.startDate, index)
      const releaseTime = offer.releaseTime
      const status = dayStatus(date, releaseTime, instant)
      return {
        name,
        date,
        releaseTime,
        status,
        offer: status === 'upcoming' ? null : offer as LaunchWeekDay,
      }
    }),
  }
}
