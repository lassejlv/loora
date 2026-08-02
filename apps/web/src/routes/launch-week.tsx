import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { orpc } from '@loora/rpc/client'
import { usePalette } from '#/components/landing/palette'
import { LandingShell } from '#/components/landing/site-shell'

type LaunchWeek = Awaited<ReturnType<typeof orpc.launchWeek.get>>
type ActiveLaunchWeek = Extract<LaunchWeek, { enabled: true }>

export const Route = createFileRoute('/launch-week')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Launch week — loora' },
      { name: 'description', content: 'Seven days of new Loora releases.' },
      { property: 'og:title', content: 'Launch week — loora' },
      { property: 'og:description', content: 'Seven days of new Loora releases.' },
    ],
  }),
  component: LaunchWeekPage,
})

/** Repeated on every inline link on the page; the color comes from the palette. */
const LINK = 'underline-offset-2 hover:underline'

function readableDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

function LaunchWeekPage() {
  const [launchWeek, setLaunchWeek] = useState<LaunchWeek | null>(null)
  const [failed, setFailed] = useState(false)

  const loadLaunchWeek = useCallback(async () => {
    try {
      setLaunchWeek(await orpc.launchWeek.get())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void loadLaunchWeek()
  }, [loadLaunchWeek])

  return (
    <LandingShell>
      {failed ? (
        <Unavailable message="Launch week could not be loaded." />
      ) : !launchWeek ? (
        <p className="text-muted-foreground">Loading launch week…</p>
      ) : !launchWeek.enabled ? (
        <Unavailable message="Launch week is not live yet." />
      ) : (
        <LaunchWeekContent launchWeek={launchWeek} onLaunchReached={loadLaunchWeek} />
      )}
    </LandingShell>
  )
}

function LaunchWeekContent({
  launchWeek,
  onLaunchReached,
}: {
  launchWeek: ActiveLaunchWeek
  onLaunchReached: () => Promise<void>
}) {
  const palette = usePalette()
  const link = { color: palette.accent }
  const nextLaunch = launchWeek.days.find((day) => day.status === 'upcoming')
  const lastDay = launchWeek.days[launchWeek.days.length - 1]

  return (
    <>
      <p className="text-[12px] tabular-nums text-muted-foreground">
        {readableDate(launchWeek.startDate)} – {readableDate(lastDay.date)}
      </p>

      <h1 className="mt-3 flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <span aria-hidden="true" style={link}>
          |
        </span>
        <span>{launchWeek.headline}</span>
      </h1>

      <p className="mt-6 text-muted-foreground">{launchWeek.description}</p>

      {nextLaunch ? (
        <LaunchCountdown
          date={nextLaunch.date}
          dayName={nextLaunch.name}
          onReached={onLaunchReached}
        />
      ) : null}

      {/* At-a-glance grid: hairline cells, today washed in accent. */}
      <ul className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-7">
        {launchWeek.days.map((day) => (
          <li
            key={day.date}
            className="flex min-h-20 flex-row items-center justify-between gap-2 bg-background p-3 sm:min-h-24 sm:flex-col sm:items-start"
            style={day.status === 'today' ? { background: palette.accent, color: palette.accentInk } : undefined}
          >
            <span className="text-[11px] font-medium">{day.name.slice(0, 3)}</span>
            <span
              className={
                day.status === 'today' ? 'text-[11px]' : 'text-[11px] text-muted-foreground'
              }
            >
              {day.status === 'upcoming' ? 'Locked' : day.status === 'today' ? 'Today' : 'Open'}
            </span>
            <span className="text-[11px] tabular-nums sm:mt-auto">{readableDate(day.date)}</span>
          </li>
        ))}
      </ul>

      {/* Day-by-day detail. */}
      {launchWeek.days.map((day, index) => (
        <section key={day.date} className="mt-10 border-t border-dashed border-border pt-8">
          <div className="flex items-baseline gap-3">
            <h2
              className="text-[15px] font-semibold"
              style={day.status === 'today' ? link : undefined}
            >
              {day.name}
            </h2>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              Day {index + 1} · {readableDate(day.date)}
            </span>
          </div>

          {day.offer ? (
            <div className="mt-4">
              <p className="text-[15px] font-medium">{day.offer.title}</p>
              <p className="mt-2 text-[13px] text-muted-foreground">{day.offer.description}</p>
              {day.offer.ctaUrl ? (
                <p className="mt-4">
                  <a href={day.offer.ctaUrl} className={LINK} style={link}>
                    {day.offer.ctaLabel} →
                  </a>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-muted-foreground">
              Opens on {day.name}, {readableDate(day.date)}.
            </p>
          )}
        </section>
      ))}

      <p className="mt-12 border-t border-dashed border-border pt-8">
        <Link to="/app" className={LINK} style={link}>
          Open Loora →
        </Link>
      </p>
    </>
  )
}

function timeUntil(date: string) {
  const remaining = Math.max(0, new Date(`${date}T00:00:00Z`).getTime() - Date.now())
  return {
    total: remaining,
    days: Math.floor(remaining / 86_400_000),
    hours: Math.floor((remaining / 3_600_000) % 24),
    minutes: Math.floor((remaining / 60_000) % 60),
    seconds: Math.floor((remaining / 1_000) % 60),
  }
}

function LaunchCountdown({
  date,
  dayName,
  onReached,
}: {
  date: string
  dayName: string
  onReached: () => Promise<void>
}) {
  const palette = usePalette()
  const link = { color: palette.accent }
  const [remaining, setRemaining] = useState(() => timeUntil(date))

  useEffect(() => {
    let lastRefresh = 0
    const update = () => {
      const next = timeUntil(date)
      setRemaining(next)
      if (next.total === 0 && Date.now() - lastRefresh >= 5_000) {
        lastRefresh = Date.now()
        void onReached()
      }
    }
    update()
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [date, onReached])

  return (
    <section className="mt-10 border-t border-dashed border-border pt-8">
      <h2 className="text-[15px] font-semibold">
        Next launch: <span style={link}>{dayName}</span>
      </h2>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Unlocks {readableDate(date)} at 00:00 UTC.
      </p>
      <div
        role="timer"
        aria-label={`${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes, ${remaining.seconds} seconds until the next launch`}
        className="mt-5 flex gap-6 tabular-nums"
      >
        <CountdownUnit value={remaining.days} label="days" />
        <CountdownUnit value={remaining.hours} label="hrs" />
        <CountdownUnit value={remaining.minutes} label="min" />
        <CountdownUnit value={remaining.seconds} label="sec" />
      </div>
    </section>
  )
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[24px] font-semibold leading-none">{String(value).padStart(2, '0')}</span>
      <span className="mt-1.5 text-[10px] text-muted-foreground">{label}</span>
    </span>
  )
}

function Unavailable({ message }: { message: string }) {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <div>
      <h1 className="flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <span aria-hidden="true" style={link}>
          |
        </span>
        <span>Launch week</span>
      </h1>
      <p className="mt-6 text-muted-foreground">{message}</p>
      <p className="mt-8">
        <Link to="/" className={LINK} style={link}>
          Back to Loora →
        </Link>
      </p>
    </div>
  )
}