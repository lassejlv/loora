import { useEffect, useState } from 'react'
import { orpc } from '@loora/rpc/client'
import { Button } from '@loora/ui/button'
import { Input } from '@loora/ui/input'
import { Label } from '@loora/ui/label'
import { Switch } from '@loora/ui/switch'
import { Textarea } from '@loora/ui/textarea'

type LaunchWeekConfig = Awaited<ReturnType<typeof orpc.admin.launchWeek.get>>
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function emptyDay(
  index: number,
  releaseTime: string,
): LaunchWeekConfig['days'][number] {
  return {
    title: `${DAY_NAMES[index]} release`,
    description: 'Describe what launches today and why it matters.',
    ctaLabel: '',
    ctaUrl: '',
    releaseTime,
  }
}

function formatDate(value: string, index: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + index)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function AdminLaunchWeek() {
  const [config, setConfig] = useState<LaunchWeekConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void orpc.admin.launchWeek.get()
      .then(setConfig)
      .catch(() => setMessage('Could not load launch week.'))
  }, [])

  if (!config) {
    return <p className="text-xs text-muted-foreground">{message || 'Loading launch week…'}</p>
  }

  const updateDay = (index: number, patch: Partial<LaunchWeekConfig['days'][number]>) => {
    setConfig((current) => {
      if (!current) return current
      const days = [...current.days]
      days[index] = { ...days[index], ...patch }
      return { ...current, days }
    })
  }

  const setDayCount = (count: 5 | 7) => {
    const days = Array.from(
      { length: count },
      (_, index) => config.days[index] ?? emptyDay(index, config.releaseTime),
    )
    setConfig({ ...config, days })
  }

  const applyDefaultTimeToAll = () => {
    setConfig({
      ...config,
      days: config.days.map((day) => ({ ...day, releaseTime: config.releaseTime })),
    })
  }

  return (
    <section className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h2 className="text-sm font-semibold">Launch week</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Schedule five or seven daily releases at <span className="font-mono">/launch-week</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="launch-week-enabled" className="text-xs">
            {config.enabled ? 'Live' : 'Hidden'}
          </Label>
          <Switch
            id="launch-week-enabled"
            checked={config.enabled}
            onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
          />
        </div>
      </div>

      <div className="space-y-5 p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_140px_140px]">
          <div className="space-y-1.5">
            <Label htmlFor="launch-week-headline">Headline</Label>
            <Input
              id="launch-week-headline"
              value={config.headline}
              onChange={(event) => setConfig({ ...config, headline: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="launch-week-start">Week starts</Label>
            <Input
              id="launch-week-start"
              type="date"
              nativeInput
              value={config.startDate}
              onChange={(event) => setConfig({ ...config, startDate: event.target.value })}
            />
            <p className="text-2xs text-muted-foreground">Choose a Monday.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="launch-week-release-time">Default time</Label>
            <Input
              id="launch-week-release-time"
              type="time"
              nativeInput
              value={config.releaseTime}
              onChange={(event) => setConfig({ ...config, releaseTime: event.target.value.slice(0, 5) })}
            />
            <button
              type="button"
              className="text-2xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={applyDefaultTimeToAll}
            >
              Apply to all days
            </button>
          </div>
          <div className="space-y-1.5">
            <Label>Campaign length</Label>
            <div className="grid grid-cols-2 gap-1" role="group" aria-label="Campaign length">
              {([5, 7] as const).map((count) => (
                <Button
                  key={count}
                  size="sm"
                  variant={config.days.length === count ? 'secondary' : 'outline'}
                  aria-pressed={config.days.length === count}
                  onClick={() => setDayCount(count)}
                >
                  {count} days
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="launch-week-description">Introduction</Label>
          <Textarea
            id="launch-week-description"
            value={config.description}
            onChange={(event) => setConfig({ ...config, description: event.target.value })}
          />
        </div>

        <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-2">
          {config.days.map((day, index) => (
            <div key={index} className="space-y-3 bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">{formatDate(config.startDate, index)}</p>
                  <p className="text-2xs text-muted-foreground">Day {index + 1}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`launch-day-${index}-time`}>Unlock (UTC)</Label>
                  <Input
                    id={`launch-day-${index}-time`}
                    type="time"
                    nativeInput
                    value={day.releaseTime}
                    onChange={(event) => updateDay(index, { releaseTime: event.target.value.slice(0, 5) })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`launch-day-${index}-title`}>Offer title</Label>
                <Input
                  id={`launch-day-${index}-title`}
                  value={day.title}
                  onChange={(event) => updateDay(index, { title: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`launch-day-${index}-description`}>What ships</Label>
                <Textarea
                  id={`launch-day-${index}-description`}
                  size="sm"
                  value={day.description}
                  onChange={(event) => updateDay(index, { description: event.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`launch-day-${index}-cta`}>Link label</Label>
                  <Input
                    id={`launch-day-${index}-cta`}
                    placeholder="Optional"
                    value={day.ctaLabel}
                    onChange={(event) => updateDay(index, { ctaLabel: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`launch-day-${index}-url`}>Link URL</Label>
                  <Input
                    id={`launch-day-${index}-url`}
                    placeholder="/features"
                    value={day.ctaUrl}
                    onChange={(event) => updateDay(index, { ctaUrl: event.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className={message.startsWith('Saved') ? 'text-xs text-emerald-600' : 'text-xs text-destructive-foreground'}>
            {message}
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setMessage('')
              try {
                const saved = await orpc.admin.launchWeek.save(config)
                setConfig(saved)
                setMessage(saved.enabled ? 'Saved. Launch week is live.' : 'Saved. Launch week is hidden.')
              } catch (cause) {
                setMessage(cause instanceof Error ? cause.message : 'Could not save launch week.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Save launch week'}
          </Button>
        </div>
      </div>
    </section>
  )
}
